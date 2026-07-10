import * as vscode from "vscode"
import type { WorkspaceRef } from "../bridge/types"
import { openSettingsQuery } from "./settings"
import { checkOpencodeAvailable, runtimeNotReadyMessage } from "./runtime-errors"
import { SessionItem, WorkspaceItem } from "../sidebar/item"
import type { WorkspaceRuntime } from "./server"
import { SessionStore } from "./session"
import { TabManager } from "./tabs"
import { WorkspaceManager } from "./workspace"

export function commands(
  ctx: vscode.ExtensionContext,
  mgr: WorkspaceManager,
  sessions: SessionStore,
  out: vscode.OutputChannel,
  tabs: TabManager,
  syncTargets: () => Promise<void>,
) {
  ctx.subscriptions.push(
    vscode.commands.registerCommand("opencode-ui.refresh", async () => {
      await syncTargets()
      await sessions.refreshAll()
    }),
    vscode.commands.registerCommand("opencode-ui.openOutput", () => {
      out.show(true)
    }),
    vscode.commands.registerCommand("opencode-ui.openSettings", async () => {
      await vscode.commands.executeCommand("workbench.action.openSettings", openSettingsQuery())
    }),
    vscode.commands.registerCommand("opencode-ui.openProviderDocs", async () => {
      await vscode.env.openExternal(vscode.Uri.parse("https://opencode.ai/docs"))
    }),
    vscode.commands.registerCommand("opencode-ui.checkEnvironment", async () => {
      const host = vscode.env.remoteName || "local"
      const result = await checkOpencodeAvailable()

      if (result.ok) {
        await vscode.window.showInformationMessage(`opencode is available on the current ${host} host: ${result.output}`)
        return
      }

      await vscode.window.showErrorMessage(`OpenCode UI environment check failed on ${host}: ${result.message}`)
    }),
    vscode.commands.registerCommand("opencode-ui.newSession", async (item?: WorkspaceItem) => {
      const rt = await readyRuntime(mgr, item?.runtime ?? firstRuntime(mgr))

      if (!rt) {
        await vscode.window.showInformationMessage("Open a workspace folder first.")
        return
      }

      if (rt.state !== "ready") {
        await vscode.window.showErrorMessage(runtimeNotReadyMessage(rt))
        return
      }

      await vscode.commands.executeCommand("opencode-ui.newSessionAndOpen", workspaceRef(rt))
    }),
    vscode.commands.registerCommand("opencode-ui.newSessionAndOpen", async (workspace?: WorkspaceRef) => {
      const rt = await readyRuntime(mgr, workspace ? mgr.get(workspace.workspaceId) : firstRuntime(mgr))

      if (!rt) {
        await vscode.window.showInformationMessage("Open a workspace folder first.")
        return
      }

      if (rt.state !== "ready") {
        await vscode.window.showErrorMessage(runtimeNotReadyMessage(rt))
        return
      }

      const session = await sessions.create(rt.workspaceId)
      await vscode.commands.executeCommand("opencode-ui.openSessionById", workspaceRef(rt), session.id)
    }),
    vscode.commands.registerCommand("opencode-ui.startWorkspaceServer", async (item?: WorkspaceItem) => {
      const rt = item?.runtime

      if (!rt) {
        await vscode.window.showInformationMessage("Pick a workspace item to start its server.")
        return
      }

      const next = await mgr.start(rt.workspaceId)
      if (next?.state === "ready") {
        await sessions.refresh(next.workspaceId, true)
      } else {
        await vscode.window.showErrorMessage(runtimeNotReadyMessage(next))
      }
    }),
    vscode.commands.registerCommand("opencode-ui.restartWorkspaceServer", async (item?: WorkspaceItem) => {
      const rt = item?.runtime

      if (!rt) {
        await vscode.window.showInformationMessage("Pick a workspace item to restart its server.")
        return
      }

      await mgr.restart(rt.workspaceId)
      await sessions.refresh(rt.workspaceId, true)
    }),
    vscode.commands.registerCommand("opencode-ui.refreshWorkspaceSessions", async (item?: WorkspaceItem) => {
      const rt = item?.runtime

      if (!rt) {
        await vscode.window.showInformationMessage("Pick a workspace item to refresh its sessions.")
        return
      }

      await sessions.refresh(rt.workspaceId)
    }),
    vscode.commands.registerCommand("opencode-ui.openSession", async (item?: SessionItem) => {
      if (!item) {
        await vscode.window.showInformationMessage("Pick a session item first.")
        return
      }

      const rt = await readyRuntime(mgr, item.runtime)
      if (!rt || rt.state !== "ready") {
        await vscode.window.showErrorMessage(runtimeNotReadyMessage(rt))
        return
      }

      await tabs.openSession(workspaceRef(rt), item.session)
    }),
    vscode.commands.registerCommand("opencode-ui.openSessionById", async (workspace?: WorkspaceRef, sessionID?: string) => {
      if (!workspace || !sessionID) {
        return
      }

      const rt = await readyRuntime(mgr, mgr.get(workspace.workspaceId))

      if (!rt || rt.state !== "ready" || !rt.sdk) {
        await vscode.window.showErrorMessage(runtimeNotReadyMessage(rt))
        return
      }

      const res = await rt.sdk.session.get({
        sessionID,
        directory: rt.dir,
      })

      if (!res.data) {
        await vscode.window.showInformationMessage("Session was not found.")
        return
      }

      await tabs.openSession(workspaceRef(rt), res.data)
    }),
    vscode.commands.registerCommand("opencode-ui.deleteSession", async (item?: SessionItem) => {
      if (!item) {
        await vscode.window.showInformationMessage("Pick a session item first.")
        return
      }

      const label = item.session.title || item.session.id.slice(0, 8)
      const confirmed = await vscode.window.showWarningMessage(
        `Delete session "${label}"? This permanently removes its messages and history.`,
        { modal: true },
        "Delete Session",
      )

      if (confirmed !== "Delete Session") {
        return
      }

      await sessions.delete(item.runtime.workspaceId, item.session.id)
      tabs.closeSession(workspaceRef(item.runtime), item.session.id)
    }),
  )
}

function firstRuntime(mgr: WorkspaceManager): WorkspaceRuntime | undefined {
  return mgr.list()[0]
}

async function readyRuntime(mgr: WorkspaceManager, rt: WorkspaceRuntime | undefined) {
  if (rt?.state === "idle") {
    return await mgr.start(rt.workspaceId)
  }

  return rt
}

function workspaceRef(runtime: { workspaceId: string; dir: string }): WorkspaceRef {
  return {
    workspaceId: runtime.workspaceId,
    dir: runtime.dir,
  }
}
