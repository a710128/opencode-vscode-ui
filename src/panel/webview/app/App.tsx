import React from "react"
import type { ComposerPathResult, ComposerPromptPart, SessionBootstrap } from "../../../bridge/types"
import type { QuestionRequest } from "../../../core/sdk"
import { ChildMessagesContext, ChildSessionsContext, WorkspaceDirContext } from "./contexts"
import { answerKey, PermissionDock, QuestionDock, RetryStatus, SessionNav, SubagentNotice } from "./docks"
import { createInitialState, persistableAppState, type AppState, type ComposerEditorPart, type PersistedAppState, type VsCodeApi } from "./state"
import { Timeline } from "./timeline"
import { AgentBadge, CompactionDivider, EmptyState, MarkdownBlock, PartView, WebviewBindingsProvider } from "./webview-bindings"
import { ensureComposerCursorVisible, resizeComposer, useComposerResize } from "../hooks/useComposer"
import { matchAutocomplete, useComposerAutocomplete, type ComposerAutocompleteItem, type ComposerAutocompleteState } from "../hooks/useComposerAutocomplete"
import { useHostMessages } from "../hooks/useHostMessages"
import { useModifierState } from "../hooks/useModifierState"
import { useTimelineScroll } from "../hooks/useTimelineScroll"
import { formatComposerFileContent, parseComposerFileQuery } from "../lib/composer-file-selection"
import { agentColorClass, composerIdentity, composerMetrics, composerSelection, cycleModelVariant, formatUsd, isSessionRunning, lastUserSelection, modelKey, modelVariants, overallLspStatus, overallMcpStatus, pushRecentModel, sessionTitle, toggleFavoriteModel, type StatusItem, type StatusTone } from "../lib/session-meta"
import { buildComposerSubmitParts, composerMentionAgentOverride } from "./composer-mentions"
import { absorbFileSelectionSuffix, composerMentions as mentionsFromParts, composerPartsEqual, composerText, deleteStructuredRange, emptyComposerParts, ensureTextPart, replaceRangeWithMention, replaceRangeWithText } from "./composer-editor"
import { getSelectionOffsets, parseComposerEditor, renderComposerEditor, setCursorPosition, syncComposerPillSelection } from "./composer-editor-dom"
import { autocompleteItemView, buildComposerMenuItems, mentionForQuery } from "./composer-menu"
import { composerTabIntent, cycleAgentName, isShortcutTarget, leaderAction } from "./keyboard-shortcuts"
import { buildModelPickerSections, ModelPicker } from "./model-picker"
import { activeChildSessionId } from "./session-navigation"

declare global {
  interface Window {
    __OPENCODE_INITIAL_STATE__?: SessionBootstrap["sessionRef"] | null
  }
}

declare function acquireVsCodeApi(): VsCodeApi

const vscode = acquireVsCodeApi()
const initialRef = window.__OPENCODE_INITIAL_STATE__ ?? null
const persistedState = normalizePersistedState(vscode.getState<PersistedAppState | SessionBootstrap["sessionRef"]>())
const fileRefStatus = new Map<string, boolean>()
const ESC_INTERRUPT_WINDOW_MS = 5000

function sameAutocompleteMatch(
  left: { trigger: ComposerAutocompleteState["trigger"]; query: string; start: number; end: number } | null,
  right: { trigger: ComposerAutocompleteState["trigger"]; query: string; start: number; end: number } | null,
) {
  return !!left && !!right && left.trigger === right.trigger && left.query === right.query && left.start === right.start && left.end === right.end
}

