import * as path from "node:path"
import * as vscode from "vscode"
import { getDiscoverSubmodules, getSubmoduleDepth } from "./settings"
import { type WorkspaceTarget, workspaceId } from "./workspace"

const skipped = new Set<string>()

type DiscoverOptions = {
  depth?: number
  out?: vscode.OutputChannel
}

type GitmoduleEntry = {
  name: string
  path: string
  url?: string
}

export async function computeTargets(out?: vscode.OutputChannel): Promise<WorkspaceTarget[]> {
  const roots = (vscode.workspace.workspaceFolders ?? []).map((folder) => ({
    uri: folder.uri,
    name: folder.name,
  }))

  if (!getDiscoverSubmodules() || getSubmoduleDepth() <= 0) {
    return roots
  }

  const discovered = await Promise.all(roots.map((root) => discoverSubmodules(root, {
    depth: getSubmoduleDepth(),
    out,
  })))

  return dedupeTargets([...roots, ...discovered.flat()])
}

export async function discoverSubmodules(root: WorkspaceTarget, options: DiscoverOptions = {}): Promise<WorkspaceTarget[]> {
  const rootId = workspaceId(root)
  const maxDepth = Math.max(0, Math.min(3, Math.trunc(options.depth ?? 1)))
  const found: WorkspaceTarget[] = []
  const seen = new Set<string>()
  const directKeys = new Set<string>()

  async function walk(currentUri: vscode.Uri, prefix: string, remaining: number) {
    if (remaining <= 0) {
      return
    }

    const content = await readGitmodules(currentUri)
    if (content === undefined) {
      return
    }

    const entries = parseGitmoduleEntries(content)
    if (!prefix) {
      for (const entry of entries) {
        directKeys.add(moduleKey(entry))
      }
    }

    for (const entry of entries) {
      const relativePath = normalizeSubmodulePath(prefix ? `${prefix}/${entry.path}` : entry.path)
      if (!relativePath) {
        continue
      }

      if (prefix && directKeys.has(moduleKey(entry))) {
        continue
      }

      const uri = vscode.Uri.joinPath(root.uri, ...relativeSegments(relativePath))
      const key = dedupeKey(uri.fsPath)
      if (seen.has(key)) {
        continue
      }
      seen.add(key)

      if (!await isInitializedSubmodule(uri)) {
        logSkipped(root, relativePath, options.out)
        continue
      }

      found.push({
        uri,
        name: `${root.name}/${relativePath}`,
        parentId: rootId,
      })

      await walk(uri, relativePath, remaining - 1)
    }
  }

  await walk(root.uri, "", maxDepth)
  return found
}

export function parseGitmodules(content: string) {
  return parseGitmoduleEntries(content).map((entry) => entry.path)
}

function parseGitmoduleEntries(content: string) {
  const entries: GitmoduleEntry[] = []
  let inSubmodule = false
  let current: Partial<GitmoduleEntry> | undefined

  const flush = () => {
    if (current?.path) {
      entries.push({
        name: current.name ?? current.path,
        path: current.path,
        url: current.url,
      })
    }
  }

  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim()

    if (!line || line.startsWith("#") || line.startsWith(";")) {
      continue
    }

    const section = line.match(/^\[([^\]]+)\]$/)
    if (section) {
      flush()
      const match = section[1].trim().match(/^submodule(?:\s+"(.*)"|\s+(\S+))?$/)
      inSubmodule = !!match
      current = inSubmodule ? { name: normalizeSubmodulePath(match?.[1] ?? match?.[2] ?? "") } : undefined
      continue
    }

    if (!inSubmodule) {
      continue
    }

    const value = line.match(/^([A-Za-z0-9_.-]+)\s*=\s*(.+)$/)
    if (!value || !current) {
      continue
    }

    const key = value[1].toLowerCase()
    const rawValue = stripQuotes(value[2])

    if (key === "path") {
      current.path = normalizeSubmodulePath(rawValue)
    } else if (key === "url") {
      current.url = rawValue.trim()
    }
  }

  flush()
  return entries
}

function dedupeTargets(targets: WorkspaceTarget[]) {
  const result: WorkspaceTarget[] = []
  const seen = new Set<string>()

  for (const target of targets) {
    const key = dedupeKey(target.uri.fsPath)
    if (seen.has(key)) {
      continue
    }

    seen.add(key)
    result.push(target)
  }

  return result
}

function normalizeSubmodulePath(value: string) {
  return stripQuotes(value)
    .trim()
    .replace(/\\/g, "/")
    .replace(/^\/+|\/+$/g, "")
}

function stripQuotes(value: string) {
  return value.trim().replace(/^["']|["']$/g, "")
}

function moduleKey(entry: GitmoduleEntry) {
  const urlKey = canonicalUrlKey(entry.url)
  if (urlKey) {
    return `url:${urlKey}`
  }

  return `path:${path.posix.basename(normalizeSubmodulePath(entry.path || entry.name)).toLowerCase()}`
}

function canonicalUrlKey(url?: string) {
  const value = url?.trim()
  if (!value) {
    return ""
  }

  const normalized = value
    .replace(/\\/g, "/")
    .replace(/^.*:/, "")
    .replace(/^\/+/, "")
    .replace(/\/+$/, "")
    .replace(/\.git$/i, "")

  return path.posix.basename(normalized).toLowerCase()
}

function relativeSegments(value: string) {
  return value.split(/[\\/]+/).filter(Boolean)
}

function dedupeKey(fsPath: string) {
  const normalized = path.normalize(fsPath)
  return process.platform === "win32" || process.platform === "darwin" ? normalized.toLowerCase() : normalized
}

async function readGitmodules(uri: vscode.Uri) {
  try {
    const bytes = await vscode.workspace.fs.readFile(vscode.Uri.joinPath(uri, ".gitmodules"))
    return new TextDecoder().decode(bytes)
  } catch {
    return undefined
  }
}

async function isInitializedSubmodule(uri: vscode.Uri) {
  try {
    const stat = await vscode.workspace.fs.stat(uri)
    if ((stat.type & vscode.FileType.Directory) === 0) {
      return false
    }

    await vscode.workspace.fs.stat(vscode.Uri.joinPath(uri, ".git"))
    return true
  } catch {
    return false
  }
}

function logSkipped(root: WorkspaceTarget, relativePath: string, out?: vscode.OutputChannel) {
  if (!out) {
    return
  }

  const key = `${workspaceId(root)}:${relativePath}`
  if (skipped.has(key)) {
    return
  }

  skipped.add(key)
  out.appendLine(`[${root.name}] skipped uninitialized submodule ${relativePath}`)
}
