import * as vscode from "vscode"
import type { SessionInfo } from "../core/sdk"
import type { WorkspaceRuntime } from "../core/server"

export class WorkspaceItem extends vscode.TreeItem {
  constructor(readonly runtime: WorkspaceRuntime) {
    super(runtime.name, vscode.TreeItemCollapsibleState.Expanded)
    this.id = runtime.dir
    this.description = desc(runtime)
    this.tooltip = `${runtime.dir}\n${runtime.url}`
    this.contextValue = "workspace"
    this.iconPath = icon(runtime.state)
  }
}

export class StatusItem extends vscode.TreeItem {
  constructor(label: string, description?: string) {
    super(label, vscode.TreeItemCollapsibleState.None)
    this.description = description
    this.contextValue = "status"
  }
}

export class SessionItem extends vscode.TreeItem {
  constructor(
    readonly runtime: WorkspaceRuntime,
    readonly session: SessionInfo,
  ) {
    super(session.title || session.id.slice(0, 8), vscode.TreeItemCollapsibleState.None)
    this.id = `${runtime.dir}:${session.id}`
    this.description = session.id.slice(0, 8)
    this.tooltip = `${session.title || session.id}\n${session.id}\n${runtime.dir}`
    this.contextValue = "session"
    this.iconPath = new vscode.ThemeIcon("comment-discussion")
    this.command = {
      command: "opencode-ui.openSession",
      title: "Open Session",
      arguments: [this],
    }
  }
}

function desc(runtime: WorkspaceRuntime) {
  if (runtime.state === "ready") {
    return `ready :${runtime.port}`
  }

  if (runtime.state === "starting") {
    return `starting :${runtime.port}`
  }

  if (runtime.state === "error") {
    return "error"
  }

  return "stopped"
}

function icon(state: WorkspaceRuntime["state"]) {
  if (state === "ready") {
    return new vscode.ThemeIcon("check")
  }

  if (state === "starting") {
    return new vscode.ThemeIcon("sync")
  }

  if (state === "error") {
    return new vscode.ThemeIcon("error")
  }

  return new vscode.ThemeIcon("circle-slash")
}
