import * as vscode from "vscode"
import { postToWebview } from "../../bridge/host"
import type { SessionPanelRef } from "../../bridge/types"
import type { PermissionReply } from "../../core/sdk"
import { WorkspaceManager } from "../../core/workspace"
import { text, textError, wait } from "./utils"

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

export async function submit(ctx: ActionContext, textValue: string) {
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
    await rt.sdk.session.promptAsync({
      sessionID: ctx.ref.sessionId,
      directory: rt.dir,
      parts: [
        {
          type: "text",
          text: value,
        },
      ],
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