export function App() {
  const [state, setState] = React.useState(() => createInitialState(initialRef, persistedState))
  const [composing, setComposing] = React.useState(false)
  const [composerFocused, setComposerFocused] = React.useState(false)
  const [escPending, setEscPending] = React.useState(false)
  const [leaderPending, setLeaderPending] = React.useState(false)
  const [pendingMcpActions, setPendingMcpActions] = React.useState<Record<string, boolean>>({})
  const [fileResults, setFileResults] = React.useState<ComposerPathResult[]>([])
  const [fileSearch, setFileSearch] = React.useState<{ status: "idle" | "searching" | "done"; query: string }>({ status: "idle", query: "" })
  const [composerDrag, setComposerDrag] = React.useState<null | "mention">(null)
  const [modelPickerOpen, setModelPickerOpen] = React.useState(false)
  const timelineRef = React.useRef<HTMLDivElement | null>(null)
  const composerRef = React.useRef<HTMLDivElement | null>(null)
  const modelPickerRef = React.useRef<HTMLDivElement | null>(null)
  const composerCursorRef = React.useRef<number | null>(null)
  const searchRef = React.useRef<{ requestID: string; query: string } | null>(null)
  const escTimerRef = React.useRef<number | null>(null)
  const escPendingRef = React.useRef(false)
  const autocompleteDismissedRef = React.useRef<null | { trigger: ComposerAutocompleteState["trigger"]; query: string; start: number; end: number }>(null)
  const leaderTimerRef = React.useRef<number | null>(null)
  const leaderPendingRef = React.useRef(false)
  const onFileSearchResults = React.useCallback((payload: { requestID: string; query: string; results: ComposerPathResult[] }) => {
    if (!searchRef.current || payload.requestID !== searchRef.current.requestID) {
      return
    }
    if (payload.query !== searchRef.current.query) {
      return
    }
    setFileResults(payload.results)
    setFileSearch({ status: "done", query: payload.query })
  }, [])
  const composerMenuItems = React.useMemo(() => buildComposerMenuItems(state, fileResults), [fileResults, state])
  const composerAutocomplete = useComposerAutocomplete(composerMenuItems)
  const currentSelection = React.useMemo(() => composerSelection({
    ...state.snapshot,
    composerAgentOverride: state.composerAgentOverride,
    composerMentionAgentOverride: state.composerMentionAgentOverride,
    composerRecentModels: state.composerRecentModels,
    composerModelOverrides: state.composerModelOverrides,
    composerModelVariants: state.composerModelVariants,
  }), [state.composerAgentOverride, state.composerMentionAgentOverride, state.composerModelOverrides, state.composerModelVariants, state.composerRecentModels, state.snapshot])
  const latestUserSelection = React.useMemo(() => lastUserSelection(state.snapshot.messages, state.snapshot.providers), [state.snapshot.messages, state.snapshot.providers])
  const modelPickerSections = React.useMemo(() => buildModelPickerSections({
    providers: state.snapshot.providers,
    favorites: state.composerFavoriteModels,
    recents: state.composerRecentModels,
    currentModel: currentSelection.model,
    variants: state.composerModelVariants,
  }), [currentSelection.model, state.composerFavoriteModels, state.composerModelVariants, state.composerRecentModels, state.snapshot.providers])

  const blocked = state.snapshot.permissions.length > 0 || state.snapshot.questions.length > 0
  const isChildSession = !!state.bootstrap.session?.parentID
  const firstPermission = state.snapshot.permissions[0]
  const firstQuestion = state.snapshot.questions[0]

  useComposerResize(composerRef, state.draft)
  useTimelineScroll(timelineRef, [state.snapshot.messages, state.snapshot.submitting, state.snapshot.permissions, state.snapshot.questions])
  useModifierState()

  React.useEffect(() => {
    document.title = `OpenCode: ${sessionTitle(state.bootstrap)}`
  }, [state.bootstrap])

  const autocompleteTrigger = composerAutocomplete.state?.trigger ?? null
  const autocompleteQuery = composerAutocomplete.state?.query ?? null

  React.useEffect(() => {
    if (autocompleteTrigger !== "mention" || autocompleteQuery === null) {
      searchRef.current = null
      setFileResults([])
      setFileSearch({ status: "idle", query: "" })
      return
    }

    const query = parseComposerFileQuery(autocompleteQuery.trim()).baseQuery.trim()

    const requestID = `file-search:${Date.now()}:${query}`
    searchRef.current = { requestID, query }
    setFileSearch({ status: "searching", query })
    vscode.postMessage({
      type: "searchFiles",
      requestID,
      query,
    })
  }, [autocompleteTrigger, autocompleteQuery])

  const setComposerState = React.useCallback((parts: ComposerEditorPart[], error = "", allowTerminal = false) => {
    const composerParts = ensureTextPart(absorbFileSelectionSuffix(parts, allowTerminal).parts)
    const draft = composerText(composerParts)
    const composerMentions = mentionsFromParts(composerParts)
    setState((current) => ({
      ...current,
      draft,
      composerParts,
      composerMentions,
      composerMentionAgentOverride: composerMentionAgentOverride(composerMentions),
      error,
    }))
    return { draft, composerParts, composerMentions }
  }, [])

  const syncComposerInput = React.useCallback((
    value: string,
    start: number | null | undefined,
    end: number | null | undefined,
    source: "input" | "passive" = "input",
  ) => {
    const next = matchAutocomplete(value, start, end)

    // Upstream only reevaluates autocomplete after content changes. In the webview we
    // also resync on passive events like keyup, focus, mouseup, and compositionend,
    // so dismissing @ autocomplete with Esc would immediately reopen on the next passive
    // sync unless we suppress that exact unchanged match until real input changes it.
    if (sameAutocompleteMatch(autocompleteDismissedRef.current, next)) {
      if (source === "passive") {
        return
      }

      return
    }

    autocompleteDismissedRef.current = null
    composerAutocomplete.sync(value, start, end)
  }, [composerAutocomplete])

  const restoreComposerCursor = React.useCallback((value: string, cursor: number) => {
    composerCursorRef.current = cursor
    window.setTimeout(() => {
      const input = composerRef.current
      if (!input) {
        return
      }
      input.focus()
      setCursorPosition(input, cursor)
      resizeComposer(input)
      ensureComposerCursorVisible(input)
      syncComposerInput(value, cursor, cursor)
    }, 0)
  }, [syncComposerInput])

  const closeComposerAutocomplete = React.useCallback(() => {
    const autocomplete = composerAutocomplete.state
    if (!autocomplete) {
      return
    }

    if (autocomplete.trigger === "slash") {
      autocompleteDismissedRef.current = null
      const next = replaceRangeWithText(state.composerParts, autocomplete.start, autocomplete.end, "")
      const result = setComposerState(next.parts, "")
      restoreComposerCursor(result.draft, next.cursor)
      return
    }

    autocompleteDismissedRef.current = autocomplete
    composerAutocomplete.close()
  }, [composerAutocomplete, restoreComposerCursor, setComposerState, state.composerParts])

  const onRestoreComposer = React.useCallback((payload: { parts: ComposerPromptPart[] }) => {
    const parts = composerPartsFromPromptParts(payload.parts)
    const result = setComposerState(parts, "")
    restoreComposerCursor(result.draft, result.draft.length)
  }, [restoreComposerCursor, setComposerState])

  useHostMessages({
    fileRefStatus,
    onFileSearchResults,
    onRestoreComposer,
    setPendingMcpActions,
    setState,
    vscode,
  })

  const persistedPanelState = React.useMemo(() => persistableAppState(state), [
    state.bootstrap.sessionRef.workspaceId,
    state.bootstrap.sessionRef.dir,
    state.bootstrap.sessionRef.sessionId,
    state.composerAgentOverride,
    state.composerFavoriteModels,
    state.composerModelOverrides,
    state.composerModelVariants,
    state.composerRecentModels,
  ])

  React.useEffect(() => {
    vscode.setState(persistedPanelState)
  }, [persistedPanelState])

  React.useEffect(() => {
    if (!latestUserSelection?.messageID) {
      return
    }

    setState((current) => {
      if (current.composerHydratedMessageID === latestUserSelection.messageID) {
        return current
      }

      const nextOverrides = { ...current.composerModelOverrides }
      if (latestUserSelection.agent && latestUserSelection.model) {
        nextOverrides[latestUserSelection.agent] = latestUserSelection.model
      }

      const nextVariants = { ...current.composerModelVariants }
      const nextModelKey = modelKey(latestUserSelection.model)
      if (nextModelKey) {
        if (latestUserSelection.variant) {
          nextVariants[nextModelKey] = latestUserSelection.variant
        } else {
          delete nextVariants[nextModelKey]
        }
      }

      return {
        ...current,
        composerAgentOverride: latestUserSelection.agent || current.composerAgentOverride,
        composerModelOverrides: nextOverrides,
        composerRecentModels: pushRecentModel(current.composerRecentModels, latestUserSelection.model),
        composerModelVariants: nextVariants,
        composerHydratedMessageID: latestUserSelection.messageID,
      }
    })
  }, [latestUserSelection])

  React.useEffect(() => {
    if (!modelPickerOpen) {
      return
    }

    const onPointerDown = (event: MouseEvent) => {
      const target = event.target
      if (target instanceof Node && modelPickerRef.current?.contains(target)) {
        return
      }
      setModelPickerOpen(false)
    }

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setModelPickerOpen(false)
      }
    }

    document.addEventListener("mousedown", onPointerDown)
    window.addEventListener("keydown", onKeyDown)
    return () => {
      document.removeEventListener("mousedown", onPointerDown)
      window.removeEventListener("keydown", onKeyDown)
    }
  }, [modelPickerOpen])

  React.useEffect(() => {
    const onDragOver = (event: DragEvent) => {
      if (!supportsComposerDrop(event.dataTransfer)) {
        return
      }
      event.preventDefault()
      setComposerDrag("mention")
    }

    const onDragLeave = (event: DragEvent) => {
      if (!event.relatedTarget) {
        setComposerDrag(null)
      }
    }

    const onDrop = (event: DragEvent) => {
      const mentions = droppedFileMentions(event.dataTransfer, state.bootstrap.sessionRef.dir)
      setComposerDrag(null)
      if (mentions.length === 0) {
        return
      }

      event.preventDefault()
      const input = composerRef.current
      if (!input) {
        return
      }

      const selection = composerFocused
        ? getSelectionOffsets(input)
        : { start: state.draft.length, end: state.draft.length }

      let parts = state.composerParts
      let cursor = selection.start
      let end = selection.end
      for (const mention of mentions) {
        const next = replaceRangeWithMention(parts, cursor, end, mention)
        parts = next.parts
        cursor = next.cursor
        end = next.cursor
      }

      const result = setComposerState(parts, "")
      restoreComposerCursor(result.draft, cursor)
    }

    document.addEventListener("dragover", onDragOver)
    document.addEventListener("dragleave", onDragLeave)
    document.addEventListener("drop", onDrop)
    return () => {
      document.removeEventListener("dragover", onDragOver)
      document.removeEventListener("dragleave", onDragLeave)
      document.removeEventListener("drop", onDrop)
    }
  }, [composerFocused, restoreComposerCursor, setComposerState, state.bootstrap.sessionRef.dir, state.composerParts, state.draft])

  React.useLayoutEffect(() => {
    const input = composerRef.current
    if (!input) {
      return
    }
    const next = ensureTextPart(state.composerParts)
    const current = ensureTextPart(parseComposerEditor(input))
    if (!composerPartsEqual(current, next)) {
      renderComposerEditor(input, next)
    }
    if (typeof composerCursorRef.current === "number") {
      setCursorPosition(input, composerCursorRef.current)
      composerCursorRef.current = null
    }
    resizeComposer(input)
    ensureComposerCursorVisible(input)
    syncComposerPillSelection(input)
  }, [state.composerParts])

  React.useEffect(() => {
    const syncSelection = () => {
      const input = composerRef.current
      if (!input) {
        return
      }
      syncComposerPillSelection(input)
    }

    document.addEventListener("selectionchange", syncSelection)
    return () => document.removeEventListener("selectionchange", syncSelection)
  }, [])

  const submit = React.useCallback(() => {
    if (!state.draft.trim() || blocked) {
      return
    }

    const finalized = ensureTextPart(absorbFileSelectionSuffix(state.composerParts, true).parts)
    const draft = composerText(finalized)
    const selection = currentSelection

    // Check if draft is a slash command invocation: starts with "/" and first token matches a known server command
    const slashMatch = draft.match(/^\/(\S+)(?:\s+([\s\S]*))?$/)
    if (slashMatch) {
      const cmdName = slashMatch[1]
      const cmdArgs = (slashMatch[2] ?? "").trim()
      const knownCmd = state.snapshot.commands.find((c) => c.name === cmdName && c.source !== "skill")
      if (knownCmd) {
        vscode.postMessage({
          type: "runSlashCommand",
          command: cmdName,
          arguments: cmdArgs,
          agent: selection.agent,
          model: selection.model ? `${selection.model.providerID}/${selection.model.modelID}` : undefined,
          variant: selection.variant,
        })
        setState((current) => ({
          ...current,
          draft: "",
          composerParts: emptyComposerParts(),
          composerMentions: [],
          composerMentionAgentOverride: undefined,
          error: "",
        }))
        return
      }
    }

    if (!selection.model) {
      setState((current) => ({
        ...current,
        error: current.snapshot.providers.length > 0 ? "Select a model before sending this message." : "Configure a provider before sending this message.",
      }))
      setModelPickerOpen(true)
      return
    }

    const mentions = mentionsFromParts(finalized)
    const parts = buildComposerSubmitParts(draft, mentions)
    vscode.postMessage({
      type: "submit",
      text: draft,
      parts,
      agent: selection.agent,
      model: selection.model,
      variant: selection.variant,
    })
    setState((current) => ({
      ...current,
      draft: "",
      composerParts: emptyComposerParts(),
      composerMentions: [],
      composerMentionAgentOverride: undefined,
      error: "",
    }))
  }, [blocked, currentSelection, state.composerParts, state.snapshot.commands])

  const clearComposerDraft = React.useCallback(() => {
    setState((current) => ({
      ...current,
      draft: "",
      composerParts: emptyComposerParts(),
      composerMentions: [],
      composerMentionAgentOverride: undefined,
      error: "",
    }))
  }, [])

  const clearLeaderPending = React.useCallback(() => {
    leaderPendingRef.current = false
    setLeaderPending(false)
    if (leaderTimerRef.current !== null) {
      window.clearTimeout(leaderTimerRef.current)
      leaderTimerRef.current = null
    }
  }, [])

  const startLeaderPending = React.useCallback(() => {
    clearLeaderPending()
    leaderPendingRef.current = true
    setLeaderPending(true)
    leaderTimerRef.current = window.setTimeout(() => {
      leaderPendingRef.current = false
      setLeaderPending(false)
      leaderTimerRef.current = null
    }, 2000)
  }, [clearLeaderPending])

  const navigateSession = React.useCallback((sessionID: string) => {
    vscode.postMessage({ type: "navigateSession", sessionID })
  }, [])

  const postNewSession = React.useCallback(() => {
    vscode.postMessage({ type: "newSession" })
  }, [])

  const openModelPicker = React.useCallback(() => {
    setModelPickerOpen(true)
  }, [])

  const toggleModelPicker = React.useCallback(() => {
    setModelPickerOpen((current) => !current)
  }, [])

  const selectComposerModel = React.useCallback((model: { providerID: string; modelID: string }) => {
    setState((current) => {
      const agent = composerSelection({
        ...current.snapshot,
        composerAgentOverride: current.composerAgentOverride,
        composerMentionAgentOverride: current.composerMentionAgentOverride,
        composerRecentModels: current.composerRecentModels,
        composerModelOverrides: current.composerModelOverrides,
        composerModelVariants: current.composerModelVariants,
      }).agent
      if (!agent) {
        return current
      }

      return {
        ...current,
        composerModelOverrides: {
          ...current.composerModelOverrides,
          [agent]: model,
        },
        composerRecentModels: pushRecentModel(current.composerRecentModels, model),
        error: "",
      }
    })
    setModelPickerOpen(false)
  }, [])

  const toggleComposerFavorite = React.useCallback((model: { providerID: string; modelID: string }) => {
    setState((current) => ({
      ...current,
      composerFavoriteModels: toggleFavoriteModel(current.composerFavoriteModels, model),
    }))
  }, [])

  const cycleComposerVariant = React.useCallback((model?: { providerID: string; modelID: string }) => {
    setState((current) => {
      const target = model || composerSelection({
        ...current.snapshot,
        composerAgentOverride: current.composerAgentOverride,
        composerMentionAgentOverride: current.composerMentionAgentOverride,
        composerRecentModels: current.composerRecentModels,
        composerModelOverrides: current.composerModelOverrides,
        composerModelVariants: current.composerModelVariants,
      }).model
      const nextVariant = cycleModelVariant(current.snapshot.providers, target, target ? current.composerModelVariants[modelKey(target)] : undefined)
      const nextVariants = { ...current.composerModelVariants }
      const key = modelKey(target)
      if (!key) {
        return current
      }
      if (nextVariant) {
        nextVariants[key] = nextVariant
      } else {
        delete nextVariants[key]
      }
      return {
        ...current,
        composerModelVariants: nextVariants,
      }
    })
  }, [])

  const openProviderDocs = React.useCallback(() => {
    vscode.postMessage({ type: "openDocs", target: "providers" })
  }, [])

  const postComposerAction = React.useCallback((action: "refreshSession" | "compactSession" | "undoSession" | "redoSession" | "interruptSession", model?: { providerID: string; modelID: string }) => {
    vscode.postMessage({ type: "composerAction", action, model })
  }, [])

  const clearEscPending = React.useCallback(() => {
    escPendingRef.current = false
    setEscPending(false)
    if (escTimerRef.current !== null) {
      window.clearTimeout(escTimerRef.current)
      escTimerRef.current = null
    }
  }, [])

  const startEscPending = React.useCallback(() => {
    if (escTimerRef.current !== null) {
      window.clearTimeout(escTimerRef.current)
    }
    escPendingRef.current = true
    setEscPending(true)
    escTimerRef.current = window.setTimeout(() => {
      escPendingRef.current = false
      setEscPending(false)
      escTimerRef.current = null
    }, ESC_INTERRUPT_WINDOW_MS)
  }, [])

  const cycleComposerAgent = React.useCallback(() => {
    const next = cycleAgentName(state.snapshot.agents, currentSelection.agent)
    if (!next) {
      return false
    }

    setState((currentState) => ({
      ...currentState,
      composerAgentOverride: next,
      error: "",
    }))
    return true
  }, [currentSelection.agent, state.snapshot.agents])

  const runLeaderAction = React.useCallback((action: ReturnType<typeof leaderAction>) => {
    if (!action) {
      return false
    }

    if (action === "childFirst") {
      const childSessionID = activeChildSessionId(state.snapshot.messages, state.snapshot.childMessages, state.snapshot.childSessions)
      if (!childSessionID) {
        return false
      }
      navigateSession(childSessionID)
      return true
    }

    if (action === "newSession") {
      clearComposerDraft()
      postNewSession()
      return true
    }

    if (action === "redoSession") {
      if (!state.snapshot.session?.revert?.messageID) {
        return false
      }
      clearComposerDraft()
      postComposerAction("redoSession")
      return true
    }

    clearComposerDraft()
    postComposerAction("undoSession")
    return true
  }, [clearComposerDraft, navigateSession, postComposerAction, postNewSession, state.snapshot.childMessages, state.snapshot.childSessions, state.snapshot.messages, state.snapshot.session])

  React.useEffect(() => () => clearLeaderPending(), [clearLeaderPending])
  React.useEffect(() => () => clearEscPending(), [clearEscPending])

  React.useEffect(() => {
    if (composerAutocomplete.state) {
      clearLeaderPending()
    }
  }, [clearLeaderPending, composerAutocomplete.state])

  React.useEffect(() => {
    if (!isSessionRunning(state.snapshot.sessionStatus)) {
      clearEscPending()
    }
  }, [clearEscPending, state.snapshot.sessionStatus])

  React.useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (state.bootstrap.status !== "ready") {
        clearLeaderPending()
        return
      }

      const targetMatches = isShortcutTarget(event.target, composerRef.current)
      if (leaderPendingRef.current) {
        const action = leaderAction(event.key)
        clearLeaderPending()
        if (!targetMatches || composerAutocomplete.state) {
          return
        }
        event.preventDefault()
        if (!action) {
          return
        }
        if (runLeaderAction(action)) {
          return
        }
        return
      }

      if (event.ctrlKey && !event.metaKey && !event.altKey && !event.shiftKey && event.key.toLowerCase() === "x") {
        if (!targetMatches || composerAutocomplete.state) {
          return
        }
        event.preventDefault()
        startLeaderPending()
        return
      }

      if (!isChildSession || !targetMatches || event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) {
        return
      }

      if (event.key === "ArrowLeft" && state.snapshot.navigation.prev?.id) {
        event.preventDefault()
        navigateSession(state.snapshot.navigation.prev.id)
        return
      }

      if (event.key === "ArrowUp" && state.snapshot.navigation.parent?.id) {
        event.preventDefault()
        navigateSession(state.snapshot.navigation.parent.id)
        return
      }

      if (event.key === "ArrowRight" && state.snapshot.navigation.next?.id) {
        event.preventDefault()
        navigateSession(state.snapshot.navigation.next.id)
      }
    }

    window.addEventListener("keydown", onKeyDown)
    return () => window.removeEventListener("keydown", onKeyDown)
  }, [clearEscPending, clearLeaderPending, composerAutocomplete.state, isChildSession, navigateSession, runLeaderAction, startLeaderPending, state.bootstrap.status, state.snapshot.navigation.next, state.snapshot.navigation.parent, state.snapshot.navigation.prev])

  const acceptComposerAutocomplete = React.useCallback((item: ComposerAutocompleteItem, options?: { completeDirectory?: boolean }) => {
    if (item.kind === "action") {
      if (item.id === "slash-undo") {
        clearComposerDraft()
        postComposerAction("undoSession")
        composerAutocomplete.close()
        return
      }

      if (item.id === "slash-redo") {
        clearComposerDraft()
        postComposerAction("redoSession")
        composerAutocomplete.close()
        return
      }

      if (item.id === "slash-compact") {
        clearComposerDraft()
        postComposerAction("compactSession", currentSelection.model)
        composerAutocomplete.close()
        return
      }

      if (item.id === "slash-model") {
        clearComposerDraft()
        openModelPicker()
        composerAutocomplete.close()
        return
      }

      if (item.id === "slash-reset-agent") {
        setState((current) => ({
          ...current,
          draft: "",
          composerParts: emptyComposerParts(),
          composerMentions: [],
          composerAgentOverride: undefined,
          composerMentionAgentOverride: undefined,
          error: "",
        }))
        composerAutocomplete.close()
        return
      }

      if (item.id === "slash-refresh") {
        clearComposerDraft()
        postComposerAction("refreshSession")
        composerAutocomplete.close()
        return
      }
    }

    if (item.kind === "command") {
      const cmdDraft = `/${item.label} `
      const next = replaceRangeWithText(emptyComposerParts(), 0, 0, cmdDraft)
      const result = setComposerState(next.parts, "")
      composerAutocomplete.close()
      restoreComposerCursor(result.draft, cmdDraft.length)
      return
    }

    if (item.mention) {
      const range = composerAutocomplete.state
      if (!range) {
        composerAutocomplete.close()
        return
      }

      if (options?.completeDirectory && item.mention.type === "file" && item.mention.kind === "directory") {
        const next = replaceRangeWithText(state.composerParts, range.start, range.end, `@${item.mention.path}`)
        const result = setComposerState(next.parts, "")
        restoreComposerCursor(result.draft, next.cursor)
        return
      }

      const mention = item.mention.type === "file"
        ? mentionForQuery(item.mention, range.query)
        : item.mention
      const next = replaceRangeWithMention(state.composerParts, range.start, range.end, mention)
      const result = setComposerState(next.parts, "")
      composerAutocomplete.close()
      restoreComposerCursor(result.draft, next.cursor)
    }
  }, [clearComposerDraft, composerAutocomplete, currentSelection.model, openModelPicker, postComposerAction, restoreComposerCursor, setComposerState, state.composerParts, state.snapshot])

  const sendQuestionReply = React.useCallback((request: QuestionRequest) => {
    const answers = request.questions.map((_item, index) => {
      const key = answerKey(request.id, index)
      const base = state.form.selected[key] ?? []
      const custom = (state.form.custom[key] ?? "").trim()
      return custom ? [...base, custom] : base
    })

    vscode.postMessage({
      type: "questionReply",
      requestID: request.id,
      answers,
    })

    setState((current) => ({ ...current, error: "" }))
  }, [state.form.custom, state.form.selected])

  return (
    <WorkspaceDirContext.Provider value={state.bootstrap.sessionRef.dir || ""}>
      <ChildMessagesContext.Provider value={state.snapshot.childMessages}>
        <ChildSessionsContext.Provider value={state.snapshot.childSessions}>
          <WebviewBindingsProvider fileRefStatus={fileRefStatus} vscode={vscode}>
          <div className="oc-shell">
            <main ref={timelineRef} className="oc-transcript">
              <div className="oc-transcriptInner">
                <Timeline state={state} AgentBadge={AgentBadge} CompactionDivider={CompactionDivider} EmptyState={EmptyState} MarkdownBlock={MarkdownBlock} PartView={PartView} />
              </div>
            </main>

            <footer className="oc-footer">
              <div className="oc-transcriptInner oc-footerInner">
          {firstPermission ? (
            <PermissionDock
              request={firstPermission}
              currentSessionID={state.bootstrap.session?.id || state.bootstrap.sessionRef.sessionId}
              rejectMessage={state.form.reject[firstPermission.id] ?? ""}
              onRejectMessage={(value: string) => {
                setState((current) => ({
                  ...current,
                  form: {
                    ...current.form,
                    reject: {
                      ...current.form.reject,
                      [firstPermission.id]: value,
                    },
                  },
                }))
              }}
              onReply={(reply: "once" | "always" | "reject", message?: string) => {
                vscode.postMessage({ type: "permissionReply", requestID: firstPermission.id, reply, message })
                setState((current) => ({ ...current, error: "" }))
              }}
            />
          ) : null}
          {firstQuestion ? (
            <QuestionDock
              request={firstQuestion}
              form={state.form}
              onOption={(index, label, multiple) => {
                const key = answerKey(firstQuestion.id, index)
                if (!multiple && firstQuestion.questions.length === 1) {
                  vscode.postMessage({
                    type: "questionReply",
                    requestID: firstQuestion.id,
                    answers: [[label]],
                  })
                  setState((current) => ({ ...current, error: "" }))
                  return
                }

                setState((current) => {
                  const next = current.form.selected[key] ?? []
                  return {
                    ...current,
                    form: {
                      ...current.form,
                      selected: {
                        ...current.form.selected,
                        [key]: multiple
                          ? (next.includes(label) ? next.filter((item) => item !== label) : [...next, label])
                          : [label],
                      },
                      custom: multiple ? current.form.custom : {
                        ...current.form.custom,
                        [key]: "",
                      },
                    },
                  }
                })
              }}
              onCustom={(index, value) => {
                const key = answerKey(firstQuestion.id, index)
                setState((current) => ({
                  ...current,
                  form: {
                    ...current.form,
                    selected: firstQuestion.questions[index]?.multiple ? current.form.selected : {
                      ...current.form.selected,
                      [key]: value.trim() ? [] : (current.form.selected[key] ?? []),
                    },
                    custom: {
                      ...current.form.custom,
                      [key]: value,
                    },
                  },
                }))
              }}
              onReject={() => {
                vscode.postMessage({ type: "questionReject", requestID: firstQuestion.id })
                setState((current) => ({ ...current, error: "" }))
              }}
              onSubmit={() => sendQuestionReply(firstQuestion)}
            />
          ) : null}
          {!blocked && !isChildSession ? <RetryStatus status={state.snapshot.sessionStatus} /> : null}
          {isChildSession ? <SessionNav navigation={state.snapshot.navigation} onNavigate={(sessionID) => vscode.postMessage({ type: "navigateSession", sessionID })} /> : null}

          {!blocked && !isChildSession ? (
            <section className={`oc-composer${leaderPending ? " is-leaderPending" : ""}`}>
              <div className="oc-composerBody">
                {composerDrag ? <div className="oc-composerDropOverlay">Drop to @mention file</div> : null}
                <div className="oc-composerInputWrap">
                  {leaderPending ? <div className="oc-composerLeaderOverlay"><span className="oc-composerLeaderOverlayText">Ctrl + X Pressed</span></div> : null}
                  <div
                    ref={composerRef}
                    className="oc-composerInput"
                    role="textbox"
                    aria-multiline="true"
                    aria-label="Ask OpenCode to inspect explain or change this workspace"
                    contentEditable={state.bootstrap.status === "ready" && !blocked && !leaderPending}
                    suppressContentEditableWarning
                    spellCheck
                    onInput={(event) => {
                      const selection = getSelectionOffsets(event.currentTarget)
                      const rawParts = ensureTextPart(parseComposerEditor(event.currentTarget))
                      const normalized = absorbFileSelectionSuffix(rawParts)
                      const composerParts = ensureTextPart(normalized.parts)
                      const draft = composerText(composerParts)
                      const composerMentions = mentionsFromParts(composerParts)
                      syncComposerInput(draft, selection.start, selection.end, "input")
                      setState((current) => ({
                        ...current,
                        draft,
                        composerParts,
                        composerMentions,
                        composerMentionAgentOverride: composerMentionAgentOverride(composerMentions),
                      }))
                      if (normalized.changed) {
                        composerCursorRef.current = selection.end
                      }
                      resizeComposer(event.currentTarget)
                      ensureComposerCursorVisible(event.currentTarget)
                    }}
                    onPaste={(event) => {
                      const text = event.clipboardData.getData("text/plain")
                      if (!text) {
                        return
                      }
                      event.preventDefault()
                      const selection = getSelectionOffsets(event.currentTarget)
                      const next = replaceRangeWithText(state.composerParts, selection.start, selection.end, text.replace(/\r\n?/g, "\n"))
                      const result = setComposerState(next.parts, "")
                      restoreComposerCursor(result.draft, next.cursor)
                    }}
                    onKeyUp={() => {
                      const input = composerRef.current
                      if (!input) {
                        return
                      }
                      const selection = getSelectionOffsets(input)
                      ensureComposerCursorVisible(input)
                      syncComposerInput(state.draft, selection.start, selection.end, "passive")
                    }}
                    onMouseUp={() => {
                      const input = composerRef.current
                      if (!input) {
                        return
                      }
                      const selection = getSelectionOffsets(input)
                      ensureComposerCursorVisible(input)
                      syncComposerInput(state.draft, selection.start, selection.end, "passive")
                    }}
                    onFocus={() => {
                      setComposerFocused(true)
                      const input = composerRef.current
                      if (!input) {
                        return
                      }
                      const selection = getSelectionOffsets(input)
                      ensureComposerCursorVisible(input)
                      syncComposerInput(state.draft, selection.start, selection.end, "passive")
                    }}
                    onBlur={() => {
                      setComposerFocused(false)
                      setComposing(false)
                      clearLeaderPending()
                      window.setTimeout(() => composerAutocomplete.close(), 0)
                    }}
                    onCompositionStart={() => setComposing(true)}
                    onCompositionEnd={() => {
                      setComposing(false)
                      const input = composerRef.current
                      if (!input) {
                        return
                      }
                      const selection = getSelectionOffsets(input)
                      ensureComposerCursorVisible(input)
                      syncComposerInput(state.draft, selection.start, selection.end, "passive")
                    }}
                    onKeyDown={(event) => {
                      const native = event.nativeEvent as KeyboardEvent & { keyCode?: number }
                      const isImeComposing = native.isComposing || composing || native.keyCode === 229
                      const selection = getSelectionOffsets(event.currentTarget)

                      if (!event.metaKey && !event.ctrlKey && !event.altKey && (event.key === "Backspace" || event.key === "Delete")) {
                        const next = deleteStructuredRange(state.composerParts, selection.start, selection.end, event.key)
                        if (next) {
                          event.preventDefault()
                          const result = setComposerState(next.parts, "")
                          restoreComposerCursor(result.draft, next.cursor)
                          return
                        }
                      }

                      if (event.key === "Enter" && isImeComposing) {
                        return
                      }

                      if (event.key === "Enter" && !(event.metaKey || event.ctrlKey) && !composerAutocomplete.state) {
                        event.preventDefault()
                        const next = replaceRangeWithText(state.composerParts, selection.start, selection.end, "\n")
                        const result = setComposerState(next.parts, "")
                        restoreComposerCursor(result.draft, next.cursor)
                        return
                      }

                      if (composerAutocomplete.state) {
                        if (event.key === "ArrowDown") {
                          event.preventDefault()
                          composerAutocomplete.move(1)
                          return
                        }

                        if (event.key === "ArrowUp") {
                          event.preventDefault()
                          composerAutocomplete.move(-1)
                          return
                        }

                        if (event.key === "Escape") {
                          event.preventDefault()
                          closeComposerAutocomplete()
                          return
                        }

                        if (event.key === "Enter") {
                          event.preventDefault()
                          if (composerAutocomplete.currentItem) {
                            acceptComposerAutocomplete(composerAutocomplete.currentItem)
                          }
                          return
                        }

                        if (event.key === "Tab" && composerAutocomplete.currentItem) {
                          event.preventDefault()
                          acceptComposerAutocomplete(composerAutocomplete.currentItem, { completeDirectory: composerAutocomplete.currentItem.kind === "directory" })
                          return
                        }
                      }

                      if (event.key === "Escape" && !event.metaKey && !event.ctrlKey && !event.altKey && !event.shiftKey) {
                        if (!isSessionRunning(state.snapshot.sessionStatus)) {
                          return
                        }

                        event.preventDefault()
                        if (escPendingRef.current) {
                          clearEscPending()
                          postComposerAction("interruptSession")
                          return
                        }

                        startEscPending()
                        return
                      }

                      if (event.key === "Tab") {
                        const nextAgent = cycleAgentName(state.snapshot.agents, currentSelection.agent)
                        const tabIntent = composerTabIntent({
                          hasAutocomplete: !!composerAutocomplete.state,
                          hasCurrentItem: !!composerAutocomplete.currentItem,
                          metaKey: event.metaKey,
                          ctrlKey: event.ctrlKey,
                          altKey: event.altKey,
                          canCycleAgent: !!nextAgent,
                        })
                        if (tabIntent === "cycleAgent" && cycleComposerAgent()) {
                          event.preventDefault()
                          return
                        }
                      }

                      if (!event.shiftKey && !event.altKey && !event.metaKey && event.ctrlKey && event.key.toLowerCase() === "t") {
                        if (modelVariants(state.snapshot.providers, currentSelection.model).length > 0) {
                          event.preventDefault()
                          cycleComposerVariant()
                          return
                        }
                      }

                      if (event.key !== "Enter" || !(event.metaKey || event.ctrlKey)) {
                        return
                      }
                      event.preventDefault()
                      submit()
                    }}
                  />
                  {!state.draft.trim() && !composerFocused ? <div className="oc-composerPlaceholder" aria-hidden="true">Ask OpenCode to inspect, explain, or change this workspace.</div> : null}
                </div>
                <div className="oc-composerInfoWrap" ref={modelPickerRef}>
                  <ComposerInfo state={state} leaderPending={leaderPending} modelPickerOpen={modelPickerOpen} onToggleModelPicker={toggleModelPicker} onCycleVariant={() => cycleComposerVariant()} />
                  {modelPickerOpen ? (
                    <ModelPicker
                      sections={modelPickerSections}
                      currentAgent={currentSelection.agent}
                      onClose={() => setModelPickerOpen(false)}
                      onOpenProviderDocs={openProviderDocs}
                      onSelect={selectComposerModel}
                      onToggleFavorite={toggleComposerFavorite}
                      onCycleVariant={cycleComposerVariant}
                    />
                  ) : null}
                </div>
                {composerAutocomplete.state ? <ComposerAutocompletePopup state={composerAutocomplete.state} fileSearch={fileSearch} onSelect={acceptComposerAutocomplete} /> : null}
              </div>
            <div className="oc-composerActions">
              <div className="oc-composerActionsMain">
                <ComposerRunHints state={state} escPending={escPending} />
                {state.error ? <div className="oc-errorText oc-composerErrorText">{state.error}</div> : null}
              </div>
              <div className="oc-composerContextWrap">
                <ComposerMetrics state={state} />
                <ComposerStatusBadges state={state} pendingMcpActions={pendingMcpActions} onMcpActionStart={(name) => setPendingMcpActions((current) => ({ ...current, [name]: true }))} />
              </div>
            </div>
            </section>
          ) : null}

              {!blocked && isChildSession ? <SubagentNotice /> : null}
              </div>
            </footer>
          </div>
          </WebviewBindingsProvider>
        </ChildSessionsContext.Provider>
      </ChildMessagesContext.Provider>
    </WorkspaceDirContext.Provider>
  )
}

