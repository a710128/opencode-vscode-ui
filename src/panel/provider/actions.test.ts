import assert from "node:assert/strict"
import { describe, test } from "node:test"

import { runShellCommand, runSlashCommand, submit } from "./actions"

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
  shell?: (input: unknown) => Promise<unknown>
}): {
  ctx: Parameters<typeof submit>[0]
  posted: unknown[]
  syncStates: boolean[]
} {
  const posted: unknown[] = []
  const syncStates: boolean[] = []
  const rt = {
    state: "ready",
    dir: "/workspace",
    name: "workspace",
    sdk: {
      session: {
        promptAsync: overrides?.promptAsync ?? (async () => ({ data: undefined })),
        command: overrides?.command ?? (async () => ({ data: undefined })),
        shell: overrides?.shell ?? (async () => ({ data: undefined })),
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
    },
    log: () => {},
    push: async () => {},
    syncSubmitting: async function () {
      syncStates.push(ctx.state.pendingSubmitCount > 0)
    },
  } as unknown as Parameters<typeof submit>[0]

  return {
    ctx,
    posted,
    syncStates,
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
