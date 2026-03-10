import React from "react"

export type ComposerAutocompleteTrigger = "slash" | "mention"

export type ComposerAutocompleteItem = {
  id: string
  label: string
  detail: string
  keywords?: string[]
  trigger: ComposerAutocompleteTrigger
  kind: "action" | "agent" | "file"
  mention?: ({
    type: "agent"
    name: string
  } | {
    type: "file"
    path: string
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

function matchAutocomplete(value: string, start: number | null | undefined, end?: number | null | undefined): ComposerAutocompleteMatch | null {
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

function filterItems(items: ComposerAutocompleteItem[], trigger: ComposerAutocompleteTrigger, query: string) {
  const source = items.filter((item) => item.trigger === trigger)
  const normalized = query.trim().toLowerCase()
  if (!normalized) {
    return source
  }

  return source
    .map((item, index) => ({
      item,
      index,
      rank: matchRank(item, normalized),
    }))
    .filter((item): item is { item: ComposerAutocompleteItem; index: number; rank: number } => item.rank !== undefined)
    .sort((a, b) => a.rank - b.rank || a.index - b.index)
    .map((item) => item.item)
}

function matchRank(item: ComposerAutocompleteItem, query: string) {
  const label = item.label.toLowerCase()
  const detail = item.detail.toLowerCase()
  const keywords = (item.keywords ?? []).map((value) => value.toLowerCase())
  const haystack = [label, detail, ...keywords]

  if (label === query) {
    return 0
  }
  if (label.startsWith(query)) {
    return 1
  }
  if (keywords.some((value) => value === query)) {
    return 2
  }
  if (detail === query) {
    return 3
  }
  if (detail.startsWith(query)) {
    return 4
  }
  if (haystack.some((value) => value.includes(`/${query}`))) {
    return 5
  }
  if (haystack.some((value) => value.includes(query))) {
    return 6
  }
}
