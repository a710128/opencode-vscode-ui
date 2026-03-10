import React from "react"
import type { ComposerPromptPart, SessionBootstrap } from "../../../bridge/types"
import type { QuestionRequest } from "../../../core/sdk"
import { ChildMessagesContext, ChildSessionsContext, WorkspaceDirContext } from "./contexts"
import { answerKey, PermissionDock, QuestionDock, RetryStatus, SessionNav, SubagentNotice } from "./docks"
import { createInitialState, type AppState, type ComposerMention, type VsCodeApi } from "./state"
import { Timeline } from "./timeline"
import { AgentBadge, CompactionDivider, EmptyState, MarkdownBlock, PartView, WebviewBindingsProvider } from "./webview-bindings"
import { resizeComposer, useComposerResize } from "../hooks/useComposer"
import { useComposerAutocomplete, type ComposerAutocompleteItem, type ComposerAutocompleteState } from "../hooks/useComposerAutocomplete"
import { useHostMessages } from "../hooks/useHostMessages"
import { useModifierState } from "../hooks/useModifierState"
import { useTimelineScroll } from "../hooks/useTimelineScroll"
import { agentColor, composerIdentity, composerMetrics, composerSelection, formatUsd, isSessionRunning, overallLspStatus, overallMcpStatus, sessionTitle, type StatusItem, type StatusTone } from "../lib/session-meta"

declare global {
  interface Window {
    __OPENCODE_INITIAL_STATE__?: SessionBootstrap["sessionRef"] | null
  }
}

declare function acquireVsCodeApi(): VsCodeApi

const vscode = acquireVsCodeApi()
const initialRef = window.__OPENCODE_INITIAL_STATE__ ?? null
const fileRefStatus = new Map<string, boolean>()

if (initialRef) {
  vscode.setState(initialRef)
}

