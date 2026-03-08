import * as vscode from "vscode"
import type { SessionInfo } from "./sdk"
import { WorkspaceManager } from "./workspace"

export class SessionStore implements vscode.Disposable {
  private seen = new Set<string>()

  constructor(
    private mgr: WorkspaceManager,
    private out: vscode.OutputChannel,
  ) {
    this.mgr.onDidChange(() => {
      void this.sync()
    })
  }

  list(dir: string) {
    const rt = this.mgr.get(dir)

    if (!rt) {
      return []
    }

    return [...rt.sessions.values()].sort((a, b) => b.time.updated - a.time.updated)
  }

  async refresh(dir: string, quiet?: boolean) {
    const rt = this.mgr.get(dir)

    if (!rt || rt.state !== "ready" || !rt.sdk) {
      return []
    }

    rt.sessionsState = "loading"
    rt.sessionsErr = undefined
    this.mgr.invalidate()

    try {
      const res = await rt.sdk.session.list({
        directory: rt.dir,
        roots: true,
      })
      const list = res.data ?? []
      rt.sessions = new Map(list.map((item: SessionInfo) => [item.id, item]))
      rt.sessionsState = "ready"
      rt.sessionsErr = undefined
      this.seen.add(dir)
      this.log(rt.name, `loaded ${list.length} sessions`)
      return list
    } catch (err) {
      rt.sessionsState = "error"
      rt.sessionsErr = text(err)
      this.log(rt.name, `session list failed: ${rt.sessionsErr}`)
      if (!quiet) {
        await vscode.window.showErrorMessage(`OpenCode session list failed for ${rt.name}: ${rt.sessionsErr}`)
      }
      return []
    } finally {
      this.mgr.invalidate()
    }
  }

  async refreshAll() {
    await Promise.all(this.mgr.list().map((rt) => this.refresh(rt.dir, true)))
    this.mgr.invalidate()
  }

  async create(dir: string) {
    const rt = this.mgr.get(dir)

    if (!rt || rt.state !== "ready" || !rt.sdk) {
      throw new Error("workspace server is not ready")
    }

    try {
      const res = await rt.sdk.session.create({ directory: rt.dir })
      const item = res.data

      if (!item) {
        throw new Error("session create returned no data")
      }

      rt.sessions.set(item.id, item)
      rt.sessionsState = "ready"
      rt.sessionsErr = undefined
      this.mgr.invalidate()
      this.log(rt.name, `created session ${item.id}`)
      await this.refresh(dir, true)
      return item
    } catch (err) {
      const msg = text(err)
      this.log(rt.name, `session create failed: ${msg}`)
      await vscode.window.showErrorMessage(`OpenCode session create failed for ${rt.name}: ${msg}`)
      throw err
    }
  }

  async delete(dir: string, sessionID: string) {
    const rt = this.mgr.get(dir)

    if (!rt || rt.state !== "ready" || !rt.sdk) {
      throw new Error("workspace server is not ready")
    }

    try {
      await rt.sdk.session.delete({
        sessionID,
        directory: rt.dir,
      })
      rt.sessions.delete(sessionID)
      rt.sessionsState = "ready"
      rt.sessionsErr = undefined
      this.mgr.invalidate()
      this.log(rt.name, `deleted session ${sessionID}`)
      return true
    } catch (err) {
      const msg = text(err)
      this.log(rt.name, `session delete failed: ${msg}`)
      await vscode.window.showErrorMessage(`OpenCode session delete failed for ${rt.name}: ${msg}`)
      throw err
    }
  }

  dispose() {}

  private async sync() {
    const dirs = new Set(this.mgr.list().map((rt) => rt.dir))

    this.seen = new Set([...this.seen].filter((dir) => dirs.has(dir)))

    await Promise.all(
      this.mgr
        .list()
        .filter((rt) => rt.state === "ready" && rt.sdk && !this.seen.has(rt.dir) && rt.sessionsState !== "loading")
        .map((rt) => this.refresh(rt.dir, true)),
    )
  }

  private log(name: string, msg: string) {
    this.out.appendLine(`[${name}] ${msg}`)
  }
}

function text(err: unknown) {
  if (err instanceof Error) {
    return err.message
  }

  return String(err)
}
