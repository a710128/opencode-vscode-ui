import assert from "node:assert/strict"
import { describe, test } from "node:test"
import type { FilePart, MessageInfo, MessagePart, SessionMessage, TextPart, ToolPart } from "../../../core/sdk"
import { imagePreviewSide } from "./image-preview"
import { createTimelineDerivationCache, imagePreviewUrl, reconcileTimelineBlocks } from "./timeline"

function messageInfo(id: string, role: "user" | "assistant", extras?: Partial<MessageInfo>): MessageInfo {
  return {
    id,
    sessionID: "session-1",
    role,
    time: {
      created: 0,
      completed: role === "assistant" ? 1 : undefined,
    },
    ...extras,
  }
}

function textPart(id: string, messageID: string, text: string): TextPart {
  return {
    id,
    sessionID: "session-1",
    messageID,
    type: "text",
    text,
  }
}

function toolPart(id: string, messageID: string, tool: string, status: ToolPart["state"]["status"] = "completed"): ToolPart {
  return {
    id,
    sessionID: "session-1",
    messageID,
    type: "tool",
    tool,
    state: {
      status,
    },
  }
}

function filePart(overrides: Partial<FilePart>): FilePart {
  return {
    id: "file-1",
    sessionID: "session-1",
    messageID: "message-1",
    type: "file",
    mime: "image/png",
    filename: "pasted.png",
    url: "data:image/png;base64,abc",
    ...overrides,
  }
}

function sessionMessage(info: MessageInfo, parts: MessagePart[]): SessionMessage {
  return { info, parts }
}

const defaultOptions = {
  showThinking: true,
  showInternals: false,
}

describe("timeline block reconciliation", () => {
  test("delta-like updates rebuild only affected assistant blocks", () => {
    const user = sessionMessage(messageInfo("m1", "user"), [textPart("p1", "m1", "hello")])
    const assistantText = textPart("p2", "m2", "before")
    const assistantTool = toolPart("p3", "m2", "bash")
    const assistant = sessionMessage(messageInfo("m2", "assistant", { agent: "build" }), [assistantText, assistantTool])

    const cache = createTimelineDerivationCache()
    const first = reconcileTimelineBlocks(cache, [user, assistant], defaultOptions)

    const nextAssistantText = { ...assistantText, text: "before and after" }
    const nextAssistant = sessionMessage(assistant.info, [nextAssistantText, assistantTool])
    const second = reconcileTimelineBlocks(cache, [user, nextAssistant], defaultOptions)

    assert.equal(second.length, first.length)
    assert.strictEqual(second[0], first[0], "user block should be reused")
    assert.notStrictEqual(second[2], first[2], "changed assistant text block should be rebuilt")
    assert.strictEqual(second[3], first[3], "unchanged assistant tool block should be reused")
    assert.notStrictEqual(second[4], first[4], "assistant action block should update for the changed message")
    assert.notStrictEqual(second[5], first[5], "assistant meta block should update for changed assistant message group")
    assert.equal(second[2]?.kind, "assistant-part")
    assert.equal(second[2]?.kind === "assistant-part" ? second[2].part.type : undefined, "text")
    assert.equal(second[2]?.kind === "assistant-part" && second[2].part.type === "text" ? second[2].part.text : undefined, "before and after")
    assert.equal(second[5]?.kind === "assistant-meta" ? second[5].messages[0] : undefined, nextAssistant)
  })

  test("reuses all block objects when inputs are identical", () => {
    const user = sessionMessage(messageInfo("m1", "user"), [textPart("p1", "m1", "hello")])
    const assistant = sessionMessage(messageInfo("m2", "assistant", { agent: "build" }), [textPart("p2", "m2", "done")])

    const cache = createTimelineDerivationCache()
    const first = reconcileTimelineBlocks(cache, [user, assistant], defaultOptions)
    const second = reconcileTimelineBlocks(cache, [user, assistant], defaultOptions)

    assert.equal(second.length, first.length)
    second.forEach((block, index) => {
      assert.strictEqual(block, first[index], `block ${index} should be reused`)
    })
  })

  test("appending a new assistant part preserves earlier block reuse", () => {
    const user = sessionMessage(messageInfo("m1", "user"), [textPart("p1", "m1", "hello")])
    const assistantText = textPart("p2", "m2", "before")
    const assistant = sessionMessage(messageInfo("m2", "assistant", { agent: "build" }), [assistantText])

    const cache = createTimelineDerivationCache()
    const first = reconcileTimelineBlocks(cache, [user, assistant], defaultOptions)

    const appendedTool = toolPart("p3", "m2", "bash")
    const nextAssistant = sessionMessage(assistant.info, [assistantText, appendedTool])
    const second = reconcileTimelineBlocks(cache, [user, nextAssistant], defaultOptions)

    assert.equal(second.length, first.length + 1)
    assert.strictEqual(second[0], first[0], "user block should be reused")
    assert.strictEqual(second[2], first[2], "existing assistant text block should be reused")
    assert.equal(second[3]?.kind, "assistant-part")
    assert.equal(second[3]?.kind === "assistant-part" ? second[3].part : undefined, appendedTool)
    assert.notStrictEqual(second[4], first[3], "assistant action block should rebuild when the message changes")
    assert.equal(second[5]?.kind === "assistant-meta" ? second[5].messages[0] : undefined, nextAssistant)
  })

  test("adds actions only for ordinary messages with visible text", () => {
    const user = sessionMessage(messageInfo("m1", "user"), [textPart("p1", "m1", "hello")])
    const toolOnlyAssistant = sessionMessage(messageInfo("m2", "assistant"), [toolPart("p2", "m2", "bash")])

    const blocks = reconcileTimelineBlocks(createTimelineDerivationCache(), [user, toolOnlyAssistant], defaultOptions)

    assert.equal(blocks.some((block) => block.kind === "message-actions" && block.message.info.id === "m1"), true)
    assert.equal(blocks.some((block) => block.kind === "message-actions" && block.message.info.id === "m2"), false)
  })
})

describe("timeline image previews", () => {
  test("shows previews only for data URL images", () => {
    assert.equal(imagePreviewUrl(filePart({})), "data:image/png;base64,abc")
    assert.equal(imagePreviewUrl(filePart({ url: "file:///workspace/pasted.png" })), "")
    assert.equal(imagePreviewUrl(filePart({ mime: "text/plain", filename: "notes.txt", url: "data:text/plain;base64,abc" })), "")
  })

  test("places previews away from constrained viewport edges", () => {
    assert.equal(imagePreviewSide({ top: 24, bottom: 48 }, 800), "below")
    assert.equal(imagePreviewSide({ top: 420, bottom: 448 }, 800), "above")
    assert.equal(imagePreviewSide({ top: 100, bottom: 180 }, 300), "below")
  })
})
