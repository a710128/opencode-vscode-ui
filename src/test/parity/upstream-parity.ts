import type { ComposerPromptPart } from "../../bridge/types"
import { buildComposerSubmitParts } from "../../panel/webview/app/composer-mentions"
import { sortPaths } from "../../panel/provider/file-search"
import { formatComposerFileContent, parseComposerFileQuery } from "../../panel/webview/lib/composer-file-selection"
import type { ComposerParityFixture } from "./composer-parity"

type UpstreamItem = {
  kind: string
  label: string
  detail: string
  insertText?: string
  action?: string
}

export type UpstreamFixture = {
  name: string
  target: "web" | "tui"
  draft: string
  cursor: number
  agents?: Array<{ name: string; hidden?: boolean; mode: "subagent" | "primary" | "all" }>
  recent?: string[]
  files?: string[]
  resources?: Array<{ name: string; uri: string; client: string; description?: string; mimeType?: string }>
  commands?: {
    builtin?: Array<{ id: string; trigger: string; title: string; description?: string }>
    custom?: Array<{ name: string; description?: string; source?: "command" | "mcp" | "skill" }>
  }
}

export type UpstreamGolden = {
  name: string
  target: "web" | "tui"
  trigger: "slash" | "mention" | null
  query?: string
  items: Array<{
    kind: string
    label: string
    detail: string
    insertText?: string
  }>
  accepted?: {
    draft?: string
    submitParts?: ComposerPromptPart[]
    action?: string
  }
}

export function runUpstreamFixture(fix: UpstreamFixture): UpstreamGolden {
  const current = detect(fix.draft, fix.cursor)
  if (!current) {
    return { name: fix.name, target: fix.target, trigger: null, items: [] }
  }

  const items: UpstreamItem[] = fix.target === "web"
    ? current.trigger === "slash"
      ? webSlash(fix, current.query)
      : webAt(fix, current.query)
    : current.trigger === "slash"
      ? tuiSlash(fix, current.query)
      : tuiAt(fix, current.query)

  const out: UpstreamGolden = {
    name: fix.name,
    target: fix.target,
    trigger: current.trigger,
    query: current.query,
    items,
  }

  const first = items[0]
  if (!first) {
    return out
  }

  if (current.trigger === "slash") {
    return {
      ...out,
      accepted: first.insertText
        ? { draft: first.insertText }
        : { action: first.label },
    }
  }

  if (!first.insertText) {
    return out
  }

  const draft = `${fix.draft.slice(0, current.start)}${first.insertText} ${fix.draft.slice(current.end)}`
  const kind = first.kind === "agent"
    ? { type: "agent" as const, name: first.label.slice(1), content: first.insertText }
    : first.kind === "resource"
      ? {
          type: "resource" as const,
          uri: first.detail.split(" - ").slice(1).join(" - ") || first.detail,
          name: first.label.slice(1),
          clientName: first.detail.split(" - ")[0] || "",
          mimeType: undefined,
          content: first.insertText,
        }
      : {
          type: "file" as const,
          path: first.insertText.slice(1),
          kind: first.kind === "directory" ? "directory" as const : "file" as const,
          content: first.insertText,
        }
  const start = current.start
  const end = start + first.insertText.length
  return {
    ...out,
    accepted: {
      draft,
      submitParts: buildComposerSubmitParts(draft, [{ ...kind, start, end } as never]),
    },
  }
}

export function compareUpstream(fix: ComposerParityFixture, golden: UpstreamGolden) {
  return {
    name: fix.name,
    expected: golden,
  }
}

function webAt(fix: UpstreamFixture, query: string): UpstreamItem[] {
  const agents = (fix.agents ?? [])
    .filter((item) => !item.hidden && item.mode !== "primary")
    .map((item) => ({ kind: "agent", label: `@${item.name}`, detail: "", insertText: `@${item.name}` }))

  const open = fix.recent ?? []
  const seen = new Set(open)
  const pinned = open.map((path) => ({ kind: path.endsWith("/") ? "directory" : "file", label: path, detail: path, insertText: `@${path}` }))
  const files = (fix.files ?? [])
    .filter((path) => !seen.has(path))
    .map((path) => ({ kind: path.endsWith("/") ? "directory" : "file", label: path, detail: path, insertText: `@${path}` }))
  return filterWeb([...agents, ...pinned, ...files], query)
}

