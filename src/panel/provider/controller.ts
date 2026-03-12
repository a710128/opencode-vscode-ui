import * as vscode from "vscode"
import { postToWebview } from "../../bridge/host"
import type { SessionPanelRef, SessionSnapshot, WebviewMessage } from "../../bridge/types"
import { EventHub } from "../../core/events"
import type { SessionEvent } from "../../core/sdk"
import { WorkspaceManager } from "../../core/workspace"
import { rejectQuestion, replyPermission, replyQuestion, runComposerAction, runSlashCommand, submit, toggleMcp, type PanelActionState } from "./actions"
import { openFile, resolveFileRefs, searchFiles } from "./files"
import { needsRefresh, reduce } from "./reducer"
import { buildSessionSnapshot, patch } from "./snapshot"
import { boot, panelIconPath, panelTitle } from "./utils"
import { sessionPanelHtml } from "../html"

export class SessionPanelController implements vscode.Disposable {
  private ready = false
  private pending: Promise<void> | undefined
  private current: SessionSnapshot | undefined
  private readonly bag: vscode.Disposable[] = []
  private readonly state: PanelActionState = {
    disposed: false,
    run: 0,
    pendingSubmitCount: 0,
  }

  constructor(
    private extensionUri: vscode.Uri,
    readonly ref: SessionPanelRef,
    readonly key: string,
    readonly panel: vscode.WebviewPanel,
    private mgr: WorkspaceManager,
    private events: EventHub,
    private out: vscode.OutputChannel,
    private onActive: (ref: SessionPanelRef | undefined) => void,
    private onDispose: (key: string) => void,
  ) {
    panel.webview.options = { enableScripts: true }
    panel.webview.html = sessionPanelHtml(panel.webview, this.extensionUri, ref)
    panel.title = panelTitle(ref.sessionId)
    panel.iconPath = panelIconPath(this.extensionUri)

    this.panel.webview.onDidReceiveMessage(
      (message: WebviewMessage) => {
        if (message?.type === "ready") {
          this.ready = true
          void this.push()
          return
        }

        if (message?.type === "refresh") {
          void this.push(true)
          return
        }

        if (message?.type === "submit") {
          void submit(this.actionContext(), message.text, message.parts, message.agent, message.model)
          return
        }

        if (message?.type === "permissionReply") {
          void replyPermission(this.actionContext(), message.requestID, message.reply, message.message)
          return
        }

        if (message?.type === "questionReply") {
          void replyQuestion(this.actionContext(), message.requestID, message.answers)
          return
        }

        if (message?.type === "questionReject") {
          void rejectQuestion(this.actionContext(), message.requestID)
          return
        }

        if (message?.type === "navigateSession") {
          void vscode.commands.executeCommand("opencode-ui.openSessionById", this.ref.dir, message.sessionID)
          return
        }

        if (message?.type === "newSession") {
          void vscode.commands.executeCommand("opencode-ui.newSessionAndOpen", this.ref.dir)
          return
        }

        if (message?.type === "openFile") {
          void openFile(this.ref.dir, message.filePath, message.line)
          return
        }

        if (message?.type === "resolveFileRefs") {
          void resolveFileRefs(this.panel.webview, this.ref.dir, message.refs)
          return
        }

        if (message?.type === "searchFiles") {
          void searchFiles(this.panel.webview, this.ref.dir, message.requestID, message.query)
          return
        }

        if (message?.type === "toggleMcp") {
          void toggleMcp(this.actionContext(), message.name, message.action)
          return
        }

        if (message?.type === "composerAction") {
          void runComposerAction(this.actionContext(), message.action, message.model)
          return
        }

        if (message?.type === "runSlashCommand") {
          void runSlashCommand(this.actionContext(), message.command, message.arguments)
        }
      },
      undefined,
      this.bag,
    )

    this.panel.onDidDispose(() => {
      this.dispose()
    }, undefined, this.bag)

    this.panel.onDidChangeViewState(({ webviewPanel }) => {
      this.onActive(webviewPanel.active ? this.ref : undefined)
    }, undefined, this.bag)

    this.bag.push(
      this.mgr.onDidChange(() => {
        void this.push(true)
      }),
      this.events.onDidEvent((item) => {
        if (item.dir !== this.ref.dir) {
          return
        }
        void this.handle(item.event)
      }),
    )
  }

  async reveal() {
    await this.push()
    this.panel.reveal(vscode.ViewColumn.Active)
  }

  async push(force?: boolean) {
    if (!this.ready || this.state.disposed) {
      return
    }

    if (!force && this.current) {
      await this.post(this.current)
      return
    }

    if (!this.pending) {
      this.pending = this.refresh().finally(() => {
        this.pending = undefined
      })
    }

    await this.pending
  }

  dispose() {
    if (this.state.disposed) {
      return
    }

    this.state.disposed = true
    this.state.run += 1
    this.onDispose(this.key)
    vscode.Disposable.from(...this.bag).dispose()
  }

  private async refresh() {
    const payload = await buildSessionSnapshot({
      ref: this.ref,
      mgr: this.mgr,
      log: (message) => {
        this.log(message)
      },
      isSubmitting: () => this.isSubmitting(),
    })
    this.current = payload
    await this.post(payload)
  }

  private async post(payload: SessionSnapshot) {
    this.panel.title = panelTitle(payload.session?.title || this.ref.sessionId)
    await postToWebview(this.panel.webview, {
      type: "bootstrap",
      payload: boot(payload),
    })
    await postToWebview(this.panel.webview, {
      type: "snapshot",
      payload,
    })
  }

  private isSubmitting() {
    return this.state.pendingSubmitCount > 0
  }

  private async handle(event: SessionEvent) {
    if (this.state.disposed || !this.ready) {
      return
    }

    if (this.current && needsRefresh(event, this.current)) {
      await this.push(true)
      return
    }

    if (!this.current || this.current.status !== "ready") {
      return
    }

    const next = reduce(this.current, event)
    if (!next) {
      return
    }

    this.current = patch(next)
    await this.post(this.current)
  }

  private log(message: string) {
    this.out.appendLine(`[panel ${this.key}] ${message}`)
  }

  private actionContext() {
    return {
      ref: this.ref,
      mgr: this.mgr,
      panel: this.panel,
      state: this.state,
      log: (message: string) => {
        this.log(message)
      },
      push: (force?: boolean) => this.push(force),
    }
  }
}
