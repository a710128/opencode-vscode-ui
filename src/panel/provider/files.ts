import * as path from "node:path"
import { fileURLToPath } from "node:url"
import * as vscode from "vscode"
import { postToWebview } from "../../bridge/host"

export async function openFile(workspaceDir: string, filePath: string, line?: number) {
  const target = await resolveFileUri(workspaceDir, filePath)
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

export async function resolveFileUri(workspaceDir: string, filePath: string) {
  const value = filePath.trim()
  if (!value) {
    return undefined
  }

  const target = toFileUri(value, workspaceDir)
  if (!target) {
    return undefined
  }

  try {
    const stat = await vscode.workspace.fs.stat(target)
    if ((stat.type & vscode.FileType.Directory) !== 0) {
      return undefined
    }
    return target
  } catch {
    return undefined
  }
}

export async function resolveFileRefs(webview: vscode.Webview, workspaceDir: string, refs: Array<{ key: string; filePath: string }>) {
  const resolved = await Promise.all(refs.map(async (item) => ({
    key: item.key,
    exists: !!await resolveFileUri(workspaceDir, item.filePath),
  })))

  await postToWebview(webview, {
    type: "fileRefsResolved",
    refs: resolved,
  })
}

export function toFileUri(filePath: string, workspaceDir: string) {
  if (filePath.startsWith("file://")) {
    try {
      return vscode.Uri.file(fileURLToPath(filePath))
    } catch {
      return undefined
    }
  }

  if (path.isAbsolute(filePath)) {
    return vscode.Uri.file(path.normalize(filePath))
  }

  return vscode.Uri.file(path.join(workspaceDir, filePath))
}
