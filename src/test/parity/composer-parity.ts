import type { ComposerPathResult, ComposerPromptPart } from "../../bridge/types"
import type { AgentInfo, McpResource } from "../../core/sdk"
import { collectDirectoryResults, matchesPath, sortPaths } from "../../panel/provider/file-search"
import { buildComposerSubmitParts } from "../../panel/webview/app/composer-mentions"
import { composerMentions, composerText, replaceRangeWithMention } from "../../panel/webview/app/composer-editor"
import { autocompleteItemView, buildComposerMenuItems, mentionForQuery } from "../../panel/webview/app/composer-menu"
import { createInitialState } from "../../panel/webview/app/state"
import { filterItems, matchAutocomplete, type ComposerAutocompleteItem } from "../../panel/webview/hooks/useComposerAutocomplete"
import { parseComposerFileQuery } from "../../panel/webview/lib/composer-file-selection"

type ResourceMap = Record<string, McpResource>

export type ComposerParityResult = {
  trigger: "slash" | "mention" | null
  query?: string
  items: Array<{
    id: string
    kind: ComposerAutocompleteItem["kind"]
    label: string
    detail: string
  }>
  accepted?: {
    draft?: string
    action?: string
    submitParts?: ComposerPromptPart[]
  }
}

export type ComposerParityFixture = {
  name: string
  draft: string
  cursor: number
  composerAgentOverride?: string
  agents?: AgentInfo[]
  mcpResources?: ResourceMap
  files?: {
    selected?: ComposerPathResult
    recent?: string[]
    workspace?: string[]
  }
  acceptIndex?: number
  expected: {
    trigger: "slash" | "mention" | null
    query?: string
    items: Array<{
      id: string
      kind: ComposerAutocompleteItem["kind"]
      label: string
      detail: string
    }>
    accepted?: {
      draft?: string
      action?: string
      submitParts?: ComposerPromptPart[]
    }
  }
}

export function runComposerParity(fix: ComposerParityFixture): ComposerParityResult {
  const state = createInitialState({ dir: "/workspace", sessionId: "session" })
  state.snapshot.agents = fix.agents ?? []
  state.snapshot.mcpResources = fix.mcpResources ?? {}
  state.composerAgentOverride = fix.composerAgentOverride
  state.draft = fix.draft
  state.composerParts = [{ type: "text", content: fix.draft, start: 0, end: fix.draft.length }]

  const match = matchAutocomplete(fix.draft, fix.cursor, fix.cursor)
  if (!match) {
    return {
      trigger: null,
      items: [],
    }
  }

  const fileResults = match.trigger === "mention"
    ? fixtureFiles(match.query, fix.files)
    : []
  const menu = buildComposerMenuItems(state, fileResults)
  const items = filterItems(menu, match.trigger, match.query)
  const out = {
    trigger: match.trigger,
    query: match.query,
    items: normalizeItems(match.query, items),
  }

  if (typeof fix.acceptIndex !== "number") {
    return out
  }

  const item = items[fix.acceptIndex]
  if (!item) {
    return { ...out, accepted: undefined }
  }

  if (!item.mention) {
    return {
      ...out,
      accepted: {
        action: item.id,
      },
    }
  }

  const mention = item.mention.type === "file"
    ? mentionForQuery(item.mention, match.query)
    : item.mention
  const next = replaceRangeWithMention(state.composerParts, match.start, match.end, mention)
  const draft = composerText(next.parts)
  const mentions = composerMentions(next.parts)
  return {
    ...out,
    accepted: {
      draft,
      submitParts: buildComposerSubmitParts(draft, mentions),
    },
  }
}

function normalizeItems(query: string, items: ComposerAutocompleteItem[]) {
  return items.map((item) => {
    const view = autocompleteItemView(query, item)
    return {
      id: item.id,
      kind: view.kind,
      label: view.label,
      detail: view.detail,
    }
  })
}

function fixtureFiles(query: string, data?: ComposerParityFixture["files"]) {
  if (!data) {
    return []
  }

  const base = parseComposerFileQuery(query).baseQuery

  const out: ComposerPathResult[] = []
  if (data.selected && (!base || matchesPath(data.selected.path, base))) {
    out.push(data.selected)
  }

  const recent = data.recent ?? []
  const recentPaths = recent.filter((item) => !base || matchesPath(item, base))
  const recentRanked = base ? sortPaths(recentPaths, base) : recentPaths
  out.push(...recentRanked.map((path) => ({ path, kind: "file" as const, source: "recent" as const })))

  const workspace = data.workspace ?? []
  if (base.trim()) {
    const files = sortPaths(workspace, base)
    out.push(...files.map((path) => ({ path, kind: "file" as const, source: "search" as const })))
    const dirs = sortPaths(collectDirectoryResults(parentDirs(workspace), base).map((item) => item.path), base)
    out.push(...dirs.map((path) => ({ path, kind: "directory" as const, source: "search" as const })))
  }

  return dedupe(out)
}

function parentDirs(items: string[]) {
  return [...new Set(items.flatMap((item) => {
    const parts = item.split("/").filter(Boolean)
    return parts.slice(0, -1).map((_, index) => parts.slice(0, index + 1).join("/"))
  }))]
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
