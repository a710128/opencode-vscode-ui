import * as vscode from "vscode"
import { SESSION_PANEL_VIEW_TYPE } from "./bridge/types"
import { commands } from "./core/commands"
import { EventHub } from "./core/events"
import { affectsHttpProxySetting, affectsOpencodeExecutablePathSetting, affectsWorkspaceTargetsSetting, executablePathRestartMessage, proxyRestartMessage } from "./core/settings"
import { SessionStore } from "./core/session"
import { computeTargets } from "./core/submodules"
import { TabManager } from "./core/tabs"
import { WorkspaceManager } from "./core/workspace"
import { SessionPanelManager } from "./panel/provider"
import { SessionPanelSerializer } from "./panel/serializer"
import { FocusedSessionStore } from "./sidebar/focused"
import { WorkspaceItem } from "./sidebar/item"
import { SidebarProvider } from "./sidebar/provider"
import { SidebarViewProvider } from "./sidebar/view-provider"

let mgr: WorkspaceManager | undefined

export async function activate(ctx: vscode.ExtensionContext) {
  const out = vscode.window.createOutputChannel("OpenCode UI")
  out.appendLine(`OpenCode UI activating (remote=${vscode.env.remoteName || "local"}, uiKind=${vscode.UIKind[vscode.env.uiKind]})`)
  mgr = new WorkspaceManager(out)
  const events = new EventHub(mgr, out)
  const sessions = new SessionStore(mgr, events, out)
  let resolveInitialSync = () => {}
  let rejectInitialSync = (_err: unknown) => {}
  const initialSync = new Promise<void>((resolve, reject) => {
    resolveInitialSync = resolve
    rejectInitialSync = reject
  })
  const waitInitialSync = () => initialSync
  const panels = new SessionPanelManager(ctx.extensionUri, mgr, events, out, waitInitialSync)
  const tabs = new TabManager(panels)
  const focused = new FocusedSessionStore(mgr, panels, events, out)

  const tree = new SidebarProvider(mgr, sessions)
  const todoView = new SidebarViewProvider(ctx.extensionUri, "todo", focused)
  const diffView = new SidebarViewProvider(ctx.extensionUri, "diff", focused)
  const treeView = vscode.window.createTreeView("opencode-ui.sessions", { treeDataProvider: tree })
  const todoReg = vscode.window.registerWebviewViewProvider("opencode-ui.todo", todoView)
  const diffReg = vscode.window.registerWebviewViewProvider("opencode-ui.diff", diffView)
  const serializer = vscode.window.registerWebviewPanelSerializer(
    SESSION_PANEL_VIEW_TYPE,
    new SessionPanelSerializer(panels),
  )

  const syncTargets = async () => {
    await mgr!.sync(await computeTargets(out))
    await events.sync()
  }

  commands(ctx, mgr, sessions, out, tabs, syncTargets)

  ctx.subscriptions.push(out, mgr, sessions, events, panels, focused, tree, todoView, diffView, treeView, todoReg, diffReg, serializer)
  out.appendLine("OpenCode UI activated")

  try {
    await syncTargets()
    await sessions.refreshAll()
    resolveInitialSync()
  } catch (err) {
    rejectInitialSync(err)
    throw err
  }

  let gitmodulesTimer: ReturnType<typeof setTimeout> | undefined
  const scheduleTargetsSync = () => {
    if (gitmodulesTimer) {
      clearTimeout(gitmodulesTimer)
    }

    gitmodulesTimer = setTimeout(() => {
      gitmodulesTimer = undefined
      void syncTargets()
    }, 500)
  }

  const gitmodulesWatcher = vscode.workspace.createFileSystemWatcher("**/.gitmodules")
  gitmodulesWatcher.onDidCreate(scheduleTargetsSync)
  gitmodulesWatcher.onDidChange(scheduleTargetsSync)
  gitmodulesWatcher.onDidDelete(scheduleTargetsSync)

  ctx.subscriptions.push(
    gitmodulesWatcher,
    {
      dispose() {
        if (gitmodulesTimer) {
          clearTimeout(gitmodulesTimer)
        }
      },
    },
    treeView.onDidExpandElement(async (event) => {
      const item = event.element
      if (!(item instanceof WorkspaceItem) || item.runtime.state !== "idle") {
        return
      }

      const rt = await mgr?.start(item.runtime.workspaceId)
      if (rt?.state === "ready") {
        await sessions.refresh(rt.workspaceId, true)
      }
    }),
    vscode.workspace.onDidChangeConfiguration(async (event) => {
      if (affectsWorkspaceTargetsSetting(event)) {
        await syncTargets()
      }

      let message = ""

      if (affectsOpencodeExecutablePathSetting(event)) {
        message = executablePathRestartMessage()
      } else if (affectsHttpProxySetting(event)) {
        message = proxyRestartMessage()
      }

      if (!message) {
        return
      }

      const action = await vscode.window.showInformationMessage(message, "Reload Window")
      if (action === "Reload Window") {
        await vscode.commands.executeCommand("workbench.action.reloadWindow")
      }
    }),
    vscode.workspace.onDidChangeWorkspaceFolders(async () => {
      await syncTargets()
    }),
  )
}

export async function deactivate() {
  await mgr?.shutdown()
  mgr?.dispose()
  mgr = undefined
}
