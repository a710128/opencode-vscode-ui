import * as path from "node:path"
import * as vscode from "vscode"
import type { ComposerPathResult, WorkspaceRef } from "../../bridge/types"
import { WorkspaceManager } from "../../core/workspace"
import { postToWebview } from "../../bridge/host"
import { trimDirectorySuffix } from "./file-search"
import { containsPath } from "./restore-state"

export async function openFile(workspace: WorkspaceRef, filePath: string, line?: number) {
  const target = await resolveFileUri(workspace, filePath)
  if (!target) {
    return
  }

  const document = await vscode.workspace.openTextDocument(target)
  const editor = await vscode.window.showTextDocument(document, {
    preview: false,
    viewColumn: vscode.ViewColumn.Active,
  })

  if (!line || line < 1) {
    return
  }

  const targetLine = Math.min(Math.max(line - 1, 0), Math.max(document.lineCount - 1, 0))
  const position = new vscode.Position(targetLine, 0)
  editor.selection = new vscode.Selection(position, position)
  editor.revealRange(new vscode.Range(position, position), vscode.TextEditorRevealType.InCenterIfOutsideViewport)
}

export async function resolveFileUri(workspace: WorkspaceRef, filePath: string) {
  const resolved = await resolvePromptPath(workspace, filePath)
  if (!resolved || resolved.kind === "directory") {
    return undefined
  }

  return resolved.uri
}

export async function resolvePromptPath(workspace: WorkspaceRef, filePath: string) {
  const value = filePath.trim()
  if (!value) {
    return undefined
  }

  const target = toFileUri(trimDirectorySuffix(value), workspace)
  if (!target) {
    return undefined
  }

  try {
    const stat = await vscode.workspace.fs.stat(target)
    return {
      uri: target,
      kind: (stat.type & vscode.FileType.Directory) !== 0 ? "directory" as const : "file" as const,
    }
  } catch {
    return undefined
  }
}

export async function resolveFileRefs(webview: vscode.Webview, workspace: WorkspaceRef, refs: Array<{ key: string; filePath: string }>) {
  const resolved = await Promise.all(refs.map(async (item) => ({
    key: item.key,
    exists: !!await resolveFileUri(workspace, item.filePath),
  })))

  await postToWebview(webview, {
    type: "fileRefsResolved",
    refs: resolved,
  })
}

export async function searchFiles(webview: vscode.Webview, mgr: WorkspaceManager, workspaceId: string, requestID: string, query: string) {
  const rt = mgr.get(workspaceId)
  const results = rt?.state === "ready" && rt.sdk
    ? mapSearchResults((await rt.sdk.find.files({
      directory: rt.dir,
      query,
    })).data)
    : []

  await postToWebview(webview, {
    type: "fileSearchResults",
    requestID,
    query,
    results,
  })
}

export function toFileUri(filePath: string, workspace: WorkspaceRef) {
  const folder = workspaceFolder(workspace)

  if (filePath.startsWith("file://")) {
    try {
      return absoluteUri(vscode.Uri.parse(filePath).path, folder)
    } catch {
      return undefined
    }
  }

  if (path.isAbsolute(filePath)) {
    return absoluteUri(filePath, folder)
  }

  if (folder) {
    return absoluteUri(path.join(workspace.dir, filePath), folder)
  }

  return vscode.Uri.file(path.join(workspace.dir, filePath))
}

function mapSearchResults(items: string[] | undefined): ComposerPathResult[] {
  return (items ?? []).map((item) => ({
    path: item,
    kind: item.endsWith("/") ? "directory" as const : "file" as const,
    source: "search" as const,
  }))
}

function workspaceFolder(workspace: WorkspaceRef) {
  const folders = vscode.workspace.workspaceFolders ?? []
  const exact = folders.find((folder) => folder.uri.toString() === workspace.workspaceId || folder.uri.fsPath === workspace.dir)
  if (exact) {
    return exact
  }

  return folders
    .filter((folder) => containsPath(folder.uri.fsPath, workspace.dir))
    .sort((a, b) => b.uri.fsPath.length - a.uri.fsPath.length)[0]
}

function absoluteUri(filePath: string, folder?: vscode.WorkspaceFolder) {
  const normalized = path.normalize(filePath)

  if (!folder || (folder.uri.scheme === "file" && !folder.uri.authority)) {
    return vscode.Uri.file(normalized)
  }

  return folder.uri.with({
    path: slashPath(normalized),
  })
}

function slashPath(filePath: string) {
  return filePath.replace(/\\/g, "/")
}
