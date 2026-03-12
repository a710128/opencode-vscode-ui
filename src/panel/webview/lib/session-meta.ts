import type { SessionBootstrap } from "../../../bridge/types"
import type { AgentInfo, LspStatus, McpStatus, MessageInfo, ProviderInfo, SessionMessage, SessionStatus } from "../../../core/sdk"

export type StatusTone = "green" | "orange" | "red" | "gray"

export type StatusItem = {
  name: string
  tone: StatusTone
  value: string
  action?: "connect" | "disconnect" | "reconnect"
  actionLabel?: string
}

export function sessionTitle(bootstrap: SessionBootstrap) {
  return bootstrap.session?.title || bootstrap.sessionRef.sessionId?.slice(0, 8) || "session"
}

export function isSessionRunning(status?: SessionStatus) {
  return status?.type === "busy" || status?.type === "retry"
}

export function contextUsage(messages: SessionMessage[], providers: ProviderInfo[]) {
  const info = lastAssistantWithOutput(messages)?.info
  const tokens = totalTokens(info)
  if (!info || tokens <= 0) {
    return undefined
  }

  const limit = modelContextLimit(info, providers)
  return {
    tokens,
    percent: typeof limit === "number" && limit > 0 ? Math.round(tokens / limit * 100) : undefined,
  }
}

export function sessionCost(messages: SessionMessage[]) {
  return messages.reduce((acc, item) => item.info.role === "assistant" ? acc + (item.info.cost ?? 0) : acc, 0)
}

export function totalTokens(info?: MessageInfo) {
  const tokens = info?.tokens
  if (!tokens) {
    return 0
  }
  return tokens.input + tokens.output + tokens.reasoning + tokens.cache.read + tokens.cache.write
}

export function modelContextLimit(info: MessageInfo | undefined, providers: ProviderInfo[]) {
  const providerID = info?.model?.providerID?.trim()
  const modelID = info?.model?.modelID?.trim()
  if (!providerID || !modelID) {
    return undefined
  }

  const provider = providerById(providers, providerID)
  const model = providerModelById(provider, modelID)
  return model?.limit?.context
}

export function providerById(providers: ProviderInfo[], providerID?: string) {
  return providers.find((item) => item.id === providerID)
}

export function displayModelRef(model: MessageInfo["model"] | undefined, providers: ProviderInfo[]) {
  const providerID = model?.providerID?.trim()
  const modelID = model?.modelID?.trim()
  if (!modelID) {
    return ""
  }
  const provider = providerById(providers, providerID)
  return providerModelById(provider, modelID)?.name || modelID
}

export function displayProviderRef(model: MessageInfo["model"] | undefined, providers: ProviderInfo[]) {
  const providerID = model?.providerID?.trim()
  if (!providerID) {
    return ""
  }
  return providerById(providers, providerID)?.name || providerID
}

export function fallbackModelRef(providers: ProviderInfo[], defaults?: Record<string, string>) {
  const provider = preferredProvider(providers, defaults)
  if (!provider?.id) {
    return undefined
  }

  const modelID = defaults?.[provider.id]?.trim()
  const model = modelID ? providerModelById(provider, modelID) : firstProviderModel(provider)
  if (!model?.id) {
    return undefined
  }

  return {
    providerID: provider.id,
    modelID: model.id,
  }
}

export function lastUserMessage(messages: SessionMessage[]) {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    if (messages[i]?.info.role === "user") {
      return messages[i]
    }
  }
}

export function providerModelById(provider: ProviderInfo | undefined, modelID: string) {
  if (!provider?.models || !modelID) {
    return undefined
  }
  return provider.models[modelID]
}

export function firstProviderModel(provider: ProviderInfo | undefined) {
  if (!provider?.models) {
    return undefined
  }
  return Object.values(provider.models)[0]
}

export function preferredProvider(providers: ProviderInfo[], defaults?: Record<string, string>) {
  if (defaults) {
    for (const provider of providers) {
      const modelID = defaults[provider.id]?.trim()
      if (modelID && providerModelById(provider, modelID)) {
        return provider
      }
    }
  }

  return providers.find((provider) => !!firstProviderModel(provider))
}

export function primaryAgent(agents: AgentInfo[], name?: string) {
  if (name) {
    const match = agents.find((item) => item.name === name)
    if (match) {
      return match
    }
  }

  return agents[0]
}

export function lastAssistantWithOutput(messages: SessionMessage[]) {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const item = messages[i]
    if (item?.info.role === "assistant" && (item.info.tokens?.output ?? 0) > 0) {
      return item
    }
  }
}

export function formatUsd(value: number) {
  return `$${value.toFixed(4)}`
}

