import type { AgentInfo } from "../../../core/sdk"

export type LeaderAction = "childFirst" | "newSession" | "redoSession" | "undoSession"

type ComposerTabIntentOptions = {
  hasAutocomplete: boolean
  hasCurrentItem: boolean
  metaKey: boolean
  ctrlKey: boolean
  altKey: boolean
  canCycleAgent: boolean
}

export function cycleAgentName(agents: AgentInfo[], current?: string) {
  const visible = agents.filter((agent) => agent.mode !== "subagent" && !agent.hidden)
  if (visible.length === 0) {
    return undefined
  }

  const index = visible.findIndex((agent) => agent.name === current)
  if (index < 0) {
    return visible[0]?.name
  }

  return visible[(index + 1) % visible.length]?.name
}

export function leaderAction(key: string): LeaderAction | undefined {
  switch (normalizeKey(key)) {
    case "down":
      return "childFirst"
    case "n":
      return "newSession"
    case "r":
      return "redoSession"
    case "u":
      return "undoSession"
    default:
      return undefined
  }
}

export function composerTabIntent(options: ComposerTabIntentOptions) {
  if (options.hasAutocomplete && options.hasCurrentItem) {
    return "autocomplete" as const
  }

  if (!options.metaKey && !options.ctrlKey && !options.altKey && options.canCycleAgent) {
    return "cycleAgent" as const
  }

  return undefined
}

export function isShortcutTarget(target: EventTarget | null, composer: HTMLElement | null) {
  if (!(target instanceof HTMLElement)) {
    return false
  }
  if (composer && (target === composer || composer.contains(target))) {
    return true
  }
  if (target.isContentEditable) {
    return false
  }

  const tag = target.tagName
  return tag !== "INPUT" && tag !== "TEXTAREA" && tag !== "SELECT" && tag !== "BUTTON" && tag !== "A"
}

function normalizeKey(key: string) {
  const value = key.trim().toLowerCase()
  if (value === "arrowdown") {
    return "down"
  }
  if (value === "arrowup") {
    return "up"
  }
  if (value === "arrowleft") {
    return "left"
  }
  if (value === "arrowright") {
    return "right"
  }
  return value
}
