import assert from "node:assert/strict"
import { describe, test } from "node:test"
import type { SessionInfo } from "../../core/sdk"
import { collectRelatedSessionIds, nav, relatedSessionMap } from "./navigation"

function session(id: string, options?: Partial<SessionInfo>): SessionInfo {
  return {
    id,
    directory: "/workspace",
    title: id,
    time: {
      created: 0,
      updated: 0,
      archived: options?.time?.archived,
    },
    ...options,
  }
}

describe("navigation", () => {
  test("ignores archived child sessions in related session ids and child map", () => {
    const root = session("root")
    const activeChild = session("child-active", { parentID: "root" })
    const archivedChild = session("child-archived", { parentID: "root", time: { created: 0, updated: 0, archived: 1 } })

    const related = collectRelatedSessionIds(root, [root, activeChild, archivedChild])

    assert.deepEqual(related, ["child-active", "root"])
    assert.deepEqual(Object.keys(relatedSessionMap([root, activeChild, archivedChild], root.id, related)), ["child-active"])
  })

  test("does not expose archived child sessions through firstChild navigation", () => {
    const root = session("root")
    const archivedChild = session("child-archived", { parentID: "root", time: { created: 0, updated: 0, archived: 1 } })
    const activeChild = session("child-active", { parentID: "root" })

    assert.deepEqual(nav(root, [root, archivedChild, activeChild]).firstChild, {
      id: "child-active",
      title: "child-active",
    })
  })
})
