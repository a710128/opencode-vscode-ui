import * as vscode from "vscode"
import * as path from "node:path"
import { URL } from "node:url"
import { imageMimeFromFilename, supportedImageMime } from "../../bridge/image-attachments"
import { postToWebview } from "../../bridge/host"
import type { ComposerPromptPart, SessionPanelRef } from "../../bridge/types"
import type { MessageInfo, MessagePart, PermissionReply, PromptPartInput } from "../../core/sdk"
import { WorkspaceManager } from "../../core/workspace"
import { text, textError, wait } from "./utils"
import { friendlyShellSubmitError } from "./shell-errors"
import { parseComposerFileQuery } from "../webview/lib/composer-file-selection"

export type PanelActionState = {
  disposed: boolean
  run: number
  pendingSubmitCount: number
}

type ActionContext = {
  ref: SessionPanelRef
  mgr: WorkspaceManager
  panel: vscode.WebviewPanel
  state: PanelActionState
  log: (message: string) => void
  push: (force?: boolean) => Promise<void>
  syncSubmitting: () => Promise<void>
}

export async function submit(ctx: ActionContext, textValue: string, parts?: ComposerPromptPart[], agent?: string, model?: MessageInfo["model"], variant?: string) {
  if ((!textValue.trim() && !hasPromptContent(parts)) || ctx.state.disposed) {
    return
  }

  const rt = ctx.mgr.get(ctx.ref.workspaceId)

  if (!rt || rt.state !== "ready" || !rt.sdk) {
    await restoreSubmittedComposer(ctx.panel.webview, textValue, parts)
    await fail(ctx.panel.webview, "Workspace server is not ready.")
    return
  }

  const run = ++ctx.state.run
  ctx.state.pendingSubmitCount += 1
  await ctx.syncSubmitting()

  try {
    const prompt = toPromptParts(ctx.ref.dir, textValue, parts)
    await rt.sdk.session.promptAsync({
      sessionID: ctx.ref.sessionId,
      directory: rt.dir,
      agent,
      model,
      variant,
      parts: prompt,
    })
    await wait(400)
  } catch (err) {
    const message = textError(err)
    ctx.log(`submit failed: ${message}`)
    await restoreSubmittedComposer(ctx.panel.webview, textValue, parts)
    await vscode.window.showErrorMessage(`OpenCode message send failed for ${rt.name}: ${message}`)
    await fail(ctx.panel.webview, message)
  } finally {
    ctx.state.pendingSubmitCount = Math.max(0, ctx.state.pendingSubmitCount - 1)
    if (!ctx.state.disposed && run === ctx.state.run) {
      await ctx.syncSubmitting()
    }
  }
}

export async function toggleMcp(ctx: ActionContext, name: string, action: "connect" | "disconnect" | "reconnect") {
  if (!name || ctx.state.disposed) {
    return
  }

  const rt = ctx.mgr.get(ctx.ref.workspaceId)
  if (!rt || rt.state !== "ready" || !rt.sdk) {
    return
  }

  try {
    if (action === "disconnect") {
      await rt.sdk.mcp.disconnect({ name, directory: rt.dir })
    } else {
      await rt.sdk.mcp.connect({ name, directory: rt.dir })
    }
    await ctx.push(true)
  } catch (err) {
    const message = `Failed to update MCP ${name}: ${text(err)}`
    ctx.log(message)
    void vscode.window.showErrorMessage(message)
    await ctx.push(true)
  } finally {
    await postToWebview(ctx.panel.webview, {
      type: "mcpActionFinished",
      name,
    })
  }
}

export async function runSlashCommand(ctx: ActionContext, command: string, args: string, agent?: string, model?: string, variant?: string) {
  if (!command || ctx.state.disposed) {
    return
  }

  const rt = ctx.mgr.get(ctx.ref.workspaceId)
  if (!rt || rt.state !== "ready" || !rt.sdk) {
    await fail(ctx.panel.webview, "Workspace server is not ready.")
    return
  }

  const run = ++ctx.state.run
  ctx.state.pendingSubmitCount += 1
  await ctx.syncSubmitting()

  try {
    await rt.sdk.session.command({
      sessionID: ctx.ref.sessionId,
      directory: rt.dir,
      command,
      arguments: args,
      agent,
      model,
      variant,
    })
    await wait(400)
  } catch (err) {
    const message = textError(err)
    ctx.log(`slash command failed: ${command} ${message}`)
    await vscode.window.showErrorMessage(`OpenCode command /${command} failed for ${rt.name}: ${message}`)
    await fail(ctx.panel.webview, message)
  } finally {
    ctx.state.pendingSubmitCount = Math.max(0, ctx.state.pendingSubmitCount - 1)
    if (!ctx.state.disposed && run === ctx.state.run) {
      await ctx.syncSubmitting()
    }
  }
}

