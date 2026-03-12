import assert from "node:assert/strict"
import { describe, test } from "node:test"
import type { AgentInfo, ProviderInfo, SessionMessage } from "../../../core/sdk"
import { composerIdentity, composerSelection } from "./session-meta"

const providers: ProviderInfo[] = [{
  id: "p1",
  name: "Provider 1",
  models: {
    m1: { id: "m1", name: "Model 1" },
    m2: { id: "m2", name: "Model 2" },
  },
}]

const agents: AgentInfo[] = [
  { name: "build", mode: "primary", model: { providerID: "p1", modelID: "m1" } },
  { name: "plan", mode: "primary", model: { providerID: "p1", modelID: "m2" } },
]

function userMessage(agent: string, modelID: string): SessionMessage {
  return {
    info: {
      id: "msg-1",
      sessionID: "session-1",
      role: "user",
      time: { created: 0 },
      agent,
      model: { providerID: "p1", modelID },
    },
    parts: [],
  }
}

describe("session meta composer state", () => {
  test("composerSelection prefers current override over last user message", () => {
    const selection = composerSelection({
      messages: [userMessage("build", "m1")],
      agents,
      defaultAgent: "build",
      providers,
      providerDefault: { p1: "m1" },
      configuredModel: undefined,
      composerAgentOverride: "plan",
      composerMentionAgentOverride: undefined,
    })

    assert.deepEqual(selection, {
      agent: "plan",
      model: { providerID: "p1", modelID: "m2" },
    })
  })

  test("composerSelection keeps manual agent selection after typing plain text", () => {
    const selection = composerSelection({
      messages: [userMessage("build", "m1")],
      agents,
      defaultAgent: "build",
      providers,
      providerDefault: { p1: "m1" },
      configuredModel: undefined,
      composerAgentOverride: "plan",
      composerMentionAgentOverride: undefined,
    })

    assert.deepEqual(selection, {
      agent: "plan",
      model: { providerID: "p1", modelID: "m2" },
    })
  })

  test("composerSelection falls back to default current agent without override", () => {
    const selection = composerSelection({
      messages: [userMessage("plan", "m2")],
      agents,
      defaultAgent: "build",
      providers,
      providerDefault: { p1: "m1" },
      configuredModel: undefined,
      composerAgentOverride: undefined,
      composerMentionAgentOverride: undefined,
    })

    assert.deepEqual(selection, {
      agent: "build",
      model: { providerID: "p1", modelID: "m1" },
    })
  })

  test("composerIdentity shows current selection before historical message state", () => {
    const identity = composerIdentity({
      messages: [userMessage("build", "m1")],
      agents,
      defaultAgent: "build",
      providers,
      providerDefault: { p1: "m1" },
      configuredModel: undefined,
      agentMode: "build",
      composerAgentOverride: "plan",
      composerMentionAgentOverride: undefined,
    })

    assert.deepEqual(identity, {
      agent: "plan",
      model: "Model 2",
      provider: "Provider 1",
    })
  })

  test("composerSelection lets agent mentions override manual selection for current draft", () => {
    const selection = composerSelection({
      messages: [userMessage("build", "m1")],
      agents,
      defaultAgent: "build",
      providers,
      providerDefault: { p1: "m1" },
      configuredModel: undefined,
      composerAgentOverride: "build",
      composerMentionAgentOverride: "plan",
    })

    assert.deepEqual(selection, {
      agent: "plan",
      model: { providerID: "p1", modelID: "m2" },
    })
  })
})
