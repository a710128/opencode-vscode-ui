import React from "react"
import hljs from "highlight.js"
import MarkdownIt from "markdown-it"
import { createRoot } from "react-dom/client"
import type { HostMessage, SessionBootstrap, WebviewMessage } from "../../bridge/types"
import type { FileDiff, FilePart, MessageInfo, MessagePart, PermissionRequest, QuestionRequest, SessionInfo, SessionMessage, SessionStatus, TextPart, Todo } from "../../core/sdk"
import "./styles.css"

declare global {
  interface Window {
    __OPENCODE_INITIAL_STATE__?: SessionBootstrap["sessionRef"] | null
  }
}

type VsCodeApi = {
  postMessage(message: WebviewMessage): void
  setState<T>(state: T): void
}

declare function acquireVsCodeApi(): VsCodeApi

type FormState = {
  selected: Record<string, string[]>
  custom: Record<string, string>
  reject: Record<string, string>
}

type AppState = {
  bootstrap: SessionBootstrap
  snapshot: {
    messages: SessionMessage[]
    childMessages: Record<string, SessionMessage[]>
    childSessions: Record<string, SessionInfo>
    sessionStatus?: SessionStatus
    submitting: boolean
    todos: Todo[]
    diff: FileDiff[]
    permissions: PermissionRequest[]
    questions: QuestionRequest[]
    agentMode: "build" | "plan"
    navigation: {
      parent?: { id: string; title: string }
      prev?: { id: string; title: string }
      next?: { id: string; title: string }
    }
  }
  draft: string
  error: string
  form: FormState
}

const vscode = acquireVsCodeApi()
const initialRef = window.__OPENCODE_INITIAL_STATE__ ?? null
const markdown = new MarkdownIt({
  breaks: true,
  linkify: true,
  highlight(value: string, language: string) {
    return renderMarkdownCodeWindow(value, language)
  },
})

const linkDefault = markdown.renderer.rules.link_open
const copyTipTimers = new WeakMap<HTMLButtonElement, number>()

markdown.renderer.rules.link_open = (...args: Parameters<NonNullable<typeof linkDefault>>) => {
  const [tokens, idx, options, env, self] = args
  tokens[idx]?.attrSet("target", "_blank")
  tokens[idx]?.attrSet("rel", "noreferrer noopener")
  return linkDefault ? linkDefault(tokens, idx, options, env, self) : self.renderToken(tokens, idx, options)
}

const codeInlineDefault = markdown.renderer.rules.code_inline
markdown.renderer.rules.code_inline = (...args: Parameters<NonNullable<typeof codeInlineDefault>>) => {
  const [tokens, idx, options, env, self] = args
  tokens[idx]?.attrSet("class", "oc-inlineCode")
  return codeInlineDefault ? codeInlineDefault(tokens, idx, options, env, self) : self.renderToken(tokens, idx, options)
}

if (initialRef) {
  vscode.setState(initialRef)
}

const initialState: AppState = {
  bootstrap: {
    status: "loading",
    workspaceName: initialRef?.dir ? initialRef.dir.split(/[\\/]/).pop() || initialRef.dir : "-",
    sessionRef: initialRef ?? { dir: "-", sessionId: "-" },
    message: "Waiting for workspace server and session metadata.",
  },
  snapshot: {
    messages: [],
    childMessages: {},
    childSessions: {},
    sessionStatus: undefined,
    submitting: false,
    todos: [],
    diff: [],
    permissions: [],
    questions: [],
    agentMode: "build",
    navigation: {},
  },
  draft: "",
  error: "",
  form: {
    selected: {},
    custom: {},
    reject: {},
  },
}

function App() {
  const [state, setState] = React.useState(initialState)
  const timelineRef = React.useRef<HTMLDivElement | null>(null)

  const blocked = state.snapshot.permissions.length > 0 || state.snapshot.questions.length > 0
  const isChildSession = !!state.bootstrap.session?.parentID
  const busy = state.bootstrap.status !== "ready"
    || state.snapshot.submitting
    || state.snapshot.sessionStatus?.type === "busy"
    || state.snapshot.sessionStatus?.type === "retry"

  const firstPermission = state.snapshot.permissions[0]
  const firstQuestion = state.snapshot.questions[0]

  React.useEffect(() => {
    const handler = (event: MessageEvent<HostMessage>) => {
      const message = event.data
      if (message?.type === "bootstrap") {
        setState((current) => ({ ...current, bootstrap: message.payload, error: "" }))
        return
      }

      if (message?.type === "snapshot") {
        setState((current) => ({
          ...current,
          bootstrap: {
            status: message.payload.status,
            workspaceName: message.payload.workspaceName,
            sessionRef: message.payload.sessionRef,
            session: message.payload.session,
            message: message.payload.message,
          },
          snapshot: {
            messages: Array.isArray(message.payload.messages) ? message.payload.messages : [],
            childMessages: recordOfMessageLists(message.payload.childMessages),
            childSessions: recordOfSessions(message.payload.childSessions),
            sessionStatus: message.payload.sessionStatus,
            submitting: !!message.payload.submitting,
            todos: Array.isArray(message.payload.todos) ? message.payload.todos : [],
            diff: Array.isArray(message.payload.diff) ? message.payload.diff : [],
            permissions: Array.isArray(message.payload.permissions) ? message.payload.permissions : [],
            questions: Array.isArray(message.payload.questions) ? message.payload.questions : [],
            agentMode: message.payload.agentMode === "plan" ? "plan" : "build",
            navigation: message.payload.navigation || {},
          },
          error: "",
        }))
        return
      }

      if (message?.type === "error") {
        setState((current) => ({ ...current, error: message.message || "Unknown error" }))
      }
    }

    window.addEventListener("message", handler)
    vscode.postMessage({ type: "ready" })
    return () => window.removeEventListener("message", handler)
  }, [])

  React.useEffect(() => {
    const node = timelineRef.current
    if (!node) {
      return
    }
    node.scrollTop = node.scrollHeight
  }, [state.snapshot.messages.length, state.snapshot.submitting, state.snapshot.permissions.length, state.snapshot.questions.length])

  React.useEffect(() => {
    document.title = `OpenCode: ${sessionTitle(state.bootstrap)}`
  }, [state.bootstrap])

  const submit = React.useCallback(() => {
    const text = state.draft.trim()
    if (!text || blocked) {
      return
    }

    vscode.postMessage({ type: "submit", text })
    setState((current) => ({
      ...current,
      draft: "",
      error: "",
    }))
  }, [blocked, state.draft])

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
          <div className="oc-shell">
            <main ref={timelineRef} className="oc-transcript">
              <div className="oc-transcriptInner">
                <Timeline state={state} />
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
          {isChildSession ? <SessionNav navigation={state.snapshot.navigation} /> : null}

          {!blocked && !isChildSession ? (
            <section className="oc-composer">
            <div className="oc-composerHeader">
              <div className="oc-composerMeta">
                <span className={`oc-modeBadge oc-mode-${state.snapshot.agentMode}`}>{state.snapshot.agentMode}</span>
                <span className="oc-help">
                  {busy
                    ? "Waiting for the current response to settle. Ctrl or Cmd plus Enter sends when ready."
                    : "Enter for newline. Ctrl or Cmd plus Enter to send."}
                </span>
              </div>
            </div>
            <textarea
              className="oc-composerInput"
              value={state.draft}
              onChange={(event) => {
                const value = event.currentTarget.value
                setState((current) => ({ ...current, draft: value }))
              }}
              onKeyDown={(event) => {
                if (event.key !== "Enter" || !(event.metaKey || event.ctrlKey)) {
                  return
                }
                event.preventDefault()
                submit()
              }}
              placeholder="Ask OpenCode to inspect, explain, or change this workspace."
              disabled={state.bootstrap.status !== "ready" || state.snapshot.submitting || blocked}
            />
            <div className="oc-composerActions">
              <div className="oc-composerContextWrap">
                <div className="oc-errorText">{state.error}</div>
                <div className="oc-contextRow">{contextSummary(state)}</div>
              </div>
              <div className="oc-actionRow">
                <button
                  type="button"
                  className="oc-btn"
                  disabled={state.bootstrap.status !== "ready"}
                  onClick={() => {
                    vscode.postMessage({ type: "refresh" })
                    setState((current) => ({ ...current, error: "" }))
                  }}
                >
                  Refresh
                </button>
                <button
                  type="button"
                  className="oc-btn oc-btn-primary"
                  disabled={state.bootstrap.status !== "ready" || state.snapshot.submitting || blocked || !state.draft.trim()}
                  onClick={submit}
                >
                  Send
                </button>
              </div>
            </div>
            </section>
          ) : null}

              {!blocked && isChildSession ? <SubagentNotice /> : null}
              </div>
            </footer>
          </div>
        </ChildSessionsContext.Provider>
      </ChildMessagesContext.Provider>
    </WorkspaceDirContext.Provider>
  )
}

function Timeline({ state }: { state: AppState }) {
  const messages = state.snapshot.messages
  const [showThinking, setShowThinking] = React.useState(true)
  const [showInternals, setShowInternals] = React.useState(false)
  const [diffMode, setDiffMode] = React.useState<"unified" | "split">("unified")

  if (state.bootstrap.status === "error") {
    return <EmptyState title="Session unavailable" text={state.bootstrap.message || "The workspace runtime is not ready."} />
  }

  if (state.bootstrap.status !== "ready" && messages.length === 0) {
    return <EmptyState title="Connecting to workspace" text={state.bootstrap.message || "Waiting for workspace runtime."} />
  }

  if (messages.length === 0) {
    return <EmptyState title="Start this session" text="Send a message below. Pending permission and question requests will appear in the lower dock." />
  }

  const blocks = buildTimelineBlocks(messages, { showThinking, showInternals })
  const activeToolID = latestActiveToolId(blocks.flatMap((block) => block.kind === "assistant-part" ? [block.part] : []))
  const hasPatchDiff = blocks.some((block) => block.kind === "assistant-part" && block.part.type === "tool" && block.part.tool === "apply_patch")

  return (
    <TranscriptVisibilityContext.Provider value={{ showThinking, showInternals }}>
      <div className="oc-log">
        <div className="oc-transcriptTools">
          <button type="button" className={`oc-toggleBtn${showThinking ? " is-active" : ""}`} onClick={() => setShowThinking((current) => !current)}>
            Thinking {showThinking ? "on" : "off"}
          </button>
          <button type="button" className={`oc-toggleBtn${showInternals ? " is-active" : ""}`} onClick={() => setShowInternals((current) => !current)}>
            Internals {showInternals ? "on" : "off"}
          </button>
          {hasPatchDiff ? (
            <div className="oc-transcriptToggleGroup" role="group" aria-label="Diff view mode">
              <button type="button" className={`oc-toggleBtn${diffMode === "unified" ? " is-active" : ""}`} onClick={() => setDiffMode("unified")}>
                Unified
              </button>
              <button type="button" className={`oc-toggleBtn${diffMode === "split" ? " is-active" : ""}`} onClick={() => setDiffMode("split")}>
                Split
              </button>
            </div>
          ) : null}
        </div>
        {blocks.map((block) => <TimelineBlockView key={block.key} block={block} activeToolID={activeToolID} diffMode={diffMode} />)}
      </div>
    </TranscriptVisibilityContext.Provider>
  )
}

