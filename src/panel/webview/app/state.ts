import type { SessionBootstrap, SessionSnapshot } from "../../../bridge/types"
import type { AgentInfo, FileDiff, LspStatus, McpStatus, PermissionRequest, ProviderInfo, QuestionRequest, SessionInfo, SessionMessage, SessionStatus, Todo } from "../../../core/sdk"

export type VsCodeApi = {
  postMessage(message: unknown): void
  setState<T>(state: T): void
}

export type FormState = {
  selected: Record<string, string[]>
  custom: Record<string, string>
  reject: Record<string, string>
}

type ComposerMentionBase = {
  content: string
  start: number
  end: number
}

export type ComposerMention = ({
  type: "agent"
  name: string
} | {
  type: "file"
  path: string
}) & ComposerMentionBase

export type AppState = {
  bootstrap: SessionBootstrap
  snapshot: {
    messages: SessionMessage[]
    childMessages: Record<string, SessionMessage[]>
    childSessions: Record<string, SessionInfo>
    sessionStatus?: SessionStatus
    submitting: boolean
    todos: Todo[]
    diff: FileDiff[]
    permissions: PermissionRequest[]
    questions: QuestionRequest[]
    agents: AgentInfo[]
    defaultAgent?: string
    providers: ProviderInfo[]
    providerDefault?: Record<string, string>
    configuredModel?: {
      providerID: string
      modelID: string
    }
    mcp: Record<string, McpStatus>
    lsp: LspStatus[]
    agentMode: "build" | "plan"
    navigation: {
      parent?: { id: string; title: string }
      prev?: { id: string; title: string }
      next?: { id: string; title: string }
    }
  }
  draft: string
  composerMentions: ComposerMention[]
  composerAgentOverride?: string
  error: string
  form: FormState
}

export function createInitialState(initialRef: SessionBootstrap["sessionRef"] | null): AppState {
  return {
    bootstrap: {
      status: "loading",
      workspaceName: initialRef?.dir ? initialRef.dir.split(/[\\/]/).pop() || initialRef.dir : "-",
      sessionRef: initialRef ?? { dir: "-", sessionId: "-" },
      message: "Waiting for workspace server and session metadata.",
    },
    snapshot: {
      messages: [],
      childMessages: {},
      childSessions: {},
      sessionStatus: undefined,
      submitting: false,
      todos: [],
      diff: [],
      permissions: [],
      questions: [],
      agents: [],
      defaultAgent: undefined,
      providers: [],
      providerDefault: undefined,
      configuredModel: undefined,
      mcp: {},
      lsp: [],
      agentMode: "build",
      navigation: {},
    },
    draft: "",
    composerMentions: [],
    composerAgentOverride: undefined,
    error: "",
    form: {
      selected: {},
      custom: {},
      reject: {},
    },
  }
}

export function bootstrapFromSnapshot(payload: SessionSnapshot): SessionBootstrap {
  return {
    status: payload.status,
    workspaceName: payload.workspaceName,
    sessionRef: payload.sessionRef,
    session: payload.session,
    message: payload.message,
  }
}

export function normalizeSnapshotPayload(payload: SessionSnapshot): AppState["snapshot"] {
  return {
    messages: Array.isArray(payload.messages) ? payload.messages : [],
    childMessages: recordOfMessageLists(payload.childMessages),
    childSessions: recordOfSessions(payload.childSessions),
    sessionStatus: payload.sessionStatus,
    submitting: !!payload.submitting,
    todos: Array.isArray(payload.todos) ? payload.todos : [],
    diff: Array.isArray(payload.diff) ? payload.diff : [],
    permissions: Array.isArray(payload.permissions) ? payload.permissions : [],
    questions: Array.isArray(payload.questions) ? payload.questions : [],
    agents: Array.isArray(payload.agents) ? payload.agents : [],
    defaultAgent: payload.defaultAgent,
    providers: Array.isArray(payload.providers) ? payload.providers : [],
    providerDefault: payload.providerDefault,
    configuredModel: payload.configuredModel,
    mcp: recordValue(payload.mcp) as Record<string, McpStatus>,
    lsp: Array.isArray(payload.lsp) ? payload.lsp : [],
    agentMode: payload.agentMode === "plan" ? "plan" : "build",
    navigation: payload.navigation || {},
  }
}

function recordOfMessageLists(value: unknown) {
  if (!value || typeof value !== "object") {
    return {} as Record<string, SessionMessage[]>
  }

  const out: Record<string, SessionMessage[]> = {}
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    out[key] = Array.isArray(entry) ? entry.filter((item): item is SessionMessage => !!item && typeof item === "object") : []
  }
  return out
}

function recordOfSessions(value: unknown) {
  if (!value || typeof value !== "object") {
    return {} as Record<string, SessionInfo>
  }

  const out: Record<string, SessionInfo> = {}
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    if (entry && typeof entry === "object") {
      out[key] = entry as SessionInfo
    }
  }
  return out
}

function recordValue(value: unknown) {
  return value && typeof value === "object" ? value as Record<string, unknown> : {}
}
