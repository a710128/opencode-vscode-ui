import type { SessionInfo, SessionStatus } from "./sdk"

export function shouldTrackSession(info: { parentID?: string }) {
  return !info.parentID
}

export function syncTrackedSession(
  sessions: Map<string, SessionInfo>,
  statuses: Map<string, SessionStatus>,
  info: SessionInfo,
) {
  if (shouldTrackSession(info)) {
    sessions.set(info.id, info)
    return true
  }

  sessions.delete(info.id)
  statuses.delete(info.id)
  return false
}
