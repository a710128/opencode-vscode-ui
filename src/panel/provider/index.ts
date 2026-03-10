import * as vscode from "vscode"
import { SESSION_PANEL_VIEW_TYPE, type SessionPanelRef } from "../../bridge/types"
import { EventHub } from "../../core/events"
import { WorkspaceManager } from "../../core/workspace"
import { sessionPanelHtml } from "../html"
import { SessionPanelController } from "./controller"
import { panelIconPath, panelKey, panelTitle, reviveState } from "./utils"

export class SessionPanelManager implements vscode.Disposable {
  private readonly panels = new Map<string, SessionPanelController>()
  private readonly active = new vscode.EventEmitter<SessionPanelRef | undefined>()
  private currentRef: SessionPanelRef | undefined

  readonly onDidChangeActiveSession = this.active.event

  constructor(
    private extensionUri: vscode.Uri,
    private mgr: WorkspaceManager,
    private events: EventHub,
    private out: vscode.OutputChannel,
  ) {}

  async open(ref: SessionPanelRef) {
    const key = panelKey(ref)
    const existing = this.panels.get(key)

    if (existing) {
      await existing.reveal()
      return existing.panel
    }

    const panel = vscode.window.createWebviewPanel(SESSION_PANEL_VIEW_TYPE, panelTitle(ref.sessionId), vscode.ViewColumn.Active, {
      enableScripts: true,
      retainContextWhenHidden: true,
      localResourceRoots: [vscode.Uri.joinPath(this.extensionUri, "dist")],
    })

    const controller = this.attach(ref, panel)
    await controller.push()
    return panel
  }

  async restore(panel: vscode.WebviewPanel, state: unknown) {
    const ref = reviveState(state)

    if (!ref) {
      panel.webview.html = sessionPanelHtml(panel.webview, this.extensionUri)
      panel.title = panelTitle("unknown")
      panel.iconPath = panelIconPath(this.extensionUri)
      this.out.appendLine("[panel] skipped restore due to invalid state")
      return
    }

    const controller = this.attach(ref, panel)
    await controller.push()
  }

  activeSession() {
    return this.currentRef
  }

  close(ref: SessionPanelRef) {
    const key = panelKey(ref)
    const controller = this.panels.get(key)

    if (!controller) {
      return false
    }

    controller.panel.dispose()
    return true
  }

  dispose() {
    for (const controller of this.panels.values()) {
      controller.dispose()
    }
    this.panels.clear()
    this.active.dispose()
  }

  private attach(ref: SessionPanelRef, panel: vscode.WebviewPanel) {
    const key = panelKey(ref)
    const controller = new SessionPanelController(
      this.extensionUri,
      ref,
      key,
      panel,
      this.mgr,
      this.events,
      this.out,
      (next) => {
        this.setActive(next)
      },
      (disposedKey) => {
        this.panels.delete(disposedKey)
        if (panelKey(this.currentRef) === disposedKey) {
          this.setActive(undefined)
        }
      },
    )
    this.panels.set(key, controller)
    if (panel.active) {
      this.setActive(ref)
    }
    return controller
  }

  private setActive(ref: SessionPanelRef | undefined) {
    if (panelKey(this.currentRef) === panelKey(ref)) {
      return
    }

    this.currentRef = ref
    this.active.fire(ref)
  }
}
