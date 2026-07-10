import assert from "node:assert/strict"
import { describe, test } from "node:test"
import { mock } from "bun:test"
import * as vscode from "vscode"

let mode = "lazy"
let spawnCalls = 0

mock.module("../core/settings", () => ({
  getServerStartMode: () => mode,
}))

mock.module("../core/sdk", () => ({
  client: async () => ({
    session: {},
    event: {},
  }),
}))

mock.module("../core/server", () => ({
  freeport: async () => 4567,
  health: async () => undefined,
  spawn: () => {
    spawnCalls += 1
    return {
      pid: 123,
      stdout: { on() {} },
      stderr: { on() {} },
      on() {},
    }
  },
  startupFailure: () => ({
    promise: new Promise<never>(() => {}),
    dispose() {},
  }),
  stop: async () => undefined,
}))

describe("WorkspaceManager lazy targets", () => {
  test("registers lazy targets as idle and starts them on demand", async () => {
    mode = "lazy"
    spawnCalls = 0
    const { WorkspaceManager } = await import("../core/workspace.js")
    const mgr = new WorkspaceManager({ appendLine() {} } as any)
    const target = { uri: vscode.Uri.file("/repo"), name: "repo" }

    await mgr.sync([target])

    assert.equal(spawnCalls, 0)
    assert.equal(mgr.list()[0].state, "idle")

    const rt = await mgr.start(target.uri.toString())

    assert.equal(spawnCalls, 1)
    assert.equal(rt?.state, "ready")
    assert.equal(rt?.port, 4567)
  })

  test("removes runtimes that disappear from the target list", async () => {
    mode = "lazy"
    const { WorkspaceManager } = await import("../core/workspace.js")
    const mgr = new WorkspaceManager({ appendLine() {} } as any)
    const root = { uri: vscode.Uri.file("/repo"), name: "repo" }
    const child = { uri: vscode.Uri.file("/repo/child"), name: "repo/child", parentId: root.uri.toString() }

    await mgr.sync([root, child])
    assert.deepEqual(mgr.list().map((item) => item.name), ["repo", "repo/child"])

    await mgr.sync([root])
    assert.deepEqual(mgr.list().map((item) => item.name), ["repo"])
  })
})
