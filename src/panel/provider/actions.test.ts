import assert from "node:assert/strict"
import { describe, test } from "node:test"

import type { SessionMessage } from "../../core/sdk"
import { copyText, forkSessionFromMessage, runShellCommand, runSlashCommand, submit } from "./actions"

async function withImmediateTimeout<T>(run: () => Promise<T>) {
  const original = globalThis.setTimeout
  globalThis.setTimeout = (((handler: TimerHandler) => {
    if (typeof handler === "function") {
      handler()
    }
    return 0 as never
  }) as unknown) as typeof setTimeout

  try {
    return await run()
  } finally {
    globalThis.setTimeout = original
  }
}

function createContext(overrides?: {
  promptAsync?: (input: unknown) => Promise<unknown>
    command?: (input: unknown) => Promise<unknown>
    fork?: (input: unknown) => Promise<unknown>
    get?: (input: unknown) => Promise<unknown>
    shell?: (input: unknown) => Promise<unknown>
    status?: (input: unknown) => Promise<unknown>
  }): {
  ctx: Parameters<typeof submit>[0]
  posted: unknown[]
  refreshes: Array<{ workspaceID: string; quiet: boolean | undefined }>
  syncStates: boolean[]
} {
  const posted: unknown[] = []
  const refreshes: Array<{ workspaceID: string; quiet: boolean | undefined }> = []
  const syncStates: boolean[] = []
  const rt = {
    state: "ready",
    dir: "/workspace",
    name: "workspace",
    sdk: {
      session: {
        promptAsync: overrides?.promptAsync ?? (async () => ({ data: undefined })),
        command: overrides?.command ?? (async () => ({ data: undefined })),
        fork: overrides?.fork ?? (async () => ({ data: { id: "fork-1" } })),
        get: overrides?.get ?? (async () => ({ data: { id: "fork-1" } })),
        shell: overrides?.shell ?? (async () => ({ data: undefined })),
        status: overrides?.status ?? (async () => ({ data: { "session-1": { type: "idle" } } })),
      },
    },
  }

  const ctx = {
    ref: {
      workspaceId: "file:///workspace",
      dir: "/workspace",
      sessionId: "session-1",
    },
    mgr: {
      get: () => rt,
    },
    sessions: {
      refresh: async (workspaceID: string, quiet?: boolean) => {
        refreshes.push({ workspaceID, quiet })
        return []
      },
    },
    panel: {
      webview: {
        postMessage: async (message: unknown) => {
          posted.push(message)
          return true
        },
      },
    },
    state: {
      disposed: false,
      run: 0,
      pendingSubmitCount: 0,
      pendingForkMessageIDs: new Set<string>(),
    },
    messages: () => [],
    log: () => {},
    push: async () => {},
    syncSubmitting: async function () {
      syncStates.push(ctx.state.pendingSubmitCount > 0)
    },
  } as unknown as Parameters<typeof submit>[0]

  return {
    ctx,
    posted,
    refreshes,
    syncStates,
  }
}

function message(id: string, text: string, extraParts: SessionMessage["parts"] = []): SessionMessage {
  return {
    info: {
      id,
      sessionID: "session-1",
      role: "assistant",
      time: { created: 1 },
    },
    parts: [{
      id: `${id}-text`,
      sessionID: "session-1",
      messageID: id,
      type: "text",
      text,
    }, ...extraParts],
  }
}

