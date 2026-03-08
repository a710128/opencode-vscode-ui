import React from "react"
import { createRoot } from "react-dom/client"
import type { SidebarHostMessage, SidebarViewMode, SidebarViewState, SidebarWebviewMessage } from "../view-types"
import "./styles.css"

declare global {
  interface Window {
    __OPENCODE_SIDEBAR_MODE__?: SidebarViewMode
  }
}

type VsCodeApi = {
  postMessage(message: SidebarWebviewMessage): void
}

declare function acquireVsCodeApi(): VsCodeApi

const vscode = acquireVsCodeApi()
const mode = window.__OPENCODE_SIDEBAR_MODE__ === "diff" ? "diff" : "todo"

const initialState: SidebarViewState = {
  status: "idle",
  mode,
  todos: [],
  diff: [],
}

function App() {
  const [state, setState] = React.useState<SidebarViewState>(initialState)

  React.useEffect(() => {
    const handler = (event: MessageEvent<SidebarHostMessage>) => {
      if (event.data?.type === "state") {
        setState(event.data.payload)
      }
    }

    window.addEventListener("message", handler)
    vscode.postMessage({ type: "ready" })
    return () => window.removeEventListener("message", handler)
  }, [])

  return (
    <div className="sv-shell">
      {state.status === "idle" ? <Empty title="No active session" text={mode === "todo" ? "Focus an OpenCode session tab to view todos" : "Focus an OpenCode session tab to view changed files"} /> : null}
      {state.status === "loading" ? <Empty title={mode === "todo" ? "Loading todos..." : "Loading modified files..."} text="From focused session" /> : null}
      {state.status === "error" ? <Empty title="Unavailable" text={state.error || "Failed to load view"} /> : null}
      {state.status === "ready" && mode === "todo" ? <TodoList state={state} /> : null}
      {state.status === "ready" && mode === "diff" ? <DiffList state={state} /> : null}
    </div>
  )
}

function TodoList({ state }: { state: SidebarViewState }) {
  if (state.todos.length === 0) {
    return <Empty title="No todos yet" text="Tasks from the focused session will appear here" />
  }

  return (
    <section className="sv-group">
      <div className="sv-list">
        {state.todos.map((item, index) => (
          <div key={`${item.content}-${index}`} className={`sv-todo sv-todo-${item.status}`}>
            <span className="sv-todoPrefix">{todoPrefix(item.status)}</span>
            <span className="sv-todoText">{item.content || "Untitled task"}</span>
          </div>
        ))}
      </div>
    </section>
  )
}

function DiffList({ state }: { state: SidebarViewState }) {
  if (state.diff.length === 0) {
    return <Empty title="No modified files" text="Files changed by the focused session will appear here" />
  }

  return (
    <section className="sv-group">
      <div className="sv-list">
        {state.diff.map((item) => (
          <button key={item.file} type="button" className="sv-diff" onClick={() => vscode.postMessage({ type: "openFile", filePath: item.file })}>
            <span className="sv-add">{item.additions ? `+${item.additions}` : ""}</span>
            <span className="sv-sep">/</span>
            <span className="sv-del">{item.deletions ? `-${item.deletions}` : ""}</span>
            <span className="sv-diffPath" title={item.file}>{item.file}</span>
          </button>
        ))}
      </div>
    </section>
  )
}

function Empty({ title, text }: { title: string; text: string }) {
  return (
    <div className="sv-empty">
      <div className="sv-emptyTitle">{title}</div>
      <div className="sv-emptyText">{text}</div>
    </div>
  )
}

function todoPrefix(status: string) {
  if (status === "in_progress") {
    return "[•]"
  }
  if (status === "completed") {
    return "[✓]"
  }
  return "[ ]"
}

createRoot(document.getElementById("root")!).render(<App />)
