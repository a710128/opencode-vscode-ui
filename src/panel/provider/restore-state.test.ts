import assert from "node:assert/strict"
import { describe, test } from "node:test"
import { canRestoreRef, reviveState } from "./restore-state"

describe("panel restore state", () => {
  test("reviveState keeps explicit workspace ids", () => {
    assert.deepEqual(reviveState({
      workspaceId: "vscode-remote://ssh-remote+box/workspace",
      dir: "/workspace",
      sessionId: "session-1",
    }), {
      workspaceId: "vscode-remote://ssh-remote+box/workspace",
      dir: "/workspace",
      sessionId: "session-1",
    })
  })

  test("reviveState backfills workspace ids for legacy state", () => {
    assert.deepEqual(reviveState({
      dir: "/workspace",
      sessionId: "session-1",
    }), {
      workspaceId: "/workspace",
      dir: "/workspace",
      sessionId: "session-1",
    })
  })

  test("reviveState rejects incomplete payloads", () => {
    assert.equal(reviveState(null), undefined)
    assert.equal(reviveState({ dir: "/workspace" }), undefined)
    assert.equal(reviveState({ sessionId: "session-1" }), undefined)
  })

  test("canRestoreRef matches remote folders by workspace id", () => {
    const ref = {
      workspaceId: "vscode-remote://ssh-remote+box/workspace",
      dir: "/workspace",
      sessionId: "session-1",
    }

    const folders = [{
      uri: {
        toString: () => "vscode-remote://ssh-remote+box/workspace",
        fsPath: "/different-mount",
      },
    }]

    assert.equal(canRestoreRef(ref, folders), true)
  })

  test("canRestoreRef falls back to legacy dir matching", () => {
    const ref = {
      workspaceId: "/legacy-workspace",
      dir: "/workspace",
      sessionId: "session-1",
    }

    const folders = [{
      uri: {
        toString: () => "vscode-remote://ssh-remote+box/other",
        fsPath: "/workspace",
      },
    }]

    assert.equal(canRestoreRef(ref, folders), true)
  })

  test("canRestoreRef accepts directories inside an open workspace folder", () => {
    const ref = {
      workspaceId: "vscode-remote://ssh-remote+box/workspace/libs/foo",
      dir: "/workspace/libs/foo",
      sessionId: "session-1",
    }

    const folders = [{
      uri: {
        toString: () => "vscode-remote://ssh-remote+box/workspace",
        fsPath: "/workspace",
      },
    }]

    assert.equal(canRestoreRef(ref, folders), true)
  })

  test("canRestoreRef handles Windows-style containment", () => {
    const ref = {
      workspaceId: "c:\\workspace\\libs\\foo",
      dir: "c:\\workspace\\libs\\foo",
      sessionId: "session-1",
    }

    const folders = [{
      uri: {
        toString: () => "c:\\workspace",
        fsPath: "C:\\workspace",
      },
    }]

    assert.equal(canRestoreRef(ref, folders), true)
  })

  test("canRestoreRef returns false when workspace is unavailable", () => {
    const ref = {
      workspaceId: "vscode-remote://ssh-remote+box/workspace",
      dir: "/workspace",
      sessionId: "session-1",
    }

    assert.equal(canRestoreRef(ref, undefined), false)
    assert.equal(canRestoreRef(ref, [{
      uri: {
        toString: () => "vscode-remote://ssh-remote+box/other",
        fsPath: "/other",
      },
    }]), false)
    assert.equal(canRestoreRef({
      workspaceId: "vscode-remote://ssh-remote+box/workspace-other",
      dir: "/workspace-other",
      sessionId: "session-2",
    }, [{
      uri: {
        toString: () => "vscode-remote://ssh-remote+box/workspace",
        fsPath: "/workspace",
      },
    }]), false)
  })
})
