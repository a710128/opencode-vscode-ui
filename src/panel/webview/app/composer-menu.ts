import type { ComposerPathResult } from "../../../bridge/types"
import type { AppState } from "./state"
import type { ComposerAutocompleteItem } from "../hooks/useComposerAutocomplete"
import { describeComposerFileSelection, formatComposerFileContent, formatComposerFileDisplay, parseComposerFileQuery } from "../lib/composer-file-selection"

export function buildComposerMenuItems(state: AppState, files: ComposerPathResult[]): ComposerAutocompleteItem[] {
  const slashItems: ComposerAutocompleteItem[] = [
    {
      id: "slash-compact",
      label: "compact",
      detail: "Summarize this session immediately using the current model.",
      keywords: ["summarize", "summary", "compress", "session"],
      trigger: "slash",
      kind: "action",
    },
    {
      id: "slash-undo",
      label: "undo",
      detail: "Revert the previous user turn immediately.",
      keywords: ["revert", "previous", "message", "back"],
      trigger: "slash",
      kind: "action",
    },
    {
      id: "slash-refresh",
      label: "refresh",
      detail: "Ask the host to reload the current session snapshot.",
      keywords: ["reload", "snapshot", "panel", "host"],
      trigger: "slash",
      kind: "action",
    },
  ]

  if (state.snapshot.session?.revert?.messageID) {
    slashItems.push({
      id: "slash-redo",
      label: "redo",
      detail: "Restore previously reverted messages immediately.",
      keywords: ["unrevert", "restore", "forward"],
      trigger: "slash",
      kind: "action",
    })
  }

  if (state.composerAgentOverride || state.composerMentionAgentOverride) {
    slashItems.push({
      id: "slash-reset-agent",
      label: "reset-agent",
      detail: "Return the composer to the default agent selection.",
      keywords: ["agent", "default", "override"],
      trigger: "slash",
      kind: "action",
    })
  }

  const commandItems: ComposerAutocompleteItem[] = state.snapshot.commands
    .filter((cmd) => cmd.source !== "skill")
    .map((cmd) => {
      const isMcp = cmd.source === "mcp"
      return {
        id: `command:${cmd.name}`,
        label: cmd.name,
        detail: cmd.description ? (isMcp ? `${cmd.description} :mcp` : cmd.description) : (isMcp ? ":mcp" : ""),
        keywords: [cmd.source ?? "", cmd.agent ?? ""].filter(Boolean),
        trigger: "slash" as const,
        kind: "command" as const,
      }
    })

  const agentItems = state.snapshot.agents.map((agent) => ({
    id: `agent:${agent.name}`,
    label: agent.name,
    detail: agent.mode === "subagent" ? "Subagent" : agent.mode === "primary" ? "Primary agent" : "Agent",
    keywords: [agent.mode, agent.variant ?? ""].filter(Boolean),
    trigger: "mention" as const,
    kind: "agent" as const,
    mention: {
      type: "agent" as const,
      name: agent.name,
      content: `@${agent.name}`,
    },
  }))

  const resourceItems = Object.values(state.snapshot.mcpResources).map((resource) => ({
    id: `resource:${resource.client}:${resource.uri}`,
    label: resource.name,
    detail: `${resource.client} - ${resource.uri}`,
    keywords: [resource.client, resource.uri, resource.description ?? ""].filter(Boolean),
    trigger: "mention" as const,
    kind: "resource" as const,
    mention: {
      type: "resource" as const,
      uri: resource.uri,
      name: resource.name,
      clientName: resource.client,
      mimeType: resource.mimeType,
      content: `@${resource.name}`,
    },
  }))

  const fileItems = files.map((item) => ({
    id: `${item.source}:${item.kind}:${item.path}:${item.selection?.startLine ?? ""}:${item.selection?.endLine ?? ""}`,
    label: item.kind === "directory" ? `${item.path.split("/").filter(Boolean).pop() || item.path}/` : item.path.split("/").pop() || item.path,
    detail: item.source === "selection" ? describeComposerFileSelection(item.selection) || item.path : item.path,
    keywords: item.path.split("/").filter(Boolean).concat(item.source, item.kind, item.selection ? [String(item.selection.startLine), String(item.selection.endLine ?? "")] : []),
    trigger: "mention" as const,
    kind: item.source === "selection" ? "selection" as const : item.source === "recent" ? "recent" as const : item.kind === "directory" ? "directory" as const : "file" as const,
    mention: {
      type: "file" as const,
      path: item.path,
      kind: item.kind,
      selection: item.selection,
      content: formatComposerFileContent(item.path, item.selection),
    },
  }))

  return [...slashItems, ...commandItems, ...agentItems, ...resourceItems, ...fileItems]
}

export function mentionForQuery(mention: Extract<NonNullable<ComposerAutocompleteItem["mention"]>, { type: "file" }>, query: string): Extract<NonNullable<ComposerAutocompleteItem["mention"]>, { type: "file" }> {
  const parsed = parseComposerFileQuery(query)
  if (!parsed.selection || mention.kind === "directory" || mention.selection) {
    return mention
  }

  return {
    ...mention,
    selection: parsed.selection,
    content: formatComposerFileContent(mention.path, parsed.selection),
  }
}

export function autocompleteItemView(query: string, item: ComposerAutocompleteItem) {
  const mention = item.mention
  if (!mention || mention.type === "agent") {
    return { label: item.label, detail: item.detail, kind: item.kind }
  }

  if (mention.type === "resource") {
    return {
      label: item.label,
      detail: item.detail,
      kind: item.kind,
    }
  }

  const next = mentionForQuery(mention, query)
  const label = next.selection
    ? formatComposerFileDisplay(item.label, next.selection)
    : item.label
  const detail = item.kind === "selection"
    ? `${mention.path}${next.selection ? ` - ${describeComposerFileSelection(next.selection)}` : ""}`
    : item.detail === mention.path && next.selection
      ? formatComposerFileDisplay(item.detail, next.selection)
      : item.detail
  return { label, detail, kind: item.kind }
}
