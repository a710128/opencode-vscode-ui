import * as path from "node:path"
import * as vscode from "vscode"
import { postToWebview } from "../bridge/host"
import { SESSION_PANEL_VIEW_TYPE, type SessionBootstrap, type SessionPanelRef, type SessionSnapshot, type WebviewMessage } from "../bridge/types"
import { EventHub } from "../core/events"
import type {
  Client,
  FileDiff,
  MessagePart,
  PermissionReply,
  PermissionRequest,
  QuestionRequest,
  SessionEvent,
  SessionMessage,
  SessionStatus,
  Todo,
} from "../core/sdk"
import { WorkspaceManager } from "../core/workspace"
import { sessionPanelHtml } from "./html"

type SessionPanelState = SessionPanelRef

class SessionPanelController implements vscode.Disposable {
  private ready = false
  private disposed = false
  private submitting = false
  private pending: Promise<void> | undefined
  private current: SessionSnapshot | undefined
  private run = 0
  private readonly bag: vscode.Disposable[] = []

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
          void this.submit(message.text)
          return
        }

        if (message?.type === "permissionReply") {
          void this.replyPermission(message.requestID, message.reply, message.message)
          return
        }

        if (message?.type === "questionReply") {
          void this.replyQuestion(message.requestID, message.answers)
          return
        }

        if (message?.type === "questionReject") {
          void this.rejectQuestion(message.requestID)
          return
        }

        if (message?.type === "navigateSession") {
          void vscode.commands.executeCommand("opencode-ui.openSessionById", this.ref.dir, message.sessionID)
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
    if (!this.ready || this.disposed) {
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
    if (this.disposed) {
      return
    }

    this.disposed = true
    this.run += 1
    this.onDispose(this.key)
    vscode.Disposable.from(...this.bag).dispose()
  }

  private async refresh() {
    const payload = await this.snapshot()
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

  private async snapshot(): Promise<SessionSnapshot> {
    const rt = this.mgr.get(this.ref.dir)
    const workspaceName = rt?.name || path.basename(this.ref.dir)

    if (!rt || rt.state === "starting" || !rt.sdk) {
        return {
          status: "loading",
          sessionRef: this.ref,
          workspaceName,
          message: "Workspace runtime is starting.",
          messages: [],
          childMessages: {},
          childSessions: {},
          submitting: this.submitting,
          todos: [],
          diff: [],
          permissions: [],
          questions: [],
          relatedSessionIds: [this.ref.sessionId],
          agentMode: "build",
          navigation: {},
        }
      }

    if (rt.state !== "ready") {
        return {
          status: "error",
          sessionRef: this.ref,
          workspaceName,
          message: rt.err || "Workspace runtime is not ready.",
          messages: [],
          childMessages: {},
          childSessions: {},
          submitting: this.submitting,
          todos: [],
          diff: [],
          permissions: [],
          questions: [],
          relatedSessionIds: [this.ref.sessionId],
          agentMode: "build",
          navigation: {},
        }
      }

    try {
      const [sessionRes, sessionsRes, rootMessageRes, statusRes, todoRes, diffRes, permissionRes, questionRes] = await Promise.all([
        rt.sdk.session.get({
          sessionID: this.ref.sessionId,
          directory: rt.dir,
        }),
        rt.sdk.session.list({
          directory: rt.dir,
        }),
        rt.sdk.session.messages({
          sessionID: this.ref.sessionId,
          directory: rt.dir,
          limit: 200,
        }),
        rt.sdk.session.status({
          directory: rt.dir,
        }),
        rt.sdk.session.todo({
          sessionID: this.ref.sessionId,
          directory: rt.dir,
        }),
        rt.sdk.session.diff({
          sessionID: this.ref.sessionId,
          directory: rt.dir,
        }),
        rt.sdk.permission.list({
          directory: rt.dir,
        }),
        rt.sdk.question.list({
          directory: rt.dir,
        }),
      ])

      const session = sessionRes.data

      if (!session) {
        return {
          status: "error",
          sessionRef: this.ref,
          workspaceName,
          message: "Session metadata was not found for this workspace.",
          messages: [],
          childMessages: {},
          childSessions: {},
          submitting: this.submitting,
          todos: [],
          diff: [],
          permissions: [],
          questions: [],
          relatedSessionIds: [this.ref.sessionId],
          agentMode: "build",
          navigation: {},
        }
      }

      rt.sessions.set(session.id, session)
      const relatedSessionIds = collectRelatedSessionIds(session, sessionsRes.data ?? [])
      const [messages, childMessages] = await relatedMessages(rt.sdk, rt.dir, this.ref.sessionId, relatedSessionIds, rootMessageRes.data ?? [])
      const childSessions = relatedSessionMap(sessionsRes.data ?? [], this.ref.sessionId, relatedSessionIds)
      const navigation = nav(session, sessionsRes.data ?? [])
      return patch({
        status: "ready",
        sessionRef: this.ref,
        workspaceName,
        session,
        sessionStatus: statusRes.data?.[this.ref.sessionId] ?? idle(),
        messages,
        childMessages,
        childSessions,
        submitting: this.submitting,
        todos: todoRes.data ?? [],
        diff: sortDiff(diffRes.data ?? []),
        permissions: filterPermission(permissionRes.data ?? [], relatedSessionIds),
        questions: filterQuestion(questionRes.data ?? [], relatedSessionIds),
        relatedSessionIds,
        agentMode: agentMode(messages),
        navigation,
      })
    } catch (err) {
      this.log(`snapshot failed: ${text(err)}`)
      return {
        status: "error",
        sessionRef: this.ref,
        workspaceName,
        message: text(err),
        messages: [],
        childMessages: {},
        childSessions: {},
        submitting: this.submitting,
        todos: [],
        diff: [],
        permissions: [],
        questions: [],
        relatedSessionIds: [this.ref.sessionId],
        agentMode: "build",
        navigation: {},
      }
    }
  }

  private async submit(textValue: string) {
    const text = textValue.trim()

    if (!text || this.disposed || this.submitting) {
      return
    }

    const rt = this.mgr.get(this.ref.dir)

    if (!rt || rt.state !== "ready" || !rt.sdk) {
      await this.fail("Workspace server is not ready.")
      return
    }

    const run = ++this.run
    this.submitting = true
    await this.push(true)

    try {
      await rt.sdk.session.promptAsync({
        sessionID: this.ref.sessionId,
        directory: rt.dir,
        parts: [
          {
            type: "text",
            text,
          },
        ],
      })
      await wait(400)
      if (!this.disposed && run === this.run) {
        await this.push(true)
      }
    } catch (err) {
      const message = textError(err)
      this.log(`submit failed: ${message}`)
      await vscode.window.showErrorMessage(`OpenCode message send failed for ${rt.name}: ${message}`)
      await this.fail(message)
    } finally {
      if (run === this.run) {
        this.submitting = false
      }
      await this.push(true)
    }
  }

  private async handle(event: SessionEvent) {
    if (this.disposed || !this.ready) {
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

  private async replyPermission(requestID: string, reply: PermissionReply, message?: string) {
    const rt = this.mgr.get(this.ref.dir)

    if (!rt || rt.state !== "ready" || !rt.sdk) {
      await this.fail("Workspace server is not ready.")
      return
    }

    try {
      await rt.sdk.permission.reply({
        requestID,
        directory: rt.dir,
        reply,
        message,
      })
      await this.push(true)
    } catch (err) {
      const msg = textError(err)
      this.log(`permission reply failed: ${msg}`)
      await this.fail(msg)
    }
  }

  private async replyQuestion(requestID: string, answers: string[][]) {
    const rt = this.mgr.get(this.ref.dir)

    if (!rt || rt.state !== "ready" || !rt.sdk) {
      await this.fail("Workspace server is not ready.")
      return
    }

    try {
      await rt.sdk.question.reply({
        requestID,
        directory: rt.dir,
        answers,
      })
      await this.push(true)
    } catch (err) {
      const msg = textError(err)
      this.log(`question reply failed: ${msg}`)
      await this.fail(msg)
    }
  }

  private async rejectQuestion(requestID: string) {
    const rt = this.mgr.get(this.ref.dir)

    if (!rt || rt.state !== "ready" || !rt.sdk) {
      await this.fail("Workspace server is not ready.")
      return
    }

    try {
      await rt.sdk.question.reject({
        requestID,
        directory: rt.dir,
      })
      await this.push(true)
    } catch (err) {
      const msg = textError(err)
      this.log(`question reject failed: ${msg}`)
      await this.fail(msg)
    }
  }

  private async fail(message: string) {
    await postToWebview(this.panel.webview, {
      type: "error",
      message,
    })
  }

  private log(message: string) {
    this.out.appendLine(`[panel ${this.key}] ${message}`)
  }
}

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

function reviveState(state: unknown): SessionPanelState | undefined {
  if (!state || typeof state !== "object") {
    return undefined
  }

  const maybe = state as Partial<SessionPanelState>

  if (!maybe.dir || !maybe.sessionId) {
    return undefined
  }

  return {
    dir: maybe.dir,
    sessionId: maybe.sessionId,
  }
}

function panelKey(ref?: SessionPanelRef) {
  if (!ref) {
    return ""
  }
  return `${ref.dir}::${ref.sessionId}`
}

function panelTitle(title: string) {
  return `OpenCode: ${(title || "session").slice(0, 80)}`
}

function boot(payload: SessionSnapshot): SessionBootstrap {
  return {
    status: payload.status,
    sessionRef: payload.sessionRef,
    workspaceName: payload.workspaceName,
    session: payload.session,
    message: payload.message,
  }
}

function idle(): SessionStatus {
  return { type: "idle" }
}

function patch(payload: Omit<SessionSnapshot, "message">): SessionSnapshot {
  return {
    ...payload,
    message: summary(payload),
  }
}

function reduce(payload: SessionSnapshot, event: SessionEvent) {
  if (event.type === "session.diff") {
    const props = event.properties as { sessionID: string; diff: FileDiff[] }
    if (props.sessionID !== payload.sessionRef.sessionId) {
      return
    }
    return {
      ...payload,
      diff: sortDiff(props.diff),
    }
  }

  if (event.type === "session.status") {
    const props = event.properties as { sessionID: string; status: SessionStatus }
    if (props.sessionID !== payload.sessionRef.sessionId) {
      return
    }
    return {
      ...payload,
      sessionStatus: props.status,
    }
  }

  if (event.type === "todo.updated") {
    const props = event.properties as { sessionID: string; todos: Todo[] }
    if (props.sessionID !== payload.sessionRef.sessionId) {
      return
    }
    return {
      ...payload,
      todos: props.todos,
    }
  }

  if (event.type === "session.updated" || event.type === "session.created") {
    const props = event.properties as { info: SessionSnapshot["session"] }
    if (!props.info || props.info.id !== payload.sessionRef.sessionId) {
      return
    }
    return {
      ...payload,
      session: props.info,
    }
  }

  if (event.type === "message.updated") {
    const props = event.properties as { info: SessionMessage["info"] }
    if (!payload.relatedSessionIds.includes(props.info.sessionID)) {
      return
    }

    if (props.info.sessionID !== payload.sessionRef.sessionId) {
      return {
        ...payload,
        childMessages: {
          ...payload.childMessages,
          [props.info.sessionID]: upsertMessage(payload.childMessages[props.info.sessionID] ?? [], props.info),
        },
      }
    }

    return {
      ...payload,
      messages: upsertMessage(payload.messages, props.info),
    }
  }

  if (event.type === "message.removed") {
    const props = event.properties as { sessionID: string; messageID: string }
    if (!payload.relatedSessionIds.includes(props.sessionID)) {
      return
    }

    if (props.sessionID !== payload.sessionRef.sessionId) {
      return {
        ...payload,
        childMessages: {
          ...payload.childMessages,
          [props.sessionID]: (payload.childMessages[props.sessionID] ?? []).filter((item) => item.info.id !== props.messageID),
        },
      }
    }

    return {
      ...payload,
      messages: payload.messages.filter((item) => item.info.id !== props.messageID),
    }
  }

  if (event.type === "message.part.updated") {
    const props = event.properties as { part: MessagePart }
    if (!payload.relatedSessionIds.includes(props.part.sessionID)) {
      return
    }

    if (props.part.sessionID !== payload.sessionRef.sessionId) {
      return {
        ...payload,
        childMessages: {
          ...payload.childMessages,
          [props.part.sessionID]: upsertPart(payload.childMessages[props.part.sessionID] ?? [], props.part),
        },
      }
    }

    const messages = upsertPart(payload.messages, props.part)
    return {
      ...payload,
      messages,
      agentMode: nextAgentMode(payload.agentMode, props.part, messages),
    }
  }

  if (event.type === "message.part.removed") {
    const props = event.properties as { messageID: string; partID: string }
    return {
      ...payload,
      messages: removePart(payload.messages, props.messageID, props.partID),
      childMessages: removePartFromChildren(payload.childMessages, props.messageID, props.partID),
    }
  }

  if (event.type === "message.part.delta") {
    const props = event.properties as {
      sessionID: string
      messageID: string
      partID: string
      field: string
      delta: string
    }
    if (!payload.relatedSessionIds.includes(props.sessionID)) {
      return
    }

    if (props.sessionID !== payload.sessionRef.sessionId) {
      return {
        ...payload,
        childMessages: {
          ...payload.childMessages,
          [props.sessionID]: appendDelta(payload.childMessages[props.sessionID] ?? [], props.messageID, props.partID, props.field, props.delta),
        },
      }
    }

    return {
      ...payload,
      messages: appendDelta(payload.messages, props.messageID, props.partID, props.field, props.delta),
    }
  }

  if (event.type === "permission.asked") {
    const props = event.properties as PermissionRequest
    if (!payload.relatedSessionIds.includes(props.sessionID)) {
      return
    }
    return {
      ...payload,
      permissions: sortRequests(upsertPermission(payload.permissions, props), payload.relatedSessionIds),
    }
  }

  if (event.type === "permission.replied") {
    const props = event.properties as { sessionID: string; requestID: string }
    if (!payload.relatedSessionIds.includes(props.sessionID)) {
      return
    }
    return {
      ...payload,
      permissions: payload.permissions.filter((item) => item.id !== props.requestID),
    }
  }

  if (event.type === "question.asked") {
    const props = event.properties as QuestionRequest
    if (!payload.relatedSessionIds.includes(props.sessionID)) {
      return
    }
    return {
      ...payload,
      questions: sortRequests(upsertQuestion(payload.questions, props), payload.relatedSessionIds),
    }
  }

  if (event.type === "question.replied" || event.type === "question.rejected") {
    const props = event.properties as { sessionID: string; requestID: string }
    if (!payload.relatedSessionIds.includes(props.sessionID)) {
      return
    }
    return {
      ...payload,
      questions: payload.questions.filter((item) => item.id !== props.requestID),
    }
  }
}

function upsertMessage(messages: SessionMessage[], info: SessionMessage["info"]) {
  const idx = messages.findIndex((item) => item.info.id === info.id)
  if (idx < 0) {
    return sortMessages([...messages, { info, parts: [] }])
  }

  return messages.map((item, i) => {
    if (i !== idx) {
      return item
    }
    return {
      ...item,
      info,
    }
  })
}

function upsertPart(messages: SessionMessage[], part: MessagePart) {
  return messages.map((item) => {
    if (item.info.id !== part.messageID) {
      return item
    }

    const idx = item.parts.findIndex((entry) => entry.id === part.id)
    if (idx < 0) {
      return {
        ...item,
        parts: sortParts([...item.parts, part]),
      }
    }

    return {
      ...item,
      parts: item.parts.map((entry, i) => (i === idx ? part : entry)),
    }
  })
}

function removePart(messages: SessionMessage[], messageID: string, partID: string) {
  return messages.map((item) => {
    if (item.info.id !== messageID) {
      return item
    }

    return {
      ...item,
      parts: item.parts.filter((part) => part.id !== partID),
    }
  })
}

function removePartFromChildren(children: Record<string, SessionMessage[]>, messageID: string, partID: string) {
  const next: Record<string, SessionMessage[]> = {}
  for (const [sessionID, messages] of Object.entries(children)) {
    next[sessionID] = removePart(messages, messageID, partID)
  }
  return next
}

function appendDelta(messages: SessionMessage[], messageID: string, partID: string, field: string, delta: string) {
  return messages.map((item) => {
    if (item.info.id !== messageID) {
      return item
    }

    return {
      ...item,
      parts: item.parts.map((part) => {
        if (part.id !== partID) {
          return part
        }

        const current = part[field as keyof MessagePart]
        if (typeof current !== "string") {
          return part
        }

        return {
          ...part,
          [field]: current + delta,
        }
      }),
    }
  })
}

function sortMessages(messages: SessionMessage[]) {
  return [...messages].sort((a, b) => cmp(a.info.id, b.info.id))
}

async function relatedMessages(
  sdk: Client,
  dir: string,
  rootSessionID: string,
  relatedSessionIds: string[],
  rootMessages: SessionMessage[],
): Promise<[SessionMessage[], Record<string, SessionMessage[]>]> {
  const children = relatedSessionIds.filter((item) => item !== rootSessionID)
  if (children.length === 0) {
    return [sortMessages(rootMessages), {}]
  }

  const results = await Promise.all(children.map(async (sessionID) => ({
    sessionID,
    data: await sdk.session.messages({
      sessionID,
      directory: dir,
      limit: 200,
    }),
  })))

  const childMessages: Record<string, SessionMessage[]> = {}
  for (const item of results) {
    childMessages[item.sessionID] = sortMessages(item.data.data ?? [])
  }

  return [sortMessages(rootMessages), childMessages]
}

function relatedSessionMap(sessions: NonNullable<SessionSnapshot["session"]>[], rootSessionID: string, relatedSessionIds: string[]) {
  const map: Record<string, NonNullable<SessionSnapshot["session"]>> = {}
  for (const session of sessions) {
    if (session.id === rootSessionID || !relatedSessionIds.includes(session.id)) {
      continue
    }
    map[session.id] = session
  }
  return map
}

function sortDiff(diff: FileDiff[]) {
  return [...diff].sort((a, b) => cmp(a.file, b.file))
}

function sortParts(parts: MessagePart[]) {
  return [...parts].sort((a, b) => cmp(a.id, b.id))
}

function upsertPermission(list: PermissionRequest[], item: PermissionRequest) {
  const idx = list.findIndex((entry) => entry.id === item.id)
  if (idx < 0) {
    return sortPending([...list, item])
  }
  return list.map((entry, i) => (i === idx ? item : entry))
}

function upsertQuestion(list: QuestionRequest[], item: QuestionRequest) {
  const idx = list.findIndex((entry) => entry.id === item.id)
  if (idx < 0) {
    return sortPending([...list, item])
  }
  return list.map((entry, i) => (i === idx ? item : entry))
}

function sortPending<T extends { id: string }>(list: T[]) {
  return [...list].sort((a, b) => cmp(a.id, b.id))
}

function filterPermission(list: PermissionRequest[], sessionIDs: string[]) {
  return sortRequests(list, sessionIDs)
}

function filterQuestion(list: QuestionRequest[], sessionIDs: string[]) {
  return sortRequests(list, sessionIDs)
}

function needsRefresh(event: SessionEvent, payload: SessionSnapshot) {
  if (event.type === "server.instance.disposed") {
    return true
  }

  if (event.type === "session.deleted") {
    const props = event.properties as { info: { id: string } }
    return payload.relatedSessionIds.includes(props.info.id)
  }

  if (event.type === "session.created" || event.type === "session.updated") {
    const props = event.properties as { info: { id: string; parentID?: string } }
    if (props.info.id === payload.sessionRef.sessionId) {
      return false
    }
    if (payload.session?.parentID) {
      return false
    }
    return props.info.parentID === payload.sessionRef.sessionId || payload.relatedSessionIds.includes(props.info.id)
  }

  return false
}

function collectRelatedSessionIds(session: NonNullable<SessionSnapshot["session"]>, sessions: NonNullable<SessionSnapshot["session"]>[]) {
  if (session.parentID) {
    return [session.id]
  }

  return sessions
    .filter((item) => item.id === session.id || item.parentID === session.id)
    .map((item) => item.id)
    .sort(cmp)
}

function nav(session: NonNullable<SessionSnapshot["session"]>, sessions: NonNullable<SessionSnapshot["session"]>[]) {
  if (!session.parentID) {
    return {}
  }

  const parent = sessions.find((item) => item.id === session.parentID)
  const siblings = sessions
    .filter((item) => item.parentID === session.parentID)
    .sort((a, b) => cmp(a.id, b.id))
  const index = siblings.findIndex((item) => item.id === session.id)
  const prev = index >= 0 && siblings.length > 1 ? siblings[(index - 1 + siblings.length) % siblings.length] : undefined
  const next = index >= 0 && siblings.length > 1 ? siblings[(index + 1) % siblings.length] : undefined

  return {
    parent: parent ? ref(parent) : undefined,
    prev: prev && prev.id !== session.id ? ref(prev) : undefined,
    next: next && next.id !== session.id ? ref(next) : undefined,
  }
}

function ref(session: NonNullable<SessionSnapshot["session"]>) {
  return {
    id: session.id,
    title: session.title || session.id.slice(0, 8),
  }
}

function sortRequests<T extends { id: string; sessionID: string }>(list: T[], sessionIDs: string[]) {
  const order = new Map(sessionIDs.map((item, index) => [item, index]))
  return [...list]
    .filter((item) => order.has(item.sessionID))
    .sort((a, b) => {
      const sessionCmp = (order.get(a.sessionID) ?? Number.MAX_SAFE_INTEGER) - (order.get(b.sessionID) ?? Number.MAX_SAFE_INTEGER)
      if (sessionCmp !== 0) {
        return sessionCmp
      }
      return cmp(a.id, b.id)
    })
}

function agentMode(messages: SessionMessage[]) {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const mode = messageAgentMode(messages[i])
    if (mode) {
      return mode
    }
  }

  return "build" as const
}

function messageAgentMode(message: SessionMessage) {
  for (let i = message.parts.length - 1; i >= 0; i -= 1) {
    const mode = partAgentMode(message.parts[i])
    if (mode) {
      return mode
    }
  }
}

function nextAgentMode(current: SessionSnapshot["agentMode"], part: MessagePart, messages: SessionMessage[]) {
  const next = partAgentMode(part)
  if (next) {
    return next
  }
  return current || agentMode(messages)
}

function partAgentMode(part: MessagePart) {
  if (part.type !== "tool" || part.state.status !== "completed") {
    return undefined
  }
  if (part.tool === "plan_enter") {
    return "plan" as const
  }
  if (part.tool === "plan_exit") {
    return "build" as const
  }
  return undefined
}

function cmp(a: string, b: string) {
  if (a < b) {
    return -1
  }

  if (a > b) {
    return 1
  }

  return 0
}

function summary(payload: Omit<SessionSnapshot, "message">) {
  if (payload.permissions.length > 0) {
    return "Session is waiting for a permission decision."
  }

  if (payload.questions.length > 0) {
    return "Session is waiting for your answer."
  }

  if (payload.submitting) {
    return "Sending message to workspace runtime."
  }

  const status = payload.sessionStatus ?? idle()
  if (status.type === "busy") {
    return `Session is responding. ${payload.messages.length} messages loaded.`
  }

  if (status.type === "retry") {
    return `Session is retrying. ${payload.messages.length} messages loaded.`
  }

  if (payload.messages.length === 0) {
    return "Session is ready. Send the first message to start the conversation."
  }

  if (payload.todos.length > 0) {
    return `Session is ready. ${payload.todos.length} todo items are being tracked.`
  }

  return `Session is ready. ${payload.messages.length} messages loaded.`
}

function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function text(err: unknown) {
  if (err instanceof Error) {
    return err.message
  }

  return String(err)
}

function textError(err: unknown) {
  const message = text(err)
  return message || "unknown error"
}
