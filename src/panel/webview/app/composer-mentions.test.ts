import assert from "node:assert/strict"
import { describe, test } from "node:test"
import { buildComposerSubmitParts, deleteMentionBoundary, insertComposerMention, selectionTouchesMention, syncComposerMentions } from "./composer-mentions"
import type { ComposerMention } from "./state"

const FILE: ComposerMention = {
  type: "file",
  path: "src/app.ts",
  content: "@src/app.ts",
  start: 6,
  end: 17,
}

const AGENT: ComposerMention = {
  type: "agent",
  name: "helper",
  content: "@helper",
  start: 18,
  end: 25,
}

describe("composer mention syncing", () => {
  test("drops a mention after editing inside its token", () => {
    const prev = "open @src/app.ts now"
    const next = "open @src/app.tx now"
    const mentions = [{ ...FILE, start: 5, end: 16 }]

    const synced = syncComposerMentions(prev, next, mentions)

    assert.deepEqual(synced, [])
  })

  test("shifts later mentions after inserting text before them", () => {
    const prev = "open @src/app.ts @helper"
    const next = "please open @src/app.ts @helper"
    const mentions = [
      { ...FILE, start: 5, end: 16 },
      { ...AGENT, start: 17, end: 24 },
    ]

    const synced = syncComposerMentions(prev, next, mentions)

    assert.deepEqual(synced, [
      { ...FILE, start: 12, end: 23 },
      { ...AGENT, start: 24, end: 31 },
    ])
  })

  test("inserting a mention keeps the trailing space outside the tracked range", () => {
    const inserted = insertComposerMention("open ", [], 5, 5, { type: "agent", name: "helper", content: "@helper" })

    assert.equal(inserted.draft, "open @helper ")
    assert.deepEqual(inserted.composerMentions, [{ type: "agent", name: "helper", content: "@helper", start: 5, end: 12 }])
    assert.equal(inserted.cursor, 13)
  })

  test("submit parts preserve file line-range metadata", () => {
    const parts = buildComposerSubmitParts("open @src/app.ts#12-20", [{
      type: "file",
      path: "src/app.ts",
      kind: "file",
      selection: { startLine: 12, endLine: 20 },
      content: "@src/app.ts#12-20",
      start: 5,
      end: 21,
    }])

    assert.deepEqual(parts, [
      { type: "text", text: "open @src/app.ts#12-20" },
      {
        type: "file",
        path: "src/app.ts",
        kind: "file",
        selection: { startLine: 12, endLine: 20 },
        source: {
          value: "@src/app.ts#12-20",
          start: 5,
          end: 21,
        },
      },
    ])
  })

  test("submit parts preserve resource metadata", () => {
    const parts = buildComposerSubmitParts("use @docs", [{
      type: "resource",
      uri: "mcp://docs/reference",
      name: "docs",
      clientName: "reference",
      mimeType: "text/markdown",
      content: "@docs",
      start: 4,
      end: 9,
    }])

    assert.deepEqual(parts, [
      { type: "text", text: "use @docs" },
      {
        type: "resource",
        uri: "mcp://docs/reference",
        name: "docs",
        clientName: "reference",
        mimeType: "text/markdown",
        source: {
          value: "@docs",
          start: 4,
          end: 9,
        },
      },
    ])
  })
})

describe("composer mention deletion", () => {
  test("backspace inside a mention removes the whole token and trailing space", () => {
    const value = "open @src/app.ts now"
    const mentions = [{ ...FILE, start: 5, end: 16 }]

    const next = deleteMentionBoundary(value, mentions, 16, 16, "Backspace")

    assert.deepEqual(next, {
      draft: "open now",
      cursor: 5,
      composerMentions: [],
      composerMentionAgentOverride: undefined,
    })
  })

  test("delete at a mention start removes the whole token and trailing space", () => {
    const value = "open @src/app.ts now"
    const mentions = [{ ...FILE, start: 5, end: 16 }]

    const next = deleteMentionBoundary(value, mentions, 5, 5, "Delete")

    assert.deepEqual(next, {
      draft: "open now",
      cursor: 5,
      composerMentions: [],
      composerMentionAgentOverride: undefined,
    })
  })

  test("selection deletion expands to fully remove touched mentions", () => {
    const value = "open @src/app.ts @helper now"
    const mentions = [
      { ...FILE, start: 5, end: 16 },
      { ...AGENT, start: 17, end: 24 },
    ]

    const next = deleteMentionBoundary(value, mentions, 10, 19, "Delete")

    assert.deepEqual(next, {
      draft: "open now",
      cursor: 5,
      composerMentions: [],
      composerMentionAgentOverride: undefined,
    })
  })
})

describe("composer autocomplete suppression", () => {
  test("suppresses popup reopening while cursor is inside a tracked mention", () => {
    const mentions = [{ ...FILE }]

    assert.equal(selectionTouchesMention(mentions, 10, 10), true)
    assert.equal(selectionTouchesMention(mentions, 6, 6), false)
    assert.equal(selectionTouchesMention(mentions, 17, 17), true)
    assert.equal(selectionTouchesMention(mentions, 18, 18), false)
  })

  test("suppresses popup reopening when selection overlaps a tracked mention", () => {
    const mentions = [{ ...FILE }]

    assert.equal(selectionTouchesMention(mentions, 4, 8), true)
    assert.equal(selectionTouchesMention(mentions, 17, 18), false)
  })
})
