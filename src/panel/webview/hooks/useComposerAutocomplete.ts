import type { ComposerPathKind } from "../../../bridge/types"
import React from "react"
import { parseComposerFileQuery } from "../lib/composer-file-selection"

export type ComposerAutocompleteTrigger = "slash" | "mention"

export type ComposerAutocompleteItem = {
  id: string
  label: string
  detail: string
  keywords?: string[]
  trigger: ComposerAutocompleteTrigger
  kind: "action" | "agent" | "resource" | "selection" | "recent" | "file" | "directory"
  match?: {
    label: number[]
    detail: number[]
  }
  mention?: ({
    type: "agent"
    name: string
  } | {
    type: "file"
    path: string
    kind?: ComposerPathKind
    selection?: import("../../../bridge/types").ComposerFileSelection
  } | {
    type: "resource"
    uri: string
    name: string
    clientName: string
    mimeType?: string
  }) & {
    content: string
  }
}

export type ComposerAutocompleteState = {
  trigger: ComposerAutocompleteTrigger
  query: string
  start: number
  end: number
  items: ComposerAutocompleteItem[]
  selectedIndex: number
}

type ComposerAutocompleteMatch = {
  trigger: ComposerAutocompleteTrigger
  query: string
  start: number
  end: number
}

export function useComposerAutocomplete(sources: ComposerAutocompleteItem[]) {
  const [state, setState] = React.useState<ComposerAutocompleteState | null>(null)

  // When sources change (e.g. file search results arrive), re-filter the current
  // query so the popup updates without requiring another keystroke.
  React.useEffect(() => {
    setState((current) => {
      if (!current) {
        return current
      }
      const items = filterItems(sources, current.trigger, current.query)
      const selectedIndex = items.length === 0 ? 0 : Math.min(current.selectedIndex, items.length - 1)
      return { ...current, items, selectedIndex }
    })
  }, [sources])

  const sync = React.useCallback((value: string, start: number | null | undefined, end?: number | null | undefined) => {
    const next = matchAutocomplete(value, start, end)
    if (!next) {
      setState(null)
      return
    }

    setState((current) => {
      const items = filterItems(sources, next.trigger, next.query)
      const selectedIndex = items.length === 0
        ? 0
        : current && current.trigger === next.trigger && current.query === next.query
          ? Math.min(current.selectedIndex, items.length - 1)
          : 0

        return {
          trigger: next.trigger,
          query: next.query,
          start: next.start,
          end: next.end,
          items,
          selectedIndex,
        }
    })
  }, [sources])

  const close = React.useCallback(() => {
    setState(null)
  }, [])

  const move = React.useCallback((delta: number) => {
    setState((current) => {
      if (!current || current.items.length === 0) {
        return current
      }

      const size = current.items.length
      const nextIndex = (current.selectedIndex + delta + size) % size
      return {
        ...current,
        selectedIndex: nextIndex,
      }
    })
  }, [])

  const currentItem = state?.items[state.selectedIndex]

  return {
    state,
    currentItem,
    sync,
    close,
    move,
  }
}

export function matchAutocomplete(value: string, start: number | null | undefined, end?: number | null | undefined): ComposerAutocompleteMatch | null {
  if (typeof start !== "number") {
    return null
  }

  if (typeof end === "number" && end !== start) {
    return null
  }

  const slash = matchSlash(value, start)
  if (slash) {
    return slash
  }

  return matchMention(value, start)
}

function matchSlash(value: string, cursor: number): ComposerAutocompleteMatch | null {
  if (cursor < 1 || value[0] !== "/") {
    return null
  }

  const token = value.slice(0, cursor)
  if (/\s/.test(token)) {
    return null
  }

  const next = value[cursor]
  if (next && !/\s/.test(next)) {
    return null
  }

  return {
    trigger: "slash",
    query: value.slice(1, cursor),
    start: 0,
    end: cursor,
  }
}

