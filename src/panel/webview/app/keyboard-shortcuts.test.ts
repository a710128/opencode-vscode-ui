import assert from "node:assert/strict"
import { describe, test } from "node:test"
import { composerTabIntent, cycleAgentName, leaderAction } from "./keyboard-shortcuts"

describe("keyboard shortcuts", () => {
  test("cycles visible primary agents and wraps", () => {
    const agents = [
      { name: "build", mode: "primary" as const },
      { name: "helper", mode: "subagent" as const },
      { name: "plan", mode: "all" as const },
      { name: "hidden", mode: "primary" as const, hidden: true },
    ]

    assert.equal(cycleAgentName(agents, "build"), "plan")
    assert.equal(cycleAgentName(agents, "plan"), "build")
    assert.equal(cycleAgentName(agents, "missing"), "build")
  })

  test("maps leader combos to upstream actions", () => {
    assert.equal(leaderAction("ArrowDown"), "childFirst")
    assert.equal(leaderAction("n"), "newSession")
    assert.equal(leaderAction("r"), "redoSession")
    assert.equal(leaderAction("u"), "undoSession")
    assert.equal(leaderAction("ArrowLeft"), undefined)
  })

  test("uses Tab for autocomplete before agent cycling only when a suggestion exists", () => {
    assert.equal(composerTabIntent({
      hasAutocomplete: true,
      hasCurrentItem: true,
      metaKey: false,
      ctrlKey: false,
      altKey: false,
      canCycleAgent: true,
    }), "autocomplete")

    assert.equal(composerTabIntent({
      hasAutocomplete: true,
      hasCurrentItem: false,
      metaKey: false,
      ctrlKey: false,
      altKey: false,
      canCycleAgent: true,
    }), "cycleAgent")

    assert.equal(composerTabIntent({
      hasAutocomplete: true,
      hasCurrentItem: false,
      metaKey: false,
      ctrlKey: false,
      altKey: false,
      canCycleAgent: false,
    }), undefined)
  })
})
