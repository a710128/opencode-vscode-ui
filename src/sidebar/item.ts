import * as vscode from "vscode"
import { isMissingOpencodeError } from "../core/runtime-errors"
import type { SessionInfo, SessionStatus } from "../core/sdk"
import type { WorkspaceRuntime } from "../core/server"

export class WorkspaceItem extends vscode.TreeItem {
  constructor(readonly runtime: WorkspaceRuntime) {
    super(
      runtime.name,
      runtime.state === "idle" ? vscode.TreeItemCollapsibleState.Collapsed : vscode.TreeItemCollapsibleState.Expanded,
    )
    this.id = runtime.workspaceId
    this.description = desc(runtime)
    this.tooltip = runtime.url ? `${runtime.dir}\n${runtime.url}` : runtime.dir
    this.contextValue = runtime.state === "idle" ? "workspace-idle" : "workspace"
    this.iconPath = icon(runtime)
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
    status?: SessionStatus,
  ) {
    super(session.title || session.id.slice(0, 8), vscode.TreeItemCollapsibleState.None)
    this.id = `${runtime.workspaceId}:${session.id}`
    this.description = session.id.slice(0, 8)
    this.tooltip = `${session.title || session.id}\n${session.id}\n${runtime.dir}`
    this.contextValue = "session"
    this.iconPath = status?.type === "busy"
      ? new vscode.ThemeIcon("loading~spin")
      : new vscode.ThemeIcon("comment-discussion")
    this.command = {
      command: "opencode-ui.openSession",
      title: "Open Session",
      arguments: [this],
    }
  }
}

function desc(runtime: WorkspaceRuntime) {
  if (runtime.state === "idle") {
    return "idle"
  }

  if (runtime.state === "ready") {
    return `ready :${runtime.port}`
  }

  if (runtime.state === "starting") {
    return `starting :${runtime.port}`
  }

  if (runtime.state === "error") {
    if (isMissingOpencodeError(runtime.err)) {
      return "missing opencode"
    }

    return "error"
  }

  return "stopped"
}

function icon(runtime: WorkspaceRuntime) {
  if (runtime.state === "idle") {
    return new vscode.ThemeIcon("circle-outline")
  }

  if (runtime.state === "ready") {
    return new vscode.ThemeIcon(runtime.parentId ? "repo-forked" : "check")
  }

  if (runtime.state === "starting") {
    return new vscode.ThemeIcon("sync")
  }

  if (runtime.state === "error") {
    return new vscode.ThemeIcon("error")
  }

  return new vscode.ThemeIcon("circle-slash")
}