export function App() {
  const [state, setState] = React.useState(() => createInitialState(initialRef))
  const [pendingMcpActions, setPendingMcpActions] = React.useState<Record<string, boolean>>({})
  const [fileResults, setFileResults] = React.useState<Array<{ path: string }>>([])
  const [fileSearch, setFileSearch] = React.useState<{ status: "idle" | "searching" | "done"; query: string }>({ status: "idle", query: "" })
  const timelineRef = React.useRef<HTMLDivElement | null>(null)
  const composerRef = React.useRef<HTMLTextAreaElement | null>(null)
  const searchRef = React.useRef<{ requestID: string; query: string } | null>(null)
  const composerMenuItems = React.useMemo(() => buildComposerMenuItems(state, fileResults), [fileResults, state])
  const composerAutocomplete = useComposerAutocomplete(composerMenuItems)

  const blocked = state.snapshot.permissions.length > 0 || state.snapshot.questions.length > 0
  const isChildSession = !!state.bootstrap.session?.parentID
  const firstPermission = state.snapshot.permissions[0]
  const firstQuestion = state.snapshot.questions[0]

  useHostMessages({
    fileRefStatus,
    onFileSearchResults: (payload) => {
      if (!searchRef.current || payload.requestID !== searchRef.current.requestID) {
        return
      }
      if (payload.query !== searchRef.current.query) {
        return
      }
      setFileResults(payload.results)
      setFileSearch({ status: "done", query: payload.query })
    },
    setPendingMcpActions,
    setState,
    vscode,
  })
  useComposerResize(composerRef, state.draft)
  useTimelineScroll(timelineRef, [state.snapshot.messages, state.snapshot.submitting, state.snapshot.permissions, state.snapshot.questions])
  useModifierState()

  React.useEffect(() => {
    document.title = `OpenCode: ${sessionTitle(state.bootstrap)}`
  }, [state.bootstrap])

  React.useEffect(() => {
    if (composerAutocomplete.state?.trigger !== "mention") {
      searchRef.current = null
      setFileResults([])
      setFileSearch({ status: "idle", query: "" })
      return
    }

    const query = composerAutocomplete.state.query.trim()
    if (!query) {
      searchRef.current = null
      setFileResults([])
      setFileSearch({ status: "idle", query: "" })
      return
    }

    const requestID = `file-search:${Date.now()}:${query}`
    searchRef.current = { requestID, query }
    setFileSearch({ status: "searching", query })
    const timer = window.setTimeout(() => {
      vscode.postMessage({
        type: "searchFiles",
        requestID,
        query,
      })
    }, 80)

    return () => window.clearTimeout(timer)
  }, [composerAutocomplete.state])


  const submit = React.useCallback(() => {
    if (!state.draft.trim() || blocked) {
      return
    }

    const selection = composerSelection({ ...state.snapshot, composerAgentOverride: state.composerAgentOverride })
    const parts = buildComposerSubmitParts(state.draft, state.composerMentions)
    vscode.postMessage({
      type: "submit",
      text: state.draft,
      parts,
      agent: selection.agent,
      model: selection.model,
    })
    setState((current) => ({
      ...current,
      draft: "",
      composerMentions: [],
      composerAgentOverride: undefined,
      error: "",
    }))
  }, [blocked, state.composerAgentOverride, state.composerMentions, state.draft, state.snapshot])

  const acceptComposerAutocomplete = React.useCallback((item: ComposerAutocompleteItem) => {
    if (item.kind === "action") {
      if (item.id === "slash-clear") {
        setState((current) => ({ ...current, draft: "", composerMentions: [], composerAgentOverride: undefined, error: "" }))
        composerAutocomplete.close()
        return
      }

      if (item.id === "slash-reset-agent") {
        setState((current) => ({
          ...current,
          draft: "",
          composerMentions: [],
          composerAgentOverride: undefined,
          error: "",
        }))
        composerAutocomplete.close()
        return
      }

      if (item.id === "slash-refresh") {
        vscode.postMessage({ type: "composerAction", action: "refreshSession" })
        composerAutocomplete.close()
        return
      }
    }

    if (item.kind === "agent" || item.kind === "file") {
      const range = composerAutocomplete.state
      const mention = item.mention
      if (!range || !mention) {
        composerAutocomplete.close()
        return
      }

      const next = insertComposerMention(state.draft, state.composerMentions, range.start, range.end, mention)

      setState((current) => ({
        ...current,
        draft: next.draft,
        composerMentions: next.composerMentions,
        composerAgentOverride: next.composerAgentOverride,
        error: "",
      }))
      composerAutocomplete.close()
      window.setTimeout(() => {
        const input = composerRef.current
        if (!input) {
          return
        }
        input.focus()
        input.setSelectionRange(next.cursor, next.cursor)
        resizeComposer(input)
      }, 0)
    }
  }, [composerAutocomplete, setState, state.composerMentions, state.draft])

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
            <section className="oc-composer">
              <div className="oc-composerInputWrap">
                <textarea
                  ref={composerRef}
                  className="oc-composerInput"
                  rows={1}
                  value={state.draft}
                  onChange={(event) => {
                    const value = event.currentTarget.value
                    composerAutocomplete.sync(value, event.currentTarget.selectionStart, event.currentTarget.selectionEnd)
                    setState((current) => {
                      const composerMentions = syncComposerMentions(current.draft, value, current.composerMentions)
                      return {
                        ...current,
                        draft: value,
                        composerMentions,
                        composerAgentOverride: composerAgentOverride(composerMentions),
                      }
                    })
                  }}
                  onInput={(event) => resizeComposer(event.currentTarget)}
                  onSelect={(event) => {
                    composerAutocomplete.sync(event.currentTarget.value, event.currentTarget.selectionStart, event.currentTarget.selectionEnd)
                  }}
                  onFocus={(event) => {
                    composerAutocomplete.sync(event.currentTarget.value, event.currentTarget.selectionStart, event.currentTarget.selectionEnd)
                  }}
                  onBlur={() => {
                    window.setTimeout(() => composerAutocomplete.close(), 0)
                  }}
                  onKeyDown={(event) => {
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
                        composerAutocomplete.close()
                        return
                      }

                      if ((event.key === "Enter" && !(event.metaKey || event.ctrlKey)) || event.key === "Tab") {
                        event.preventDefault()
                        if (composerAutocomplete.currentItem) {
                          acceptComposerAutocomplete(composerAutocomplete.currentItem)
                        }
                        return
                      }
                    }

                    if (event.key !== "Enter" || !(event.metaKey || event.ctrlKey)) {
                      return
                    }
                    event.preventDefault()
                    submit()
                }}
                placeholder="Ask OpenCode to inspect, explain, or change this workspace."
                disabled={state.bootstrap.status !== "ready" || blocked}
              />
               {composerAutocomplete.state ? <ComposerAutocompletePopup state={composerAutocomplete.state} fileSearch={fileSearch} onSelect={acceptComposerAutocomplete} /> : null}
               <ComposerInfo state={state} />
            </div>
            <div className="oc-composerActions">
              <div className="oc-composerContextWrap">
                <ComposerMetrics state={state} />
                {state.error ? <div className="oc-errorText oc-composerErrorText">{state.error}</div> : null}
              </div>
          <ComposerStatusBadges state={state} pendingMcpActions={pendingMcpActions} onMcpActionStart={(name) => setPendingMcpActions((current) => ({ ...current, [name]: true }))} />
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