function normalizePersistedState(value: PersistedAppState | SessionBootstrap["sessionRef"] | null | undefined): PersistedAppState | undefined {
  if (!value || typeof value !== "object") {
    return undefined
  }

  const maybe = value as Partial<PersistedAppState> & { workspaceId?: string }
  if (!maybe.dir || !maybe.sessionId) {
    return undefined
  }

  return {
    workspaceId: maybe.workspaceId || maybe.dir,
    dir: maybe.dir,
    sessionId: maybe.sessionId,
    composerAgentOverride: maybe.composerAgentOverride,
    composerModelOverrides: maybe.composerModelOverrides,
    composerRecentModels: maybe.composerRecentModels,
    composerFavoriteModels: maybe.composerFavoriteModels,
    composerModelVariants: maybe.composerModelVariants,
  }
}

function ComposerAutocompletePopup({ state, fileSearch, onSelect }: { state: ComposerAutocompleteState; fileSearch: { status: "idle" | "searching" | "done"; query: string }; onSelect: (item: ComposerAutocompleteItem) => void }) {
  if (!state) {
    return null
  }

  const empty = popupEmptyText(state, fileSearch)
  const itemRefs = React.useRef<Array<HTMLButtonElement | null>>([])

  React.useEffect(() => {
    const item = itemRefs.current[state.selectedIndex]
    item?.scrollIntoView({ block: "nearest" })
  }, [state.selectedIndex, state.items])

  return (
    <div className="oc-composerAutocomplete" role="listbox" aria-label={`${state.trigger} suggestions`}>
      <div className="oc-composerAutocompleteHeader">
        <span className="oc-composerAutocompleteTrigger">{state.trigger === "slash" ? "/" : "@"}</span>
        <span>{popupHeaderText(state, fileSearch)}</span>
      </div>
      <div className="oc-composerAutocompleteList">
        {state.items.length > 0 ? state.items.map((item, index) => renderComposerAutocompleteItem(state, item, index, itemRefs, onSelect)) : (
          <div className="oc-composerAutocompleteEmpty">{empty}</div>
        )}
      </div>
    </div>
  )
}

