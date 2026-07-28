import * as path from "node:path"
import type { SessionPanelRef } from "../../bridge/types"

export type SessionPanelState = SessionPanelRef

type WorkspaceFolderLike = {
  uri: {
    toString(): string
    fsPath: string
  }
}

export function reviveState(state: unknown): SessionPanelState | undefined {
  if (!state || typeof state !== "object") {
    return undefined
  }

  const maybe = state as Partial<SessionPanelState>

  if (!maybe.dir || !maybe.sessionId) {
    return undefined
  }

  return {
    workspaceId: maybe.workspaceId || maybe.dir,
    dir: maybe.dir,
    sessionId: maybe.sessionId,
  }
}

export function canRestoreRef(ref: SessionPanelRef, folders: readonly WorkspaceFolderLike[] | undefined) {
  return !!folders?.some((folder) => folder.uri.toString() === ref.workspaceId || containsPath(folder.uri.fsPath, ref.dir))
}

export function containsPath(parent: string, child: string) {
  const pathApi = isWindowsPath(parent) || isWindowsPath(child) ? path.win32 : path.posix
  const normalizedParent = normalizeForCompare(pathApi.resolve(parent), pathApi)
  const normalizedChild = normalizeForCompare(pathApi.resolve(child), pathApi)

  if (normalizedParent === normalizedChild) {
    return true
  }

  const relative = pathApi.relative(normalizedParent, normalizedChild)
  return !!relative && !relative.startsWith("..") && !pathApi.isAbsolute(relative)
}

function normalizeForCompare(value: string, pathApi: typeof path.posix | typeof path.win32) {
  const normalized = pathApi.normalize(value)
  return pathApi === path.win32 || process.platform === "darwin" ? normalized.toLowerCase() : normalized
}

function isWindowsPath(value: string) {
  return /^[a-zA-Z]:[\\/]/.test(value) || value.includes("\\")
}