export async function runShellCommand(ctx: ActionContext, command: string, agent?: string, model?: MessageInfo["model"], variant?: string) {
  if (!command.trim() || ctx.state.disposed) {
    return
  }

  const rt = ctx.mgr.get(ctx.ref.workspaceId)
  if (!rt || rt.state !== "ready" || !rt.sdk) {
    await fail(ctx.panel.webview, "Workspace server is not ready.")
    return
  }

  const run = ++ctx.state.run
  ctx.state.pendingSubmitCount += 1
  await ctx.syncSubmitting()

  try {
    await rt.sdk.session.shell({
      sessionID: ctx.ref.sessionId,
      directory: rt.dir,
      command,
      agent,
      model: model ? { providerID: model.providerID, modelID: model.modelID } : undefined,
      variant,
    })

    ctx.panel.webview.postMessage({ type: "shellCommandSucceeded" })
    await wait(400)
  } catch (err) {
    const rawMessage = textError(err)
    const message = friendlyShellSubmitError(rawMessage)
    ctx.log(`shell command failed: ${rawMessage}`)
    ctx.panel.webview.postMessage({
      type: "restoreComposer",
      parts: [{ type: "text", text: command }],
    })
    await vscode.window.showErrorMessage(message)
  } finally {
    ctx.state.pendingSubmitCount = Math.max(0, ctx.state.pendingSubmitCount - 1)
    if (!ctx.state.disposed && run === ctx.state.run) {
      await ctx.syncSubmitting()
    }
  }
}


export async function runComposerAction(ctx: ActionContext, action: "refreshSession" | "compactSession" | "undoSession" | "redoSession" | "interruptSession", model?: MessageInfo["model"]) {
  if (ctx.state.disposed) {
    return
  }

  const rt = ctx.mgr.get(ctx.ref.workspaceId)

  try {
    if (action === "refreshSession") {
      await ctx.push(true)
      return
    }

    if (action === "compactSession") {
      if (!rt || rt.state !== "ready" || !rt.sdk) {
        await fail(ctx.panel.webview, "Workspace server is not ready.")
        return
      }

      if (!model?.providerID || !model.modelID) {
        const message = "Connect or select a model before running /compact."
        ctx.log(message)
        await vscode.window.showErrorMessage(message)
        await fail(ctx.panel.webview, message)
        return
      }

      const run = ++ctx.state.run
      ctx.state.pendingSubmitCount += 1
      await ctx.syncSubmitting()

      try {
        await rt.sdk.session.summarize({
          sessionID: ctx.ref.sessionId,
          directory: rt.dir,
          providerID: model.providerID,
          modelID: model.modelID,
          auto: false,
        })
        await wait(400)
      } finally {
        ctx.state.pendingSubmitCount = Math.max(0, ctx.state.pendingSubmitCount - 1)
        if (!ctx.state.disposed && run === ctx.state.run) {
          await ctx.syncSubmitting()
        }
      }
      return
    }

    if (action === "interruptSession") {
      if (!rt || rt.state !== "ready" || !rt.sdk) {
        await fail(ctx.panel.webview, "Workspace server is not ready.")
        return
      }

      const status = (await rt.sdk.session.status({
        directory: rt.dir,
      })).data?.[ctx.ref.sessionId]

      if (!status?.type || status.type === "idle") {
        return
      }

      await rt.sdk.session.abort({
        sessionID: ctx.ref.sessionId,
        directory: rt.dir,
      })
      await wait(200)
      await ctx.push(true)
      return
    }

    if (action === "undoSession") {
      if (!rt || rt.state !== "ready" || !rt.sdk) {
        await fail(ctx.panel.webview, "Workspace server is not ready.")
        return
      }

      const run = ++ctx.state.run
      ctx.state.pendingSubmitCount += 1
      await ctx.syncSubmitting()

      try {
        const status = (await rt.sdk.session.status({
          directory: rt.dir,
        })).data?.[ctx.ref.sessionId]
        if (status?.type && status.type !== "idle") {
          await rt.sdk.session.abort({
            sessionID: ctx.ref.sessionId,
            directory: rt.dir,
          }).catch(() => {})
        }

        const session = (await rt.sdk.session.get({
          sessionID: ctx.ref.sessionId,
          directory: rt.dir,
        })).data
        const revert = session?.revert?.messageID
        const msgs = (await rt.sdk.session.messages({
          sessionID: ctx.ref.sessionId,
          directory: rt.dir,
        })).data ?? []
        const msg = [...msgs].reverse().find((item) => item.info.role === "user" && (!revert || item.info.id < revert))
        if (!msg) {
          return
        }

        await postToWebview(ctx.panel.webview, {
          type: "restoreComposer",
          parts: undoRestoreParts(msg),
        })

        await rt.sdk.session.revert({
          sessionID: ctx.ref.sessionId,
          directory: rt.dir,
          messageID: msg.info.id,
        })
        await wait(400)
      } finally {
        ctx.state.pendingSubmitCount = Math.max(0, ctx.state.pendingSubmitCount - 1)
        if (!ctx.state.disposed && run === ctx.state.run) {
          await ctx.syncSubmitting()
        }
      }
      return
    }

    if (action === "redoSession") {
      if (!rt || rt.state !== "ready" || !rt.sdk) {
        await fail(ctx.panel.webview, "Workspace server is not ready.")
        return
      }

      const run = ++ctx.state.run
      ctx.state.pendingSubmitCount += 1
      await ctx.syncSubmitting()

      try {
        const session = (await rt.sdk.session.get({
          sessionID: ctx.ref.sessionId,
          directory: rt.dir,
        })).data
        const revert = session?.revert?.messageID
        if (!revert) {
          return
        }

        const msgs = (await rt.sdk.session.messages({
          sessionID: ctx.ref.sessionId,
          directory: rt.dir,
        })).data ?? []
        const msg = msgs.find((item) => item.info.role === "user" && item.info.id > revert)
        if (!msg) {
          await rt.sdk.session.unrevert({
            sessionID: ctx.ref.sessionId,
            directory: rt.dir,
          })
        } else {
          await rt.sdk.session.revert({
            sessionID: ctx.ref.sessionId,
            directory: rt.dir,
            messageID: msg.info.id,
          })
        }

        await wait(400)
      } finally {
        ctx.state.pendingSubmitCount = Math.max(0, ctx.state.pendingSubmitCount - 1)
        if (!ctx.state.disposed && run === ctx.state.run) {
          await ctx.syncSubmitting()
        }
      }
      return
    }
  } catch (err) {
    const message = textError(err)
    ctx.log(`composer action failed: ${action} ${message}`)
    await fail(ctx.panel.webview, message)
    return
  }

  const message = `Unsupported composer action: ${action}`
  ctx.log(message)
  await fail(ctx.panel.webview, message)
}

