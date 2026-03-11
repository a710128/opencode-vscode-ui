import type { ComposerPathResult } from "../../bridge/types"
import { collectDirectoryResults, matchesPath, sortPaths } from "../../panel/provider/file-search"
import { autocompleteItemView, buildComposerMenuItems } from "../../panel/webview/app/composer-menu"
import { createInitialState } from "../../panel/webview/app/state"
import { filterItems, matchAutocomplete } from "../../panel/webview/hooks/useComposerAutocomplete"
import { parseComposerFileQuery } from "../../panel/webview/lib/composer-file-selection"

const FILE_SEARCH_LIMIT = 24

export type ComposerIntegrationFixture = {
  name: string
  draft: string
  cursor: number
  agents?: Array<{ name: string; mode: "subagent" | "primary" | "all"; hidden?: boolean }>
  resources?: Record<string, { name: string; uri: string; client: string; description?: string; mimeType?: string }>
  host?: {
    selected?: ComposerPathResult
    recent?: string[]
    workspace?: string[]
  }
}

export function runComposerIntegration(fix: ComposerIntegrationFixture) {
  const match = matchAutocomplete(fix.draft, fix.cursor, fix.cursor)
  const state = createInitialState({ dir: "/workspace", sessionId: "session" })
  state.snapshot.agents = fix.agents ?? []
  state.snapshot.mcpResources = fix.resources ?? {}

  const results = match?.trigger === "mention"
    ? hostResults(parseComposerFileQuery(match.query).baseQuery.trim(), fix.host)
    : []
  const items = match
    ? filterItems(buildComposerMenuItems(state, results), match.trigger, match.query)
    : []

  return {
    trigger: match?.trigger ?? null,
    query: match?.query,
    hostResults: results,
    items: items.map((item) => {
      const view = autocompleteItemView(match?.query ?? "", item)
      return {
        id: item.id,
        kind: view.kind,
        label: view.label,
        detail: view.detail,
      }
    }),
  }
}

function hostResults(query: string, host?: ComposerIntegrationFixture["host"]) {
  if (!host) {
    return []
  }

  const selected = host.selected && (!query || matchesPath(host.selected.path, query))
    ? [host.selected]
    : []
  const recentPaths = (host.recent ?? []).filter((item) => !query || matchesPath(item, query))
  const recent = (query ? sortPaths(recentPaths, query) : recentPaths).map((path) => ({
    path,
    kind: "file" as const,
    source: "recent" as const,
  }))

  const files = host.workspace ?? []
  const search = !query
    ? []
    : [
        ...sortPaths(files, query).map((path) => ({
          path,
          kind: "file" as const,
          source: "search" as const,
        })),
        ...sortPaths(collectDirectoryResults(parentDirs(files), query).map((item) => item.path), query).map((path) => ({
          path,
          kind: "directory" as const,
          source: "search" as const,
        })),
      ]

  return dedupe([...selected, ...recent, ...search]).slice(0, FILE_SEARCH_LIMIT)
}

function dedupe(items: ComposerPathResult[]) {
  const seen = new Set<string>()
  return items.filter((item) => {
    const key = `${item.kind}:${item.path}`
    if (seen.has(key)) {
      return false
    }
    seen.add(key)
    return true
  })
}

function parentDirs(items: string[]) {
  return [...new Set(items.flatMap((item) => {
    const parts = item.split("/").filter(Boolean)
    return parts.slice(0, -1).map((_, index) => parts.slice(0, index + 1).join("/"))
  }))]
}