function renderComposerAutocompleteItem(state: ComposerAutocompleteState, item: ComposerAutocompleteItem, index: number, itemRefs: React.RefObject<Array<HTMLButtonElement | null>>, onSelect: (item: ComposerAutocompleteItem) => void) {
  const view = autocompleteItemView(state.query, item)
  return (
    <button
      type="button"
      key={item.id}
      ref={(node) => {
        itemRefs.current[index] = node
      }}
      className={`oc-composerAutocompleteItem${index === state.selectedIndex ? " is-active" : ""}`}
      role="option"
      aria-selected={index === state.selectedIndex}
      onMouseDown={(event) => event.preventDefault()}
      onClick={() => onSelect(item)}
    >
      <div className="oc-composerAutocompleteLabelWrap">
        <div className="oc-composerAutocompleteLabel">{highlightAutocompleteText(view.label, item.match?.label)}</div>
        <div className="oc-composerAutocompleteDetail" title={view.detail}>{highlightAutocompleteText(view.detail, item.match?.detail)}</div>
        <div className="oc-composerAutocompleteKind">{view.kind}</div>
      </div>
    </button>
  )
}

function highlightAutocompleteText(value: string, indexes?: number[]) {
  if (!indexes || indexes.length === 0) {
    return value
  }

  const marks = new Set(indexes)
  return Array.from(value).map((char, index) => marks.has(index)
    ? <mark key={`${char}-${index}`} className="oc-composerAutocompleteMatch">{char}</mark>
    : <React.Fragment key={`${char}-${index}`}>{char}</React.Fragment>)
}