function undoRestoreParts(message: { parts: MessagePart[] }): ComposerPromptPart[] {
  const text = message.parts
    .flatMap((part) => part.type === "text" && !part.synthetic ? [{ type: "text" as const, text: part.text }] : [])
    .reduce((acc, part) => acc + part.text, "")

  const files = message.parts.flatMap((part): ComposerPromptPart[] => {
    if (part.type !== "file" || !part.source) {
      if (part.type === "file" && supportedImageMime(part.mime) && part.url.startsWith("data:")) {
        return [{
          type: "image",
          id: `restored:${part.id}`,
          filename: part.filename || "Pasted Image",
          mime: part.mime,
          dataUrl: part.url,
        }]
      }
      return []
    }

    if (part.source.type === "file") {
      const parsed = parseRestoredFileSource(part.source.path, part.source.text.value, part.mime)
      return [{
        type: "file",
        path: parsed.path,
        kind: parsed.kind,
        selection: parsed.selection,
        source: part.source.text,
      }]
    }

    if (part.source.type === "resource") {
      return [{
        type: "resource",
        uri: part.source.uri,
        name: part.filename || part.source.uri,
        clientName: part.source.clientName,
        mimeType: part.mime,
        source: part.source.text,
      }]
    }

    const parsed = parseRestoredFileSource(part.source.path, part.source.text.value, part.mime)
    return [{
      type: "file",
      path: parsed.path,
      kind: parsed.kind,
      selection: parsed.selection,
      source: part.source.text,
    }]
  })

  return text ? [{ type: "text", text }, ...files] : files
}

function parseRestoredFileSource(path: string, value: string, mime?: string) {
  const raw = value.startsWith("@") ? value.slice(1) : value
  const parsed = parseComposerFileQuery(raw)
  return {
    path: parsed.baseQuery || path,
    selection: parsed.selection,
    kind: mime === "application/x-directory" || (parsed.baseQuery || path).endsWith("/") ? "directory" as const : "file" as const,
  }
}

export async function replyPermission(ctx: ActionContext, requestID: string, reply: PermissionReply, message?: string) {
  const rt = ctx.mgr.get(ctx.ref.workspaceId)

  if (!rt || rt.state !== "ready" || !rt.sdk) {
    await fail(ctx.panel.webview, "Workspace server is not ready.")
    return
  }

  try {
    await rt.sdk.permission.reply({
      requestID,
      directory: rt.dir,
      reply,
      message,
    })
    await ctx.push(true)
  } catch (err) {
    const msg = textError(err)
    ctx.log(`permission reply failed: ${msg}`)
    await fail(ctx.panel.webview, msg)
  }
}

