import * as vscode from "vscode"
import * as path from "node:path"
import { postToWebview } from "../../bridge/host"
import type { ComposerPromptPart, SessionPanelRef } from "../../bridge/types"
import type { MessageInfo, PermissionReply, PromptPartInput } from "../../core/sdk"
import { WorkspaceManager } from "../../core/workspace"
import { text, textError, wait } from "./utils"
import { resolveFileUri } from "./files"

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
}

export async function submit(ctx: ActionContext, textValue: string, parts?: ComposerPromptPart[], agent?: string, model?: MessageInfo["model"]) {
  const value = textValue.trim()

  if (!value || ctx.state.disposed) {
    return
  }

  const rt = ctx.mgr.get(ctx.ref.dir)

  if (!rt || rt.state !== "ready" || !rt.sdk) {
    await fail(ctx.panel.webview, "Workspace server is not ready.")
    return
  }

  const run = ++ctx.state.run
  ctx.state.pendingSubmitCount += 1
  await ctx.push(true)

  try {
    const prompt = await toPromptParts(ctx.ref.dir, value, parts)
    await rt.sdk.session.promptAsync({
      sessionID: ctx.ref.sessionId,
      directory: rt.dir,
      agent,
      model,
      parts: prompt,
    })
    await wait(400)
    if (!ctx.state.disposed && run === ctx.state.run) {
      await ctx.push(true)
    }
  } catch (err) {
    const message = textError(err)
    ctx.log(`submit failed: ${message}`)
    await vscode.window.showErrorMessage(`OpenCode message send failed for ${rt.name}: ${message}`)
    await fail(ctx.panel.webview, message)
  } finally {
    ctx.state.pendingSubmitCount = Math.max(0, ctx.state.pendingSubmitCount - 1)
    await ctx.push(true)
  }
}

export async function toggleMcp(ctx: ActionContext, name: string, action: "connect" | "disconnect" | "reconnect") {
  if (!name || ctx.state.disposed) {
    return
  }

  const rt = ctx.mgr.get(ctx.ref.dir)
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

export async function runComposerAction(ctx: ActionContext, action: "refreshSession") {
  if (ctx.state.disposed) {
    return
  }

  try {
    if (action === "refreshSession") {
      await ctx.push(true)
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

export async function replyPermission(ctx: ActionContext, requestID: string, reply: PermissionReply, message?: string) {
  const rt = ctx.mgr.get(ctx.ref.dir)

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
  const rt = ctx.mgr.get(ctx.ref.dir)

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
  const rt = ctx.mgr.get(ctx.ref.dir)

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

async function toPromptParts(workspaceDir: string, textValue: string, parts?: ComposerPromptPart[]): Promise<PromptPartInput[]> {
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

    const uri = await resolveFileUri(workspaceDir, part.path)
    if (!uri) {
      out.push({ type: "text", text: part.source.value })
      continue
    }

    out.push({
      type: "file",
      mime: "text/plain",
      filename: path.basename(part.path),
      url: uri.toString(),
      source: {
        type: "file",
        path: uri.fsPath,
        text: part.source,
      },
    })
  }

  return out.length > 0 ? out : [{ type: "text", text: textValue }]
}
