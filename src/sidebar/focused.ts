import * as vscode from "vscode"
import type { SessionPanelRef } from "../bridge/types"
import { EventHub } from "../core/events"
import type { FileDiff, SessionEvent, SessionInfo, Todo } from "../core/sdk"
import { WorkspaceManager } from "../core/workspace"
import { SessionPanelManager } from "../panel/provider"

export type FocusedSessionState = {
  status: "idle" | "loading" | "ready" | "error"
  ref?: SessionPanelRef
  session?: SessionInfo
  todos: Todo[]
  diff: FileDiff[]
  error?: string
}

const idleState: FocusedSessionState = {
  status: "idle",
  todos: [],
  diff: [],
}

export class FocusedSessionStore implements vscode.Disposable {
  private readonly change = new vscode.EventEmitter<void>()
  private state: FocusedSessionState = idleState
  private run = 0

  readonly onDidChange = this.change.event

  constructor(
    private mgr: WorkspaceManager,
    private panels: SessionPanelManager,
    private events: EventHub,
    private out: vscode.OutputChannel,
  ) {
    this.panels.onDidChangeActiveSession((ref) => {
      void this.focus(ref)
    })

    this.events.onDidEvent((item) => {
      void this.handle(item.dir, item.event)
    })

    this.mgr.onDidChange(() => {
      const ref = this.state.ref
      if (!ref) {
        return
      }
      const rt = this.mgr.get(ref.dir)
      if (!rt || rt.state !== "ready" || !rt.sdk) {
        this.set({
          status: "error",
          ref,
          session: this.state.session,
          todos: [],
          diff: [],
          error: rt?.err || "Workspace runtime is not ready.",
        })
      }
    })

    void this.focus(this.panels.activeSession())
  }

  snapshot() {
    return this.state
  }

  dispose() {
    this.change.dispose()
  }

  private async focus(ref?: SessionPanelRef) {
    if (!ref) {
      this.set(idleState)
      return
    }

    const run = ++this.run
    this.set({
      status: "loading",
      ref,
      session: this.state.session?.id === ref.sessionId ? this.state.session : undefined,
      todos: [],
      diff: [],
    })

    const rt = this.mgr.get(ref.dir)
    if (!rt || rt.state !== "ready" || !rt.sdk) {
      this.set({
        status: "error",
        ref,
        todos: [],
        diff: [],
        error: rt?.err || "Workspace runtime is not ready.",
      })
      return
    }

    try {
      const [sessionRes, todoRes, diffRes] = await Promise.all([
        rt.sdk.session.get({
          sessionID: ref.sessionId,
          directory: ref.dir,
        }),
        rt.sdk.session.todo({
          sessionID: ref.sessionId,
          directory: ref.dir,
        }),
        rt.sdk.session.diff({
          sessionID: ref.sessionId,
          directory: ref.dir,
        }),
      ])

      if (run !== this.run || !sameRef(this.state.ref, ref)) {
        return
      }

      this.set({
        status: "ready",
        ref,
        session: sessionRes.data,
        todos: todoRes.data ?? [],
        diff: diffRes.data ?? [],
      })
    } catch (err) {
      const message = text(err)
      this.log(`focused session load failed: ${message}`)
      if (run !== this.run || !sameRef(this.state.ref, ref)) {
        return
      }
      this.set({
        status: "error",
        ref,
        todos: [],
        diff: [],
        error: message,
      })
    }
  }

  private async handle(dir: string, event: SessionEvent) {
    const ref = this.state.ref
    if (!ref || ref.dir !== dir) {
      return
    }

    if (event.type === "server.instance.disposed") {
      await this.focus(ref)
      return
    }

    if (event.type === "todo.updated") {
      const props = event.properties as { sessionID: string; todos: Todo[] }
      if (props.sessionID !== ref.sessionId) {
        return
      }
      this.set({
        ...this.state,
        status: "ready",
        todos: props.todos,
      })
      return
    }

    if (event.type === "session.diff") {
      const props = event.properties as { sessionID: string; diff: FileDiff[] }
      if (props.sessionID !== ref.sessionId) {
        return
      }
      this.set({
        ...this.state,
        status: "ready",
        diff: props.diff,
      })
      return
    }

    if (event.type === "session.updated" || event.type === "session.created") {
      const props = event.properties as { info: SessionInfo }
      if (props.info?.id !== ref.sessionId) {
        return
      }
      this.set({
        ...this.state,
        session: props.info,
      })
      return
    }

    if (event.type === "session.deleted") {
      const props = event.properties as { info: SessionInfo }
      if (props.info?.id !== ref.sessionId) {
        return
      }
      this.set({
        status: "idle",
        todos: [],
        diff: [],
      })
    }
  }

  private set(next: FocusedSessionState) {
    this.state = next
    this.change.fire()
  }

  private log(message: string) {
    this.out.appendLine(`[focused-session] ${message}`)
  }
}

function sameRef(a?: SessionPanelRef, b?: SessionPanelRef) {
  return a?.dir === b?.dir && a?.sessionId === b?.sessionId
}

function text(err: unknown) {
  if (err instanceof Error) {
    return err.message
  }

  return String(err)
}
