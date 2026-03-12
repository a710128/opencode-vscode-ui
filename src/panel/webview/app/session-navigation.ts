import type { SessionInfo, SessionMessage, ToolPart } from "../../../core/sdk"
import { toolChildSessionId } from "../lib/tool-meta"

export function activeChildSessionId(messages: SessionMessage[], childSessions: Record<string, SessionInfo>) {
  for (let messageIndex = messages.length - 1; messageIndex >= 0; messageIndex -= 1) {
    const message = messages[messageIndex]
    if (!message) {
      continue
    }

    for (let partIndex = message.parts.length - 1; partIndex >= 0; partIndex -= 1) {
      const part = message.parts[partIndex]
      if (!part || part.type !== "tool" || part.state.status === "completed") {
        continue
      }

      const sessionID = toolChildSessionId(part as ToolPart)
      if (sessionID && childSessions[sessionID]) {
        return sessionID
      }
    }
  }

  return undefined
}
