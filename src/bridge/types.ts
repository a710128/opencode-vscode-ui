import type { FileDiff, PermissionRequest, QuestionRequest, SessionInfo, SessionMessage, SessionStatus, Todo } from "../core/sdk"

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
  relatedSessionIds: string[]
  agentMode: "build" | "plan"
  navigation: {
    parent?: { id: string; title: string }
    prev?: { id: string; title: string }
    next?: { id: string; title: string }
  }
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