export async function replyQuestion(ctx: ActionContext, requestID: string, answers: string[][]) {
  const rt = ctx.mgr.get(ctx.ref.workspaceId)

  if (!rt || rt.state !== "ready" || !rt.sdk) {
    await fail(ctx.panel.webview, "Workspace server is not ready.")
    return
  }

  try {
    await rt.sdk.question.reply({
      requestID,
      directory: rt.dir,
      answers,
    })
    await ctx.push(true)
  } catch (err) {
    const msg = textError(err)
    ctx.log(`question reply failed: ${msg}`)
    await fail(ctx.panel.webview, msg)
  }
}

export async function rejectQuestion(ctx: ActionContext, requestID: string) {
  const rt = ctx.mgr.get(ctx.ref.workspaceId)

  if (!rt || rt.state !== "ready" || !rt.sdk) {
    await fail(ctx.panel.webview, "Workspace server is not ready.")
    return
  }

  try {
    await rt.sdk.question.reject({
      requestID,
      directory: rt.dir,
    })
    await ctx.push(true)
  } catch (err) {
    const msg = textError(err)
    ctx.log(`question reject failed: ${msg}`)
    await fail(ctx.panel.webview, msg)
  }
}

export async function fail(webview: vscode.Webview, message: string) {
  await postToWebview(webview, {
    type: "error",
    message,
  })
}

function toPromptParts(workspaceDir: string, textValue: string, parts?: ComposerPromptPart[]): PromptPartInput[] {
  if (!parts || parts.length === 0) {
    return [{ type: "text", text: textValue }]
  }

  const out: PromptPartInput[] = []
  for (const part of parts) {
    if (part.type === "text") {
      out.push(part)
      continue
    }
    if (part.type === "agent") {
      out.push(part)
      continue
    }

    if (part.type === "resource") {
      out.push({
        type: "file",
        mime: part.mimeType ?? "text/plain",
        filename: part.name,
        url: part.uri,
        source: {
          type: "resource",
          uri: part.uri,
          clientName: part.clientName,
          text: part.source,
        },
      })
      continue
    }

    if (part.type === "image") {
      out.push({
        type: "file",
        mime: part.mime,
        filename: part.filename,
        url: part.dataUrl,
      })
      continue
    }

    const filePath = absolutePath(workspaceDir, part.path)
    const mime = imageMimeFromFilename(part.path) ?? "text/plain"

    out.push({
      type: "file",
      mime,
      filename: path.basename(part.path),
      url: fileUrl(filePath, part.selection),
      source: {
        type: "file",
        path: filePath,
        text: part.source,
      },
    })
  }

  return out.length > 0 ? out : [{ type: "text", text: textValue }]
}

function hasPromptContent(parts?: ComposerPromptPart[]) {
  return !!parts?.some((part) => part.type === "image" || (part.type === "text" && part.text.trim()))
}

async function restoreSubmittedComposer(webview: vscode.Webview, textValue: string, parts?: ComposerPromptPart[]) {
  const restoreParts = parts && parts.length > 0
    ? parts
    : textValue.trim()
      ? [{ type: "text" as const, text: textValue }]
      : []

  if (restoreParts.length === 0) {
    return
  }

  await postToWebview(webview, {
    type: "restoreComposer",
    parts: restoreParts,
  })
}

function absolutePath(dir: string, file: string) {
  if (file.startsWith("/")) {
    return file
  }
  if (/^[A-Za-z]:[\\/]/.test(file) || /^[A-Za-z]:$/.test(file)) {
    return file
  }
  if (file.startsWith("\\\\") || file.startsWith("//")) {
    return file
  }
  return `${dir.replace(/[\\/]+$/, "")}/${file}`
}

function fileUrl(file: string, selection?: { startLine: number; endLine?: number }) {
  const url = new URL(`file://${encodeFilePath(file)}`)
  if (!selection) {
    return url.toString()
  }

  url.searchParams.set("start", String(selection.startLine))
  if (selection.endLine) {
    url.searchParams.set("end", String(selection.endLine))
  }
  return url.toString()
}

function encodeFilePath(file: string) {
  const normalized = /^[A-Za-z]:/.test(file.replace(/\\/g, "/"))
    ? `/${file.replace(/\\/g, "/")}`
    : file.replace(/\\/g, "/")

  return normalized
    .split("/")
    .map((segment, index) => (index === 1 && /^[A-Za-z]:$/.test(segment) ? segment : encodeURIComponent(segment)))
    .join("/")
}
