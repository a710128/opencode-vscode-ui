import assert from "node:assert/strict"
import { describe, test } from "node:test"

import { SessionStore } from "../core/session"
import type { SessionEvent, SessionInfo, SessionStatus } from "../core/sdk"

type Runtime = {
  workspaceId: string
  dir: string
  name: string
  state: "ready"
  sessions: Map<string, SessionInfo>
  sessionStatuses: Map<string, SessionStatus>
  sessionsState: "idle" | "loading" | "ready" | "error"
  sessionsErr?: string
}

function info(id: string, updated: number, parentID?: string): SessionInfo {
  return {
    id,
    directory: "/workspace",
    parentID,
    title: id,
    time: {
      created: updated,
      updated,
    },
  }
}

function createHarness() {
  const root = info("root", 1)
  const rt: Runtime = {
    workspaceId: "ws-1",
    dir: "/workspace",
    name: "workspace",
    state: "ready",
    sessions: new Map([[root.id, root]]),
    sessionStatuses: new Map([[root.id, { type: "idle" }]]),
    sessionsState: "ready",
  }

  let listener: ((item: { workspaceId: string; event: SessionEvent }) => void) | undefined
  let invalidations = 0

  const mgr = {
    get(id: string) {
      return id === rt.workspaceId ? rt : undefined
    },
    list() {
      return [rt]
    },
    invalidate() {
      invalidations += 1
    },
    onDidChange() {
      return { dispose() {} }
    },
  }

  const events = {
    onDidEvent(next: (item: { workspaceId: string; event: SessionEvent }) => void) {
      listener = next
      return { dispose() {} }
    },
  }

  const out = { appendLine() {} }
  const store = new SessionStore(mgr as any, events as any, out as any)

  return {
    rt,
    store,
    invalidations: () => invalidations,
    emit(event: SessionEvent) {
      listener?.({ workspaceId: rt.workspaceId, event })
    },
  }
}

describe("SessionStore child session filtering", () => {
  test("ignores child session create and status events in sidebar state", () => {
    const harness = createHarness()
    const child = info("child", 2, "root")

    harness.emit({
      type: "session.created",
      properties: { info: child },
    })
    harness.emit({
      type: "session.status",
      properties: {
        sessionID: child.id,
        status: { type: "busy" },
      },
    })

    assert.deepEqual(harness.store.list(harness.rt.workspaceId).map((item) => item.id), ["root"])
    assert.equal(harness.rt.sessionStatuses.has(child.id), false)
    assert.ok(harness.invalidations() >= 1)
  })

  test("ignores child session update events for sessions outside the root list", () => {
    const harness = createHarness()

    harness.emit({
      type: "session.updated",
      properties: { info: info("child", 2, "root") },
    })

    assert.deepEqual(harness.store.list(harness.rt.workspaceId).map((item) => item.id), ["root"])
    assert.equal(harness.rt.sessionStatuses.has("child"), false)
  })

  test("removes a root session when an update turns it into a child", () => {
    const harness = createHarness()
    const moved = info("root", 2, "parent")

    harness.emit({
      type: "session.updated",
      properties: { info: moved },
    })

    assert.deepEqual(harness.store.list(harness.rt.workspaceId).map((item) => item.id), [])
    assert.equal(harness.rt.sessionStatuses.has("root"), false)
  })
})