function popupHeaderText(state: ComposerAutocompleteState, fileSearch: { status: "idle" | "searching" | "done"; query: string }) {
  if (state.trigger === "slash") {
    return state.query ? `Filter: ${state.query}` : "Start typing to filter"
  }

  const query = parseComposerFileQuery(state.query).baseQuery.trim()
  if (!state.query) {
    return "Agents, resources, and project paths"
  }

  if (fileSearch.status === "searching" && fileSearch.query === query) {
    return `Searching paths for \"${state.query}\"...`
  }

  return `Filter: ${state.query}`
}

function popupEmptyText(state: ComposerAutocompleteState, fileSearch: { status: "idle" | "searching" | "done"; query: string }) {
  if (state.trigger === "slash") {
    return state.query ? `No slash actions match \"${state.query}\"` : "Start typing to filter"
  }

  const query = parseComposerFileQuery(state.query).baseQuery.trim()
  if (!state.query) {
    return "Type an agent, resource, path, or path#12-20"
  }

  if (fileSearch.status === "searching" && fileSearch.query === query) {
    return `Searching paths for \"${state.query}\"...`
  }

  return `No agents or paths match \"${state.query}\"`
}

function ComposerInfo({
  state,
  leaderPending: _leaderPending,
  modelPickerOpen,
  onToggleModelPicker,
  onCycleVariant,
}: {
  state: AppState
  leaderPending: boolean
  modelPickerOpen: boolean
  onToggleModelPicker: () => void
  onCycleVariant: () => void
}) {
  const info = composerIdentity({
    ...state.snapshot,
    composerAgentOverride: state.composerAgentOverride,
    composerMentionAgentOverride: state.composerMentionAgentOverride,
    composerRecentModels: state.composerRecentModels,
    composerModelOverrides: state.composerModelOverrides,
    composerModelVariants: state.composerModelVariants,
  })
  const variantOptions = modelVariants(state.snapshot.providers, info.modelRef)
  const colorClass = agentColorClass(info.agent)
  return (
    <div className="oc-composerInfo">
      <div className="oc-composerInfoSpacer" />
      <div className="oc-composerInfoRow">
        <span className="oc-composerIdentityStart">
          <span className={`oc-composerAgent ${colorClass}`}>{info.agent}</span>
        </span>
        {info.model || info.provider ? (
          <button
            type="button"
            className={`oc-composerModelTrigger${modelPickerOpen ? " is-open" : ""}`}
            aria-label="Switch model"
            aria-expanded={modelPickerOpen}
            onClick={onToggleModelPicker}
          >
            {info.model ? <span className="oc-composerModel" title={info.model}>{info.model}</span> : null}
            {info.provider ? <span className="oc-composerProvider" title={info.provider}>{info.provider}</span> : null}
          </button>
        ) : null}
        {variantOptions.length > 0 ? (
          <button type="button" className="oc-composerVariantTrigger" onClick={onCycleVariant} title="Cycle variant">
            {info.variant || "default"}
          </button>
        ) : null}
      </div>
    </div>
  )
}