type TimelineBlock =
  | { kind: "user-message"; key: string; message: SessionMessage }
  | { kind: "assistant-part"; key: string; part: MessagePart }
  | { kind: "assistant-meta"; key: string; text: string }

type ToolDisplayVariant = "row" | "panel" | "links" | "files" | "todos" | "question"

type ToolDetails = {
  title: string
  subtitle: string
  args: string[]
}

const OUTPUT_WINDOW_COLLAPSED_LINES = 10
const OUTPUT_WINDOW_EXPANDED_LINES = 100
const OUTPUT_WINDOW_FONT_SIZE_PX = 12
const OUTPUT_WINDOW_LINE_HEIGHT = 1.65
const OUTPUT_WINDOW_VERTICAL_PADDING_PX = 24

type ToolFileSummary = {
  path: string
  summary: string
}

function TimelineBlockView({ block, activeToolID, diffMode }: { block: TimelineBlock; activeToolID: string; diffMode: "unified" | "split" }) {
  if (block.kind === "user-message") {
    const userText = primaryUserText(block.message)
    const userFiles = userAttachments(block.message)
    return (
      <section className="oc-turnUser">
        <div className="oc-entryHeader">
          <div className="oc-entryRole">You</div>
          <div className="oc-entryTime">{formatTime(block.message.info.time?.created)}</div>
        </div>
        {userText ? <MarkdownBlock content={userText.text || ""} /> : <div className="oc-partEmpty">No visible prompt text.</div>}
        {userFiles.length > 0 ? (
          <div className="oc-attachmentRow">
            {userFiles.map((part) => (
              <span key={part.id} className="oc-pill oc-pill-file">{part.filename || fileLabel(part.url)}</span>
            ))}
          </div>
        ) : null}
      </section>
    )
  }

  if (block.kind === "assistant-meta") {
    return <section className="oc-turnMeta">{block.text}</section>
  }

  const part = block.part
  return <PartView part={part} active={part.type === "tool" && part.id === activeToolID} diffMode={diffMode} />
}

const TranscriptVisibilityContext = React.createContext({
  showThinking: false,
  showInternals: false,
})

const WorkspaceDirContext = React.createContext("")
const ChildMessagesContext = React.createContext<Record<string, SessionMessage[]>>({})
const ChildSessionsContext = React.createContext<Record<string, SessionInfo>>({})

function useWorkspaceDir() {
  return React.useContext(WorkspaceDirContext)
}

function useChildMessages() {
  return React.useContext(ChildMessagesContext)
}

function useChildSessions() {
  return React.useContext(ChildSessionsContext)
}

function PermissionDock(props: {
  request: PermissionRequest
  currentSessionID: string
  rejectMessage: string
  onRejectMessage: (value: string) => void
  onReply: (reply: "once" | "always" | "reject", message?: string) => void
}) {
  const { request, currentSessionID, rejectMessage, onRejectMessage, onReply } = props
  const childRequest = request.sessionID !== currentSessionID
  const info = permissionInfo(request)
  return (
    <section className="oc-dock oc-dock-warning">
      <div className="oc-dockHeader">
        <span className="oc-kicker">permission</span>
        <span className="oc-dockTitle">Approval required</span>
      </div>
      <div className="oc-dockText">OpenCode is waiting for confirmation before it continues.</div>
      <div className="oc-inlineValue">{info.title}</div>
      {info.details.length > 0 ? (
        <div className="oc-detailList">
          {info.details.map((item) => <div key={item} className="oc-dockText">{item}</div>)}
        </div>
      ) : null}
      {request.patterns?.length ? (
        <div className="oc-pillRow">
          {request.patterns.map((item) => <span key={item} className="oc-pill">{item}</span>)}
        </div>
      ) : null}
      {childRequest ? (
        <textarea
          className="oc-answerInput"
          value={rejectMessage}
          onChange={(event) => {
            const value = event.currentTarget.value
            onRejectMessage(value)
          }}
          placeholder="Optional instructions for the child session when rejecting"
        />
      ) : null}
      <div className="oc-actionRow">
        <button type="button" className="oc-btn" onClick={() => onReply("reject", childRequest ? rejectMessage.trim() || undefined : undefined)}>Reject</button>
        <button type="button" className="oc-btn" onClick={() => onReply("once")}>Allow once</button>
        <button type="button" className="oc-btn oc-btn-primary" onClick={() => onReply("always")}>Always allow</button>
      </div>
    </section>
  )
}

