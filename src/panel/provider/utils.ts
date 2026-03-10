import * as vscode from "vscode"
import type { SessionBootstrap, SessionPanelRef, SessionSnapshot } from "../../bridge/types"
import type { SessionStatus } from "../../core/sdk"

export type SessionPanelState = SessionPanelRef

export function reviveState(state: unknown): SessionPanelState | undefined {
  if (!state || typeof state !== "object") {
    return undefined
  }

  const maybe = state as Partial<SessionPanelState>

  if (!maybe.dir || !maybe.sessionId) {
    return undefined
  }

  return {
    dir: maybe.dir,
    sessionId: maybe.sessionId,
  }
}

export function panelKey(ref?: SessionPanelRef) {
  if (!ref) {
    return ""
  }

  return `${ref.dir}::${ref.sessionId}`
}

export function panelTitle(title: string) {
  const prefix = "OC:"
  const clean = (title || "session").trim() || "session"
  const maxTitleLength = 24
  return `${prefix}${clean.length > maxTitleLength ? `${clean.slice(0, maxTitleLength - 1)}…` : clean}`
}

export function panelIconPath(extensionUri: vscode.Uri) {
  return vscode.Uri.joinPath(extensionUri, "images", "logo.svg")
}

export function boot(payload: SessionSnapshot): SessionBootstrap {
  return {
    status: payload.status,
    sessionRef: payload.sessionRef,
    workspaceName: payload.workspaceName,
    session: payload.session,
    message: payload.message,
  }
}

export function idle(): SessionStatus {
  return { type: "idle" }
}

export function cmp(a: string, b: string) {
  if (a < b) {
    return -1
  }

  if (a > b) {
    return 1
  }

  return 0
}

export function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export function text(err: unknown) {
  if (err instanceof Error) {
    return err.message
  }

  return String(err)
}

export function textError(err: unknown) {
  const message = text(err)
  return message || "unknown error"
}
