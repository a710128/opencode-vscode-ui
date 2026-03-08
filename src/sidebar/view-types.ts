import type { FileDiff, Todo } from "../core/sdk"

export type SidebarViewMode = "todo" | "diff"

export type SidebarViewState = {
  status: "idle" | "loading" | "ready" | "error"
  mode: SidebarViewMode
  sessionTitle?: string
  todos: Todo[]
  diff: FileDiff[]
  error?: string
}

export type SidebarHostMessage = {
  type: "state"
  payload: SidebarViewState
}

export type SidebarWebviewMessage = {
  type: "ready"
} | {
  type: "openFile"
  filePath: string
}