function QuestionDock(props: {
  request: QuestionRequest
  form: FormState
  onOption: (index: number, label: string, multiple: boolean) => void
  onCustom: (index: number, value: string) => void
  onReject: () => void
  onSubmit: () => void
}) {
  const { request, form, onCustom, onOption, onReject, onSubmit } = props
  return (
    <section className="oc-dock oc-dock-warning">
      <div className="oc-dockHeader">
        <span className="oc-kicker">question</span>
        <span className="oc-dockTitle">Answer required</span>
      </div>
      <div className="oc-dockText">OpenCode needs your answer before it can continue.</div>
      <div className="oc-questionList">
        {request.questions.map((item, index) => {
          const key = answerKey(request.id, index)
          const selected = form.selected[key] ?? []
          const custom = form.custom[key] ?? ""
          return (
            <section key={key} className="oc-questionCard">
              <div className="oc-inlineValue">{item.header || "Question"}</div>
              <div className="oc-dockText">{item.question || ""}</div>
              <div className="oc-pillRow">
                {item.options.map((option) => (
                  <button
                    key={option.label}
                    type="button"
                    className={`oc-chip ${selected.includes(option.label) ? "is-active" : ""}`}
                    onClick={() => onOption(index, option.label, !!item.multiple)}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
              {item.custom === false ? null : (
                <textarea
                  className="oc-answerInput"
                  value={custom}
                  onChange={(event) => {
                    const value = event.currentTarget.value
                    onCustom(index, value)
                  }}
                  placeholder="Optional custom answer"
                />
              )}
            </section>
          )
        })}
      </div>
      <div className="oc-actionRow">
        <button type="button" className="oc-btn" onClick={onReject}>Reject</button>
        <button type="button" className="oc-btn oc-btn-primary" onClick={onSubmit}>Submit answers</button>
      </div>
    </section>
  )
}

function RetryStatus({ status }: { status?: SessionStatus }) {
  const retry = status?.type === "retry" ? status : undefined
  const [seconds, setSeconds] = React.useState(() => retry?.next ? Math.max(0, Math.round((retry.next - Date.now()) / 1000)) : 0)

  React.useEffect(() => {
    if (!retry?.next) {
      setSeconds(0)
      return
    }

    const tick = () => setSeconds(Math.max(0, Math.round((retry.next - Date.now()) / 1000)))
    tick()
    const timer = window.setInterval(tick, 1000)
    return () => window.clearInterval(timer)
  }, [retry?.next])

  if (!retry) {
    return null
  }

  return (
    <section className="oc-dock oc-dock-error">
      <div className="oc-dockHeader">
        <span className="oc-kicker">retry</span>
        <span className="oc-dockTitle">Attempt #{retry.attempt}</span>
      </div>
      <div className="oc-dockText">{retry.message}</div>
      <div className="oc-help">Retrying {seconds > 0 ? `in ${formatDuration(seconds)} ` : ""}attempt #{retry.attempt}</div>
    </section>
  )
}

function SessionNav(props: {
  navigation: AppState["snapshot"]["navigation"]
}) {
  const { navigation } = props
  if (!navigation.parent && !navigation.prev && !navigation.next) {
    return null
  }

  return (
    <section className="oc-dock">
      <div className="oc-dockHeader">
        <span className="oc-kicker">subagent</span>
        <span className="oc-dockTitle">Navigation</span>
      </div>
      <div className="oc-actionRow">
        {navigation.parent ? <button type="button" className="oc-btn" onClick={() => vscode.postMessage({ type: "navigateSession", sessionID: navigation.parent!.id })}>Parent</button> : null}
        {navigation.prev ? <button type="button" className="oc-btn" onClick={() => vscode.postMessage({ type: "navigateSession", sessionID: navigation.prev!.id })}>Prev</button> : null}
        {navigation.next ? <button type="button" className="oc-btn" onClick={() => vscode.postMessage({ type: "navigateSession", sessionID: navigation.next!.id })}>Next</button> : null}
      </div>
    </section>
  )
}

function SubagentNotice() {
  return (
    <section className="oc-dock">
      <div className="oc-dockHeader">
        <span className="oc-kicker">subagent</span>
        <span className="oc-dockTitle">Read-only session</span>
      </div>
      <div className="oc-dockText">Upstream TUI hides the composer for child sessions. This tab follows that behavior.</div>
    </section>
  )
}

function PartView({ part, active = false, diffMode = "unified" }: { part: MessagePart; active?: boolean; diffMode?: "unified" | "split" }) {
  const meta = partMeta(part)

  if (part.type === "text") {
    return (
      <section className="oc-part oc-part-text oc-part-inline">
        <MarkdownBlock content={part.text || ""} />
      </section>
    )
  }

  if (part.type === "reasoning") {
    return (
      <section className="oc-part oc-part-reasoning">
        <MarkdownBlock className="is-subtle" content={`_Thinking:_ ${cleanReasoning(part.text || "")}`} />
      </section>
    )
  }

  if (part.type === "tool") {
    return <ToolPartView part={part} active={active} diffMode={diffMode} />
  }

  if (isDividerPart(part)) {
    return <DividerPartView part={part} />
  }

  if (part.type === "file") {
    return (
      <section className="oc-part oc-part-file oc-part-compact">
        <div className="oc-attachmentRow">
          <span className="oc-pill oc-pill-file">{part.filename || fileLabel(part.url)}</span>
          {part.mime ? <span className="oc-pill oc-pill-file">{part.mime}</span> : null}
        </div>
      </section>
    )
  }

  return (
    <section className={`oc-part oc-part-${part.type}`}>
      <div className="oc-partHeader">
        <span className="oc-kicker">{partTitle(part)}</span>
        {meta ? <span className="oc-partMeta">{meta}</span> : null}
      </div>
      {renderPartBody(part)}
    </section>
  )
}

function ToolPartView({ part, active = false, diffMode = "unified" }: { part: Extract<MessagePart, { type: "tool" }>; active?: boolean; diffMode?: "unified" | "split" }) {
  if (part.tool === "bash" && !bashHasPanel(part)) {
    return <ToolRow part={part} active={active} />
  }

  if (part.tool === "bash") {
    return <ToolShellPanel part={part} active={active} />
  }

  if (part.tool === "websearch" || part.tool === "codesearch") {
    return <ToolRow part={part} active={active} />
  }

  const variant = toolVariant(part.tool)

  if (variant === "row") {
    return <ToolRow part={part} active={active} />
  }

  if (variant === "files") {
    return <ToolFilesPanel part={part} active={active} diffMode={diffMode} />
  }

  if (variant === "links") {
    return <ToolLinksPanel part={part} active={active} />
  }

  if (variant === "todos") {
    return <ToolTodosPanel part={part} active={active} />
  }

  if (variant === "question") {
    return <ToolQuestionPanel part={part} active={active} />
  }

  return <ToolTextPanel part={part} active={active} />
}

function ToolRow({ part, active = false }: { part: Extract<MessagePart, { type: "tool" }>; active?: boolean }) {
  if (part.tool === "task") {
    return <TaskToolRow part={part} active={active} />
  }

  const details = toolDetails(part)
  const childSessionID = toolChildSessionId(part)
  const workspaceDir = useWorkspaceDir()
  const title = toolRowTitle(part, details)
  const subtitle = toolRowSubtitle(part, details, workspaceDir)
  const summary = toolRowSummary(part)
  const extras = toolRowExtras(part)
  return (
    <section className={`oc-toolRowWrap oc-toolRowWrap-${part.tool}${active ? " is-active" : ""}${part.state?.status === "completed" ? " is-completed" : ""}`}>
      <div className="oc-toolRow">
        <div className="oc-toolRowMain">
          <span className="oc-kicker">{toolLabel(part.tool)}</span>
          <span className="oc-toolRowTitle">{title}</span>
          {part.tool === "task" ? <span className="oc-pill oc-pill-file">Subagent</span> : null}
        </div>
        <div className="oc-toolRowMeta">
          {subtitle ? <span className="oc-partMeta">{subtitle}</span> : null}
          {summary ? <span className="oc-toolRowSummary">{summary}</span> : null}
          {childSessionID ? <button type="button" className="oc-inlineLinkBtn" onClick={() => vscode.postMessage({ type: "navigateSession", sessionID: childSessionID })}>Open child</button> : null}
          <ToolStatus state={part.state?.status} />
        </div>
      </div>
      {extras.length > 0 ? (
        <div className="oc-toolRowExtras">
          {extras.map((item) => <div key={item} className="oc-toolRowExtra">↳ {item}</div>)}
        </div>
      ) : null}
    </section>
  )
}

function TaskToolRow({ part, active = false }: { part: Extract<MessagePart, { type: "tool" }>; active?: boolean }) {
  const childSessionID = toolChildSessionId(part)
  const agentName = taskAgentName(part)
  const child = useChildMessages()
  const sessions = useChildSessions()
  const title = taskSessionTitle(part, sessions[childSessionID])
  const body = taskBody(part, child[childSessionID] || [])
  const clickable = !!childSessionID

  const content = (
    <>
      <div className="oc-taskRow">
        <div className="oc-taskLine oc-taskLinePrimary">
          <span className="oc-agentSwatch" style={{ background: agentColor(agentName) }} />
          <span className="oc-taskAgent">{agentName}</span>
          <span className="oc-taskColon">:</span>
          <span className="oc-taskSessionTitle">{title}</span>
          <ToolStatus state={part.state?.status} />
        </div>
        {body ? <div className="oc-taskLine oc-taskLineSecondary"><span className="oc-taskBranch">└</span><span className="oc-taskBody">{body}</span></div> : null}
      </div>
    </>
  )

  if (clickable) {
    return (
      <button
        type="button"
        className={`oc-toolRowWrap oc-toolRowBtn oc-toolRowBtn-task${active ? " is-active" : ""}${part.state?.status === "completed" ? " is-completed" : ""}`}
        onClick={() => vscode.postMessage({ type: "navigateSession", sessionID: childSessionID })}
      >
        {content}
      </button>
    )
  }

  return <section className={`oc-toolRowWrap oc-toolRowWrap-task${active ? " is-active" : ""}${part.state?.status === "completed" ? " is-completed" : ""}`}>{content}</section>
}

function ToolTextPanel({ part, active = false }: { part: Extract<MessagePart, { type: "tool" }>; active?: boolean }) {
  const details = toolDetails(part)
  const body = toolTextBody(part)
  const [expanded, setExpanded] = React.useState(() => defaultToolExpanded(part, active, !!body))
  const status = part.state?.status || "pending"

  React.useEffect(() => {
    if (status === "running" || status === "pending" || status === "error" || active) {
      setExpanded(true)
    }
  }, [active, status])

  return (
    <section className={`oc-part oc-part-tool oc-toolPanel oc-toolPanel-${part.tool}${active ? " is-active" : ""}${status === "completed" ? " is-completed" : ""}`}>
      <button type="button" className="oc-toolTrigger" onClick={() => setExpanded((current: boolean) => !current)}>
        <div className="oc-partHeader">
          <div className="oc-toolHeaderMain">
            <span className="oc-kicker">{toolLabel(part.tool)}</span>
            <span className="oc-toolPanelTitle">{details.title}</span>
          </div>
          <div className="oc-toolHeaderMeta">
            {details.subtitle ? <span className="oc-partMeta">{details.subtitle}</span> : null}
            <ToolStatus state={part.state?.status} />
          </div>
        </div>
      </button>
      {expanded && details.args.length > 0 ? (
        <div className="oc-attachmentRow">
          {details.args.map((item) => <span key={item} className="oc-pill oc-pill-file">{item}</span>)}
        </div>
      ) : null}
      {expanded && body ? <pre className="oc-partTerminal">{body}</pre> : null}
    </section>
  )
}

function ToolShellPanel({ part, active = false }: { part: Extract<MessagePart, { type: "tool" }>; active?: boolean }) {
  const details = toolDetails(part)
  const body = toolTextBody(part)
  const status = part.state?.status || "pending"
  return (
    <OutputWindow
      action={toolLabel(part.tool)}
      title={details.title}
      running={status === "running"}
      lineCount={normalizedLineCount(body)}
      className={active ? "is-active" : ""}
    >
      <pre className="oc-outputWindowContent oc-outputWindowContent-shell">{body || " "}</pre>
    </OutputWindow>
  )
}

function ToolLinksPanel({ part, active = false }: { part: Extract<MessagePart, { type: "tool" }>; active?: boolean }) {
  const details = toolDetails(part)
  const links = uniqueStrings(extractUrls(part.state?.output || ""))
  const status = part.state?.status || "pending"
  const [expanded, setExpanded] = React.useState(() => defaultToolExpanded(part, active, links.length > 0))

  React.useEffect(() => {
    if (status === "running" || status === "pending" || status === "error" || active) {
      setExpanded(true)
    }
  }, [active, status])

  return (
    <section className={`oc-part oc-part-tool oc-toolPanel${active ? " is-active" : ""}${status === "completed" ? " is-completed" : ""}`}>
      <button type="button" className="oc-toolTrigger" onClick={() => setExpanded((current: boolean) => !current)}>
        <div className="oc-partHeader">
          <div className="oc-toolHeaderMain">
            <span className="oc-kicker">{toolLabel(part.tool)}</span>
            <span className="oc-toolPanelTitle">{details.title}</span>
          </div>
          <div className="oc-toolHeaderMeta">
            {details.subtitle ? <span className="oc-partMeta">{details.subtitle}</span> : null}
            <ToolStatus state={part.state?.status} />
          </div>
        </div>
      </button>
      {expanded && links.length > 0 ? (
        <div className="oc-linkList">
          {links.map((item) => <a key={item} className="oc-linkItem" href={item}>{item}</a>)}
        </div>
      ) : null}
    </section>
  )
}

function ToolFilesPanel({ part, active = false, diffMode = "unified" }: { part: Extract<MessagePart, { type: "tool" }>; active?: boolean; diffMode?: "unified" | "split" }) {
  if (part.tool === "write") {
    return <ToolWritePanel part={part} active={active} />
  }

  if (part.tool === "edit") {
    return <ToolEditPanel part={part} active={active} diffMode={diffMode} />
  }

  if (part.tool === "apply_patch") {
    return <ToolApplyPatchPanel part={part} active={active} diffMode={diffMode} />
  }

  const details = toolDetails(part)
  const files = toolFiles(part)
  const status = part.state?.status || "pending"
  const [expanded, setExpanded] = React.useState(() => defaultToolExpanded(part, active, files.length > 0 || !!toolTextBody(part)))

  React.useEffect(() => {
    if (status === "running" || status === "pending" || status === "error" || active) {
      setExpanded(true)
    }
  }, [active, status])

  return (
    <section className={`oc-part oc-part-tool oc-toolPanel oc-toolPanel-files${active ? " is-active" : ""}${status === "completed" ? " is-completed" : ""}`}>
      <button type="button" className="oc-toolTrigger" onClick={() => setExpanded((current: boolean) => !current)}>
        <div className="oc-partHeader">
          <div className="oc-toolHeaderMain">
            <span className="oc-kicker">{toolLabel(part.tool)}</span>
            <span className="oc-toolPanelTitle">{details.title}</span>
          </div>
          <div className="oc-toolHeaderMeta">
            {details.subtitle ? <span className="oc-partMeta">{details.subtitle}</span> : null}
            <ToolStatus state={part.state?.status} />
          </div>
        </div>
      </button>
      {expanded && files.length > 0 ? (
        <div className="oc-fileToolList">
          {files.map((item) => (
            <div key={`${item.path}:${item.summary}`} className="oc-fileToolItem">
              <div className="oc-fileToolPath">{item.path}</div>
              {item.summary ? <div className="oc-fileToolSummary">{item.summary}</div> : null}
            </div>
          ))}
        </div>
      ) : null}
      {expanded && files.length === 0 && toolTextBody(part) ? <pre className="oc-partTerminal">{toolTextBody(part)}</pre> : null}
    </section>
  )
}

function ToolWritePanel({ part, active = false }: { part: Extract<MessagePart, { type: "tool" }>; active?: boolean }) {
  const details = toolDetails(part)
  const status = part.state?.status || "pending"
  const content = toolWriteContent(part)
  const [expanded, setExpanded] = React.useState(() => defaultToolExpanded(part, active, !!content))

  React.useEffect(() => {
    if (status === "running" || status === "pending" || status === "error" || active) {
      setExpanded(true)
    }
  }, [active, status])

  return (
    <section className={`oc-part oc-part-tool oc-toolPanel oc-toolPanel-files${active ? " is-active" : ""}${status === "completed" ? " is-completed" : ""}`}>
      <button type="button" className="oc-toolTrigger" onClick={() => setExpanded((current: boolean) => !current)}>
        <div className="oc-partHeader">
          <div className="oc-toolHeaderMain">
            <span className="oc-kicker">{toolLabel(part.tool)}</span>
            <span className="oc-toolPanelTitle">{details.title}</span>
          </div>
          <div className="oc-toolHeaderMeta">
            {details.subtitle ? <span className="oc-partMeta">{details.subtitle}</span> : null}
            <ToolStatus state={part.state?.status} />
          </div>
        </div>
      </button>
      {expanded && content ? <CodeBlock value={content} filePath={details.title} /> : null}
      {expanded && !content && toolTextBody(part) ? <pre className="oc-partTerminal">{toolTextBody(part)}</pre> : null}
      {expanded && toolDiagnostics(part).length > 0 ? <DiagnosticsList items={toolDiagnostics(part)} /> : null}
    </section>
  )
}

function ToolEditPanel({ part, active = false, diffMode = "unified" }: { part: Extract<MessagePart, { type: "tool" }>; active?: boolean; diffMode?: "unified" | "split" }) {
  const details = toolDetails(part)
  const status = part.state?.status || "pending"
  const diff = toolEditDiff(part)
  const [expanded, setExpanded] = React.useState(() => defaultToolExpanded(part, active, !!diff || !!toolTextBody(part)))

  React.useEffect(() => {
    if (status === "running" || status === "pending" || status === "error" || active) {
      setExpanded(true)
    }
  }, [active, status])

  return (
    <section className={`oc-part oc-part-tool oc-toolPanel oc-toolPanel-files${active ? " is-active" : ""}${status === "completed" ? " is-completed" : ""}`}>
      <button type="button" className="oc-toolTrigger" onClick={() => setExpanded((current: boolean) => !current)}>
        <div className="oc-partHeader">
          <div className="oc-toolHeaderMain">
            <span className="oc-kicker">{toolLabel(part.tool)}</span>
            <span className="oc-toolPanelTitle">{details.title}</span>
          </div>
          <div className="oc-toolHeaderMeta">
            {details.subtitle ? <span className="oc-partMeta">{details.subtitle}</span> : null}
            <ToolStatus state={part.state?.status} />
          </div>
        </div>
      </button>
      {expanded && diff ? <DiffBlock value={diff} mode={diffMode} /> : null}
      {expanded && !diff && toolTextBody(part) ? <pre className="oc-partTerminal">{toolTextBody(part)}</pre> : null}
      {expanded && toolDiagnostics(part).length > 0 ? <DiagnosticsList items={toolDiagnostics(part)} /> : null}
    </section>
  )
}

function ToolApplyPatchPanel({ part, active = false, diffMode = "unified" }: { part: Extract<MessagePart, { type: "tool" }>; active?: boolean; diffMode?: "unified" | "split" }) {
  const status = part.state?.status || "pending"
  const files = patchFiles(part)

  return (
    <section className={`oc-patchPanel${active ? " is-active" : ""}${status === "completed" ? " is-completed" : ""}`}>
      {files.length > 0 ? (
        <div className="oc-patchList">
          {files.map((item) => (
            <section key={`${item.path}:${item.type}:${item.summary}`} className="oc-patchItem">
              <OutputWindow
                action={item.type}
                title={item.path}
                running={status === "running"}
                lineCount={item.diff ? diffOutputLineCount(item.diff, diffMode) : normalizedLineCount(item.summary)}
                className="oc-outputWindow-patch"
              >
                {item.diff
                  ? <DiffWindowBody value={item.diff} mode={diffMode} filePath={item.path} />
                  : <pre className="oc-outputWindowContent oc-outputWindowContent-shell">{item.summary || " "}</pre>}
              </OutputWindow>
            </section>
          ))}
        </div>
      ) : null}
      {files.length === 0 && toolTextBody(part) ? <pre className="oc-partTerminal">{toolTextBody(part)}</pre> : null}
      {toolDiagnostics(part).length > 0 ? <DiagnosticsList items={toolDiagnostics(part)} /> : null}
    </section>
  )
}

function CodeBlock({ value, filePath }: { value: string; filePath?: string }) {
  const html = React.useMemo(() => highlightCode(value, codeLanguage(filePath)), [filePath, value])
  return <pre className="oc-codeBlock"><code dangerouslySetInnerHTML={{ __html: html }} /></pre>
}

function DiffBlock({ value, mode = "unified" }: { value: string; mode?: "unified" | "split" }) {
  return <DiffBlockImpl value={value} mode={mode} />
}

function DiffWindowBody({ value, mode = "unified", filePath }: { value: string; mode?: "unified" | "split"; filePath?: string }) {
  return <DiffBlockImpl value={value} mode={mode} windowed filePath={filePath} />
}

function DiffBlockImpl({ value, mode, windowed = false, filePath }: { value: string; mode: "unified" | "split"; windowed?: boolean; filePath?: string }) {
  if (mode === "split") {
    return <SplitDiffBlock value={value} windowed={windowed} filePath={filePath} />
  }
  const rows = React.useMemo(() => parseUnifiedDiffRows(value), [value])
  const language = React.useMemo(() => codeLanguage(filePath), [filePath])
  return (
    <div className={`oc-diffBlock${windowed ? " is-window" : ""}`}>
      {rows.map((row, index) => (
        <div key={`${index}:${row.oldLine ?? ""}:${row.newLine ?? ""}:${row.marker}:${row.text}`} className={diffRowClass(row.type)}>
          <span className="oc-diffLineNo">{formatDiffLineNumber(row.oldLine)}</span>
          <span className="oc-diffLineNo">{formatDiffLineNumber(row.newLine)}</span>
          <span className="oc-diffLineMarker">{row.marker}</span>
          <DiffCodeText text={row.text} language={language} />
        </div>
      ))}
    </div>
  )
}

function SplitDiffBlock({ value, windowed = false, filePath }: { value: string; windowed?: boolean; filePath?: string }) {
  const rows = React.useMemo(() => splitDiffRows(value), [value])
  const language = React.useMemo(() => codeLanguage(filePath), [filePath])
  return (
    <div className={`oc-splitDiff${windowed ? " is-window" : ""}`}>
      <div className="oc-splitDiffBody">
        {rows.map((row, index) => (
          <React.Fragment key={`${index}:${row.left}:${row.right}`}>
            <div className={splitDiffClass(row.leftType)}>
              <span className="oc-diffLineNo">{formatDiffLineNumber(row.leftLine)}</span>
              <span className="oc-diffLineMarker">{row.leftMarker}</span>
              <DiffCodeText text={row.left} language={language} />
            </div>
            <div className={splitDiffClass(row.rightType)}>
              <span className="oc-diffLineNo">{formatDiffLineNumber(row.rightLine)}</span>
              <span className="oc-diffLineMarker">{row.rightMarker}</span>
              <DiffCodeText text={row.right} language={language} />
            </div>
          </React.Fragment>
        ))}
      </div>
    </div>
  )
}

function DiffCodeText({ text, language }: { text: string; language: string }) {
  const html = React.useMemo(() => highlightCode(text || " ", language), [language, text])
  return <span className="oc-diffLineText hljs" dangerouslySetInnerHTML={{ __html: html }} />
}

function DiagnosticsList({ items }: { items: string[] }) {
  return (
    <div className="oc-diagnosticsList">
      {items.map((item) => <div key={item} className="oc-diagnosticItem">{item}</div>)}
    </div>
  )
}

function ToolTodosPanel({ part, active = false }: { part: Extract<MessagePart, { type: "tool" }>; active?: boolean }) {
  const details = toolDetails(part)
  const todos = toolTodos(part)
  const status = part.state?.status || "pending"
  return (
    <section className={`oc-part oc-part-tool oc-toolPanel oc-toolPanel-todos${active ? " is-active" : ""}${status === "completed" ? " is-completed" : ""}`}>
      <div className="oc-partHeader">
        <div className="oc-toolHeaderMain">
          <span className="oc-kicker">to-dos</span>
          <span className="oc-toolPanelTitle">{details.title}</span>
        </div>
        <div className="oc-toolHeaderMeta">
          {details.subtitle ? <span className="oc-partMeta">{details.subtitle}</span> : null}
            <ToolStatus state={part.state?.status} />
          </div>
        </div>
      {todos.length > 0 ? (
        <div className="oc-toolTodoList">
          {todos.map((item) => <div key={`${item.status}:${item.content}`} className={`oc-toolTodoItem is-${item.status}`}>{todoMarker(item.status)} {item.content}</div>)}
        </div>
      ) : status === "running" || status === "pending" ? <div className="oc-partEmpty">Updating todos...</div> : null}
    </section>
  )
}

function ToolQuestionPanel({ part, active = false }: { part: Extract<MessagePart, { type: "tool" }>; active?: boolean }) {
  const details = toolDetails(part)
  const answers = stringList(part.state?.metadata?.answers)
  const status = part.state?.status || "pending"
  return (
    <section className={`oc-part oc-part-tool oc-toolPanel${active ? " is-active" : ""}${status === "completed" ? " is-completed" : ""}`}>
      <div className="oc-partHeader">
        <div className="oc-toolHeaderMain">
          <span className="oc-kicker">questions</span>
          <span className="oc-toolPanelTitle">{details.title}</span>
        </div>
        <div className="oc-toolHeaderMeta">
          {details.subtitle ? <span className="oc-partMeta">{details.subtitle}</span> : null}
            <ToolStatus state={part.state?.status} />
          </div>
        </div>
      {answers.length > 0 ? <div className="oc-toolAnswerList">{answers.map((item) => <div key={item} className="oc-toolAnswerItem">{item}</div>)}</div> : null}
    </section>
  )
}

function DividerPartView({ part }: { part: MessagePart }) {
  return (
    <div className={`oc-dividerPart oc-dividerPart-${part.type}`}>
      <span className="oc-dividerLine" />
      <span className="oc-dividerText">{dividerText(part)}</span>
      <span className="oc-dividerLine" />
    </div>
  )
}

function renderPartBody(part: MessagePart) {
  if (part.type === "tool") {
    return <pre className="oc-partTerminal">{toolTextBody(part)}</pre>
  }

  if (part.type === "patch") {
    const files = stringList((part as Record<string, unknown>).files)
    return files.length > 0
      ? <ul className="oc-list">{files.map((file) => <li key={file}>{file}</li>)}</ul>
      : <div className="oc-partEmpty">Patch created.</div>
  }

  if (part.type === "subtask") {
    return <MarkdownBlock content={textValue((part as Record<string, unknown>).description) || textValue((part as Record<string, unknown>).prompt) || ""} />
  }

  if (part.type === "snapshot") {
    return <pre className="oc-partTerminal">{textValue((part as Record<string, unknown>).snapshot) || "Workspace snapshot updated."}</pre>
  }

  if (part.type === "retry") {
    const error = (part as Record<string, unknown>).error
    return <pre className="oc-partTerminal">{retryText(error)}</pre>
  }

  if (part.type === "agent") {
    return <MarkdownBlock content={textValue((part as Record<string, unknown>).name) || "Agent task"} />
  }

  if (part.type === "compaction") {
    return <MarkdownBlock content={(part as Record<string, unknown>).auto ? "Automatic compaction completed." : "Compaction completed."} />
  }

  return <div className="oc-partEmpty">{partTitle(part)}</div>
}

function EmptyState({ title, text }: { title: string; text: string }) {
  return (
    <div className="oc-emptyWrap">
      <section className="oc-emptyState">
        <div className="oc-kicker">session</div>
        <h2 className="oc-emptyTitle">{title}</h2>
        <p className="oc-emptyText">{text}</p>
      </section>
    </div>
  )
}

function MarkdownBlock({ content, className = "" }: { content: string; className?: string }) {
  const html = React.useMemo(() => markdown.render(content || ""), [content])
  return (
    <div
      className={`oc-markdown${className ? ` ${className}` : ""}`}
      dangerouslySetInnerHTML={{ __html: html }}
      onClick={(event) => {
        const target = event.target
        if (!(target instanceof Element)) {
          return
        }
        const button = target.closest("[data-copy-code]")
        if (!(button instanceof HTMLButtonElement)) {
          return
        }
        const value = button.getAttribute("data-copy-code") || ""
        if (!value) {
          return
        }
        event.preventDefault()
        event.stopPropagation()
        button.blur()
        const timer = copyTipTimers.get(button)
        if (timer) {
          window.clearTimeout(timer)
        }
        button.setAttribute("data-copied", "true")
        copyTipTimers.set(button, window.setTimeout(() => {
          button.removeAttribute("data-copied")
          copyTipTimers.delete(button)
        }, 1200))
        void copyText(value)
      }}
    />
  )
}

function sessionTitle(bootstrap: SessionBootstrap) {
  return bootstrap.session?.title || bootstrap.sessionRef.sessionId?.slice(0, 8) || "session"
}

function buildTimelineBlocks(messages: SessionMessage[], options: { showThinking: boolean; showInternals: boolean }) {
  const blocks: TimelineBlock[] = []
  let assistants: SessionMessage[] = []

  const flush = () => {
    const meta = assistantTurnMeta(assistants)
    if (meta) {
      blocks.push({
        kind: "assistant-meta",
        key: `meta:${assistants[0]?.info.id || assistants.length}`,
        text: meta,
      })
    }
    assistants = []
  }

  for (const message of messages) {
    if (message.info.role === "user") {
      flush()
      blocks.push({
        kind: "user-message",
        key: `user:${message.info.id}`,
        message,
      })
      continue
    }

    const parts = message.parts.filter((part) => visibleAssistantPart(part, options))
    for (const part of parts) {
      blocks.push({
        kind: "assistant-part",
        key: `part:${part.id}`,
        part,
      })
    }
    assistants.push(message)
  }

  flush()

  return blocks
}

function primaryUserText(message: SessionMessage) {
  return message.parts.find((part): part is TextPart => part.type === "text" && !part.synthetic && !part.ignored)
}

function userAttachments(message: SessionMessage) {
  return message.parts.filter((part): part is FilePart => part.type === "file")
}

function latestActiveToolId(parts: MessagePart[]) {
  for (let i = parts.length - 1; i >= 0; i -= 1) {
    const part = parts[i]
    if (part?.type === "tool" && part.state?.status !== "completed") {
      return part.id
    }
  }
  return ""
}

function assistantSummary(messages: SessionMessage[]) {
  if (messages.length === 0) {
    return ""
  }

  const first = messages[0]?.info
  const last = messages[messages.length - 1]?.info
  const parts: string[] = []
  const finish = lastStepFinish(messages)

  const model = assistantModel(last)
  if (model) {
    parts.push(model)
  }

  const duration = assistantDuration(first, last)
  if (duration) {
    parts.push(duration)
  }

  const tokenSummary = assistantTokens(last)
  if (tokenSummary) {
    parts.push(tokenSummary)
  }

  if (typeof last?.cost === "number" && Number.isFinite(last.cost)) {
    parts.push(`$${last.cost.toFixed(4)}`)
  }

  if (finish) {
    const reason = textValue(finish.reason)
    if (reason) {
      parts.push(reason)
    }
  }

  return parts.join(" · ")
}

function assistantTurnMeta(messages: SessionMessage[]) {
  if (messages.length === 0) {
    return ""
  }

  const parts: string[] = []
  const first = messages[0]?.info
  const agent = first?.agent?.trim()
  const created = formatTime(first?.time?.created)
  const summary = assistantSummary(messages)

  if (agent) {
    parts.push(agent)
  }
  if (created) {
    parts.push(created)
  }
  if (summary) {
    parts.push(summary)
  }

  return parts.join(" · ")
}

function lastStepFinish(messages: SessionMessage[]) {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const parts = messages[i]?.parts || []
    for (let j = parts.length - 1; j >= 0; j -= 1) {
      const part = parts[j]
      if (part?.type === "step-finish") {
        return part as Record<string, unknown>
      }
    }
  }
}

type PartBucket = "primary" | "secondary" | "divider" | "hidden"

function partBucket(part: MessagePart, options: { showThinking: boolean; showInternals: boolean }): PartBucket {
  if (part.type === "text") {
    return part.text?.trim() && !part.synthetic && !part.ignored ? "primary" : "hidden"
  }

  if (part.type === "reasoning") {
    return options.showThinking && cleanReasoning(part.text || "").trim() ? "secondary" : "hidden"
  }

  if (part.type === "tool" || part.type === "file") {
    return "secondary"
  }

  if (part.type === "step-start") {
    return "hidden"
  }

  if (part.type === "compaction" || part.type === "retry" || part.type === "agent" || part.type === "subtask") {
    return "divider"
  }

  if (part.type === "step-finish" || part.type === "snapshot" || part.type === "patch") {
    return options.showInternals ? "secondary" : "hidden"
  }

  return options.showInternals ? "secondary" : "hidden"
}

function visibleAssistantPart(part: MessagePart, options: { showThinking: boolean; showInternals: boolean }) {
  return partBucket(part, options) !== "hidden"
}

function assistantModel(info?: MessageInfo) {
  const modelID = info?.model?.modelID?.trim()
  const providerID = info?.model?.providerID?.trim()
  if (modelID && providerID) {
    return `${providerID}/${modelID}`
  }
  return modelID || providerID || ""
}

function assistantDuration(first?: MessageInfo, last?: MessageInfo) {
  const start = first?.time?.created
  const end = last?.time?.completed
  if (typeof start !== "number" || typeof end !== "number" || end < start) {
    return ""
  }

  const seconds = Math.max(0, Math.round((end - start) / 1000))
  return formatDuration(seconds)
}

function assistantTokens(info?: MessageInfo) {
  const output = info?.tokens?.output
  const reasoning = info?.tokens?.reasoning
  const tokens: string[] = []

  if (typeof output === "number" && output > 0) {
    tokens.push(`${output} out`)
  }
  if (typeof reasoning === "number" && reasoning > 0) {
    tokens.push(`${reasoning} reasoning`)
  }

  return tokens.join(" · ")
}

function toolVariant(tool: string): ToolDisplayVariant {
  if (tool === "read" || tool === "webfetch" || tool === "task" || tool === "skill" || tool === "glob" || tool === "grep" || tool === "list" || tool === "websearch" || tool === "codesearch") {
    return "row"
  }
  if (tool === "write" || tool === "edit" || tool === "apply_patch") {
    return "files"
  }
  if (tool === "todowrite") {
    return "todos"
  }
  if (tool === "question") {
    return "question"
  }
  return "panel"
}

function toolLabel(tool: string) {
  if (tool === "bash") {
    return "shell"
  }
  if (tool === "todowrite") {
    return "to-dos"
  }
  return tool || "tool"
}

function toolDetails(part: Extract<MessagePart, { type: "tool" }>): ToolDetails {
  const input = recordValue(part.state?.input)
  const metadata = recordValue(part.state?.metadata)
  const title = part.tool === "apply_patch"
    ? defaultToolTitle(part.tool, input, metadata)
    : stringValue(part.state?.title) || defaultToolTitle(part.tool, input, metadata)
  const subtitle = defaultToolSubtitle(part.tool, input, metadata)
  const args = defaultToolArgs(part.tool, input)
  return { title, subtitle, args }
}

function defaultToolTitle(tool: string, input: Record<string, unknown>, metadata: Record<string, unknown>) {
  if (tool === "bash") {
    return stringValue(input.description) || "Shell command"
  }
  if (tool === "task") {
    return stringValue(input.description) || `${capitalize(stringValue(input.subagent_type) || "task")} task`
  }
  if (tool === "webfetch") {
    return stringValue(input.url) || "Web fetch"
  }
  if (tool === "websearch" || tool === "codesearch") {
    return stringValue(input.query) || capitalize(tool)
  }
  if (tool === "read") {
    return stringValue(input.filePath) || stringValue(input.path) || "Read"
  }
  if (tool === "list") {
    return stringValue(input.path) || "List directory"
  }
  if (tool === "glob" || tool === "grep") {
    return stringValue(input.path) || capitalize(tool)
  }
  if (tool === "apply_patch") {
    return "Patch"
  }
  if (tool === "write" || tool === "edit") {
    return stringValue(input.filePath) || stringValue(input.path) || stringValue(metadata.filepath) || capitalize(tool)
  }
  if (tool === "todowrite") {
    const todos = toolTodosFromMetadata(metadata)
    return todos.length > 0 ? `${todos.filter((item) => item.status === "completed").length}/${todos.length}` : "Updating todos"
  }
  if (tool === "question") {
    const questions = numberValue(metadata.count) || stringList(metadata.questions).length
    return questions > 0 ? `${questions} question${questions === 1 ? "" : "s"}` : "Questions"
  }
  if (tool === "skill") {
    return stringValue(input.name) || "Skill"
  }
  return capitalize(tool)
}

function defaultToolSubtitle(tool: string, input: Record<string, unknown>, metadata: Record<string, unknown>) {
  if (tool === "bash") {
    return stringValue(input.command)
  }
  if (tool === "task") {
    return stringValue(metadata.sessionID) || stringValue(input.subagent_type)
  }
  if (tool === "webfetch") {
    return stringValue(input.url)
  }
  if (tool === "websearch" || tool === "codesearch") {
    return stringValue(input.query)
  }
  if (tool === "read" || tool === "list" || tool === "glob" || tool === "grep") {
    return stringValue(input.path) || stringValue(input.filePath)
  }
  if (tool === "write" || tool === "edit" || tool === "apply_patch") {
    return stringValue(metadata.directory) || parentDir(stringValue(input.filePath) || stringValue(input.path) || stringValue(metadata.filepath))
  }
  if (tool === "skill") {
    return stringValue(input.name)
  }
  return ""
}

function defaultToolArgs(tool: string, input: Record<string, unknown>) {
  const args: string[] = []
  if (tool === "glob" || tool === "grep") {
    const pattern = stringValue(input.pattern)
    if (pattern) {
      args.push(`pattern=${pattern}`)
    }
  }
  if (tool === "grep") {
    const include = stringValue(input.include)
    if (include) {
      args.push(`include=${include}`)
    }
  }
  if (tool === "read") {
    const offset = numberValue(input.offset)
    const limit = numberValue(input.limit)
    if (offset > 0) {
      args.push(`offset=${offset}`)
    }
    if (limit > 0) {
      args.push(`limit=${limit}`)
    }
  }
  return args
}

function toolTextBody(part: Extract<MessagePart, { type: "tool" }>) {
  const lines: string[] = []
  const input = recordValue(part.state?.input)
  const metadata = recordValue(part.state?.metadata)
  if (part.tool === "bash") {
    const command = stringValue(input.command)
    if (command) {
      lines.push(`$ ${command}`)
    }
    const output = stringValue(metadata.output) || part.state?.output || ""
    if (output) {
      lines.push(output)
    }
    if (part.state?.error) {
      lines.push(part.state.error)
    }
    return lines.join("\n\n")
  }
  if (part.state?.output) {
    lines.push(part.state.output)
  }
  if (part.state?.error) {
    lines.push(part.state.error)
  }
  if (lines.length === 0) {
    if (Object.keys(metadata).length > 0) {
      lines.push(JSON.stringify(metadata, null, 2))
    }
  }
  return lines.join("\n\n")
}

function defaultToolExpanded(part: Extract<MessagePart, { type: "tool" }>, active: boolean, hasBody: boolean) {
  const status = part.state?.status || "pending"
  if (active || status === "running" || status === "pending" || status === "error") {
    return true
  }
  if (part.tool === "bash" || part.tool === "apply_patch") {
    return true
  }
  if (part.tool === "bash" || part.tool === "edit" || part.tool === "write" || part.tool === "apply_patch") {
    return hasBody && status !== "completed"
  }
  return false
}

function bashHasPanel(part: Extract<MessagePart, { type: "tool" }>) {
  const metadata = recordValue(part.state?.metadata)
  return !!(stringValue(metadata.output) || part.state?.output || part.state?.error)
}

function toolRowTitle(part: Extract<MessagePart, { type: "tool" }>, details: ToolDetails) {
  const input = recordValue(part.state?.input)
  if (part.tool === "read") {
    const path = stringValue(input.filePath) || stringValue(input.path)
    const items: string[] = [fileLabel(path) || details.title]
    const offset = numberValue(input.offset)
    const limit = numberValue(input.limit)
    const args: string[] = []
    if (offset > 0) {
      args.push(`offset=${offset}`)
    }
    if (limit > 0) {
      args.push(`limit=${limit}`)
    }
    if (args.length > 0) {
      items.push(`[${args.join(", ")}]`)
    }
    return items.join(" ")
  }
  if (part.tool === "bash") {
    return stringValue(input.command) || details.title
  }
  if (part.tool === "websearch" || part.tool === "codesearch") {
    const query = stringValue(input.query)
    return query || details.title
  }
  if (part.tool === "glob" || part.tool === "grep") {
    const pattern = stringValue(input.pattern)
    return pattern || details.title
  }
  if (part.tool === "list") {
    return details.title
  }
  return details.title
}

function toolRowSubtitle(part: Extract<MessagePart, { type: "tool" }>, details: ToolDetails, workspaceDir = "") {
  const input = recordValue(part.state?.input)
  if (part.tool === "grep" || part.tool === "glob") {
    const rawPath = stringValue(input.path) || stringValue(input.filePath)
    const relPath = relativeWorkspacePath(rawPath, workspaceDir)
    return relPath ? `in ${relPath}` : ""
  }
  if (part.tool === "read") {
    return ""
  }
  if (part.tool === "bash") {
    return stringValue(input.description) || details.subtitle
  }
  if (part.tool === "websearch") {
    return "Exa Web Search"
  }
  if (part.tool === "codesearch") {
    return "Exa Code Search"
  }
  if (part.tool === "glob" || part.tool === "grep" || part.tool === "list") {
    return stringValue(input.path) || details.subtitle
  }
  return details.subtitle
}

function toolRowSummary(part: Extract<MessagePart, { type: "tool" }>) {
  const metadata = recordValue(part.state?.metadata)
  if (part.tool === "glob") {
    const count = numberValue(metadata.count)
    if (count > 0) {
      return `${count} ${count === 1 ? "match" : "matches"}`
    }
  }
  if (part.tool === "grep") {
    const count = numberValue(metadata.matches)
    if (count > 0) {
      return `${count} ${count === 1 ? "match" : "matches"}`
    }
  }
  if (part.tool === "websearch") {
    const count = numberValue(metadata.numResults) || numberValue(metadata.results)
    if (count > 0) {
      return `${count} results`
    }
  }
  if (part.tool === "codesearch") {
    const count = numberValue(metadata.results) || numberValue(metadata.numResults)
    if (count > 0) {
      return `${count} results`
    }
  }
  return ""
}

function taskSummary(part: Extract<MessagePart, { type: "tool" }>, messages: SessionMessage[]) {
  const status = part.state?.status || "pending"
  if (status !== "completed") {
    return ""
  }

  const calls = childTools(messages).length
  const duration = childDuration(messages)
  const parts: string[] = []
  if (calls > 0) {
    parts.push(`${calls} tools`)
  }
  if (duration > 0) {
    parts.push(formatDuration(Math.round(duration / 1000)))
  }
  return parts.join(" · ")
}

function toolRowExtras(part: Extract<MessagePart, { type: "tool" }>) {
  const metadata = recordValue(part.state?.metadata)
  if (part.tool === "read") {
    return stringList(metadata.loaded).map((item) => `Loaded ${item}`)
  }
  return [] as string[]
}

function taskAgentName(part: Extract<MessagePart, { type: "tool" }>) {
  const input = recordValue(part.state?.input)
  const metadata = recordValue(part.state?.metadata)
  return stringValue(input.subagent_type) || stringValue(metadata.agent) || stringValue(metadata.name) || "subagent"
}

function taskSessionTitle(part: Extract<MessagePart, { type: "tool" }>, session?: SessionInfo) {
  if (session?.title?.trim()) {
    return session.title.trim()
  }

  const title = stringValue(part.state?.title) || toolDetails(part).title
  if (!title) {
    return "Task"
  }
  return title.toLowerCase().startsWith("task ") ? title : `Task ${title}`
}

function taskBody(part: Extract<MessagePart, { type: "tool" }>, messages: SessionMessage[]) {
  const status = part.state?.status || "pending"
  if (status === "completed") {
    return taskSummary(part, messages)
  }
  const calls = childTools(messages).length
  const current = childCurrentTool(messages)
  const currentTool = current ? toolLabel(current.tool) : ""
  const currentTitle = current ? stringValue(current.state?.title) : ""
  const outputLines = (part.state?.output || "")
    .split("\n")
    .map((item) => item.trim())
    .filter(Boolean)
    .filter((item) => !item.startsWith("task_id:") && item !== "<task_result>" && item !== "</task_result>")
  if (currentTool && currentTitle) {
    return `${currentTool}: ${currentTitle}`
  }
  if (currentTitle) {
    return currentTitle
  }
  if (calls > 0) {
    return `${calls} ${calls === 1 ? "tool" : "tools"}`
  }
  if (status === "running") {
    return ""
  }
  if (outputLines.length > 0) {
    return outputLines[outputLines.length - 1]
  }
  return "Queued…"
}

function childTools(messages: SessionMessage[]) {
  return messages.flatMap((message) => message.parts.filter((part): part is Extract<MessagePart, { type: "tool" }> => part.type === "tool"))
}

function childCurrentTool(messages: SessionMessage[]) {
  const tools = childTools(messages)
  for (let index = tools.length - 1; index >= 0; index -= 1) {
    const part = tools[index]
    if (stringValue(part.state?.title)) {
      return part
    }
  }
  return tools[tools.length - 1]
}

function childDuration(messages: SessionMessage[]) {
  const start = messages.find((message) => message.info.role === "user")?.info.time.created
  const end = [...messages].reverse().find((message) => message.info.role === "assistant")?.info.time.completed
  if (typeof start !== "number" || typeof end !== "number" || end < start) {
    return 0
  }
  return end - start
}

function ToolStatus({ state }: { state?: string }) {
  if (state !== "running") {
    return null
  }
  return (
    <span className="oc-toolSpinner" aria-label="running">
      <svg viewBox="0 0 16 16" aria-hidden="true">
        <circle cx="8" cy="8" r="6" className="oc-toolSpinnerTrack" />
        <path d="M 8 2 A 6 6 0 0 1 14 8" className="oc-toolSpinnerHead" />
      </svg>
    </span>
  )
}

function OutputWindow({
  action,
  title,
  running = false,
  lineCount,
  className = "",
  children,
}: {
  action: string
  title: string
  running?: boolean
  lineCount: number
  className?: string
  children: React.ReactNode
}) {
  const [expanded, setExpanded] = React.useState(false)
  const [contentHeight, setContentHeight] = React.useState(0)
  const toggleRef = React.useRef<HTMLButtonElement | null>(null)
  const scrollAdjustRef = React.useRef<{ scrollNode: HTMLElement; top: number } | null>(null)
  const contentRef = React.useRef<HTMLDivElement | null>(null)
  const collapsedHeight = React.useMemo(() => outputWindowBodyHeight(OUTPUT_WINDOW_COLLAPSED_LINES), [])
  const expandedHeight = React.useMemo(() => outputWindowBodyHeight(OUTPUT_WINDOW_EXPANDED_LINES), [])
  const collapsible = contentHeight > collapsedHeight + 1
  const scrollable = contentHeight > expandedHeight + 1

  React.useLayoutEffect(() => {
    const node = contentRef.current
    if (!node) {
      return
    }

    const measure = () => {
      const next = Math.ceil(node.scrollHeight)
      setContentHeight((current) => current === next ? current : next)
    }

    measure()

    const Observer = window.ResizeObserver
    if (!Observer) {
      return
    }

    const observer = new Observer(() => measure())
    observer.observe(node)
    return () => observer.disconnect()
  }, [children, expanded])

  const bodyStyle = React.useMemo<React.CSSProperties>(() => {
    if (!collapsible) {
      return {}
    }
    if (!expanded) {
      return { maxHeight: `${collapsedHeight}px` }
    }
    if (scrollable) {
      return { maxHeight: `${expandedHeight}px` }
    }
    return {}
  }, [collapsedHeight, collapsible, expanded, expandedHeight, scrollable])

  React.useEffect(() => {
    if (!collapsible && expanded) {
      setExpanded(false)
    }
  }, [collapsible, expanded])

  React.useLayoutEffect(() => {
    const pending = scrollAdjustRef.current
    const toggleNode = toggleRef.current
    if (!pending || !toggleNode) {
      return
    }
    const nextTop = toggleNode.getBoundingClientRect().top
    pending.scrollNode.scrollTop += nextTop - pending.top
    scrollAdjustRef.current = null
  }, [expanded])

  const bodyClassName = [
    "oc-outputWindowBody",
    collapsible ? "is-collapsible" : "",
    collapsible && expanded ? "is-expanded" : "",
    collapsible && !expanded ? "is-collapsed" : "",
    collapsible && expanded && scrollable ? "is-scrollable" : "",
  ].filter(Boolean).join(" ")

  return (
    <section className={["oc-outputWindow", className].filter(Boolean).join(" ")}>
      <div className="oc-outputWindowHead">
        <div className="oc-outputWindowTitleRow">
          <span className="oc-outputWindowAction">{action}</span>
          <span className="oc-outputWindowTitle">{title}</span>
        </div>
        <span className="oc-outputWindowSpinnerSlot">{running ? <ToolStatus state="running" /> : null}</span>
      </div>
      <div className={bodyClassName} style={bodyStyle}>
        <div ref={contentRef} className="oc-outputWindowBodyInner">{children}</div>
      </div>
      {collapsible ? (
        <button
          ref={toggleRef}
          type="button"
          className="oc-outputWindowToggle"
          aria-expanded={expanded}
          aria-label={expanded ? "Collapse output" : "Expand output"}
          onClick={(event) => {
            const toggleNode = event.currentTarget
            if (expanded) {
              const scrollNode = toggleNode.closest(".oc-transcript")
              if (scrollNode instanceof HTMLElement) {
                scrollAdjustRef.current = {
                  scrollNode,
                  top: toggleNode.getBoundingClientRect().top,
                }
              } else {
                scrollAdjustRef.current = null
              }
            } else {
              scrollAdjustRef.current = null
            }
            setExpanded((current) => !current)
          }}
        >
          <svg className="oc-outputWindowToggleIcon" viewBox="0 0 16 16" aria-hidden="true">
            {expanded
              ? <path d="M4 10l4-4 4 4" />
              : <path d="M4 6l4 4 4-4" />}
          </svg>
          <span className="oc-outputWindowToggleMeta">{formatLineCount(lineCount)}</span>
        </button>
      ) : null}
    </section>
  )
}

function splitDiffRows(value: string) {
  const rows: Array<{
    left: string
    right: string
    leftType: string
    rightType: string
    leftLine?: number
    rightLine?: number
    leftMarker: string
    rightMarker: string
  }> = []
  const hunks = parseDiffHunks(value)
  for (const hunk of hunks) {
    let oldLine = hunk.oldStart
    let newLine = hunk.newStart
    for (let index = 0; index < hunk.lines.length; index += 1) {
      const line = hunk.lines[index] || ""
      if (line.startsWith("-")) {
        const next = hunk.lines[index + 1] || ""
        if (next.startsWith("+")) {
          rows.push({
            left: line.slice(1),
            right: next.slice(1),
            leftType: "del",
            rightType: "add",
            leftLine: oldLine,
            rightLine: newLine,
            leftMarker: "-",
            rightMarker: "+",
          })
          oldLine += 1
          newLine += 1
          index += 1
          continue
        }
        rows.push({ left: line.slice(1), right: "", leftType: "del", rightType: "empty", leftLine: oldLine, leftMarker: "-", rightMarker: "" })
        oldLine += 1
        continue
      }
      if (line.startsWith("+")) {
        rows.push({ left: "", right: line.slice(1), leftType: "empty", rightType: "add", rightLine: newLine, leftMarker: "", rightMarker: "+" })
        newLine += 1
        continue
      }
      const text = line.startsWith(" ") ? line.slice(1) : line
      rows.push({
        left: text,
        right: text,
        leftType: "ctx",
        rightType: "ctx",
        leftLine: oldLine,
        rightLine: newLine,
        leftMarker: " ",
        rightMarker: " ",
      })
      oldLine += 1
      newLine += 1
    }
  }
  return rows
}

function normalizedLineCount(value: string) {
  if (!value) {
    return 0
  }
  return value.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n").length
}

function diffOutputLineCount(value: string, mode: "unified" | "split") {
  if (mode === "split") {
    return splitDiffRows(value).length
  }
  return parseUnifiedDiffRows(value).length
}

function outputWindowBodyHeight(lines: number) {
  const lineHeightPx = OUTPUT_WINDOW_FONT_SIZE_PX * OUTPUT_WINDOW_LINE_HEIGHT
  return Math.round(lines * lineHeightPx + OUTPUT_WINDOW_VERTICAL_PADDING_PX)
}

function splitDiffClass(type: string) {
  if (type === "add") return "oc-splitDiffLine is-add"
  if (type === "del") return "oc-splitDiffLine is-del"
  if (type === "empty") return "oc-splitDiffLine is-empty"
  return "oc-splitDiffLine"
}

function diffRowClass(type: string) {
  if (type === "add") return "oc-diffLine is-add"
  if (type === "del") return "oc-diffLine is-del"
  return "oc-diffLine"
}

function parseUnifiedDiffRows(value: string) {
  const rows: Array<{ type: string; text: string; oldLine?: number; newLine?: number; marker: string }> = []
  const hunks = parseDiffHunks(value)
  for (const hunk of hunks) {
    let oldLine = hunk.oldStart
    let newLine = hunk.newStart
    for (const line of hunk.lines) {
      if (line.startsWith("-")) {
        rows.push({ type: "del", text: line.slice(1), oldLine, marker: "-" })
        oldLine += 1
        continue
      }
      if (line.startsWith("+")) {
        rows.push({ type: "add", text: line.slice(1), newLine, marker: "+" })
        newLine += 1
        continue
      }
      const text = line.startsWith(" ") ? line.slice(1) : line
      rows.push({ type: "ctx", text, oldLine, newLine, marker: " " })
      oldLine += 1
      newLine += 1
    }
  }
  return rows
}

function parseDiffHunks(value: string) {
  const lines = value.split("\n")
  const hunks: Array<{ oldStart: number; newStart: number; lines: string[] }> = []
  let current: { oldStart: number; newStart: number; lines: string[] } | null = null
  for (const rawLine of lines) {
    const line = rawLine || ""
    if (line.startsWith("@@")) {
      const header = parseHunkHeader(line)
      current = { oldStart: header.oldStart, newStart: header.newStart, lines: [] }
      hunks.push(current)
      continue
    }
    if (!current) {
      continue
    }
    if (line.startsWith("\\ No newline at end of file")) {
      continue
    }
    current.lines.push(line)
  }
  return hunks
}

function parseHunkHeader(line: string) {
  const match = /^@@\s+-(\d+)(?:,(\d+))?\s+\+(\d+)(?:,(\d+))?\s+@@/.exec(line)
  return {
    oldStart: match ? Number.parseInt(match[1] || "0", 10) : 0,
    newStart: match ? Number.parseInt(match[3] || "0", 10) : 0,
  }
}

function formatDiffLineNumber(value?: number) {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? String(value) : ""
}

function formatLineCount(value: number) {
  return `${value} ${value === 1 ? "line" : "lines"}`
}

function agentColor(name: string) {
  const palette = [
    "#7aa2f7",
    "#9ece6a",
    "#e0af68",
    "#bb9af7",
    "#f7768e",
    "#7dcfff",
    "#73daca",
    "#ff9e64",
  ]
  let hash = 0
  for (const char of name) {
    hash = ((hash << 5) - hash) + char.charCodeAt(0)
    hash |= 0
  }
  return palette[Math.abs(hash) % palette.length]
}

function relativeWorkspacePath(value: string, workspaceDir: string) {
  const path = normalizePath(value)
  const root = normalizePath(workspaceDir)
  if (!path) {
    return ""
  }
  if (root && path.startsWith(root.endsWith("/") ? root : `${root}/`)) {
    return path.slice(root.length + (root.endsWith("/") ? 0 : 1))
  }
  return path
}

function normalizePath(value: string) {
  return value.replace(/\\/g, "/").replace(/\/+/g, "/").replace(/\/$/, "")
}

function toolChildSessionId(part: Extract<MessagePart, { type: "tool" }>) {
  const metadata = recordValue(part.state?.metadata)
  const candidates = [
    metadata.sessionID,
    metadata.sessionId,
    metadata.childSessionID,
    metadata.childSessionId,
    metadata.session,
  ]

  for (const item of candidates) {
    const value = stringValue(item)
    if (value) {
      return value
    }
  }

  return ""
}

function toolFiles(part: Extract<MessagePart, { type: "tool" }>): ToolFileSummary[] {
  const input = recordValue(part.state?.input)
  const metadata = recordValue(part.state?.metadata)
  if (part.tool === "apply_patch") {
    const files = stringList(metadata.files)
    return files.map((file) => ({ path: file, summary: "patched" }))
  }
  const path = stringValue(input.filePath) || stringValue(input.path) || stringValue(metadata.filepath)
  if (!path) {
    return []
  }
  const summary = part.tool === "edit"
    ? diffSummary(stringValue(metadata.diff))
    : part.tool === "write"
      ? "written"
      : "updated"
  return [{ path, summary }]
}

function toolWriteContent(part: Extract<MessagePart, { type: "tool" }>) {
  const input = recordValue(part.state?.input)
  return stringValue(input.content)
}

function toolEditDiff(part: Extract<MessagePart, { type: "tool" }>) {
  const metadata = recordValue(part.state?.metadata)
  return stringValue(metadata.diff)
}

function toolDiagnostics(part: Extract<MessagePart, { type: "tool" }>) {
  const metadata = recordValue(part.state?.metadata)
  const value = metadata.diagnostics
  if (!Array.isArray(value)) {
    return [] as string[]
  }
  return value
    .map((item) => formatDiagnostic(recordValue(item)))
    .filter(Boolean)
}

function patchFiles(part: Extract<MessagePart, { type: "tool" }>) {
  const metadata = recordValue(part.state?.metadata)
  const value = metadata.files
  if (!Array.isArray(value)) {
    return [] as Array<{ path: string; type: string; summary: string; diff: string }>
  }
  return value
    .filter((item): item is Record<string, unknown> => !!item && typeof item === "object")
    .map((item) => {
      const type = stringValue(item.type) || "update"
      const path = stringValue(item.relativePath) || stringValue(item.filePath) || stringValue(item.movePath)
      const diff = stringValue(item.diff)
      const additions = numberValue(item.additions)
      const deletions = numberValue(item.deletions)
      const summary = patchSummary(type, additions, deletions, stringValue(item.movePath), stringValue(item.filePath))
      return { path, type, summary, diff }
    })
    .filter((item) => !!item.path)
}

function patchSummary(type: string, additions: number, deletions: number, movePath: string, filePath: string) {
  if (type === "delete") {
    return deletions > 0 ? `-${deletions}` : "deleted"
  }
  if (type === "add") {
    return additions > 0 ? `+${additions}` : "created"
  }
  if (type === "move") {
    return movePath && filePath ? `${filePath} → ${movePath}` : "moved"
  }
  if (additions > 0 || deletions > 0) {
    return `+${additions} / -${deletions}`
  }
  return "patched"
}

function formatDiagnostic(item: Record<string, unknown>) {
  const severity = stringValue(item.severity) || stringValue(item.level)
  const message = stringValue(item.message) || stringValue(item.text)
  const line = numberValue(item.line) || numberValue(item.lineNumber)
  const col = numberValue(item.column) || numberValue(item.col)
  const head = [severity, line > 0 ? `L${line}` : "", col > 0 ? `C${col}` : ""].filter(Boolean).join(" ")
  return [head, message].filter(Boolean).join(" · ")
}

function codeLanguage(filePath?: string) {
  const value = stringValue(filePath)
  const normalized = value.toLowerCase()
  if (normalized.endsWith(".ts")) return "typescript"
  if (normalized.endsWith(".tsx")) return "tsx"
  if (normalized.endsWith(".js")) return "javascript"
  if (normalized.endsWith(".jsx")) return "jsx"
  if (normalized.endsWith(".json")) return "json"
  if (normalized.endsWith(".css")) return "css"
  if (normalized.endsWith(".html")) return "html"
  if (normalized.endsWith(".md")) return "markdown"
  if (normalized.endsWith(".sh")) return "bash"
  if (normalized.endsWith(".yml") || normalized.endsWith(".yaml")) return "yaml"
  return ""
}

function highlightCode(value: string, language: string) {
  if (language && hljs.getLanguage(language)) {
    return hljs.highlight(value, { language }).value
  }
  return hljs.highlightAuto(value).value
}

function renderMarkdownCodeWindow(value: string, language: string) {
  const lang = normalizeCodeLanguage(language)
  const title = lang ? capitalize(lang) : "Code"
  const lines = codeWindowRows(value, lang)
  const gutter = codeWindowGutter(value)
  return [
    '<section class="oc-outputWindow oc-outputWindow-markdownCode">',
    '<div class="oc-outputWindowHead">',
    '<div class="oc-outputWindowTitleRow">',
    '<span class="oc-outputWindowAction">Code</span>',
    `<span class="oc-outputWindowTitle">${escapeHtml(title)}</span>`,
    '</div>',
    '<button type="button" class="oc-outputWindowCopyBtn" aria-label="Copy code"',
    ` data-copy-code="${escapeAttribute(value)}">`,
    '<svg class="oc-outputWindowCopyIcon" viewBox="0 0 16 16" aria-hidden="true">',
    '<rect x="5" y="3" width="8" height="10" rx="1.5" />',
    '<path d="M3.5 10.5V5.5c0-.828.672-1.5 1.5-1.5h5" />',
    '</svg>',
    '<span class="oc-outputWindowCopyTip">Copied!</span>',
    '</button>',
    '</div>',
    '<div class="oc-outputWindowBody">',
    '<div class="oc-outputWindowBodyInner">',
    `<pre class="oc-codeWindowBody" style="--oc-codeWindow-gutter:${gutter}"><code class="oc-codeWindowText">`,
    lines,
    '</code></pre>',
    '</div>',
    '</div>',
    '</section>',
  ].join("")
}

function codeWindowRows(value: string, language: string) {
  const rows = normalizedLines(value)
  return rows.map((line, index) => {
    const html = highlightCode(line, language)
    return [
      '<span class="oc-codeWindowLine">',
      `<span class="oc-codeWindowLineNo">${index + 1}</span>`,
      `<span class="oc-codeWindowLineText hljs${language ? ` language-${escapeAttribute(language)}` : ""}">${html || " "}</span>`,
      '</span>',
    ].join("")
  }).join("")
}

function normalizeCodeLanguage(value: string) {
  const lang = value.trim().toLowerCase().split(/\s+/)[0] || ""
  if (!lang) {
    return ""
  }
  if (hljs.getLanguage(lang)) {
    return lang
  }
  if (lang === "ts") return "typescript"
  if (lang === "js") return "javascript"
  if (lang === "md") return "markdown"
  if (lang === "sh" || lang === "shell") return "bash"
  if (lang === "yml") return "yaml"
  return ""
}

function copyText(value: string) {
  const clipboard = window.navigator?.clipboard
  if (clipboard?.writeText) {
    return clipboard.writeText(value)
  }
  const input = document.createElement("textarea")
  input.value = value
  input.setAttribute("readonly", "true")
  input.style.position = "absolute"
  input.style.left = "-9999px"
  document.body.appendChild(input)
  input.select()
  document.execCommand("copy")
  document.body.removeChild(input)
  return Promise.resolve()
}

function normalizedLines(value: string) {
  return value.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n")
}

function codeWindowGutter(value: string) {
  return `calc(${Math.max(String(normalizedLines(value).length).length, 2)}ch + 12px)`
}

function escapeAttribute(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
}

function toolTodos(part: Extract<MessagePart, { type: "tool" }>) {
  return toolTodosFromMetadata(recordValue(part.state?.metadata))
}

function toolTodosFromMetadata(metadata: Record<string, unknown>) {
  const value = metadata.todos
  if (!Array.isArray(value)) {
    return [] as Array<{ content: string; status: string }>
  }
  return value
    .filter((item): item is Record<string, unknown> => !!item && typeof item === "object")
    .map((item) => ({
      content: stringValue(item.content),
      status: stringValue(item.status) || "pending",
    }))
    .filter((item) => !!item.content)
}

function extractUrls(value: string) {
  return value.match(/https?:\/\/[^\s)]+/g) || []
}

function uniqueStrings(values: string[]) {
  return [...new Set(values)]
}

function todoMarker(status: string) {
  if (status === "completed") {
    return "[✓]"
  }
  if (status === "in_progress") {
    return "[•]"
  }
  return "[ ]"
}

function parentDir(value: string) {
  if (!value) {
    return ""
  }
  const normalized = value.replace(/\\/g, "/")
  const index = normalized.lastIndexOf("/")
  return index > 0 ? normalized.slice(0, index) : ""
}

function diffSummary(value: string) {
  if (!value) {
    return "modified"
  }
  const additions = (value.match(/^\+/gm) || []).length
  const deletions = (value.match(/^-/gm) || []).length
  if (!additions && !deletions) {
    return "modified"
  }
  return `+${additions} / -${deletions}`
}

function partTitle(part: MessagePart) {
  if (part.type === "text") {
    return part.synthetic ? "context" : "text"
  }
  if (part.type === "reasoning") {
    return "reasoning"
  }
  if (part.type === "tool") {
    return part.tool || "tool"
  }
  if (part.type === "file") {
    return part.filename || "attachment"
  }
  if (part.type === "step-start") {
    return "step started"
  }
  if (part.type === "step-finish") {
    return "step finished"
  }
  if (part.type === "snapshot") {
    return "snapshot"
  }
  if (part.type === "patch") {
    return "patch"
  }
  if (part.type === "agent") {
    return "agent"
  }
  if (part.type === "retry") {
    return "retry"
  }
  if (part.type === "compaction") {
    return "compaction"
  }
  if (part.type === "subtask") {
    return "subtask"
  }
  return part.type || "part"
}

function partMeta(part: MessagePart) {
  if (part.type === "tool") {
    return part.state?.status || "pending"
  }
  if (part.type === "file") {
    return part.mime || "file"
  }
  return ""
}

function isDividerPart(part: MessagePart) {
  return part.type === "compaction"
    || part.type === "retry"
    || part.type === "agent"
    || part.type === "subtask"
    || part.type === "step-start"
}

function dividerText(part: MessagePart) {
  if (part.type === "compaction") {
    return (part as Record<string, unknown>).auto ? "Automatic compaction" : "Compaction"
  }

  if (part.type === "retry") {
    return retryText((part as Record<string, unknown>).error) || "Retry"
  }

  if (part.type === "agent") {
    return textValue((part as Record<string, unknown>).name) || "Agent task"
  }

  if (part.type === "subtask") {
    return textValue((part as Record<string, unknown>).description) || textValue((part as Record<string, unknown>).prompt) || "Subtask"
  }

  if (part.type === "step-start") {
    const model = textValue((part as Record<string, unknown>).model)
    return model ? `Step started · ${model}` : "Step started"
  }

  return partTitle(part)
}

function activeTodos(todos: Todo[]) {
  return todos.filter((item) => item.status !== "completed")
}

function permissionInfo(request: PermissionRequest) {
  const input = permissionInput(request)
  const details: string[] = []

  if (request.permission === "edit") {
    const filepath = stringValue(request.metadata?.filepath)
    if (filepath) {
      details.push(`Path: ${filepath}`)
    }
    const diff = stringValue(request.metadata?.diff)
    if (diff) {
      details.push(diff)
    }
    return { title: `Edit ${filepath || "file"}`, details }
  }

  if (request.permission === "read") {
    const filePath = stringValue(input.filePath)
    return {
      title: `Read ${filePath || "file"}`,
      details: filePath ? [`Path: ${filePath}`] : details,
    }
  }

  if (request.permission === "glob" || request.permission === "grep") {
    const pattern = stringValue(input.pattern)
    return {
      title: `${capitalize(request.permission)} ${pattern ? `"${pattern}"` : "request"}`,
      details: pattern ? [`Pattern: ${pattern}`] : details,
    }
  }

  if (request.permission === "list") {
    const dir = stringValue(input.path)
    return {
      title: `List ${dir || "directory"}`,
      details: dir ? [`Path: ${dir}`] : details,
    }
  }

  if (request.permission === "bash") {
    const title = stringValue(input.description) || "Shell command"
    const command = stringValue(input.command)
    return {
      title,
      details: command ? [`$ ${command}`] : details,
    }
  }

  if (request.permission === "task") {
    const type = stringValue(input.subagent_type) || "Unknown"
    const description = stringValue(input.description)
    return {
      title: `${capitalize(type)} task`,
      details: description ? [description] : details,
    }
  }

  if (request.permission === "webfetch") {
    const url = stringValue(input.url)
    return {
      title: `WebFetch ${url || "request"}`,
      details: url ? [`URL: ${url}`] : details,
    }
  }

  if (request.permission === "websearch" || request.permission === "codesearch") {
    const query = stringValue(input.query)
    return {
      title: `${capitalize(request.permission)} ${query ? `"${query}"` : "request"}`,
      details: query ? [`Query: ${query}`] : details,
    }
  }

  if (request.permission === "external_directory") {
    const filepath = stringValue(request.metadata?.filepath)
    return {
      title: `Access external directory ${filepath || request.patterns?.[0] || "request"}`,
      details,
    }
  }

  if (request.permission === "doom_loop") {
    return {
      title: "Continue after repeated failures",
      details: ["This keeps the session running despite repeated failures."],
    }
  }

  return {
    title: `Call tool ${request.permission || "permission"}`,
    details,
  }
}

function permissionInput(request: PermissionRequest) {
  return request.metadata && typeof request.metadata === "object" ? request.metadata : {}
}

function answerKey(requestID: string, index: number) {
  return `${requestID}:${index}`
}

function formatTime(value?: number) {
  if (typeof value !== "number") {
    return ""
  }
  try {
    return new Date(value).toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
    })
  } catch {
    return ""
  }
}

