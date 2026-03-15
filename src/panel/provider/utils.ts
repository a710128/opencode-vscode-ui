import * as vscode from "vscode"
import type { SessionBootstrap, SessionPanelRef, SessionSnapshot } from "../../bridge/types"
import type { SessionStatus } from "../../core/sdk"
export { canRestoreRef, reviveState, type SessionPanelState } from "./restore-state"

export function panelKey(ref?: SessionPanelRef) {
  if (!ref) {
    return ""
  }

  return `${ref.workspaceId}::${ref.sessionId}`
}

export function panelTitle(title: string) {
  const prefix = "OC:"
  const clean = (title || "session").trim() || "session"
  const maxTitleLength = 24
  return `${prefix}${clean.length > maxTitleLength ? `${clean.slice(0, maxTitleLength - 1)}…` : clean}`
}

export function panelIconPath(extensionUri: vscode.Uri): vscode.IconPath {
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
  if (err instanceof Error) {
    return err.message || err.name || "unknown error"
  }

  if (typeof err === "string") {
    return err || "unknown error"
  }

  if (err && typeof err === "object") {
    const record = err as Record<string, unknown>
    const name = typeof record.name === "string" ? record.name : ""

    const message = typeof record.message === "string" ? record.message : ""
    if (message) {
      return name ? `${name}: ${message}` : message
    }

    const data = record.data
    if (data && typeof data === "object") {
      const dataRecord = data as Record<string, unknown>
      const dataMessage = typeof dataRecord.message === "string" ? dataRecord.message : ""
      if (dataMessage) {
        return name ? `${name}: ${dataMessage}` : dataMessage
      }

      const responseBody = typeof dataRecord.responseBody === "string" ? dataRecord.responseBody : ""
      if (responseBody) {
        return responseBody
      }
    }

    const errors = record.errors
    if (Array.isArray(errors) && errors.length > 0) {
      const first = errors[0]
      if (first && typeof first === "object") {
        const firstRecord = first as Record<string, unknown>
        for (const key of Object.keys(firstRecord)) {
          const value = firstRecord[key]
          if (typeof value === "string" && value) {
            return value
          }
        }
      }
    }

    const raw = String(err)
    if (raw && raw !== "[object Object]") {
      return raw
    }

    try {
      const seen = new WeakSet<object>()
      const json = JSON.stringify(err, (_key, value) => {
        if (typeof value === "bigint") {
          return value.toString()
        }
        if (!value || typeof value !== "object") {
          return value
        }
        if (seen.has(value as object)) {
          return "[Circular]"
        }
        seen.add(value as object)
        return value
      })
      if (json) {
        return json.length > 1200 ? `${json.slice(0, 1200)}…` : json
      }
    } catch {
      // ignore
    }
  }

  return String(err) || "unknown error"
}