function supportsComposerDrop(data: DataTransfer | null) {
  return droppedFileMentions(data, "").length > 0
}

function composerPartsFromPromptParts(parts: ComposerPromptPart[]): ComposerEditorPart[] {
  const next: ComposerEditorPart[] = []

  for (const part of parts) {
    if (part.type === "text") {
      next.push({ type: "text", content: part.text, start: 0, end: 0 })
      continue
    }

    if (part.type === "file") {
      const parsed = parseRestoredComposerFile(part)
      next.push({
        type: "file",
        path: parsed.path,
        kind: parsed.kind,
        selection: parsed.selection,
        content: part.source.value,
        start: 0,
        end: 0,
      })
      next.push({ type: "text", content: " ", start: 0, end: 0 })
      continue
    }

    if (part.type === "resource") {
      next.push({
        type: "resource",
        uri: part.uri,
        name: part.name,
        clientName: part.clientName,
        mimeType: part.mimeType,
        content: part.source.value,
        start: 0,
        end: 0,
      })
      next.push({ type: "text", content: " ", start: 0, end: 0 })
      continue
    }

    next.push({
      type: "agent",
      name: part.name,
      content: part.source?.value ?? `@${part.name}`,
      start: 0,
      end: 0,
    })
    next.push({ type: "text", content: " ", start: 0, end: 0 })
  }

  return ensureTextPart(next)
}

