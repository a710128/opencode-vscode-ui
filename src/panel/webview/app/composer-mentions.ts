import type { ComposerPromptPart } from "../../../bridge/types"
import type { ComposerAutocompleteItem } from "../hooks/useComposerAutocomplete"
import type { ComposerMention } from "./state"

export function composerAgentOverride(mentions: ComposerMention[]) {
  for (let i = mentions.length - 1; i >= 0; i -= 1) {
    const item = mentions[i]
    if (item && item.type === "agent") {
      return item.name
    }
  }
}

export function buildComposerSubmitParts(value: string, mentions: ComposerMention[]): ComposerPromptPart[] {
  if (!value.trim()) {
    return []
  }

  const parts: ComposerPromptPart[] = [{ type: "text", text: value }]

  parts.push(...[...mentions]
    .sort((a, b) => a.start - b.start)
    .map((item): ComposerPromptPart => item.type === "agent"
      ? {
          type: "agent",
          name: item.name,
          source: {
            value: item.content,
            start: item.start,
            end: item.end,
          },
        }
      : item.type === "resource"
        ? {
            type: "resource",
            uri: item.uri,
            name: item.name,
            clientName: item.clientName,
            mimeType: item.mimeType,
            source: {
              value: item.content,
              start: item.start,
              end: item.end,
            },
          }
        : {
          type: "file",
          path: item.path,
          kind: item.kind,
          selection: item.selection,
          source: {
            value: item.content,
            start: item.start,
            end: item.end,
          },
        }))

  return parts
}

export function insertComposerMention(value: string, mentions: ComposerMention[], start: number, end: number, mention: NonNullable<ComposerAutocompleteItem["mention"]>) {
  const insert = `${mention.content} `
  const draft = `${value.slice(0, start)}${insert}${value.slice(end)}`
  const delta = insert.length - (end - start)
  const composerMentions = mentions
    .flatMap((item) => {
      if (item.end <= start) {
        return [item]
      }
      if (item.start >= end) {
        return [{ ...item, start: item.start + delta, end: item.end + delta }]
      }
      return []
    })
    .concat(mention.type === "agent"
      ? {
          type: "agent" as const,
          name: mention.name,
          content: mention.content,
          start,
          end: start + mention.content.length,
        }
      : mention.type === "resource"
        ? {
            type: "resource" as const,
            uri: mention.uri,
            name: mention.name,
            clientName: mention.clientName,
            mimeType: mention.mimeType,
            content: mention.content,
            start,
            end: start + mention.content.length,
          }
      : {
          type: "file" as const,
          path: mention.path,
          kind: mention.kind,
          selection: mention.selection,
          content: mention.content,
          start,
          end: start + mention.content.length,
        })
    .sort((a, b) => a.start - b.start)

  return {
    draft,
    cursor: start + insert.length,
    composerMentions,
    composerAgentOverride: composerAgentOverride(composerMentions),
  }
}

export function syncComposerMentions(prev: string, next: string, mentions: ComposerMention[]) {
  if (mentions.length === 0) {
    return mentions
  }

  const range = textChangeRange(prev, next)
  if (!range) {
    return mentions.filter((item) => next.slice(item.start, item.end) === item.content)
  }

  return mentions
    .flatMap((item) => {
      if (item.end <= range.start) {
        return [item]
      }
      if (item.start >= range.beforeEnd) {
        return [{ ...item, start: item.start + range.delta, end: item.end + range.delta }]
      }
      return []
    })
    .filter((item) => next.slice(item.start, item.end) === item.content)
}

export function selectionTouchesMention(mentions: ComposerMention[], start: number | null | undefined, end: number | null | undefined) {
  if (typeof start !== "number") {
    return false
  }

  if (typeof end === "number" && end !== start) {
    return mentions.some((item) => item.start < end && item.end > start)
  }

  return mentions.some((item) => start > item.start && start <= item.end)
}

export function deleteMentionBoundary(value: string, mentions: ComposerMention[], start: number | null | undefined, end: number | null | undefined, key: "Backspace" | "Delete") {
  const range = deleteRange(value, mentions, start, end, key)
  if (!range) {
    return null
  }

  const draft = `${value.slice(0, range.start)}${value.slice(range.end)}`
  const composerMentions = syncComposerMentions(value, draft, mentions)
  return {
    draft,
    cursor: range.start,
    composerMentions,
    composerAgentOverride: composerAgentOverride(composerMentions),
  }
}

function deleteRange(value: string, mentions: ComposerMention[], start: number | null | undefined, end: number | null | undefined, key: "Backspace" | "Delete") {
  if (typeof start !== "number") {
    return null
  }

  if (typeof end === "number" && end !== start) {
    const overlap = mentions.filter((item) => item.start < end && item.end > start)
    if (overlap.length === 0) {
      return null
    }

    return {
      start: Math.min(start, ...overlap.map((item) => item.start)),
      end: Math.max(end, ...overlap.map((item) => mentionDeleteEnd(value, item.end))),
    }
  }

  const item = mentions.find((mention) => key === "Backspace"
    ? start > mention.start && start <= mention.end
    : start >= mention.start && start < mention.end)

  if (!item) {
    return null
  }

  return {
    start: item.start,
    end: mentionDeleteEnd(value, item.end),
  }
}

function mentionDeleteEnd(value: string, end: number) {
  return value[end] === " " ? end + 1 : end
}

function textChangeRange(prev: string, next: string) {
  if (prev === next) {
    return null
  }

  let start = 0
  while (start < prev.length && start < next.length && prev[start] === next[start]) {
    start += 1
  }

  let beforeEnd = prev.length
  let afterEnd = next.length
  while (beforeEnd > start && afterEnd > start && prev[beforeEnd - 1] === next[afterEnd - 1]) {
    beforeEnd -= 1
    afterEnd -= 1
  }

  return {
    start,
    beforeEnd,
    delta: afterEnd - beforeEnd,
  }
}
