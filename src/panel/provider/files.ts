import * as path from "node:path"
import { fileURLToPath } from "node:url"
import * as vscode from "vscode"
import { postToWebview } from "../../bridge/host"

const FILE_SEARCH_LIMIT = 12
const FILE_SEARCH_POOL = 200
const FILE_SEARCH_EXCLUDE = "{**/.git/**,**/node_modules/**,**/dist/**,**/.memory/**,**/opencode/**}"

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

export async function searchFiles(webview: vscode.Webview, workspaceDir: string, requestID: string, query: string) {
  const value = query.trim()
  if (!value) {
    await postToWebview(webview, {
      type: "fileSearchResults",
      requestID,
      query,
      results: [],
    })
    return
  }

  const base = vscode.Uri.file(workspaceDir)
  const pattern = new vscode.RelativePattern(base, `**/*${glob(value)}*`)
  const files = await vscode.workspace.findFiles(pattern, FILE_SEARCH_EXCLUDE, FILE_SEARCH_POOL)
  const results = files
    .map((uri) => path.relative(workspaceDir, uri.fsPath).replace(/\\/g, "/"))
    .filter((item) => item && !item.startsWith(".."))
    .sort((a, b) => rank(a, value) - rank(b, value) || a.localeCompare(b))
    .slice(0, FILE_SEARCH_LIMIT)
    .map((item) => ({ path: item }))

  await postToWebview(webview, {
    type: "fileSearchResults",
    requestID,
    query,
    results,
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

function rank(filePath: string, query: string) {
  const file = filePath.toLowerCase()
  const value = query.trim().toLowerCase()
  const base = path.basename(file)
  if (base === value) {
    return 0
  }
  if (file === value) {
    return 1
  }
  if (base.startsWith(value)) {
    return 2
  }
  if (file.startsWith(value)) {
    return 3
  }
  const slash = `/${value}`
  if (file.includes(slash)) {
    return 4
  }
  if (base.includes(value)) {
    return 5
  }
  return 6
}

function glob(value: string) {
  return value.replace(/[{}\[\]*?]/g, "")
}