function ComposerAutocompletePopup({ state, fileSearch, onSelect }: { state: ComposerAutocompleteState; fileSearch: { status: "idle" | "searching" | "done"; query: string }; onSelect: (item: ComposerAutocompleteItem) => void }) {
  if (!state) {
    return null
  }

  const groups = state.trigger === "mention"
    ? [
        { title: "Agents", items: state.items.filter((item) => item.kind === "agent") },
        { title: "Files", items: state.items.filter((item) => item.kind === "file") },
      ].filter((group) => group.items.length > 0)
    : []
  const empty = popupEmptyText(state, fileSearch)

  return (
    <div className="oc-composerAutocomplete" role="listbox" aria-label={`${state.trigger} suggestions`}>
      <div className="oc-composerAutocompleteHeader">
        <span className="oc-composerAutocompleteTrigger">{state.trigger === "slash" ? "/" : "@"}</span>
        <span>{popupHeaderText(state, fileSearch)}</span>
      </div>
      <div className="oc-composerAutocompleteList">
        {state.items.length > 0 ? (
          state.trigger === "mention"
            ? groups.map((group) => (
                <div key={group.title} className="oc-composerAutocompleteSection">
                  <div className="oc-composerAutocompleteSectionTitle">{group.title}</div>
                  <div className="oc-composerAutocompleteSectionItems">
                    {group.items.map((item) => renderComposerAutocompleteItem(state, item, onSelect))}
                  </div>
                </div>
              ))
            : state.items.map((item) => renderComposerAutocompleteItem(state, item, onSelect))
        ) : (
          <div className="oc-composerAutocompleteEmpty">{empty}</div>
        )}
      </div>
    </div>
  )
}

function renderComposerAutocompleteItem(state: ComposerAutocompleteState, item: ComposerAutocompleteItem, onSelect: (item: ComposerAutocompleteItem) => void) {
  const index = state.items.findIndex((entry) => entry.id === item.id)
  return (
    <button
      type="button"
      key={item.id}
      className={`oc-composerAutocompleteItem${index === state.selectedIndex ? " is-active" : ""}`}
      role="option"
      aria-selected={index === state.selectedIndex}
      onMouseDown={(event) => event.preventDefault()}
      onClick={() => onSelect(item)}
    >
      <div className="oc-composerAutocompleteLabelWrap">
        <div className="oc-composerAutocompleteTopline">
          <div className="oc-composerAutocompleteLabel">{item.label}</div>
          <div className="oc-composerAutocompleteKind">{item.kind}</div>
        </div>
        <div className="oc-composerAutocompleteDetail" title={item.detail}>{item.detail}</div>
      </div>
    </button>
  )
}

function popupHeaderText(state: ComposerAutocompleteState, fileSearch: { status: "idle" | "searching" | "done"; query: string }) {
  if (state.trigger === "slash") {
    return state.query ? `Filter: ${state.query}` : "Start typing to filter"
  }

  if (!state.query) {
    return "Type an agent name or file path"
  }

  if (fileSearch.status === "searching" && fileSearch.query === state.query) {
    return `Searching files for \"${state.query}\"...`
  }

  return `Filter: ${state.query}`
}

function popupEmptyText(state: ComposerAutocompleteState, fileSearch: { status: "idle" | "searching" | "done"; query: string }) {
  if (state.trigger === "slash") {
    return state.query ? `No slash actions match \"${state.query}\"` : "Start typing to filter"
  }

  if (!state.query) {
    return "Type an agent name or file path"
  }

  if (fileSearch.status === "searching" && fileSearch.query === state.query) {
    return `Searching files for \"${state.query}\"...`
  }

  return `No agents or files match \"${state.query}\"`
}

