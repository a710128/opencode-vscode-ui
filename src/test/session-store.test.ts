import assert from "node:assert/strict"
import { describe, test } from "node:test"

import { SessionStore } from "../core/session"
import type { SessionEvent, SessionInfo, SessionStatus } from "../core/sdk"

type Runtime = {
  workspaceId: string
  dir: string
  name: string
  state: "ready"
  sdk?: {
    session: {
      list(input: { directory: string; roots: true }): Promise<{ data?: SessionInfo[] }>
      status(input: { directory: string }): Promise<{ data?: Record<string, SessionStatus> }>
    }
  }
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
  let rt: Runtime = {
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
    get rt() {
      return rt
    },
    setRuntime(next: Runtime) {
      rt = next
    },
    store,
    invalidations: () => invalidations,
    emit(event: SessionEvent) {
      listener?.({ workspaceId: rt.workspaceId, event })
    },
  }
}

function deferred<T>() {
  let resolve: (value: T) => void
  let reject: (reason?: unknown) => void

  const promise = new Promise<T>((nextResolve, nextReject) => {
    resolve = nextResolve
    reject = nextReject
  })

  return {
    promise,
    resolve: resolve!,
    reject: reject!,
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

  test("coalesces concurrent refreshes so startup does not keep a partial later result", async () => {
    const harness = createHarness()
    const first = deferred<{ data?: SessionInfo[] }>()
    const second = deferred<{ data?: SessionInfo[] }>()
    let listCalls = 0

    harness.rt.sessions.clear()
    harness.rt.sessionStatuses.clear()
    harness.rt.sessionsState = "idle"
    harness.rt.sdk = {
      session: {
        list: () => {
          listCalls += 1
          return listCalls === 1 ? first.promise : second.promise
        },
        status: async () => ({
          data: {
            root: { type: "idle" },
            second: { type: "busy" },
          },
        }),
      },
    }

    const firstRefresh = harness.store.refresh(harness.rt.workspaceId, true)
    const secondRefresh = harness.store.refresh(harness.rt.workspaceId, true)

    assert.equal(listCalls, 1)

    first.resolve({ data: [info("root", 1), info("second", 2)] })
    second.resolve({ data: [info("root", 1)] })

    const [firstResult, secondResult] = await Promise.all([firstRefresh, secondRefresh])

    assert.equal(listCalls, 1)
    assert.deepEqual(firstResult.map((item) => item.id), ["root", "second"])
    assert.deepEqual(secondResult.map((item) => item.id), ["root", "second"])
    assert.deepEqual(harness.store.list(harness.rt.workspaceId).map((item) => item.id), ["second", "root"])
  })

  test("does not reuse an inflight refresh after the runtime instance changes", async () => {
    const harness = createHarness()
    const first = deferred<{ data?: SessionInfo[] }>()
    const second = deferred<{ data?: SessionInfo[] }>()
    let firstCalls = 0
    let secondCalls = 0

    harness.rt.sessions.clear()
    harness.rt.sessionStatuses.clear()
    harness.rt.sessionsState = "idle"
    harness.rt.sdk = {
      session: {
        list: () => {
          firstCalls += 1
          return first.promise
        },
        status: async () => ({ data: {} }),
      },
    }

    const staleRefresh = harness.store.refresh(harness.rt.workspaceId, true)

    const nextRoot = info("next-root", 3)
    harness.setRuntime({
      workspaceId: "ws-1",
      dir: "/workspace",
      name: "workspace",
      state: "ready",
      sessions: new Map(),
      sessionStatuses: new Map(),
      sessionsState: "idle",
      sdk: {
        session: {
          list: () => {
            secondCalls += 1
            return second.promise
          },
          status: async () => ({
            data: {
              [nextRoot.id]: { type: "idle" },
            },
          }),
        },
      },
    })

    const freshRefresh = harness.store.refresh("ws-1", true)

    assert.equal(firstCalls, 1)
    assert.equal(secondCalls, 1)

    first.resolve({ data: [info("stale-root", 1)] })
    second.resolve({ data: [nextRoot] })

    await Promise.all([staleRefresh, freshRefresh])

    assert.deepEqual(harness.store.list("ws-1").map((item) => item.id), [nextRoot.id])
  })

  test("authoritative refresh clears root sessions that only came from snapshot preloading", async () => {
    const harness = createHarness()
    const opened = info("opened", 5)

    harness.rt.sessions = new Map([[opened.id, opened]])
    harness.rt.sessionStatuses = new Map([[opened.id, { type: "busy" }]])
    harness.rt.sessionsState = "idle"
    harness.rt.sdk = {
      session: {
        list: async () => ({
          data: [],
        }),
        status: async () => ({
          data: {},
        }),
      },
    }

    await harness.store.refresh(harness.rt.workspaceId, true)

    assert.deepEqual(harness.store.list(harness.rt.workspaceId).map((item) => item.id), [])
    assert.equal(harness.rt.sessionStatuses.has(opened.id), false)
  })
})