describe("provider actions submitting", () => {
  test("submit toggles submitting around promptAsync", async () => {
    let promptPayload: unknown
    const { ctx, posted, syncStates } = createContext({
      promptAsync: async (input) => {
        promptPayload = input
        return { data: undefined }
      },
    })

    await withImmediateTimeout(async () => {
      await submit(ctx, "hello", undefined, "coder", { providerID: "openai", modelID: "gpt-5" }, "fast")
    })

    assert.deepEqual(syncStates, [true, false])
    assert.equal(ctx.state.pendingSubmitCount, 0)
    assert.deepEqual(promptPayload, {
      sessionID: "session-1",
      directory: "/workspace",
      agent: "coder",
      model: { providerID: "openai", modelID: "gpt-5" },
      variant: "fast",
      parts: [{ type: "text", text: "hello" }],
    })
    assert.deepEqual(posted, [])
  })

  test("submit converts image attachments into file prompt parts", async () => {
    let promptPayload: unknown
    const { ctx } = createContext({
      promptAsync: async (input) => {
        promptPayload = input
        return { data: undefined }
      },
    })

    await withImmediateTimeout(async () => {
      await submit(ctx, "", [{
        type: "image",
        id: "img-1",
        filename: "pasted.png",
        mime: "image/png",
        dataUrl: "data:image/png;base64,abc",
      }])
    })

    assert.deepEqual(promptPayload, {
      sessionID: "session-1",
      directory: "/workspace",
      agent: undefined,
      model: undefined,
      variant: undefined,
      parts: [{
        type: "file",
        mime: "image/png",
        filename: "pasted.png",
        url: "data:image/png;base64,abc",
      }],
    })
  })

  test("submit uses image MIME for supported file mentions", async () => {
    let promptPayload: unknown
    const { ctx } = createContext({
      promptAsync: async (input) => {
        promptPayload = input
        return { data: undefined }
      },
    })

    await withImmediateTimeout(async () => {
      await submit(ctx, "look @images/cat.webp", [
        { type: "text", text: "look @images/cat.webp" },
        {
          type: "file",
          path: "images/cat.webp",
          kind: "file",
          source: { value: "@images/cat.webp", start: 5, end: 21 },
        },
      ])
    })

    assert.deepEqual((promptPayload as { parts: unknown[] }).parts[1], {
      type: "file",
      mime: "image/webp",
      filename: "cat.webp",
      url: "file:///workspace/images/cat.webp",
      source: {
        type: "file",
        path: "/workspace/images/cat.webp",
        text: { value: "@images/cat.webp", start: 5, end: 21 },
      },
    })
  })

  test("runSlashCommand toggles submitting around command execution", async () => {
    let commandPayload: unknown
    const { ctx, syncStates } = createContext({
      command: async (input) => {
        commandPayload = input
        return { data: undefined }
      },
    })

    await withImmediateTimeout(async () => {
      await runSlashCommand(ctx, "review", "src/panel", "planner", "gpt-5", "safe")
    })

    assert.deepEqual(syncStates, [true, false])
    assert.equal(ctx.state.pendingSubmitCount, 0)
    assert.deepEqual(commandPayload, {
      sessionID: "session-1",
      directory: "/workspace",
      command: "review",
      arguments: "src/panel",
      agent: "planner",
      model: "gpt-5",
      variant: "safe",
    })
  })

  test("runShellCommand toggles submitting and posts success message", async () => {
    let shellPayload: unknown
    const { ctx, posted, syncStates } = createContext({
      shell: async (input) => {
        shellPayload = input
        return { data: undefined }
      },
    })

    await withImmediateTimeout(async () => {
      await runShellCommand(ctx, "bun test", "builder", { providerID: "openai", modelID: "gpt-5" }, "fast")
    })

    assert.deepEqual(syncStates, [true, false])
    assert.equal(ctx.state.pendingSubmitCount, 0)
    assert.deepEqual(shellPayload, {
      sessionID: "session-1",
      directory: "/workspace",
      command: "bun test",
      agent: "builder",
      model: { providerID: "openai", modelID: "gpt-5" },
      variant: "fast",
    })
    assert.deepEqual(posted, [{ type: "shellCommandSucceeded" }])
  })

  test("submit clears submitting and posts error on failure", async () => {
    const { ctx, posted, syncStates } = createContext({
      promptAsync: async () => {
        throw new Error("boom")
      },
    })

    await withImmediateTimeout(async () => {
      await submit(ctx, "hello")
    })

    assert.deepEqual(syncStates, [true, false])
    assert.equal(ctx.state.pendingSubmitCount, 0)
    assert.deepEqual(posted, [
      { type: "restoreComposer", parts: [{ type: "text", text: "hello" }] },
      { type: "error", message: "boom" },
    ])
  })
})

