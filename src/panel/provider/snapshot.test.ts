import assert from "node:assert/strict"
import { describe, test } from "node:test"

import { buildSessionSnapshot } from "./snapshot"
import type { SessionInfo, SessionMessage, SessionStatus } from "../../core/sdk"

type Runtime = {
  workspaceId: string
  dir: string
  name: string
  state: "ready"
  sdk: any
  sessions: Map<string, SessionInfo>
  sessionStatuses: Map<string, SessionStatus>
}

function session(id: string, parentID?: string): SessionInfo {
  return {
    id,
    directory: "/workspace",
    parentID,
    title: id,
    time: {
      created: 1,
      updated: 1,
    },
  }
}

function createSdk(current: SessionInfo) {
  const root = session("root")

  return {
    session: {
      get: async ({ sessionID }: { sessionID: string }) => {
        if (sessionID === current.id) {
          return { data: current }
        }
        if (sessionID === root.id) {
          return { data: root }
        }
        return { data: undefined }
      },
      messages: async (_input: { sessionID: string; directory: string; limit: number }) => ({ data: [] as SessionMessage[] }),
      todo: async () => ({ data: [] }),
      diff: async () => ({ data: [] }),
      status: async () => ({ data: {} }),
      children: async ({ sessionID }: { sessionID: string; directory: string }) => {
        if (sessionID === root.id) {
          return { data: [current] }
        }
        return { data: [] }
      },
    },
    provider: {
      list: async () => ({ data: { all: [], default: {} } }),
    },
    permission: {
      list: async () => ({ data: [] }),
    },
    question: {
      list: async () => ({ data: [] }),
    },
    mcp: {
      status: async () => ({ data: {} }),
    },
    lsp: {
      status: async () => ({ data: [] }),
    },
  }
}

describe("buildSessionSnapshot session list filtering", () => {
  test("does not add child sessions to the root session list", async () => {
    const root = session("root")
    const child = session("child", root.id)
    const rt: Runtime = {
      workspaceId: "ws-1",
      dir: "/workspace",
      name: "workspace",
      state: "ready",
      sdk: createSdk(child),
      sessions: new Map([[root.id, root]]),
      sessionStatuses: new Map([[root.id, { type: "idle" }]]),
    }

    const build = await buildSessionSnapshot({
      ref: {
        workspaceId: rt.workspaceId,
        dir: rt.dir,
        sessionId: child.id,
      },
      mgr: {
        get(id: string) {
          return id === rt.workspaceId ? rt : undefined
        },
      } as any,
      log() {},
      isSubmitting: () => false,
    })

    assert.equal(build.snapshot.session?.id, child.id)
    assert.deepEqual([...rt.sessions.keys()], [root.id])
    assert.equal(rt.sessionStatuses.has(child.id), false)
  })
})