function textValue(value: unknown) {
  return typeof value === "string" ? value : ""
}

function cleanReasoning(value: string) {
  return value.replace(/\[REDACTED\]/g, "").trim()
}

function fileLabel(value: string) {
  const normalized = value.replace(/\\/g, "/")
  return normalized.split("/").filter(Boolean).pop() || value
}

function stringList(value: unknown) {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : []
}

function recordOfMessageLists(value: unknown) {
  if (!value || typeof value !== "object") {
    return {} as Record<string, SessionMessage[]>
  }

  const out: Record<string, SessionMessage[]> = {}
  for (const [key, item] of Object.entries(value)) {
    out[key] = Array.isArray(item) ? item as SessionMessage[] : []
  }
  return out
}

function recordOfSessions(value: unknown) {
  if (!value || typeof value !== "object") {
    return {} as Record<string, SessionInfo>
  }

  const out: Record<string, SessionInfo> = {}
  for (const [key, item] of Object.entries(value)) {
    if (item && typeof item === "object") {
      out[key] = item as SessionInfo
    }
  }
  return out
}

function stringValue(value: unknown) {
  return typeof value === "string" ? value : ""
}

function numberValue(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : 0
}

function recordValue(value: unknown) {
  return value && typeof value === "object" ? value as Record<string, unknown> : {}
}

