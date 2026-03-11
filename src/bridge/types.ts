import type { AgentInfo, FileDiff, LspStatus, McpResource, McpStatus, PermissionRequest, PromptSource, ProviderInfo, QuestionRequest, SessionInfo, SessionMessage, SessionStatus, Todo } from "../core/sdk"

export const SESSION_PANEL_VIEW_TYPE = "opencode-ui.session"

export type SessionPanelRef = {
  dir: string
  sessionId: string
}

export type SessionPanelStatus = "loading" | "ready" | "error"

export type SessionBootstrap = {
  status: SessionPanelStatus
  sessionRef: SessionPanelRef
  workspaceName: string
  session?: SessionInfo
  message?: string
}

export type SessionSnapshot = SessionBootstrap & {
  sessionStatus?: SessionStatus
  messages: SessionMessage[]
  childMessages: Record<string, SessionMessage[]>
  childSessions: Record<string, SessionInfo>
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
  mcpResources: Record<string, McpResource>
  lsp: LspStatus[]
  relatedSessionIds: string[]
  agentMode: "build" | "plan"
  navigation: {
    parent?: { id: string; title: string }
    prev?: { id: string; title: string }
    next?: { id: string; title: string }
  }
}

export type ComposerPathKind = "file" | "directory"

export type ComposerPathSource = "selection" | "recent" | "search"

export type ComposerFileSelection = {
  startLine: number
  endLine?: number
}

export type ComposerPathResult = {
  path: string
  kind: ComposerPathKind
  source: ComposerPathSource
  selection?: ComposerFileSelection
}

export type HostMessage =
  | {
      type: "bootstrap"
      payload: SessionBootstrap
    }
  | {
      type: "snapshot"
      payload: SessionSnapshot
    }
  | {
      type: "error"
      message: string
    }
  | {
      type: "fileRefsResolved"
      refs: Array<{
        key: string
        exists: boolean
      }>
    }
  | {
      type: "mcpActionFinished"
      name: string
    }
  | {
      type: "fileSearchResults"
      requestID: string
      query: string
      results: ComposerPathResult[]
    }

export type ComposerPromptPart =
  | {
      type: "text"
      text: string
    }
  | {
      type: "agent"
      name: string
      source?: PromptSource
    }
  | {
      type: "file"
      path: string
      kind?: ComposerPathKind
      selection?: ComposerFileSelection
      source: PromptSource
    }
  | {
      type: "resource"
      uri: string
      name: string
      clientName: string
      mimeType?: string
      source: PromptSource
    }

export type WebviewMessage =
  | {
      type: "ready"
    }
  | {
      type: "refresh"
    }
  | {
      type: "submit"
      text: string
      parts?: ComposerPromptPart[]
      agent?: string
      model?: {
        providerID: string
        modelID: string
      }
    }
  | {
      type: "permissionReply"
      requestID: string
      reply: "once" | "always" | "reject"
      message?: string
    }
  | {
      type: "questionReply"
      requestID: string
      answers: string[][]
    }
  | {
      type: "questionReject"
      requestID: string
    }
  | {
      type: "navigateSession"
      sessionID: string
    }
  | {
      type: "openFile"
      filePath: string
      line?: number
    }
  | {
      type: "resolveFileRefs"
      refs: Array<{
        key: string
        filePath: string
      }>
    }
  | {
      type: "toggleMcp"
      name: string
      action: "connect" | "disconnect" | "reconnect"
    }
  | {
      type: "composerAction"
      action: "refreshSession"
    }
  | {
      type: "searchFiles"
      requestID: string
      query: string
    }
