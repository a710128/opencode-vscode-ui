import type { MessagePart, PermissionRequest, QuestionRequest, SessionMessage } from "../../core/sdk"
import { cmp } from "./utils"

export function upsertMessage(messages: SessionMessage[], info: SessionMessage["info"]) {
  const idx = messages.findIndex((item) => item.info.id === info.id)
  if (idx < 0) {
    return sortMessages([...messages, { info, parts: [] }])
  }

  return messages.map((item, i) => {
    if (i !== idx) {
      return item
    }
    return {
      ...item,
      info,
    }
  })
}

export function upsertPart(messages: SessionMessage[], part: MessagePart) {
  return messages.map((item) => {
    if (item.info.id !== part.messageID) {
      return item
    }

    const idx = item.parts.findIndex((entry) => entry.id === part.id)
    if (idx < 0) {
      return {
        ...item,
        parts: sortParts([...item.parts, part]),
      }
    }

    return {
      ...item,
      parts: item.parts.map((entry, i) => (i === idx ? part : entry)),
    }
  })
}

export function removePart(messages: SessionMessage[], messageID: string, partID: string) {
  return messages.map((item) => {
    if (item.info.id !== messageID) {
      return item
    }

    return {
      ...item,
      parts: item.parts.filter((part) => part.id !== partID),
    }
  })
}

export function removePartFromChildren(children: Record<string, SessionMessage[]>, messageID: string, partID: string) {
  const next: Record<string, SessionMessage[]> = {}
  for (const [sessionID, messages] of Object.entries(children)) {
    next[sessionID] = removePart(messages, messageID, partID)
  }
  return next
}

export function appendDelta(messages: SessionMessage[], messageID: string, partID: string, field: string, delta: string) {
  return messages.map((item) => {
    if (item.info.id !== messageID) {
      return item
    }

    return {
      ...item,
      parts: item.parts.map((part) => {
        if (part.id !== partID) {
          return part
        }

        const current = part[field as keyof MessagePart]
        if (typeof current !== "string") {
          return part
        }

        return {
          ...part,
          [field]: current + delta,
        }
      }),
    }
  })
}

export function sortMessages(messages: SessionMessage[]) {
  return [...messages].sort((a, b) => cmp(a.info.id, b.info.id))
}

export function sortParts(parts: MessagePart[]) {
  return [...parts].sort((a, b) => cmp(a.id, b.id))
}

export function upsertPermission(list: PermissionRequest[], item: PermissionRequest) {
  const idx = list.findIndex((entry) => entry.id === item.id)
  if (idx < 0) {
    return sortPending([...list, item])
  }
  return list.map((entry, i) => (i === idx ? item : entry))
}

export function upsertQuestion(list: QuestionRequest[], item: QuestionRequest) {
  const idx = list.findIndex((entry) => entry.id === item.id)
  if (idx < 0) {
    return sortPending([...list, item])
  }
  return list.map((entry, i) => (i === idx ? item : entry))
}

export function sortPending<T extends { id: string }>(list: T[]) {
  return [...list].sort((a, b) => cmp(a.id, b.id))
}