function capitalize(value: string) {
  if (!value) {
    return ""
  }
  return value[0].toUpperCase() + value.slice(1)
}

function formatDuration(seconds: number) {
  if (seconds < 60) {
    return `${seconds}s`
  }

  const minutes = Math.floor(seconds / 60)
  const rest = seconds % 60
  if (!rest) {
    return `${minutes}m`
  }
  return `${minutes}m ${rest}s`
}

function contextSummary(state: AppState) {
  const metrics = usage(state.snapshot.messages)
  const parts = [
    `${state.snapshot.messages.length} msgs`,
    `${activeTodos(state.snapshot.todos).length} todos`,
    `${state.snapshot.diff.length} files`,
  ]

  if (metrics.tokens > 0) {
    parts.unshift(`${metrics.tokens.toLocaleString()} tokens`)
  }

  if (metrics.cost > 0) {
    parts.push(`$${metrics.cost.toFixed(2)}`)
  }

  return parts.join(" • ")
}

function usage(messages: SessionMessage[]) {
  return messages.reduce((acc, item) => {
    if (item.info.role !== "assistant") {
      return acc
    }

    const tokens = item.info.tokens
    return {
      cost: acc.cost + (item.info.cost ?? 0),
      tokens: acc.tokens + (tokens
        ? tokens.input + tokens.output + tokens.reasoning + tokens.cache.read + tokens.cache.write
        : 0),
    }
  }, { cost: 0, tokens: 0 })
}

function retryText(value: unknown) {
  if (typeof value === "string") {
    return value
  }

  if (value && typeof value === "object") {
    const maybe = value as { message?: unknown }
    if (typeof maybe.message === "string") {
      return maybe.message
    }
  }

  return "Retry requested."
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;")
}

const root = document.getElementById("root")

if (!root) {
  throw new Error("Missing webview root")
}

createRoot(root).render(<App />)
