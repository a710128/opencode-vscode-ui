import * as vscode from "vscode"
import { EventHub } from "./events"
import type { WorkspaceRuntime } from "./server"
import { shouldTrackSession, syncTrackedSession } from "./session-list"
import type { SessionEvent, SessionInfo, SessionStatus } from "./sdk"
import { WorkspaceManager } from "./workspace"

type RefreshRuntime = {
  workspaceId: string
  dir: string
  name: string
  sdk: NonNullable<WorkspaceRuntime["sdk"]>
  sessionsState: "idle" | "loading" | "ready" | "error"
  sessionsErr?: string
}

type InflightRefresh = {
  promise: Promise<SessionInfo[]>
  rt: RefreshRuntime
  loud: boolean
}

export class SessionStore implements vscode.Disposable {
  private seen = new Set<string>()
  private inflightRefresh = new Map<string, InflightRefresh>()
  private refreshRev = new Map<string, number>()
  private infoRev = new Map<string, number>()
  private infoEventRev = new Map<string, Map<string, number>>()
  private infoTombstones = new Map<string, Map<string, number>>()
  private statusRev = new Map<string, number>()
  private statusEventRev = new Map<string, Map<string, number>>()

  constructor(
    private mgr: WorkspaceManager,
    private events: EventHub,
    private out: vscode.OutputChannel,
  ) {
    this.mgr.onDidChange(() => {
      void this.sync()
    })

    this.events.onDidEvent((item) => {
      this.handleEvent(item.workspaceId, item.event)
    })
  }

  list(workspaceId: string) {
    const rt = this.mgr.get(workspaceId)

    if (!rt) {
      return []
    }

    return [...rt.sessions.values()].sort((a, b) => b.time.updated - a.time.updated)
  }

  async refresh(workspaceId: string, quiet?: boolean) {
    const rt = this.mgr.get(workspaceId)

    if (!rt || rt.state !== "ready" || !rt.sdk) {
      return []
    }

    const refreshRt = rt as RefreshRuntime
    const pending = this.inflightRefresh.get(workspaceId)
    if (pending?.rt === refreshRt) {
      if (!quiet) {
        pending.loud = true
      }
      return pending.promise
    }

    const entry: InflightRefresh = {
      rt: refreshRt,
      loud: !quiet,
      promise: Promise.resolve([]),
    }
    entry.promise = this.runRefresh(entry)
    this.inflightRefresh.set(workspaceId, entry)
    try {
      return await entry.promise
    } finally {
      if (this.inflightRefresh.get(workspaceId) === entry) {
        this.inflightRefresh.delete(workspaceId)
      }
    }
  }

  async refreshAll() {
    await Promise.all(this.mgr.list().map((rt) => this.refresh(rt.workspaceId, true)))
    this.mgr.invalidate()
  }

  async create(workspaceId: string) {
    const rt = this.mgr.get(workspaceId)

    if (!rt || rt.state !== "ready" || !rt.sdk) {
      throw new Error("workspace server is not ready")
    }

    try {
      const res = await rt.sdk.session.create({ directory: rt.dir })
      const item = res.data

      if (!item) {
        throw new Error("session create returned no data")
      }

      syncTrackedSession(rt.sessions, rt.sessionStatuses, item)
      rt.sessionsState = "ready"
      rt.sessionsErr = undefined
      this.mgr.invalidate()
      this.log(rt.name, `created session ${item.id}`)
      await this.refresh(rt.workspaceId, true)
      return item
    } catch (err) {
      const msg = text(err)
      this.log(rt.name, `session create failed: ${msg}`)
      await vscode.window.showErrorMessage(`OpenCode session create failed for ${rt.name}: ${msg}`)
      throw err
    }
  }

