import type { SessionBootstrap } from "../../../bridge/types"
import type { AgentInfo, LspStatus, McpStatus, MessageInfo, ProviderInfo, SessionMessage, SessionStatus } from "../../../core/sdk"

export type ModelRef = NonNullable<MessageInfo["model"]>

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

export function normalizeModelRef(model: MessageInfo["model"] | undefined): ModelRef | undefined {
  const providerID = model?.providerID?.trim()
  const modelID = model?.modelID?.trim()
  if (!providerID || !modelID) {
    return undefined
  }

  return { providerID, modelID }
}

export function modelKey(model: MessageInfo["model"] | undefined) {
  const normalized = normalizeModelRef(model)
  return normalized ? `${normalized.providerID}/${normalized.modelID}` : ""
}

export function sameModelRef(left: MessageInfo["model"] | undefined, right: MessageInfo["model"] | undefined) {
  const a = normalizeModelRef(left)
  const b = normalizeModelRef(right)
  return !!a && !!b && a.providerID === b.providerID && a.modelID === b.modelID
}

export function isValidModelRef(providers: ProviderInfo[], model: MessageInfo["model"] | undefined): model is ModelRef {
  const normalized = normalizeModelRef(model)
  if (!normalized) {
    return false
  }

  return !!providerModelById(providerById(providers, normalized.providerID), normalized.modelID)
}

export function pushRecentModel(recents: ModelRef[], model: MessageInfo["model"] | undefined, limit = 10) {
  const normalized = normalizeModelRef(model)
  if (!normalized) {
    return recents
  }

  const key = modelKey(normalized)
  const next = [normalized, ...recents.filter((item) => modelKey(item) !== key)]
  return next.slice(0, limit)
}

export function toggleFavoriteModel(favorites: ModelRef[], model: MessageInfo["model"] | undefined) {
  const normalized = normalizeModelRef(model)
  if (!normalized) {
    return favorites
  }

  const key = modelKey(normalized)
  const exists = favorites.some((item) => modelKey(item) === key)
  if (exists) {
    return favorites.filter((item) => modelKey(item) !== key)
  }

  return [normalized, ...favorites]
}

export function modelVariants(providers: ProviderInfo[], model: MessageInfo["model"] | undefined) {
  const normalized = normalizeModelRef(model)
  if (!normalized) {
    return []
  }

  const info = providerModelById(providerById(providers, normalized.providerID), normalized.modelID)
  return Object.keys(info?.variants ?? {})
}

export function cycleModelVariant(providers: ProviderInfo[], model: MessageInfo["model"] | undefined, current?: string) {
  const variants = modelVariants(providers, model)
  if (variants.length === 0) {
    return undefined
  }

  const currentIndex = current ? variants.indexOf(current) : -1
  if (currentIndex < 0) {
    return variants[0]
  }

  return currentIndex === variants.length - 1 ? undefined : variants[currentIndex + 1]
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

export function fallbackRecentModel(recents: ModelRef[] | undefined, providers: ProviderInfo[]) {
  if (!Array.isArray(recents)) {
    return undefined
  }

  return recents.find((item) => isValidModelRef(providers, item))
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
  const palette = agentPalette()
  return palette[agentColorIndex(name)]
}

export function agentColorClass(name: string) {
  return `oc-agentColor-${agentColorIndex(name)}`
}

function agentColorIndex(name: string) {
  let hash = 0
  for (const char of name) {
    hash = ((hash << 5) - hash) + char.charCodeAt(0)
    hash |= 0
  }
  return Math.abs(hash) % agentPalette().length
}

function agentPalette() {
  return [
    "#9ece6a",
    "#6ab5ce",
    "#6a8cce",
    "#a06ace",
    "#ce6ab5",
    "#ce8c6a",
    "#ceb56a",
  ]
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
  composerRecentModels?: ModelRef[]
  composerModelOverrides?: Record<string, ModelRef>
  composerModelVariants?: Record<string, string>
}) {
  const selection = composerSelection(snapshot)
  const lastUser = lastUserMessage(snapshot.messages)
  return {
    agent: selection.agent || lastUser?.info.agent?.trim() || snapshot.agentMode,
    model: displayModelRef(selection.model, snapshot.providers) || displayModelRef(lastUser?.info.model, snapshot.providers) || "",
    provider: displayProviderRef(selection.model, snapshot.providers) || displayProviderRef(lastUser?.info.model, snapshot.providers) || "",
    modelRef: selection.model,
    variant: selection.variant || lastUser?.info.variant?.trim() || "",
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
  composerRecentModels?: ModelRef[]
  composerModelOverrides?: Record<string, ModelRef>
  composerModelVariants?: Record<string, string>
}) {
  const agent = primaryAgent(snapshot.agents, snapshot.composerMentionAgentOverride || snapshot.composerAgentOverride || snapshot.defaultAgent)
  const overrideModel = agent?.name ? snapshot.composerModelOverrides?.[agent.name] : undefined
  const manualModel = isValidModelRef(snapshot.providers, overrideModel) ? overrideModel : undefined
  const agentModel = isValidModelRef(snapshot.providers, agent?.model) ? agent.model : undefined
  const configuredModel = isValidModelRef(snapshot.providers, snapshot.configuredModel) ? snapshot.configuredModel : undefined
  const recentModel = fallbackRecentModel(snapshot.composerRecentModels, snapshot.providers)
  const model = manualModel || agentModel || configuredModel || recentModel || fallbackModelRef(snapshot.providers, snapshot.providerDefault)
  const variant = model ? snapshot.composerModelVariants?.[modelKey(model)] : undefined

  return {
    agent: agent?.name,
    model,
    variant: variant || (agentModel && model && sameModelRef(agentModel, model) ? agent?.variant : undefined),
  }
}

export function lastUserSelection(messages: SessionMessage[], providers: ProviderInfo[]) {
  const message = lastUserMessage(messages)
  if (!message) {
    return undefined
  }

  const model = isValidModelRef(providers, message.info.model) ? message.info.model : undefined
  return {
    messageID: message.info.id,
    agent: message.info.agent?.trim() || undefined,
    model,
    variant: message.info.variant?.trim() || undefined,
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
