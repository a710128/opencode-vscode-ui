import type { SessionSnapshot } from "../../bridge/types"
import type { PermissionRequest, QuestionRequest } from "../../core/sdk"
import { cmp } from "./utils"

type SessionInfo = NonNullable<SessionSnapshot["session"]>

export function collectRelatedSessionIds(session: SessionInfo, sessions: SessionInfo[]) {
  if (session.parentID) {
    return [session.id]
  }

  return sessions
    .filter((item) => item.id === session.id || isVisibleChildSession(item, session.id))
    .map((item) => item.id)
    .sort(cmp)
}

export function relatedSessionMap(sessions: SessionInfo[], rootSessionID: string, relatedSessionIds: string[]) {
  const map: Record<string, SessionInfo> = {}
  for (const session of sessions) {
    if (session.id === rootSessionID || session.time.archived || !relatedSessionIds.includes(session.id)) {
      continue
    }
    map[session.id] = session
  }
  return map
}

export function nav(session: SessionInfo, sessions: SessionInfo[]) {
  const rootID = session.parentID || session.id
  const children = sessions
    .filter((item) => isVisibleChildSession(item, rootID))
    .sort((a, b) => cmp(a.id, b.id))
  const firstChild = children[0]

  if (!session.parentID) {
    return {
      firstChild: firstChild ? ref(firstChild) : undefined,
    }
  }

  const parent = sessions.find((item) => item.id === session.parentID)
  const siblings = children
  const index = siblings.findIndex((item) => item.id === session.id)
  const prev = index >= 0 && siblings.length > 1 ? siblings[(index - 1 + siblings.length) % siblings.length] : undefined
  const next = index >= 0 && siblings.length > 1 ? siblings[(index + 1) % siblings.length] : undefined

  return {
    firstChild: firstChild ? ref(firstChild) : undefined,
    parent: parent ? ref(parent) : undefined,
    prev: prev && prev.id !== session.id ? ref(prev) : undefined,
    next: next && next.id !== session.id ? ref(next) : undefined,
  }
}

export function sortRequests<T extends { id: string; sessionID: string }>(list: T[], sessionIDs: string[]) {
  const order = new Map(sessionIDs.map((item, index) => [item, index]))
  return [...list]
    .filter((item) => order.has(item.sessionID))
    .sort((a, b) => {
      const sessionCmp = (order.get(a.sessionID) ?? Number.MAX_SAFE_INTEGER) - (order.get(b.sessionID) ?? Number.MAX_SAFE_INTEGER)
      if (sessionCmp !== 0) {
        return sessionCmp
      }
      return cmp(a.id, b.id)
    })
}

export function filterPermission(list: PermissionRequest[], sessionIDs: string[]) {
  return sortRequests(list, sessionIDs)
}

export function filterQuestion(list: QuestionRequest[], sessionIDs: string[]) {
  return sortRequests(list, sessionIDs)
}

function ref(session: SessionInfo) {
  return {
    id: session.id,
    title: session.title || session.id.slice(0, 8),
  }
}

function isVisibleChildSession(session: SessionInfo, parentID: string) {
  return session.parentID === parentID && !session.time.archived
}
