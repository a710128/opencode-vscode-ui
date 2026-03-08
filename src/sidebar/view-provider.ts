import * as path from "node:path"
import * as vscode from "vscode"
import { FocusedSessionStore } from "./focused"
import { sidebarViewHtml } from "./html"
import type { SidebarHostMessage, SidebarViewMode, SidebarWebviewMessage } from "./view-types"

export class SidebarViewProvider implements vscode.WebviewViewProvider, vscode.Disposable {
  private readonly bag: vscode.Disposable[] = []
  private view: vscode.WebviewView | undefined

  constructor(
    private extensionUri: vscode.Uri,
    private mode: SidebarViewMode,
    private focused: FocusedSessionStore,
  ) {
    this.bag.push(this.focused.onDidChange(() => {
      void this.post()
    }))
  }

  resolveWebviewView(view: vscode.WebviewView) {
    this.view = view
    view.webview.options = {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(this.extensionUri, "dist")],
    }
    view.webview.html = sidebarViewHtml(view.webview, this.extensionUri, this.mode)
    view.webview.onDidReceiveMessage((message: SidebarWebviewMessage) => {
      if (message.type === "ready") {
        void this.post()
        return
      }

      if (message.type === "openFile") {
        const ref = this.focused.snapshot().ref
        if (!ref) {
          return
        }

        const target = vscode.Uri.file(path.join(ref.dir, message.filePath))
        void vscode.commands.executeCommand("vscode.open", target)
      }
    }, undefined, this.bag)
  }

  dispose() {
    vscode.Disposable.from(...this.bag).dispose()
  }

  private async post() {
    if (!this.view) {
      return
    }

    const state = this.focused.snapshot()
    const message: SidebarHostMessage = {
      type: "state",
      payload: {
        status: state.status,
        mode: this.mode,
        sessionTitle: state.session?.title || state.session?.id?.slice(0, 8),
        todos: state.todos,
        diff: state.diff,
        error: state.error,
      },
    }
    await this.view.webview.postMessage(message)
  }
}