  async delete(workspaceId: string, sessionID: string) {
    const rt = this.mgr.get(workspaceId)

    if (!rt || rt.state !== "ready" || !rt.sdk) {
      throw new Error("workspace server is not ready")
    }

    try {
      await rt.sdk.session.delete({
        sessionID,
        directory: rt.dir,
      })
      rt.sessions.delete(sessionID)
      rt.sessionStatuses.delete(sessionID)
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

  private handleEvent(workspaceId: string, event: SessionEvent) {
    const rt = this.mgr.get(workspaceId)

    if (!rt) {
      return
    }

    if (isSessionStatusEvent(event)) {
      const sessionID = event.properties.sessionID
      const status = event.properties.status

      if (!sessionID || !status || typeof status !== "object") {
        return
      }

      if (!isSessionStatus(status)) {
        return
      }

      if (!rt.sessions.has(sessionID)) {
        return
      }

      rt.sessionStatuses.set(sessionID, status)
      this.setEventRev(workspaceId, sessionID, this.bumpRev(workspaceId))
      this.mgr.invalidate()
      return
    }

    if (isSessionInfoEvent(event)) {
      const info = event.properties.info
      const rev = this.bumpInfoRev(workspaceId)

      if (syncTrackedSession(rt.sessions, rt.sessionStatuses, info)) {
        this.infoTombstones.get(workspaceId)?.delete(info.id)
        this.setInfoEventRev(workspaceId, info.id, rev)
      } else {
        this.setInfoEventRev(workspaceId, info.id, rev)
        this.setInfoTombstone(workspaceId, info.id, info.time.updated)
        this.setEventRev(workspaceId, info.id, this.bumpRev(workspaceId))
      }

      this.mgr.invalidate()
      return
    }

    if (isSessionDeletedEvent(event)) {
      const info = event.properties.info
      if (!info?.id) {
        return
      }

      this.setInfoEventRev(workspaceId, info.id, this.bumpInfoRev(workspaceId))
      this.setInfoTombstone(workspaceId, info.id, info.time.updated)
      this.setEventRev(workspaceId, info.id, this.bumpRev(workspaceId))
      rt.sessions.delete(info.id)
      rt.sessionStatuses.delete(info.id)
      this.mgr.invalidate()
    }
  }

  private async sync() {
    const ids = new Set(this.mgr.list().map((rt) => rt.workspaceId))

    this.seen = new Set([...this.seen].filter((workspaceId) => ids.has(workspaceId)))

    await Promise.all(
      this.mgr
        .list()
        .filter((rt) => rt.state === "ready" && rt.sdk && !this.seen.has(rt.workspaceId) && rt.sessionsState !== "loading")
        .map((rt) => this.refresh(rt.workspaceId, true)),
    )
  }

  private async runRefresh(entry: InflightRefresh) {
    const rt = entry.rt
    rt.sessionsState = "loading"
    rt.sessionsErr = undefined
    const refreshRev = this.bumpRefreshRev(rt.workspaceId)
    this.mgr.invalidate()

    try {
      const infoRev = this.infoRevision(rt.workspaceId)
      const rev = this.rev(rt.workspaceId)
      const [listRes, statusRes] = await Promise.all([
        rt.sdk.session.list({
          directory: rt.dir,
          roots: true,
        }),
        rt.sdk.session.status({
          directory: rt.dir,
        }).catch(() => ({ data: undefined })),
      ])

      if (!this.isLatestRefresh(rt.workspaceId, refreshRev)) {
        return this.list(rt.workspaceId)
      }

      const list: SessionInfo[] = listRes.data ?? []
      this.applySessions(rt.workspaceId, list, infoRev)
      this.applyStatuses(rt.workspaceId, list.map((item) => item.id), statusRes.data, rev)
      rt.sessionsState = "ready"
      rt.sessionsErr = undefined
      this.seen.add(rt.workspaceId)
      this.log(rt.name, `loaded ${list.length} sessions`)
      return list
    } catch (err) {
      if (!this.isLatestRefresh(rt.workspaceId, refreshRev)) {
        return this.list(rt.workspaceId)
      }

      rt.sessionsState = "error"
      rt.sessionsErr = text(err)
      this.log(rt.name, `session list failed: ${rt.sessionsErr}`)
      if (entry.loud) {
        await vscode.window.showErrorMessage(`OpenCode session list failed for ${rt.name}: ${rt.sessionsErr}`)
      }
      return []
    } finally {
      if (this.isLatestRefresh(rt.workspaceId, refreshRev)) {
        this.mgr.invalidate()
      }
    }
  }

  private log(name: string, msg: string) {
    this.out.appendLine(`[${name}] ${msg}`)
  }

  private applySessions(workspaceId: string, list: SessionInfo[], revAtStart: number) {
    const rt = this.mgr.get(workspaceId)

    if (!rt) {
      return
    }

    const roots = list.filter(shouldTrackSession)
    const ids = new Set(roots.map((item) => item.id))
    const eventRevs = this.infoEventRev.get(workspaceId)
    const tombstones = this.infoTombstones.get(workspaceId)

    for (const id of [...rt.sessions.keys()]) {
      if (!ids.has(id) && (eventRevs?.get(id) ?? 0) <= revAtStart) {
        rt.sessions.delete(id)
      }
    }

    for (const info of roots) {
      const tombstone = tombstones?.get(info.id)
      if (typeof tombstone === "number" && info.time.updated <= tombstone) {
        continue
      }

      const local = rt.sessions.get(info.id)
      if (local && local.time.updated >= info.time.updated) {
        continue
      }

      tombstones?.delete(info.id)
      rt.sessions.set(info.id, info)
    }

  }

  private applyStatuses(
    workspaceId: string,
    sessionIDs: string[],
    next: Record<string, SessionStatus> | undefined,
    revAtStart: number,
  ) {
    const rt = this.mgr.get(workspaceId)

    if (!rt) {
      return
    }

    const ids = new Set(sessionIDs)

    if (!next) {
      for (const id of [...rt.sessionStatuses.keys()]) {
        if (!ids.has(id)) {
          rt.sessionStatuses.delete(id)
        }
      }
      this.pruneEventRevs(workspaceId, ids)
      return
    }

    const eventRevs = this.statusEventRev.get(workspaceId)

    for (const id of [...rt.sessionStatuses.keys()]) {
      if (!ids.has(id)) {
        rt.sessionStatuses.delete(id)
      }
    }

    for (const id of sessionIDs) {
      if ((eventRevs?.get(id) ?? 0) > revAtStart) {
        continue
      }

      const status = next[id]
      if (status) {
        rt.sessionStatuses.set(id, status)
        continue
      }

      rt.sessionStatuses.delete(id)
    }

    this.pruneEventRevs(workspaceId, ids)
  }

  private rev(workspaceId: string) {
    return this.statusRev.get(workspaceId) ?? 0
  }

  private isLatestRefresh(workspaceId: string, rev: number) {
    return (this.refreshRev.get(workspaceId) ?? 0) === rev
  }

  private infoRevision(workspaceId: string) {
    return this.infoRev.get(workspaceId) ?? 0
  }

  private bumpRefreshRev(workspaceId: string) {
    const next = (this.refreshRev.get(workspaceId) ?? 0) + 1
    this.refreshRev.set(workspaceId, next)
    return next
  }

  private bumpRev(workspaceId: string) {
    const next = this.rev(workspaceId) + 1
    this.statusRev.set(workspaceId, next)
    return next
  }

  private bumpInfoRev(workspaceId: string) {
    const next = this.infoRevision(workspaceId) + 1
    this.infoRev.set(workspaceId, next)
    return next
  }

  private setInfoEventRev(workspaceId: string, sessionID: string, rev: number) {
    let map = this.infoEventRev.get(workspaceId)
    if (!map) {
      map = new Map()
      this.infoEventRev.set(workspaceId, map)
    }
    map.set(sessionID, rev)
  }

  private setInfoTombstone(workspaceId: string, sessionID: string, updatedAt: number) {
    let map = this.infoTombstones.get(workspaceId)
    if (!map) {
      map = new Map()
      this.infoTombstones.set(workspaceId, map)
    }
    map.set(sessionID, updatedAt)
  }

  private setEventRev(workspaceId: string, sessionID: string, rev: number) {
    let map = this.statusEventRev.get(workspaceId)
    if (!map) {
      map = new Map()
      this.statusEventRev.set(workspaceId, map)
    }
    map.set(sessionID, rev)
  }

  private pruneEventRevs(workspaceId: string, ids: Set<string>) {
    const map = this.statusEventRev.get(workspaceId)
    if (!map) {
      return
    }

    for (const id of [...map.keys()]) {
      if (!ids.has(id)) {
        map.delete(id)
      }
    }

    if (!map.size) {
      this.statusEventRev.delete(workspaceId)
    }
  }

}

function isSessionStatus(value: unknown): value is SessionStatus {
  if (!value || typeof value !== "object") {
    return false
  }

  const type = "type" in value ? value.type : undefined
  if (type === "idle" || type === "busy") {
    return true
  }

  return type === "retry"
}

function isSessionStatusEvent(event: SessionEvent): event is Extract<SessionEvent, { type: "session.status" }> {
  return event.type === "session.status"
}

function isSessionDeletedEvent(event: SessionEvent): event is Extract<SessionEvent, { type: "session.deleted" }> {
  return event.type === "session.deleted"
}

function isSessionInfoEvent(event: SessionEvent): event is Extract<SessionEvent, { type: "session.updated" | "session.created" }> {
  return event.type === "session.updated" || event.type === "session.created"
}

function text(err: unknown) {
  if (err instanceof Error) {
    return err.message
  }

  return String(err)
}
