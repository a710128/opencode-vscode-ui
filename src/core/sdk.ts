export type SessionInfo = {
  id: string
  directory: string
  parentID?: string
  title: string
  time: {
    created: number
    updated: number
    archived?: number
  }
}

export type SessionStatus =
  | { type: "idle" }
  | {
      type: "retry"
      attempt: number
      message: string
      next: number
    }
  | { type: "busy" }

export type PermissionReply = "once" | "always" | "reject"

export type PermissionRequest = {
  id: string
  sessionID: string
  permission: string
  patterns: string[]
  metadata: Record<string, unknown>
  always: string[]
  tool?: {
    messageID: string
    callID: string
  }
}

export type QuestionOption = {
  label: string
  description: string
}

export type QuestionInfo = {
  question: string
  header: string
  options: QuestionOption[]
  multiple?: boolean
  custom?: boolean
}

export type QuestionRequest = {
  id: string
  sessionID: string
  questions: QuestionInfo[]
  tool?: {
    messageID: string
    callID: string
  }
}

export type Todo = {
  content: string
  status: string
  priority: string
}

export type FileDiff = {
  file: string
  before: string
  after: string
  additions: number
  deletions: number
  status?: "added" | "deleted" | "modified"
}

export type MessageInfo = {
  id: string
  sessionID: string
  role: "user" | "assistant"
  time: {
    created: number
    completed?: number
  }
  agent?: string
  cost?: number
  tokens?: {
    input: number
    output: number
    reasoning: number
    cache: {
      read: number
      write: number
    }
  }
  model?: {
    providerID: string
    modelID: string
  }
  variant?: string
}

export type TextPart = {
  id: string
  sessionID: string
  messageID: string
  type: "text"
  text: string
  synthetic?: boolean
  ignored?: boolean
}

export type ReasoningPart = {
  id: string
  sessionID: string
  messageID: string
  type: "reasoning"
  text: string
}

export type FilePart = {
  id: string
  sessionID: string
  messageID: string
  type: "file"
  mime: string
  filename?: string
  url: string
}

export type ToolPart = {
  id: string
  sessionID: string
  messageID: string
  callID?: string
  type: "tool"
  tool: string
  state: {
    status: "pending" | "running" | "completed" | "error"
    title?: string
    input?: Record<string, unknown>
    output?: string
    error?: string
    metadata?: Record<string, unknown>
  }
}

export type SimplePart = {
  id: string
  sessionID: string
  messageID: string
  type: "step-start" | "step-finish" | "snapshot" | "patch" | "agent" | "retry" | "compaction" | "subtask"
  [key: string]: unknown
}

export type MessagePart = TextPart | ReasoningPart | FilePart | ToolPart | SimplePart

export type SessionMessage = {
  info: MessageInfo
  parts: MessagePart[]
}

export type SessionEvent =
  | {
      type: "server.instance.disposed"
      properties?: {
        workspaceID?: string
      }
    }
  | {
      type: "session.status"
      properties: {
        sessionID: string
        status: SessionStatus
      }
    }
  | {
      type: "session.updated" | "session.created"
      properties: {
        info: SessionInfo
      }
    }
  | {
      type: "session.deleted"
      properties: {
        info: SessionInfo
      }
    }
  | {
      type: "session.diff"
      properties: {
        sessionID: string
        diff: FileDiff[]
      }
    }
  | {
      type: "message.updated"
      properties: {
        info: MessageInfo
      }
    }
  | {
      type: "message.removed"
      properties: {
        sessionID: string
        messageID: string
      }
    }
  | {
      type: "message.part.updated"
      properties: {
        part: MessagePart
      }
    }
  | {
      type: "message.part.removed"
      properties: {
        messageID: string
        partID: string
      }
    }
  | {
      type: "message.part.delta"
      properties: {
        sessionID: string
        messageID: string
        partID: string
        field: string
        delta: string
      }
    }
  | {
      type: "permission.asked"
      properties: PermissionRequest
    }
  | {
      type: "permission.replied"
      properties: {
        sessionID: string
        requestID: string
        reply: PermissionReply
      }
    }
  | {
      type: "question.asked"
      properties: QuestionRequest
    }
  | {
      type: "question.replied"
      properties: {
        sessionID: string
        requestID: string
        answers: string[][]
      }
    }
  | {
      type: "question.rejected"
      properties: {
        sessionID: string
        requestID: string
      }
    }
  | {
      type: "todo.updated"
      properties: {
        sessionID: string
        todos: Todo[]
      }
    }
  | {
      type: string
      properties?: unknown
    }

export type Client = {
  session: {
    list(input?: {
      directory?: string
      workspace?: string
      roots?: boolean
      start?: number
      search?: string
      limit?: number
    }): Promise<{ data?: SessionInfo[] }>
    create(input?: {
      directory?: string
      workspace?: string
      parentID?: string
      title?: string
    }): Promise<{ data?: SessionInfo }>
    delete(input: {
      sessionID: string
      directory?: string
      workspace?: string
    }): Promise<{ data?: boolean }>
    diff(input: {
      sessionID: string
      directory?: string
      workspace?: string
      messageID?: string
    }): Promise<{ data?: FileDiff[] }>
    get(input: {
      sessionID: string
      directory?: string
      workspace?: string
    }): Promise<{ data?: SessionInfo }>
    status(input?: {
      directory?: string
      workspace?: string
    }): Promise<{ data?: Record<string, SessionStatus> }>
    messages(input: {
      sessionID: string
      directory?: string
      workspace?: string
      limit?: number
    }): Promise<{ data?: SessionMessage[] }>
    promptAsync(input: {
      sessionID: string
      directory?: string
      workspace?: string
      messageID?: string
      agent?: string
      noReply?: boolean
      variant?: string
      parts: Array<{
        type: "text"
        text: string
      }>
    }): Promise<{ data?: void }>
    todo(input: {
      sessionID: string
      directory?: string
      workspace?: string
    }): Promise<{ data?: Todo[] }>
  }
  permission: {
    list(input?: {
      directory?: string
      workspace?: string
    }): Promise<{ data?: PermissionRequest[] }>
    reply(input: {
      requestID: string
      directory?: string
      workspace?: string
      reply?: PermissionReply
      message?: string
    }): Promise<{ data?: void }>
  }
  question: {
    list(input?: {
      directory?: string
      workspace?: string
    }): Promise<{ data?: QuestionRequest[] }>
    reply(input: {
      requestID: string
      directory?: string
      workspace?: string
      answers?: string[][]
    }): Promise<{ data?: void }>
    reject(input: {
      requestID: string
      directory?: string
      workspace?: string
    }): Promise<{ data?: void }>
  }
  event: {
    subscribe(input?: {
      directory?: string
      workspace?: string
    }, options?: {
      signal?: AbortSignal
      onSseError?: (error: unknown) => void
    }): Promise<{
      stream: AsyncIterable<SessionEvent>
    }>
  }
}

export async function client(url: string, dir: string): Promise<Client> {
  const mod = await import("@opencode-ai/sdk/v2/client")
  return mod.createOpencodeClient({
    baseUrl: url,
    directory: dir,
    throwOnError: true,
  }) as unknown as Client
}
