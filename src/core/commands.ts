import * as vscode from "vscode"
import { SessionItem, WorkspaceItem } from "../sidebar/item"
import { SessionStore } from "./session"
import { TabManager } from "./tabs"
import { WorkspaceManager } from "./workspace"

export function commands(
  ctx: vscode.ExtensionContext,
  mgr: WorkspaceManager,
  sessions: SessionStore,
  out: vscode.OutputChannel,
  tabs: TabManager,
) {
  ctx.subscriptions.push(
    vscode.commands.registerCommand("opencode-ui.refresh", async () => {
      const folders = vscode.workspace.workspaceFolders ?? []
      await mgr.sync(folders)
      await sessions.refreshAll()
    }),
    vscode.commands.registerCommand("opencode-ui.openOutput", () => {
      out.show(true)
    }),
    vscode.commands.registerCommand("opencode-ui.newSession", async (item?: WorkspaceItem) => {
      const dir = item?.runtime.dir ?? vscode.workspace.workspaceFolders?.[0]?.uri.fsPath

      if (!dir) {
        await vscode.window.showInformationMessage("Open a workspace folder first.")
        return
      }

      const rt = mgr.get(dir)

      if (!rt || rt.state !== "ready") {
        await vscode.window.showInformationMessage("Wait for the workspace server to become ready first.")
        return
      }

      const session = await sessions.create(dir)
      await vscode.window.showInformationMessage(`Created session ${session.title || session.id.slice(0, 8)}.`)
    }),
    vscode.commands.registerCommand("opencode-ui.restartWorkspaceServer", async (item?: WorkspaceItem) => {
      const dir = item?.runtime.dir

      if (!dir) {
        await vscode.window.showInformationMessage("Pick a workspace item to restart its server.")
        return
      }

      await mgr.restart(dir)
      await sessions.refresh(dir, true)
    }),
    vscode.commands.registerCommand("opencode-ui.refreshWorkspaceSessions", async (item?: WorkspaceItem) => {
      const dir = item?.runtime.dir

      if (!dir) {
        await vscode.window.showInformationMessage("Pick a workspace item to refresh its sessions.")
        return
      }

      await sessions.refresh(dir)
    }),
    vscode.commands.registerCommand("opencode-ui.openSession", async (item?: SessionItem) => {
      if (!item) {
        await vscode.window.showInformationMessage("Pick a session item first.")
        return
      }

      await tabs.openSession(item.runtime.dir, item.session)
    }),
    vscode.commands.registerCommand("opencode-ui.openSessionById", async (dir?: string, sessionID?: string) => {
      if (!dir || !sessionID) {
        return
      }

      const rt = mgr.get(dir)

      if (!rt || rt.state !== "ready" || !rt.sdk) {
        await vscode.window.showInformationMessage("Wait for the workspace server to become ready first.")
        return
      }

      const res = await rt.sdk.session.get({
        sessionID,
        directory: dir,
      })

      if (!res.data) {
        await vscode.window.showInformationMessage("Session was not found.")
        return
      }

      await tabs.openSession(dir, res.data)
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

      await sessions.delete(item.runtime.dir, item.session.id)
      tabs.closeSession(item.runtime.dir, item.session.id)
    }),
  )
}
