import React from "react"
import hljs from "highlight.js"
import MarkdownIt from "markdown-it"
import { createRoot } from "react-dom/client"
import type { HostMessage, SessionBootstrap, WebviewMessage } from "../../bridge/types"
import type { FileDiff, FilePart, MessageInfo, MessagePart, PermissionRequest, QuestionRequest, SessionMessage, SessionStatus, TextPart, Todo } from "../../core/sdk"
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
    if (language && hljs.getLanguage(language)) {
      return `<pre><code class="hljs language-${language}">${hljs.highlight(value, { language }).value}</code></pre>`
    }

    return `<pre><code class="hljs">${escapeHtml(value)}</code></pre>`
  },
})

const linkDefault = markdown.renderer.rules.link_open
markdown.renderer.rules.link_open = (...args: Parameters<NonNullable<typeof linkDefault>>) => {
  const [tokens, idx, options, env, self] = args
  tokens[idx]?.attrSet("target", "_blank")
  tokens[idx]?.attrSet("rel", "noreferrer noopener")
  return linkDefault ? linkDefault(tokens, idx, options, env, self) : self.renderToken(tokens, idx, options)
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
    </WorkspaceDirContext.Provider>
  )
}

function Timeline({ state }: { state: AppState }) {
  const messages = state.snapshot.messages
  const [showThinking, setShowThinking] = React.useState(true)
  const [showInternals, setShowInternals] = React.useState(false)

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
        </div>
        {blocks.map((block) => <TimelineBlockView key={block.key} block={block} activeToolID={activeToolID} />)}
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

type ToolFileSummary = {
  path: string
  summary: string
}

function TimelineBlockView({ block, activeToolID }: { block: TimelineBlock; activeToolID: string }) {
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
  return (
    <PartView part={part} active={part.type === "tool" && part.id === activeToolID} />
  )
}

const TranscriptVisibilityContext = React.createContext({
  showThinking: false,
  showInternals: false,
})

const WorkspaceDirContext = React.createContext("")

function useWorkspaceDir() {
  return React.useContext(WorkspaceDirContext)
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

function PartView({ part, active = false }: { part: MessagePart; active?: boolean }) {
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
    return <ToolPartView part={part} active={active} />
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

function ToolPartView({ part, active = false }: { part: Extract<MessagePart, { type: "tool" }>; active?: boolean }) {
  if (part.tool === "bash" && !bashHasPanel(part)) {
    return <ToolRow part={part} active={active} />
  }

  if (part.tool === "websearch" || part.tool === "codesearch") {
    return <ToolRow part={part} active={active} />
  }

  const variant = toolVariant(part.tool)

  if (variant === "row") {
    return <ToolRow part={part} active={active} />
  }

  if (variant === "files") {
    return <ToolFilesPanel part={part} active={active} />
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
    <section className={`oc-toolRowWrap${active ? " is-active" : ""}${part.state?.status === "completed" ? " is-completed" : ""}`}>
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
  const body = taskBody(part)
  const clickable = !!childSessionID

  const content = (
    <>
      <div className="oc-toolRow oc-taskRowHeader">
        <div className="oc-toolRowMain oc-taskRowMain">
          <span className="oc-kicker oc-toolLeadGhost" aria-hidden="true">task</span>
          <span className="oc-taskTitleWrap">
            <span className="oc-agentSwatch" style={{ background: agentColor(agentName) }} />
            <span className="oc-toolRowTitle">{agentName}</span>
            <ToolStatus state={part.state?.status} />
          </span>
        </div>
      </div>
      {body ? <div className="oc-toolRowExtras oc-taskRowBody"><div className="oc-toolRowExtra">{body}</div></div> : null}
    </>
  )

  if (clickable) {
    return (
      <button
        type="button"
        className={`oc-toolRowWrap oc-toolRowBtn${active ? " is-active" : ""}${part.state?.status === "completed" ? " is-completed" : ""}`}
        onClick={() => vscode.postMessage({ type: "navigateSession", sessionID: childSessionID })}
      >
        {content}
      </button>
    )
  }

  return <section className={`oc-toolRowWrap${active ? " is-active" : ""}${part.state?.status === "completed" ? " is-completed" : ""}`}>{content}</section>
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

function ToolFilesPanel({ part, active = false }: { part: Extract<MessagePart, { type: "tool" }>; active?: boolean }) {
  if (part.tool === "write") {
    return <ToolWritePanel part={part} active={active} />
  }

  if (part.tool === "edit") {
    return <ToolEditPanel part={part} active={active} />
  }

  if (part.tool === "apply_patch") {
    return <ToolApplyPatchPanel part={part} active={active} />
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

function ToolEditPanel({ part, active = false }: { part: Extract<MessagePart, { type: "tool" }>; active?: boolean }) {
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
      {expanded && diff ? <DiffBlock value={diff} /> : null}
      {expanded && !diff && toolTextBody(part) ? <pre className="oc-partTerminal">{toolTextBody(part)}</pre> : null}
      {expanded && toolDiagnostics(part).length > 0 ? <DiagnosticsList items={toolDiagnostics(part)} /> : null}
    </section>
  )
}

function ToolApplyPatchPanel({ part, active = false }: { part: Extract<MessagePart, { type: "tool" }>; active?: boolean }) {
  const details = toolDetails(part)
  const status = part.state?.status || "pending"
  const files = patchFiles(part)
  const [expanded, setExpanded] = React.useState(() => defaultToolExpanded(part, active, files.length > 0 || !!toolTextBody(part)))
  const [mode, setMode] = React.useState<"unified" | "split">("unified")

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
        <div className="oc-attachmentRow">
          <button type="button" className={`oc-chip${mode === "unified" ? " is-active" : ""}`} onClick={() => setMode("unified")}>Unified</button>
          <button type="button" className={`oc-chip${mode === "split" ? " is-active" : ""}`} onClick={() => setMode("split")}>Split</button>
        </div>
      ) : null}
      {expanded && files.length > 0 ? (
        <div className="oc-patchList">
          {files.map((item) => (
            <section key={`${item.path}:${item.type}:${item.summary}`} className="oc-patchItem">
              <div className="oc-patchHeader">
                <div className="oc-fileToolPath">{item.path}</div>
                <div className="oc-patchMeta">
                  <span className={`oc-pill oc-pill-file is-${item.type}`}>{item.type}</span>
                  {item.summary ? <span className="oc-fileToolSummary">{item.summary}</span> : null}
                </div>
              </div>
              {item.diff ? <DiffBlock value={item.diff} mode={mode} /> : null}
            </section>
          ))}
        </div>
      ) : null}
      {expanded && files.length === 0 && toolTextBody(part) ? <pre className="oc-partTerminal">{toolTextBody(part)}</pre> : null}
      {expanded && toolDiagnostics(part).length > 0 ? <DiagnosticsList items={toolDiagnostics(part)} /> : null}
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

function DiffBlockImpl({ value, mode }: { value: string; mode: "unified" | "split" }) {
  if (mode === "split") {
    return <SplitDiffBlock value={value} />
  }
  return (
    <pre className="oc-diffBlock">
      {value.split("\n").map((line, index) => <div key={`${index}:${line}`} className={diffLineClass(line)}>{line || " "}</div>)}
    </pre>
  )
}

function SplitDiffBlock({ value }: { value: string }) {
  const rows = React.useMemo(() => splitDiffRows(value), [value])
  return (
    <div className="oc-splitDiff">
      <div className="oc-splitDiffHead">
        <span>Before</span>
        <span>After</span>
      </div>
      <div className="oc-splitDiffBody">
        {rows.map((row, index) => (
          <React.Fragment key={`${index}:${row.left}:${row.right}`}>
            <div className={splitDiffClass(row.leftType)}>{row.left || " "}</div>
            <div className={splitDiffClass(row.rightType)}>{row.right || " "}</div>
          </React.Fragment>
        ))}
      </div>
    </div>
  )
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
    <section className={`oc-part oc-part-tool oc-toolPanel${active ? " is-active" : ""}${status === "completed" ? " is-completed" : ""}`}>
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
    <div className={`oc-markdown${className ? ` ${className}` : ""}`} dangerouslySetInnerHTML={{ __html: html }} />
  )
}

function sessionTitle(bootstrap: SessionBootstrap) {
  return bootstrap.session?.title || bootstrap.sessionRef.sessionId?.slice(0, 8) || "session"
}

function buildTimelineBlocks(messages: SessionMessage[], options: { showThinking: boolean; showInternals: boolean }) {
  const blocks: TimelineBlock[] = []

  for (const message of messages) {
    if (message.info.role === "user") {
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

    const meta = assistantMessageMeta(message)
    if (meta) {
      blocks.push({
        kind: "assistant-meta",
        key: `meta:${message.info.id}`,
        text: meta,
      })
    }
  }

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

function assistantMessageMeta(message: SessionMessage) {
  const parts: string[] = []
  const agent = message.info.agent?.trim()
  const created = formatTime(message.info.time?.created)
  const summary = assistantSummary([message])

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
  const title = stringValue(part.state?.title) || defaultToolTitle(part.tool, input, metadata)
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
  if (tool === "write" || tool === "edit" || tool === "apply_patch") {
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
  if (part.tool === "task") {
    return taskSummary(part)
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

function taskSummary(part: Extract<MessagePart, { type: "tool" }>) {
  const metadata = recordValue(part.state?.metadata)
  const status = part.state?.status || "pending"
  if (status === "completed") {
    const calls = numberValue(metadata.toolCalls) || numberValue(metadata.toolcalls) || numberValue(metadata.calls) || numberValue(metadata.callCount) || numberValue(metadata.totalTools)
    const duration = numberValue(metadata.duration) || numberValue(metadata.durationMs) || numberValue(metadata.elapsed) || numberValue(metadata.elapsedMs) || numberValue(metadata.totalDuration) || numberValue(metadata.totalDurationMs)
    const parts: string[] = []
    if (calls > 0) {
      parts.push(`${calls} tools`)
    }
    if (duration > 0) {
      parts.push(formatDuration(duration > 1000 ? Math.round(duration / 1000) : duration))
    }
    return parts.join(" · ")
  }
  return ""
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

function taskBody(part: Extract<MessagePart, { type: "tool" }>) {
  const metadata = recordValue(part.state?.metadata)
  const status = part.state?.status || "pending"
  if (status === "completed") {
    return taskSummary(part)
  }
  const currentTool = stringValue(metadata.currentTool) || stringValue(metadata.tool)
  const currentTitle = stringValue(metadata.currentTitle) || stringValue(metadata.title)
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
  if (outputLines.length > 0) {
    return outputLines[outputLines.length - 1]
  }
  return status === "running" ? "Running…" : "Queued…"
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

function splitDiffRows(value: string) {
  const rows: Array<{ left: string; right: string; leftType: string; rightType: string }> = []
  const lines = value.split("\n")
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] || ""
    if (line.startsWith("@@") || line.startsWith("+++ ") || line.startsWith("--- ")) {
      rows.push({ left: line, right: line, leftType: "meta", rightType: "meta" })
      continue
    }
    if (line.startsWith("-")) {
      const next = lines[index + 1] || ""
      if (next.startsWith("+")) {
        rows.push({ left: line, right: next, leftType: "del", rightType: "add" })
        index += 1
        continue
      }
      rows.push({ left: line, right: "", leftType: "del", rightType: "empty" })
      continue
    }
    if (line.startsWith("+")) {
      rows.push({ left: "", right: line, leftType: "empty", rightType: "add" })
      continue
    }
    rows.push({ left: line, right: line, leftType: "ctx", rightType: "ctx" })
  }
  return rows
}

function splitDiffClass(type: string) {
  if (type === "add") return "oc-splitDiffLine is-add"
  if (type === "del") return "oc-splitDiffLine is-del"
  if (type === "meta") return "oc-splitDiffLine is-meta"
  if (type === "empty") return "oc-splitDiffLine is-empty"
  return "oc-splitDiffLine"
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

function diffLineClass(line: string) {
  if (line.startsWith("+++ ") || line.startsWith("--- ") || line.startsWith("@@")) {
    return "oc-diffLine is-meta"
  }
  if (line.startsWith("+")) {
    return "oc-diffLine is-add"
  }
  if (line.startsWith("-")) {
    return "oc-diffLine is-del"
  }
  return "oc-diffLine"
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
