import * as vscode from "vscode"
import { isMissingOpencodeError, missingOpencodeMessage } from "../core/runtime-errors"
import { SessionStore } from "../core/session"
import { WorkspaceManager } from "../core/workspace"
import { SessionItem, StatusItem, WorkspaceItem } from "./item"

export class SidebarProvider implements vscode.TreeDataProvider<vscode.TreeItem> {
  private change = new vscode.EventEmitter<void>()

  readonly onDidChangeTreeData = this.change.event

  constructor(
    private mgr: WorkspaceManager,
    private sessions: SessionStore,
  ) {
    this.mgr.onDidChange(() => {
      this.refresh()
    })
  }

  refresh() {
    this.change.fire()
  }

  getTreeItem(item: vscode.TreeItem) {
    return item
  }

  getChildren(item?: vscode.TreeItem) {
    if (!item) {
      const list = this.mgr.list()

      if (list.length) {
        return list.map((rt) => new WorkspaceItem(rt))
      }

      return [new StatusItem("No workspace folders open")]
    }

    if (item instanceof WorkspaceItem) {
      const rt = this.mgr.get(item.runtime.workspaceId) ?? item.runtime

      if (rt.state === "idle") {
        return [new StatusItem("Server not started", "click Start to start")]
      }

      if (rt.state === "starting") {
        return [new StatusItem(rt.url ? `Starting server on ${rt.url}` : "Starting server...")]
      }

      if (rt.state === "error") {
        if (isMissingOpencodeError(rt.err)) {
          return [new StatusItem("opencode is not available", missingOpencodeMessage(rt))]
        }

        return [new StatusItem(rt.err ? `Error: ${rt.err}` : "Server failed")]
      }

      if (rt.state !== "ready") {
        return [new StatusItem("Server stopped")]
      }

      if (rt.sessionsState === "loading" && !rt.sessions.size) {
        return [new StatusItem("Loading sessions...")]
      }

      const list = this.sessions.list(rt.workspaceId).map((session) => new SessionItem(rt, session, rt.sessionStatuses.get(session.id)))

      if (rt.sessionsErr) {
        return [new StatusItem(`Session error: ${rt.sessionsErr}`), ...list]
      }

      if (list.length) {
        return list
      }

      return [new StatusItem("No sessions")]
    }

    return []
  }

  dispose() {
    this.change.dispose()
  }
}