export function overallMcpStatus(statuses: Record<string, McpStatus>) {
  const items = Object.entries(statuses)
    .map(([name, status]) => statusItemForMcp(name, status))

  if (items.length === 0) {
    return { tone: "gray" as const, items: [] }
  }

  const ok = items.filter((item) => item.tone === "green").length
  const warn = items.filter((item) => item.tone === "orange").length
  const err = items.filter((item) => item.tone === "red").length
  if (ok === items.length) {
    return { tone: "green" as const, items }
  }
  if (err > 0 && ok === 0 && warn === 0) {
    return { tone: "red" as const, items }
  }
  return { tone: "orange" as const, items }
}

export function overallLspStatus(statuses: LspStatus[]) {
  const items = statuses.map(statusItemForLsp)
  if (items.length === 0) {
    return { tone: "gray" as const, items: [] }
  }

  const ok = items.filter((item) => item.tone === "green").length
  if (ok === items.length) {
    return { tone: "green" as const, items }
  }
  if (ok === 0) {
    return { tone: "red" as const, items }
  }
  return { tone: "orange" as const, items }
}

export function statusItemForMcp(name: string, status: McpStatus): StatusItem {
  if (status.status === "connected") {
    return { name, tone: "green", value: "Connected", action: "disconnect", actionLabel: `Disconnect ${name}` }
  }
  if (status.status === "disabled") {
    return { name, tone: "gray", value: "Disabled", action: "connect", actionLabel: `Connect ${name}` }
  }
  if (status.status === "needs_auth") {
    return { name, tone: "orange", value: "Needs authentication", action: "reconnect", actionLabel: `Reconnect ${name}` }
  }
  if (status.status === "needs_client_registration") {
    return { name, tone: "red", value: status.error || "Client registration required", action: "reconnect", actionLabel: `Reconnect ${name}` }
  }
  return { name, tone: "red", value: status.error || "Error", action: "reconnect", actionLabel: `Reconnect ${name}` }
}

export function statusItemForLsp(status: LspStatus): StatusItem {
  return {
    name: status.name,
    tone: status.status === "connected" ? "green" : "red",
    value: status.root || ".",
  }
}

export function agentColor(name: string) {
  const palette = [
    "#9ece6a",
    "#6ab5ce",
    "#6a8cce",
    "#a06ace",
    "#ce6ab5",
    "#ce8c6a",
    "#ceb56a",
  ]
  let hash = 0
  for (const char of name) {
    hash = ((hash << 5) - hash) + char.charCodeAt(0)
    hash |= 0
  }
  return palette[Math.abs(hash) % palette.length]
}

export function composerIdentity(snapshot: {
  messages: SessionMessage[]
  agents: AgentInfo[]
  defaultAgent?: string
  providers: ProviderInfo[]
  providerDefault?: Record<string, string>
  configuredModel?: {
    providerID: string
    modelID: string
  }
  agentMode: "build" | "plan"
  composerAgentOverride?: string
  composerMentionAgentOverride?: string
}) {
  const selection = composerSelection(snapshot)
  const lastUser = lastUserMessage(snapshot.messages)
  return {
    agent: selection.agent || lastUser?.info.agent?.trim() || snapshot.agentMode,
    model: displayModelRef(selection.model, snapshot.providers) || displayModelRef(lastUser?.info.model, snapshot.providers) || "",
    provider: displayProviderRef(selection.model, snapshot.providers) || displayProviderRef(lastUser?.info.model, snapshot.providers) || "",
  }
}

export function composerSelection(snapshot: {
  messages: SessionMessage[]
  agents: AgentInfo[]
  defaultAgent?: string
  providers: ProviderInfo[]
  providerDefault?: Record<string, string>
  configuredModel?: {
    providerID: string
    modelID: string
  }
  composerAgentOverride?: string
  composerMentionAgentOverride?: string
}) {
  const agent = primaryAgent(snapshot.agents, snapshot.composerMentionAgentOverride || snapshot.composerAgentOverride || snapshot.defaultAgent)
  const model = agent?.model && providerModelById(providerById(snapshot.providers, agent.model.providerID), agent.model.modelID)
    ? agent.model
    : undefined

  return {
    agent: agent?.name,
    model: model || (snapshot.agents.length === 0 ? snapshot.configuredModel || fallbackModelRef(snapshot.providers, snapshot.providerDefault) : undefined),
  }
}

export function composerMetrics(snapshot: {
  messages: SessionMessage[]
  providers: ProviderInfo[]
}) {
  const context = contextUsage(snapshot.messages, snapshot.providers)
  return {
    tokens: context?.tokens ?? 0,
    percent: context?.percent,
    cost: sessionCost(snapshot.messages),
  }
}