function parseRestoredComposerFile(part: Extract<ComposerPromptPart, { type: "file" }>) {
  const raw = part.source.value.startsWith("@") ? part.source.value.slice(1) : part.source.value
  const parsed = parseComposerFileQuery(raw)
  return {
    path: parsed.baseQuery || part.path,
    selection: parsed.selection ?? part.selection,
    kind: part.kind ?? ((parsed.baseQuery || part.path).endsWith("/") ? "directory" as const : "file" as const),
  }
}

function droppedFileMentions(data: DataTransfer | null, workspaceDir: string) {
  const paths = droppedFilePaths(data, workspaceDir)
  return paths.map((path) => ({
    type: "file" as const,
    path,
    kind: "file" as const,
    content: formatComposerFileContent(path),
  }))
}

function droppedFilePaths(data: DataTransfer | null, workspaceDir: string) {
  if (!data) {
    return []
  }

  const seen = new Set<string>()
  const out: string[] = []
  const add = (value: string) => {
    const next = normalizeDroppedFilePath(value, workspaceDir)
    if (!next || seen.has(next)) {
      return
    }
    seen.add(next)
    out.push(next)
  }

  const uriList = data.getData("text/uri-list")
  uriList.split(/\r?\n/).map((item) => item.trim()).filter(Boolean).filter((item) => !item.startsWith("#")).forEach(add)

  const text = data.getData("text/plain").trim()
  if (text.startsWith("file:")) {
    add(text)
  }

  for (const file of Array.from(data.files ?? [])) {
    const value = (file as File & { path?: string }).path
    if (value) {
      add(value)
    }
  }

  return out
}

function normalizeDroppedFilePath(value: string, workspaceDir: string) {
  const path = value.startsWith("file:") ? fileUrlPath(value) : value
  if (!path) {
    return undefined
  }

  if (!workspaceDir) {
    return path
  }

  return path === workspaceDir
    ? path.split(/[\\/]/).pop() || path
    : path.startsWith(`${workspaceDir}/`)
      ? path.slice(workspaceDir.length + 1)
      : path
}

function fileUrlPath(value: string) {
  try {
    return decodeURIComponent(new URL(value).pathname)
  } catch {
    return undefined
  }
}

function ComposerRunningIndicator({ running }: { running: boolean }) {
  return <span className={`oc-composerRunBar${running ? " is-running" : ""}`} aria-label="running" />
}

