import assert from "node:assert/strict"
import { describe, test } from "node:test"
import { absorbFileSelectionSuffix, composerMentions, composerText, deleteStructuredRange, emptyComposerParts, normalizeComposerParts, replaceRangeWithMention, replaceRangeWithText } from "./composer-editor"
import type { ComposerEditorPart } from "./state"

describe("composer editor parts", () => {
  test("normalizes adjacent text parts and positions", () => {
    const parts: ComposerEditorPart[] = [
      { type: "text", content: "hello", start: 0, end: 5 },
      { type: "text", content: " ", start: 5, end: 6 },
      { type: "agent", name: "helper", content: "@helper", start: 6, end: 13 },
    ]

    assert.deepEqual(normalizeComposerParts(parts), [
      { type: "text", content: "hello ", start: 0, end: 6 },
      { type: "agent", name: "helper", content: "@helper", start: 6, end: 13 },
    ])
  })

  test("replaces an @query range with an atomic mention plus trailing space", () => {
    const next = replaceRangeWithMention([{ type: "text", content: "open @he now", start: 0, end: 12 }], 5, 8, {
      type: "agent",
      name: "helper",
      content: "@helper",
    })

    assert.equal(composerText(next.parts), "open @helper  now")
    assert.deepEqual(composerMentions(next.parts), [{ type: "agent", name: "helper", content: "@helper", start: 5, end: 12 }])
    assert.equal(next.cursor, 13)
  })

  test("deletes an adjacent token atomically", () => {
    const parts: ComposerEditorPart[] = [
      { type: "text", content: "open ", start: 0, end: 5 },
      { type: "file", path: "src/app.ts", kind: "file", content: "@src/app.ts", start: 5, end: 16 },
      { type: "text", content: " now", start: 16, end: 20 },
    ]

    const next = deleteStructuredRange(parts, 16, 16, "Backspace")

    assert.ok(next)
    assert.equal(composerText(next?.parts ?? emptyComposerParts()), "open now")
    assert.deepEqual(composerMentions(next?.parts ?? emptyComposerParts()), [])
    assert.equal(next?.cursor, 5)
  })

  test("preserves file selection metadata on insertion", () => {
    const next = replaceRangeWithMention([{ type: "text", content: "open @app", start: 0, end: 9 }], 5, 9, {
      type: "file",
      path: "src/app.ts",
      kind: "file",
      selection: { startLine: 12, endLine: 20 },
      content: "@src/app.ts#12-20",
    })

    assert.deepEqual(composerMentions(next.parts), [{
      type: "file",
      path: "src/app.ts",
      kind: "file",
      selection: { startLine: 12, endLine: 20 },
      content: "@src/app.ts#12-20",
      start: 5,
      end: 22,
    }])
  })

  test("preserves resource metadata on insertion", () => {
    const next = replaceRangeWithMention([{ type: "text", content: "use @do", start: 0, end: 7 }], 4, 7, {
      type: "resource",
      uri: "mcp://docs/reference",
      name: "docs",
      clientName: "reference",
      mimeType: "text/markdown",
      content: "@docs",
    })

    assert.deepEqual(composerMentions(next.parts), [{
      type: "resource",
      uri: "mcp://docs/reference",
      name: "docs",
      clientName: "reference",
      mimeType: "text/markdown",
      content: "@docs",
      start: 4,
      end: 9,
    }])
  })

  test("absorbs a typed line range after an existing file token once delimited", () => {
    const next = absorbFileSelectionSuffix([
      { type: "file", path: "src/app.ts", kind: "file", content: "@src/app.ts", start: 0, end: 11 },
      { type: "text", content: "#12-20 ", start: 11, end: 18 },
    ])

    assert.equal(next.changed, true)
    assert.deepEqual(next.parts, [
      { type: "file", path: "src/app.ts", kind: "file", selection: { startLine: 12, endLine: 20 }, content: "@src/app.ts#12-20", start: 0, end: 17 },
      { type: "text", content: " ", start: 17, end: 18 },
    ])
  })

  test("extends a single-line file token into a line range", () => {
    const next = absorbFileSelectionSuffix([
      { type: "file", path: "src/app.ts", kind: "file", selection: { startLine: 12 }, content: "@src/app.ts#12", start: 0, end: 14 },
      { type: "text", content: "-20 ", start: 14, end: 18 },
    ])

    assert.equal(next.changed, true)
    assert.deepEqual(next.parts, [
      { type: "file", path: "src/app.ts", kind: "file", selection: { startLine: 12, endLine: 20 }, content: "@src/app.ts#12-20", start: 0, end: 17 },
      { type: "text", content: " ", start: 17, end: 18 },
    ])
  })

  test("keeps an in-progress range suffix editable until submit or delimiter", () => {
    const next = absorbFileSelectionSuffix([
      { type: "file", path: "src/app.ts", kind: "file", content: "@src/app.ts", start: 0, end: 11 },
      { type: "text", content: "#12-20", start: 11, end: 17 },
    ])

    assert.equal(next.changed, false)
    assert.equal(composerText(next.parts), "@src/app.ts#12-20")
    assert.equal(composerText(absorbFileSelectionSuffix(next.parts, true).parts), "@src/app.ts#12-20")
    assert.deepEqual(composerMentions(absorbFileSelectionSuffix(next.parts, true).parts), [
      { type: "file", path: "src/app.ts", kind: "file", selection: { startLine: 12, endLine: 20 }, content: "@src/app.ts#12-20", start: 0, end: 17 },
    ])
  })

  test("inserts plain text with normalized ranges", () => {
    const next = replaceRangeWithText([{ type: "text", content: "hello", start: 0, end: 5 }], 5, 5, "\nworld")

    assert.equal(composerText(next.parts), "hello\nworld")
    assert.deepEqual(next.parts, [{ type: "text", content: "hello\nworld", start: 0, end: 11 }])
  })
})
