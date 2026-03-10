import type { SessionSnapshot } from "../../bridge/types"
import type { FileDiff, MessagePart, PermissionRequest, QuestionRequest, SessionEvent, SessionMessage, SessionStatus, Todo } from "../../core/sdk"
import { filterPermission, filterQuestion } from "./navigation"
import { appendDelta, removePart, removePartFromChildren, upsertMessage, upsertPart, upsertPermission, upsertQuestion } from "./mutations"
import { sortDiff } from "./snapshot"

export function reduce(payload: SessionSnapshot, event: SessionEvent) {
  if (event.type === "session.diff") {
    const props = event.properties as { sessionID: string; diff: FileDiff[] }
    if (props.sessionID !== payload.sessionRef.sessionId) {
      return
    }
    return {
      ...payload,
      diff: sortDiff(props.diff),
    }
  }

  if (event.type === "session.status") {
    const props = event.properties as { sessionID: string; status: SessionStatus }
    if (props.sessionID !== payload.sessionRef.sessionId) {
      return
    }
    return {
      ...payload,
      sessionStatus: props.status,
    }
  }

  if (event.type === "todo.updated") {
    const props = event.properties as { sessionID: string; todos: Todo[] }
    if (props.sessionID !== payload.sessionRef.sessionId) {
      return
    }
    return {
      ...payload,
      todos: props.todos,
    }
  }

  if (event.type === "session.updated" || event.type === "session.created") {
    const props = event.properties as { info: SessionSnapshot["session"] }
    if (!props.info || props.info.id !== payload.sessionRef.sessionId) {
      return
    }
    return {
      ...payload,
      session: props.info,
    }
  }

  if (event.type === "message.updated") {
    const props = event.properties as { info: SessionMessage["info"] }
    if (!payload.relatedSessionIds.includes(props.info.sessionID)) {
      return
    }

    if (props.info.sessionID !== payload.sessionRef.sessionId) {
      return {
        ...payload,
        childMessages: {
          ...payload.childMessages,
          [props.info.sessionID]: upsertMessage(payload.childMessages[props.info.sessionID] ?? [], props.info),
        },
      }
    }

    return {
      ...payload,
      messages: upsertMessage(payload.messages, props.info),
    }
  }

  if (event.type === "message.removed") {
    const props = event.properties as { sessionID: string; messageID: string }
    if (!payload.relatedSessionIds.includes(props.sessionID)) {
      return
    }

    if (props.sessionID !== payload.sessionRef.sessionId) {
      return {
        ...payload,
        childMessages: {
          ...payload.childMessages,
          [props.sessionID]: (payload.childMessages[props.sessionID] ?? []).filter((item) => item.info.id !== props.messageID),
        },
      }
    }

    return {
      ...payload,
      messages: payload.messages.filter((item) => item.info.id !== props.messageID),
    }
  }

  if (event.type === "message.part.updated") {
    const props = event.properties as { part: MessagePart }
    if (!payload.relatedSessionIds.includes(props.part.sessionID)) {
      return
    }

    if (props.part.sessionID !== payload.sessionRef.sessionId) {
      return {
        ...payload,
        childMessages: {
          ...payload.childMessages,
          [props.part.sessionID]: upsertPart(payload.childMessages[props.part.sessionID] ?? [], props.part),
        },
      }
    }

    const messages = upsertPart(payload.messages, props.part)
    return {
      ...payload,
      messages,
      agentMode: nextAgentMode(payload.agentMode, props.part, messages),
    }
  }

  if (event.type === "message.part.removed") {
    const props = event.properties as { messageID: string; partID: string }
    return {
      ...payload,
      messages: removePart(payload.messages, props.messageID, props.partID),
      childMessages: removePartFromChildren(payload.childMessages, props.messageID, props.partID),
    }
  }

  if (event.type === "message.part.delta") {
    const props = event.properties as {
      sessionID: string
      messageID: string
      partID: string
      field: string
      delta: string
    }
    if (!payload.relatedSessionIds.includes(props.sessionID)) {
      return
    }

    if (props.sessionID !== payload.sessionRef.sessionId) {
      return {
        ...payload,
        childMessages: {
          ...payload.childMessages,
          [props.sessionID]: appendDelta(payload.childMessages[props.sessionID] ?? [], props.messageID, props.partID, props.field, props.delta),
        },
      }
    }

    return {
      ...payload,
      messages: appendDelta(payload.messages, props.messageID, props.partID, props.field, props.delta),
    }
  }

  if (event.type === "permission.asked") {
    const props = event.properties as PermissionRequest
    if (!payload.relatedSessionIds.includes(props.sessionID)) {
      return
    }
    return {
      ...payload,
      permissions: filterPermission(upsertPermission(payload.permissions, props), payload.relatedSessionIds),
    }
  }

  if (event.type === "permission.replied") {
    const props = event.properties as { sessionID: string; requestID: string }
    if (!payload.relatedSessionIds.includes(props.sessionID)) {
      return
    }
    return {
      ...payload,
      permissions: payload.permissions.filter((item) => item.id !== props.requestID),
    }
  }

  if (event.type === "question.asked") {
    const props = event.properties as QuestionRequest
    if (!payload.relatedSessionIds.includes(props.sessionID)) {
      return
    }
    return {
      ...payload,
      questions: filterQuestion(upsertQuestion(payload.questions, props), payload.relatedSessionIds),
    }
  }

  if (event.type === "question.replied" || event.type === "question.rejected") {
    const props = event.properties as { sessionID: string; requestID: string }
    if (!payload.relatedSessionIds.includes(props.sessionID)) {
      return
    }
    return {
      ...payload,
      questions: payload.questions.filter((item) => item.id !== props.requestID),
    }
  }
}

export function needsRefresh(event: SessionEvent, payload: SessionSnapshot) {
  if (event.type === "server.instance.disposed") {
    return true
  }

  if (event.type === "session.deleted") {
    const props = event.properties as { info: { id: string } }
    return payload.relatedSessionIds.includes(props.info.id)
  }

  if (event.type === "session.created" || event.type === "session.updated") {
    const props = event.properties as { info: { id: string; parentID?: string } }
    if (props.info.id === payload.sessionRef.sessionId) {
      return false
    }
    if (payload.session?.parentID) {
      return false
    }
    return props.info.parentID === payload.sessionRef.sessionId || payload.relatedSessionIds.includes(props.info.id)
  }

  return false
}

function nextAgentMode(current: SessionSnapshot["agentMode"], part: MessagePart, messages: SessionMessage[]) {
  const next = partAgentMode(part)
  if (next) {
    return next
  }
  return current || agentMode(messages)
}

function agentMode(messages: SessionMessage[]) {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const mode = messageAgentMode(messages[i])
    if (mode) {
      return mode
    }
  }

  return "build" as const
}

function messageAgentMode(message: SessionMessage) {
  for (let i = message.parts.length - 1; i >= 0; i -= 1) {
    const mode = partAgentMode(message.parts[i])
    if (mode) {
      return mode
    }
  }
}

function partAgentMode(part: MessagePart) {
  if (part.type !== "tool" || part.state.status !== "completed") {
    return undefined
  }
  if (part.tool === "plan_enter") {
    return "plan" as const
  }
  if (part.tool === "plan_exit") {
    return "build" as const
  }
  return undefined
}