function ComposerRunHints({ state, escPending }: { state: AppState; escPending: boolean }) {
  const running = isSessionRunning(state.snapshot.sessionStatus)
  const modifierLabel = useModifierKeyLabel()

  if (running) {
    return (
      <div className="oc-composerHintRow" aria-hidden="true">
        <ComposerRunningIndicator running />
        <span className={`oc-composerHintText${escPending ? " is-warning" : ""}`}>{escPending ? "esc again to interrupt" : "esc interrupt"}</span>
      </div>
    )
  }

  return (
    <div className="oc-composerHintRow" aria-hidden="true">
      <span className="oc-composerShortcutGroup">
        <Keycap icon={<EnterKeyIcon />} label="Enter" />
        <span>newline</span>
      </span>
      <span aria-hidden="true">·</span>
      <span className="oc-composerShortcutGroup">
        <Keycap icon={modifierLabel === "Cmd" ? <CommandKeyIcon /> : <CtrlKeyIcon />} label={modifierLabel} />
        <span>+</span>
        <Keycap icon={<EnterKeyIcon />} label="Enter" />
        <span>submit</span>
      </span>
    </div>
  )
}

function ComposerMetrics({ state }: { state: AppState }) {
  const metrics = composerMetrics(state.snapshot)
  const items = [
    `${metrics.tokens.toLocaleString()} tokens`,
    typeof metrics.percent === "number" ? `${metrics.percent}%` : "",
    formatUsd(metrics.cost),
  ].filter(Boolean)
  return (
    <div className="oc-contextRow">
      {items.map((item, index) => (
        <React.Fragment key={item}>
          {index > 0 ? <span aria-hidden="true">·</span> : null}
          <span>{item}</span>
        </React.Fragment>
      ))}
    </div>
  )
}

function ComposerStatusBadges({ state, pendingMcpActions, onMcpActionStart }: { state: AppState; pendingMcpActions: Record<string, boolean>; onMcpActionStart: (name: string) => void }) {
  const mcp = overallMcpStatus(state.snapshot.mcp)
  const lsp = overallLspStatus(state.snapshot.lsp)
  return (
    <div className="oc-actionRow oc-composerBadgeRow">
      <StatusBadge label="MCP" tone={mcp.tone} items={mcp.items} pendingActions={pendingMcpActions} onActionStart={onMcpActionStart} />
      <StatusBadge label="LSP" tone={lsp.tone} items={lsp.items} />
    </div>
  )
}

function useModifierKeyLabel() {
  return React.useMemo(() => {
    if (typeof navigator === "undefined") {
      return "Ctrl"
    }

    const platform = ((navigator as Navigator & { userAgentData?: { platform?: string } }).userAgentData?.platform) || navigator.platform || navigator.userAgent
    return /mac|iphone|ipad|ipod/i.test(platform) ? "Cmd" : "Ctrl"
  }, [])
}

function Keycap({ icon, label }: { icon: React.ReactNode; label: string }) {
  return (
    <span className="oc-keycap" aria-label={label} title={label}>
      {icon}
    </span>
  )
}

function EnterKeyIcon() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <path d="M11.75 3.75v4.5a2 2 0 0 1-2 2H4.5" className="oc-keycapPath" />
      <path d="M6.75 7.75 4.25 10l2.5 2.25" className="oc-keycapPath" />
    </svg>
  )
}

function CtrlKeyIcon() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <path d="M4.25 10.75 8 6.25l3.75 4.5" className="oc-keycapPath" />
    </svg>
  )
}

function CommandKeyIcon() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <path d="M6 6V4.75a1.75 1.75 0 1 0-1.75 1.75H6" className="oc-keycapPath" />
      <path d="M10 6V4.75a1.75 1.75 0 1 1 1.75 1.75H10" className="oc-keycapPath" />
      <path d="M6 10v1.25a1.75 1.75 0 1 1-1.75-1.75H6" className="oc-keycapPath" />
      <path d="M10 10v1.25a1.75 1.75 0 1 0 1.75-1.75H10" className="oc-keycapPath" />
      <path d="M6 6h4v4H6z" className="oc-keycapPath" />
    </svg>
  )
}

function StatusBadge(props: { label: string; tone: StatusTone; items: StatusItem[]; pendingActions?: Record<string, boolean>; onActionStart?: (name: string) => void }) {
  const { label, tone, items, pendingActions, onActionStart } = props
  return (
    <div className="oc-statusBadgeWrap">
      <div className="oc-statusBadge">
        <span className={`oc-statusLight is-${tone}`} />
        <span>{label}</span>
      </div>
      {items.length > 0 ? (
        <div className="oc-statusPopover">
          {items.map((item) => (
            <div key={`${label}-${item.name}`} className="oc-statusPopoverItem">
              <span className={`oc-statusLight is-${item.tone}`} />
              <span className="oc-statusPopoverName">{item.name}</span>
              <span className="oc-statusPopoverValue" title={item.value}>{item.value}</span>
              {item.action ? <StatusPopoverAction item={item} pending={!!pendingActions?.[item.name]} onActionStart={onActionStart} /> : null}
            </div>
          ))}
        </div>
      ) : null}
    </div>
  )
}

function StatusPopoverAction({ item, pending, onActionStart }: { item: StatusItem; pending: boolean; onActionStart?: (name: string) => void }) {
  const onClick = (event: React.MouseEvent<HTMLButtonElement>) => {
    event.preventDefault()
    event.stopPropagation()
    if (!item.action || pending) {
      return
    }
    onActionStart?.(item.name)
    vscode.postMessage({ type: "toggleMcp", name: item.name, action: item.action })
  }

  return (
    <button type="button" disabled={pending} className={`oc-statusPopoverAction${item.action === "disconnect" ? " is-disconnect" : ""}${item.action === "connect" ? " is-connect" : ""}${pending ? " is-pending" : ""}`} onClick={onClick} title={item.actionLabel} aria-label={item.actionLabel}>
      {item.action === "disconnect" ? <DisconnectIcon /> : null}
      {item.action === "connect" ? <ConnectIcon /> : null}
      {item.action === "reconnect" ? <ReconnectIcon /> : null}
    </button>
  )
}

function ConnectIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M2 22L6 18" className="oc-statusActionPath" />
      <rect x="5" y="13" width="7" height="5" rx="1" transform="rotate(-45 8.5 15.5)" className="oc-statusActionPath" />
      <path d="M8 14L10 12" className="oc-statusActionPath" />
      <path d="M10 16L12 14" className="oc-statusActionPath" />
      <rect x="12" y="6" width="7" height="5" rx="1" transform="rotate(-45 15.5 8.5)" className="oc-statusActionPath" />
      <path d="M18 6L22 2" className="oc-statusActionPath" />
    </svg>
  )
}

function DisconnectIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M2 22L6 18" className="oc-statusActionPath" />
      <rect x="5" y="13" width="7" height="5" rx="1" transform="rotate(-45 8.5 15.5)" className="oc-statusActionPath" />
      <path d="M8 14L10 12" className="oc-statusActionPath" />
      <path d="M10 16L12 14" className="oc-statusActionPath" />
      <rect x="12" y="6" width="7" height="5" rx="1" transform="rotate(-45 15.5 8.5)" className="oc-statusActionPath" />
      <path d="M18 6L22 2" className="oc-statusActionPath" />
      <path d="M4 4L20 20" className="oc-statusActionPath" />
    </svg>
  )
}

function ReconnectIcon() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <path d="M12.5 6.5A4.5 4.5 0 0 0 5.25 4" className="oc-statusActionPath" />
      <path d="M4.75 2.75v2.5h2.5" className="oc-statusActionPath" />
      <path d="M3.5 9.5A4.5 4.5 0 0 0 10.75 12" className="oc-statusActionPath" />
      <path d="M11.25 13.25v-2.5h-2.5" className="oc-statusActionPath" />
    </svg>
  )
}