function ComposerInfo({ state }: { state: AppState }) {
  const info = composerIdentity({ ...state.snapshot, composerAgentOverride: state.composerAgentOverride })
  const running = isSessionRunning(state.snapshot.sessionStatus)
  return (
    <div className="oc-composerInfo" aria-hidden="true">
      <div className="oc-composerInfoSpacer" />
      <div className="oc-composerInfoRow">
        <span className="oc-composerIdentityStart">
          <span className="oc-composerAgent" style={{ color: agentColor(info.agent) }}>{info.agent}</span>
          <ComposerRunningIndicator running={running} />
        </span>
        {info.model ? <span className="oc-composerModel" title={info.model}>{info.model}</span> : null}
        {info.provider ? <span className="oc-composerProvider" title={info.provider}>{info.provider}</span> : null}
      </div>
    </div>
  )
}

function buildComposerMenuItems(state: AppState, files: Array<{ path: string }>): ComposerAutocompleteItem[] {
  const slashItems: ComposerAutocompleteItem[] = [
    {
      id: "slash-refresh",
      label: "refresh",
      detail: "Ask the host to reload the current session snapshot.",
      keywords: ["reload", "snapshot", "panel", "host"],
      trigger: "slash",
      kind: "action",
    },
    {
      id: "slash-clear",
      label: "clear",
      detail: "Clear the current composer draft locally.",
      keywords: ["reset", "draft", "composer"],
      trigger: "slash",
      kind: "action",
    },
  ]

  if (state.composerAgentOverride) {
    slashItems.push({
      id: "slash-reset-agent",
      label: "reset-agent",
      detail: "Return the composer to the default agent selection.",
      keywords: ["agent", "default", "override"],
      trigger: "slash",
      kind: "action",
    })
  }

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

  const fileItems = files.map((item) => ({
    id: `file:${item.path}`,
    label: item.path.split("/").pop() || item.path,
    detail: item.path,
    keywords: item.path.split("/").filter(Boolean),
    trigger: "mention" as const,
    kind: "file" as const,
    mention: {
      type: "file" as const,
      path: item.path,
      content: `@${item.path}`,
    },
  }))

  return [...slashItems, ...agentItems, ...fileItems]
}

function composerAgentOverride(mentions: ComposerMention[]) {
  for (let i = mentions.length - 1; i >= 0; i -= 1) {
    const item = mentions[i]
    if (item && item.type === "agent") {
      return item.name
    }
  }
}

function buildComposerSubmitParts(value: string, mentions: ComposerMention[]): ComposerPromptPart[] {
  const parts: ComposerPromptPart[] = []
  const items = [...mentions].sort((a, b) => a.start - b.start)
  let cursor = 0

  for (const item of items) {
    if (item.start > cursor) {
      pushComposerTextPart(parts, value.slice(cursor, item.start))
    }

    parts.push(item.type === "agent"
      ? {
          type: "agent",
          name: item.name,
          source: {
            value: item.content,
            start: item.start,
            end: item.end,
          },
        }
      : {
          type: "file",
          path: item.path,
          source: {
            value: item.content,
            start: item.start,
            end: item.end,
          },
        })
    cursor = item.end
  }

  if (cursor < value.length) {
    pushComposerTextPart(parts, value.slice(cursor))
  }

  if (parts.length > 0) {
    return parts
  }

  return value.trim()
    ? [{ type: "text", text: value.trim() }]
    : []
}

function insertComposerMention(value: string, mentions: ComposerMention[], start: number, end: number, mention: NonNullable<ComposerAutocompleteItem["mention"]>) {
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
      : {
          type: "file" as const,
          path: mention.path,
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

function syncComposerMentions(prev: string, next: string, mentions: ComposerMention[]) {
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

function pushComposerTextPart(parts: ComposerPromptPart[], text: string) {
  if (!text) {
    return
  }

  const prev = parts[parts.length - 1]
  if (prev?.type === "text") {
    prev.text += text
    return
  }

  parts.push({ type: "text", text })
}

function ComposerRunningIndicator({ running }: { running: boolean }) {
  return <span className={`oc-composerRunBar${running ? " is-running" : ""}`} aria-label="running" />
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