describe("provider message actions", () => {
  test("copyText joins visible text parts and excludes internal transcript data", () => {
    const value = copyText(message("message-1", "first", [
      {
        id: "text-2",
        sessionID: "session-1",
        messageID: "message-1",
        type: "text",
        text: "second",
      },
      {
        id: "hidden",
        sessionID: "session-1",
        messageID: "message-1",
        type: "text",
        text: "internal",
        synthetic: true,
      },
      {
        id: "tool",
        sessionID: "session-1",
        messageID: "message-1",
        type: "tool",
        tool: "bash",
        state: { status: "completed", output: "do not copy" },
      },
    ]))

    assert.equal(value, "first\nsecond")
  })

  test("fork uses the next message as the cut-off so the selected message is retained", async () => {
    let payload: unknown
    const { ctx, posted, refreshes } = createContext({
      fork: async (input) => {
        payload = input
        return { data: { id: "fork-1" } }
      },
    })
    const forkContext = ctx as unknown as { messages: () => SessionMessage[] }
    forkContext.messages = () => [
      message("message-1", "keep this"),
      message("message-2", "cut off here"),
    ]

    await forkSessionFromMessage(ctx, "message-1")

    assert.deepEqual(payload, {
      sessionID: "session-1",
      messageID: "message-2",
      directory: "/workspace",
    })
    assert.deepEqual(refreshes, [{ workspaceID: "file:///workspace", quiet: true }])
    assert.deepEqual(posted, [
      { type: "forkStarted", messageID: "message-1" },
      { type: "forkCompleted", sourceMessageID: "message-1", newSessionID: "fork-1" },
    ])
  })

  test("fork omits the cut-off message when the selected message is last", async () => {
    let payload: unknown
    const { ctx } = createContext({
      fork: async (input) => {
        payload = input
        return { data: { id: "fork-1" } }
      },
    })
    const forkContext = ctx as unknown as { messages: () => SessionMessage[] }
    forkContext.messages = () => [message("message-1", "keep this")]

    await forkSessionFromMessage(ctx, "message-1")

    assert.deepEqual(payload, {
      sessionID: "session-1",
      directory: "/workspace",
    })
  })

  test("fork maps a missing endpoint to an actionable compatibility error", async () => {
    const { ctx, posted } = createContext({
      fork: async () => {
        throw new Error("404 Not Found")
      },
    })
    const forkContext = ctx as unknown as { messages: () => SessionMessage[] }
    forkContext.messages = () => [message("message-1", "fork here")]

    await forkSessionFromMessage(ctx, "message-1")

    assert.deepEqual(posted, [
      { type: "forkStarted", messageID: "message-1" },
      { type: "forkFailed", messageID: "message-1", error: "Fork requires a newer version of OpenCode." },
    ])
  })

  test("fork returns a server failure to the affected message", async () => {
    const { ctx, posted } = createContext({
      fork: async () => {
        throw new Error("500 Internal Server Error")
      },
    })
    const forkContext = ctx as unknown as { messages: () => SessionMessage[] }
    forkContext.messages = () => [message("message-1", "fork here")]

    await forkSessionFromMessage(ctx, "message-1")

    assert.deepEqual(posted, [
      { type: "forkStarted", messageID: "message-1" },
      { type: "forkFailed", messageID: "message-1", error: "500 Internal Server Error" },
    ])
  })

  test("fork reports when the created child session cannot be loaded", async () => {
    const { ctx, posted } = createContext({
      get: async () => {
        throw new Error("Session not found")
      },
    })
    const forkContext = ctx as unknown as { messages: () => SessionMessage[] }
    forkContext.messages = () => [message("message-1", "fork here")]

    await forkSessionFromMessage(ctx, "message-1")

    assert.deepEqual(posted, [
      { type: "forkStarted", messageID: "message-1" },
      { type: "forkFailed", messageID: "message-1", error: "Fork was created, but the new session could not be loaded." },
    ])
  })

  test("fork ignores duplicate requests while the selected message is pending", async () => {
    let forkCalls = 0
    let resolveFork: ((value: unknown) => void) | undefined
    let markForkStarted: (() => void) | undefined
    const forkStarted = new Promise<void>((resolve) => {
      markForkStarted = resolve
    })
    const { ctx } = createContext({
      fork: async () => {
        forkCalls += 1
        markForkStarted?.()
        return await new Promise((resolve) => {
          resolveFork = resolve
        })
      },
    })
    const forkContext = ctx as unknown as { messages: () => SessionMessage[] }
    forkContext.messages = () => [message("message-1", "fork here")]

    const first = forkSessionFromMessage(ctx, "message-1")
    await forkStarted
    await forkSessionFromMessage(ctx, "message-1")
    resolveFork?.({ data: { id: "fork-1" } })
    await first

    assert.equal(forkCalls, 1)
  })
})
