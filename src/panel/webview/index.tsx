import React from "react"
import hljs from "highlight.js"
import MarkdownIt from "markdown-it"
import { createRoot } from "react-dom/client"
import type { HostMessage, SessionBootstrap, WebviewMessage } from "../../bridge/types"
import type { FileDiff, MessagePart, PermissionRequest, QuestionRequest, SessionMessage, SessionStatus, Todo } from "../../core/sdk"
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
              <span className="oc-kicker">composer</span>
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
  )
}

function Timeline({ state }: { state: AppState }) {
  const messages = state.snapshot.messages

  if (state.bootstrap.status === "error") {
    return <EmptyState title="Session unavailable" text={state.bootstrap.message || "The workspace runtime is not ready."} />
  }

  if (state.bootstrap.status !== "ready" && messages.length === 0) {
    return <EmptyState title="Connecting to workspace" text={state.bootstrap.message || "Waiting for workspace runtime."} />
  }

  if (messages.length === 0) {
    return <EmptyState title="Start this session" text="Send a message below. Pending permission and question requests will appear in the lower dock." />
  }

  return (
    <div className="oc-log">
      {messages.map((entry) => (
        <article key={entry.info.id} className={`oc-entry oc-entry-${entry.info.role || "assistant"}`}>
          <div className="oc-rail" />
          <div className="oc-entryBody">
            <div className="oc-entryHeader">
              <div className="oc-entryRole">{entry.info.role === "user" ? "You" : entry.info.agent || "OpenCode"}</div>
              <div className="oc-entryTime">{formatTime(entry.info.time?.created)}</div>
            </div>
            <div className="oc-parts">
              {entry.parts.length > 0 ? entry.parts.map((part) => <PartView key={part.id} part={part} />) : <div className="oc-partEmpty">No message parts yet.</div>}
            </div>
          </div>
        </article>
      ))}
    </div>
  )
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

function PartView({ part }: { part: MessagePart }) {
  const meta = partMeta(part)
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

function renderPartBody(part: MessagePart) {
  if (part.type === "text" || part.type === "reasoning") {
    return <MarkdownBlock content={part.text || ""} />
  }

  if (part.type === "tool") {
    const lines: string[] = []
    if (part.state?.title) {
      lines.push(part.state.title)
    }
    if (part.state?.output) {
      lines.push(part.state.output)
    }
    if (part.state?.error) {
      lines.push(part.state.error)
    }
    if (lines.length === 0) {
      lines.push(JSON.stringify(part.state?.metadata || {}, null, 2))
    }
    return <pre className="oc-partTerminal">{lines.join("\n\n")}</pre>
  }

  if (part.type === "file") {
    return (
      <ul className="oc-list">
        {part.filename ? <li>{part.filename}</li> : null}
        {part.url ? <li>{part.url}</li> : null}
      </ul>
    )
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

function MarkdownBlock({ content }: { content: string }) {
  const html = React.useMemo(() => markdown.render(content || ""), [content])
  return (
    <div className="oc-markdown" dangerouslySetInnerHTML={{ __html: html }} />
  )
}

function sessionTitle(bootstrap: SessionBootstrap) {
  return bootstrap.session?.title || bootstrap.sessionRef.sessionId?.slice(0, 8) || "session"
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

function stringList(value: unknown) {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : []
}

function stringValue(value: unknown) {
  return typeof value === "string" ? value : ""
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