function matchMention(value: string, cursor: number): ComposerAutocompleteMatch | null {
  if (cursor < 1) {
    return null
  }

  let index = cursor - 1
  while (index >= 0) {
    const char = value[index]
    if (char === "@") {
      const prev = index === 0 ? "" : value[index - 1]
      if (prev && !/\s/.test(prev)) {
        return null
      }

      const next = value[cursor]
      if (next && !/\s/.test(next)) {
        return null
      }

      return {
        trigger: "mention",
        query: value.slice(index + 1, cursor),
        start: index,
        end: cursor,
      }
    }
    if (/\s/.test(char)) {
      return null
    }
    index -= 1
  }

  return null
}

export function filterItems(items: ComposerAutocompleteItem[], trigger: ComposerAutocompleteTrigger, query: string) {
  const source = items.filter((item) => item.trigger === trigger)
  const normalized = query.trim().toLowerCase()
  if (!normalized) {
    return source.map((item) => ({ ...item, match: undefined }))
  }

  return source
    .map((item, index) => ({
      item: withMatch(item, normalized),
      index,
      rank: matchRank(item, normalized),
    }))
    .filter((item): item is { item: ComposerAutocompleteItem; index: number; rank: number } => item.rank !== undefined)
    .sort((a, b) => kindRank(a.item.kind) - kindRank(b.item.kind) || a.rank - b.rank || a.index - b.index)
    .map((item) => item.item)
}

function matchRank(item: ComposerAutocompleteItem, query: string) {
  const normalized = item.mention?.type === "file"
    ? parseComposerFileQuery(query).baseQuery.trim().toLowerCase()
    : query
  if (!normalized) {
    return 0
  }

  const fields = [
    fuzzyScore(item.label, normalized, 0),
    fuzzyScore(item.detail, normalized, 40),
    ...(item.keywords ?? []).map((value) => fuzzyScore(value, normalized, 70)),
  ].filter((value): value is number => typeof value === "number")

  return fields.length > 0 ? Math.min(...fields) : undefined
}

function withMatch(item: ComposerAutocompleteItem, query: string): ComposerAutocompleteItem {
  const normalized = item.mention?.type === "file"
    ? parseComposerFileQuery(query).baseQuery.trim().toLowerCase()
    : query
  return {
    ...item,
    match: {
      label: fuzzyIndexes(item.label, normalized),
      detail: fuzzyIndexes(item.detail, normalized),
    },
  }
}

function kindRank(kind: ComposerAutocompleteItem["kind"]) {
  switch (kind) {
    case "action":
      return 0
    case "agent":
      return 1
    case "selection":
      return 2
    case "resource":
      return 3
    case "recent":
      return 4
    case "file":
    case "directory":
      return 5
  }
}

function fuzzyIndexes(value: string, query: string) {
  const source = value.toLowerCase()
  const needle = query.trim().toLowerCase()
  if (!needle) {
    return []
  }

  const indexes: number[] = []
  let cursor = 0
  for (const char of needle) {
    const next = source.indexOf(char, cursor)
    if (next === -1) {
      return []
    }
    indexes.push(next)
    cursor = next + 1
  }

  return indexes
}

function fuzzyScore(value: string, query: string, offset: number) {
  const indexes = fuzzyIndexes(value, query)
  if (indexes.length === 0) {
    return undefined
  }

  const normalized = value.toLowerCase()
  const needle = query.trim().toLowerCase()
  let score = offset + Math.max(0, normalized.length - needle.length)

  for (let i = 0; i < indexes.length; i += 1) {
    const index = indexes[i]
    if (i === 0) {
      score += index * 3
    } else {
      const gap = index - indexes[i - 1] - 1
      score += gap * 5
      if (gap === 0) {
        score -= 8
      }
    }

    const prev = index === 0 ? "" : normalized[index - 1]
    if (!prev || prev === "/" || prev === "-" || prev === "_" || prev === ".") {
      score -= 3
    }
  }

  if (normalized === needle) {
    score -= 40
  } else if (normalized.startsWith(needle)) {
    score -= 24
  } else if (normalized.includes(`/${needle}`)) {
    score -= 10
  }

  return score
}