function webSlash(fix: UpstreamFixture, query: string): UpstreamItem[] {
  const custom = (fix.commands?.custom ?? []).map((cmd) => ({ kind: "custom", label: `/${cmd.name}`, detail: cmd.description ?? "", insertText: `/${cmd.name} ` }))
  const builtin = (fix.commands?.builtin ?? []).map((cmd) => ({ kind: "builtin", label: `/${cmd.trigger}`, detail: cmd.description ?? cmd.title, action: cmd.id }))
  return filterWeb([...custom, ...builtin], query).map((item) => ({
    kind: item.kind,
    label: item.label,
    detail: item.detail,
    insertText: "insertText" in item ? item.insertText : undefined,
  }))
}

function tuiAt(fix: UpstreamFixture, query: string): UpstreamItem[] {
  const range = parseComposerFileQuery(query)
  const files = sortPaths(fix.files ?? [], range.baseQuery)
    .map((path) => ({
      kind: path.endsWith("/") ? "directory" : "file",
      label: `@${path}${!path.endsWith("/") && range.selection ? `#${range.selection.startLine}${range.selection.endLine ? `-${range.selection.endLine}` : ""}` : ""}`,
      detail: path,
      insertText: formatComposerFileContent(path, path.endsWith("/") ? undefined : range.selection),
    }))
  const resources = (fix.resources ?? []).map((res) => ({
    kind: "resource",
    label: `@${res.name}`,
    detail: `${res.name} (${res.uri})`,
    insertText: `@${res.name}`,
  }))
  const agents = (fix.agents ?? [])
    .filter((item) => !item.hidden && item.mode !== "primary")
    .map((item) => ({ kind: "agent", label: `@${item.name}`, detail: "", insertText: `@${item.name}` }))
  return filterTui([...agents, ...files, ...resources], query)
}

function tuiSlash(fix: UpstreamFixture, query: string): UpstreamItem[] {
  const builtin = (fix.commands?.builtin ?? []).map((cmd) => ({ kind: "builtin", label: `/${cmd.trigger}`, detail: cmd.description ?? cmd.title }))
  const custom = (fix.commands?.custom ?? [])
    .filter((cmd) => cmd.source !== "skill")
    .map((cmd) => ({ kind: cmd.source === "mcp" ? "mcp" : "custom", label: `/${cmd.name}${cmd.source === "mcp" ? ":mcp" : ""}`, detail: cmd.description ?? "", insertText: `/${cmd.name} ` }))
  return filterTui([...builtin, ...custom].sort((a, b) => a.label.localeCompare(b.label)), query)
}

function filterWeb<T extends UpstreamItem>(items: T[], query: string) {
  if (!query) {
    return items
  }

  return items
    .map((item, index) => ({ item, index, score: score(`${item.label} ${item.detail}`, query) }))
    .filter((item): item is { item: T; index: number; score: number } => typeof item.score === "number")
    .sort((a, b) => a.score - b.score || a.index - b.index)
    .map((item) => item.item)
}

function filterTui<T extends UpstreamItem>(items: T[], query: string) {
  const value = parseComposerFileQuery(query).baseQuery || query
  if (!value) {
    return items.slice(0, 10)
  }

  return items
    .map((item, index) => ({ item, index, score: score(`${item.label} ${item.detail}`, value) }))
    .filter((item): item is { item: T; index: number; score: number } => typeof item.score === "number")
    .sort((a, b) => a.score - b.score || a.index - b.index)
    .slice(0, 10)
    .map((item) => item.item)
}

function detect(value: string, cursor: number) {
  if (cursor < 0 || cursor > value.length) {
    return null
  }
  if (value.startsWith("/") && !value.slice(0, cursor).match(/\s/)) {
    return { trigger: "slash" as const, query: value.slice(1, cursor), start: 0, end: cursor }
  }

  const text = value.slice(0, cursor)
  const idx = text.lastIndexOf("@")
  if (idx === -1) {
    return null
  }

  const between = text.slice(idx)
  const before = idx === 0 ? undefined : value[idx - 1]
  if ((before === undefined || /\s/.test(before)) && !between.match(/\s/)) {
    return { trigger: "mention" as const, query: value.slice(idx + 1, cursor), start: idx, end: cursor }
  }

  return null
}

function score(value: string, query: string) {
  const source = value.toLowerCase()
  const needle = query.trim().toLowerCase()
  if (!needle) {
    return 0
  }

  const indexes: number[] = []
  let cursor = 0
  for (const char of needle) {
    const next = source.indexOf(char, cursor)
    if (next === -1) {
      return undefined
    }
    indexes.push(next)
    cursor = next + 1
  }

  let total = Math.max(0, source.length - needle.length)
  for (let i = 0; i < indexes.length; i += 1) {
    total += i === 0 ? indexes[i] * 3 : Math.max(0, indexes[i] - indexes[i - 1] - 1) * 5
  }
  if (source.startsWith(needle)) {
    total -= 24
  }
  return total
}
