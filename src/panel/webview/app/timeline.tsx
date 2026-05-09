import React from "react"
import { parsePatch } from "diff"
import type { FilePart, MessageInfo, MessagePart, SessionMessage, TextPart } from "../../../core/sdk"
import { TranscriptVisibilityContext } from "./contexts"

export type TimelineBlock =
  | { kind: "user-message"; key: string; message: SessionMessage; queued: boolean }
  | { kind: "assistant-part"; key: string; part: MessagePart }
  | { kind: "assistant-meta"; key: string; messages: SessionMessage[] }
  | { kind: "revert"; key: string; count: number; files: Array<{ filename: string; additions: number; deletions: number }> }

type TimelineDerivationOptions = {
  showThinking: boolean
  showInternals: boolean
  revertID?: string
  revertDiff?: string
}

export type TimelineDerivationCache = {
  assistantMetaBlocks: Map<string, Extract<TimelineBlock, { kind: "assistant-meta" }>>
  assistantPartBlocks: Map<string, Extract<TimelineBlock, { kind: "assistant-part" }>>
  revertBlocks: Map<string, Extract<TimelineBlock, { kind: "revert" }>>
  userBlocks: Map<string, Extract<TimelineBlock, { kind: "user-message" }>>
}

export function createTimelineDerivationCache(): TimelineDerivationCache {
  return {
    assistantMetaBlocks: new Map(),
    assistantPartBlocks: new Map(),
    revertBlocks: new Map(),
    userBlocks: new Map(),
  }
}

type TimelineProps = {
  bootstrapStatus: "idle" | "loading" | "ready" | "error"
  bootstrapMessage?: string
  diffMode: "unified" | "split"
  messages: SessionMessage[]
  revertDiff?: string
  revertID?: string
  showInternals: boolean
  showThinking: boolean
  AgentBadge: ({ name }: { name: string }) => React.JSX.Element
  CompactionDivider: () => React.JSX.Element
  EmptyState: ({ title, text }: { title: string; text: string }) => React.JSX.Element
  MarkdownBlock: ({ content, className }: { content: string; className?: string }) => React.JSX.Element
  PartView: ({ part, active, diffMode }: { part: MessagePart; active?: boolean; diffMode?: "unified" | "split" }) => React.JSX.Element
}

export const Timeline = React.memo(function Timeline({
  bootstrapStatus,
  bootstrapMessage,
  diffMode,
  messages,
  revertDiff,
  revertID,
  showInternals,
  showThinking,
  AgentBadge,
  CompactionDivider,
  EmptyState,
  MarkdownBlock,
  PartView,
}: TimelineProps) {
  const cacheRef = React.useRef<TimelineDerivationCache>(createTimelineDerivationCache())

  const blocks = React.useMemo(() => reconcileTimelineBlocks(cacheRef.current, messages, {
    showThinking,
    showInternals,
    revertID,
    revertDiff,
  }), [messages, revertDiff, revertID, showInternals, showThinking])
  const activeToolID = React.useMemo(() => latestActiveToolId(blocks.flatMap((block) => block.kind === "assistant-part" ? [block.part] : [])), [blocks])

  if (bootstrapStatus === "error") {
    return <EmptyState title="Session unavailable" text={bootstrapMessage || "The workspace runtime is not ready."} />
  }

  if (bootstrapStatus !== "ready" && messages.length === 0) {
    return <EmptyState title="Connecting to workspace" text={bootstrapMessage || "Waiting for workspace runtime."} />
  }

  if (messages.length === 0) {
    return <EmptyState title="Start this session" text="Send a message below. Pending permission and question requests will appear in the lower dock." />
  }

  return (
    <TranscriptVisibilityContext.Provider value={{ showThinking, showInternals }}>
      <div className="oc-log">
        {blocks.map((block) => (
          <MemoTimelineBlockView
            key={block.key}
            AgentBadge={AgentBadge}
            CompactionDivider={CompactionDivider}
            MarkdownBlock={MarkdownBlock}
            PartView={PartView}
            active={block.kind === "assistant-part" && block.part.type === "tool" && block.part.id === activeToolID}
            block={block}
            diffMode={diffMode}
          />
        ))}
      </div>
    </TranscriptVisibilityContext.Provider>
  )
})

type TimelineBlockViewProps = {
  AgentBadge: ({ name }: { name: string }) => React.JSX.Element
  CompactionDivider: () => React.JSX.Element
  MarkdownBlock: ({ content, className }: { content: string; className?: string }) => React.JSX.Element
  PartView: ({ part, active, diffMode }: { part: MessagePart; active?: boolean; diffMode?: "unified" | "split" }) => React.JSX.Element
  active: boolean
  block: TimelineBlock
  diffMode: "unified" | "split"
}

function TimelineBlockView({
  AgentBadge,
  CompactionDivider,
  MarkdownBlock,
  PartView,
  active,
  block,
  diffMode,
}: TimelineBlockViewProps) {
  if (block.kind === "user-message") {
    const userText = primaryUserText(block.message)
    const userFiles = userAttachments(block.message)
    const hasCompaction = userHasCompaction(block.message)
    const hasSyntheticText = userHasSyntheticText(block.message)
    const showEmptyPrompt = !userText && !hasSyntheticText
    if (hasCompaction && !userText && userFiles.length === 0) {
      return <CompactionDivider />
    }
    return (
      <>
        {hasCompaction ? <CompactionDivider /> : null}
        <section className="oc-turnUser">
          <div className="oc-entryHeader">
            <div className="oc-entryRole">You</div>
            {block.queued ? <div className="oc-queuedBadge">QUEUED</div> : <div className="oc-entryTime">{formatTime(block.message.info.time?.created)}</div>}
          </div>
          {userText ? <MarkdownBlock content={userText.text || ""} /> : (showEmptyPrompt ? <div className="oc-partEmpty">No visible prompt text.</div> : null)}
          {userFiles.length > 0 ? (
            <div className="oc-attachmentRow">
              {userFiles.map((part) => (
                <span key={part.id} className={`oc-pill oc-pill-file${imagePreviewUrl(part) ? " has-imagePreview" : ""}`} tabIndex={imagePreviewUrl(part) ? 0 : undefined}>
                  <span className="oc-pillFileType">{fileTypeLabel(part)}</span>
                  <span className="oc-pillFilePath">{attachmentFilePath(part)}</span>
                  {imagePreviewUrl(part) ? (
                    <span className="oc-imagePreview" role="tooltip">
                      <img src={imagePreviewUrl(part)} alt={attachmentFilePath(part)} />
                    </span>
                  ) : null}
                </span>
              ))}
            </div>
          ) : null}
        </section>
      </>
    )
  }

  if (block.kind === "assistant-meta") {
    return <AssistantTurnMeta AgentBadge={AgentBadge} messages={block.messages} />
  }

  if (block.kind === "revert") {
    return (
      <section className="oc-revertNotice">
        <div className="oc-revertNoticeTitle">{block.count} message reverted</div>
        <div className="oc-revertNoticeText">Use `/redo` to restore this part of the session.</div>
        {block.files.length > 0 ? (
          <div className="oc-revertFileList">
            {block.files.map((file, index) => (
              <div key={`${file.filename}:${index}`} className="oc-revertFileRow">
                <span>{file.filename}</span>
                {file.additions > 0 ? <span className="oc-revertFileAdd">+{file.additions}</span> : null}
                {file.deletions > 0 ? <span className="oc-revertFileDel">-{file.deletions}</span> : null}
              </div>
            ))}
          </div>
        ) : null}
      </section>
    )
  }

  const part = block.part
  return <PartView part={part} active={active} diffMode={diffMode} />
}

const MemoTimelineBlockView = React.memo(TimelineBlockView, areTimelineBlockPropsEqual)

function areTimelineBlockPropsEqual(prev: TimelineBlockViewProps, next: TimelineBlockViewProps) {
  if (prev.AgentBadge !== next.AgentBadge
    || prev.CompactionDivider !== next.CompactionDivider
    || prev.MarkdownBlock !== next.MarkdownBlock
    || prev.PartView !== next.PartView
    || prev.active !== next.active
    || prev.diffMode !== next.diffMode) {
    return false
  }

  return sameTimelineBlock(prev.block, next.block)
}

function sameTimelineBlock(prev: TimelineBlock, next: TimelineBlock) {
  if (prev.kind !== next.kind || prev.key !== next.key) {
    return false
  }

  if (prev.kind === "user-message" && next.kind === "user-message") {
    return prev.message === next.message && prev.queued === next.queued
  }

  if (prev.kind === "assistant-part" && next.kind === "assistant-part") {
    return prev.part === next.part
  }

  if (prev.kind === "assistant-meta" && next.kind === "assistant-meta") {
    return sameMessageList(prev.messages, next.messages)
  }

  if (prev.kind === "revert" && next.kind === "revert") {
    return prev.count === next.count && sameRevertFiles(prev.files, next.files)
  }

  return false
}

function sameMessageList(prev: SessionMessage[], next: SessionMessage[]) {
  if (prev.length !== next.length) {
    return false
  }

  for (let index = 0; index < prev.length; index += 1) {
    if (prev[index] !== next[index]) {
      return false
    }
  }

  return true
}

function sameRevertFiles(
  prev: Array<{ filename: string; additions: number; deletions: number }>,
  next: Array<{ filename: string; additions: number; deletions: number }>,
) {
  if (prev.length !== next.length) {
    return false
  }

  for (let index = 0; index < prev.length; index += 1) {
    const left = prev[index]
    const right = next[index]
    if (!left || !right || left.filename !== right.filename || left.additions !== right.additions || left.deletions !== right.deletions) {
      return false
    }
  }

  return true
}

function AssistantTurnMeta({ AgentBadge, messages }: { AgentBadge: ({ name }: { name: string }) => React.JSX.Element; messages: SessionMessage[] }) {
  const first = messages[0]?.info
  const agent = first?.agent?.trim()
  const created = formatTime(first?.time?.created)
  const summary = assistantSummary(messages)
  const items: React.ReactNode[] = []

  if (agent) {
    items.push(<AgentBadge key="agent" name={agent} />)
  }
  if (created) {
    items.push(<span key="created">{created}</span>)
  }
  if (summary) {
    items.push(<span key="summary">{summary}</span>)
  }
  if (items.length === 0) {
    return null
  }

  return (
    <section className="oc-turnMeta">
      <div className="oc-turnMetaContent">
        {items.map((item, index) => (
          <React.Fragment key={index}>
            {index > 0 ? <span className="oc-turnMetaSep">·</span> : null}
            {item}
          </React.Fragment>
        ))}
      </div>
    </section>
  )
}

export function reconcileTimelineBlocks(cache: TimelineDerivationCache, messages: SessionMessage[], options: TimelineDerivationOptions) {
  const nextAssistantMetaBlocks = new Map<string, Extract<TimelineBlock, { kind: "assistant-meta" }>>()
  const nextAssistantPartBlocks = new Map<string, Extract<TimelineBlock, { kind: "assistant-part" }>>()
  const nextRevertBlocks = new Map<string, Extract<TimelineBlock, { kind: "revert" }>>()
  const nextUserBlocks = new Map<string, Extract<TimelineBlock, { kind: "user-message" }>>()
  const blocks: TimelineBlock[] = []
  let assistants: SessionMessage[] = []
  const pendingAssistantIndex = lastPendingAssistantIndex(messages)

  const flush = () => {
    const meta = assistantMetaBlock(cache.assistantMetaBlocks, nextAssistantMetaBlocks, assistants)
    if (meta) {
      blocks.push(meta)
    }
    assistants = []
  }

  for (const [index, message] of messages.entries()) {
    if (options.revertID && message.info.id === options.revertID) {
      flush()
      blocks.push(revertBlock(cache.revertBlocks, nextRevertBlocks, message.info.id, revertedUserCount(messages, options.revertID), revertFiles(options.revertDiff)))
      break
    }

    if (message.info.role === "user") {
      flush()
      blocks.push(userBlock(cache.userBlocks, nextUserBlocks, message, pendingAssistantIndex >= 0 && index > pendingAssistantIndex))
      continue
    }

    const parts = message.parts.filter((part) => visibleAssistantPart(part, options))
    for (const part of parts) {
      blocks.push(assistantPartBlock(cache.assistantPartBlocks, nextAssistantPartBlocks, part))
    }
    assistants.push(message)
  }

  flush()
  cache.assistantMetaBlocks = nextAssistantMetaBlocks
  cache.assistantPartBlocks = nextAssistantPartBlocks
  cache.revertBlocks = nextRevertBlocks
  cache.userBlocks = nextUserBlocks
  return blocks
}

function userBlock(
  cache: Map<string, Extract<TimelineBlock, { kind: "user-message" }>>,
  nextCache: Map<string, Extract<TimelineBlock, { kind: "user-message" }>>,
  message: SessionMessage,
  queued: boolean,
) {
  const key = `user:${message.info.id}`
  const prev = cache.get(key)
  if (prev && prev.message === message && prev.queued === queued) {
    nextCache.set(key, prev)
    return prev
  }

  const next: Extract<TimelineBlock, { kind: "user-message" }> = {
    kind: "user-message",
    key,
    message,
    queued,
  }
  nextCache.set(key, next)
  return next
}

function assistantPartBlock(
  cache: Map<string, Extract<TimelineBlock, { kind: "assistant-part" }>>,
  nextCache: Map<string, Extract<TimelineBlock, { kind: "assistant-part" }>>,
  part: MessagePart,
) {
  const key = `part:${part.id}`
  const prev = cache.get(key)
  if (prev && prev.part === part) {
    nextCache.set(key, prev)
    return prev
  }

  const next: Extract<TimelineBlock, { kind: "assistant-part" }> = {
    kind: "assistant-part",
    key,
    part,
  }
  nextCache.set(key, next)
  return next
}

function assistantMetaBlock(
  cache: Map<string, Extract<TimelineBlock, { kind: "assistant-meta" }>>,
  nextCache: Map<string, Extract<TimelineBlock, { kind: "assistant-meta" }>>,
  messages: SessionMessage[],
) {
  if (!assistantTurnMeta(messagesFromAssistants(messages))) {
    return undefined
  }

  const key = `meta:${messages[0]?.info.id || messages.length}`
  const prev = cache.get(key)
  if (prev && sameMessageList(prev.messages, messages)) {
    nextCache.set(key, prev)
    return prev
  }

  const next: Extract<TimelineBlock, { kind: "assistant-meta" }> = {
    kind: "assistant-meta",
    key,
    messages,
  }
  nextCache.set(key, next)
  return next
}

function revertBlock(
  cache: Map<string, Extract<TimelineBlock, { kind: "revert" }>>,
  nextCache: Map<string, Extract<TimelineBlock, { kind: "revert" }>>,
  messageID: string,
  count: number,
  files: Array<{ filename: string; additions: number; deletions: number }>,
) {
  const key = `revert:${messageID}`
  const prev = cache.get(key)
  if (prev && prev.count === count && sameRevertFiles(prev.files, files)) {
    nextCache.set(key, prev)
    return prev
  }

  const next: Extract<TimelineBlock, { kind: "revert" }> = {
    kind: "revert",
    key,
    count,
    files,
  }
  nextCache.set(key, next)
  return next
}

function revertedUserCount(messages: SessionMessage[], revertID: string) {
  return messages.filter((message) => message.info.role === "user" && message.info.id >= revertID).length
}

function revertFiles(diff?: string) {
  if (!diff?.trim()) {
    return []
  }

  try {
    return parsePatch(diff).map((patch) => ({
      filename: (patch.newFileName || patch.oldFileName || "unknown").replace(/^[ab]\//, ""),
      additions: patch.hunks.reduce((sum, hunk) => sum + hunk.lines.filter((line) => line.startsWith("+")).length, 0),
      deletions: patch.hunks.reduce((sum, hunk) => sum + hunk.lines.filter((line) => line.startsWith("-")).length, 0),
    }))
  } catch {
    return []
  }
}

function messagesFromAssistants(messages: SessionMessage[]) {
  return messages
}

function lastPendingAssistantIndex(messages: SessionMessage[]) {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]
    if (message?.info.role === "assistant" && !message.info.time.completed) {
      return index
    }
  }
  return -1
}

function primaryUserText(message: SessionMessage) {
  return message.parts.find((part): part is TextPart => part.type === "text" && !part.synthetic && !part.ignored)
}

function userHasSyntheticText(message: SessionMessage) {
  return message.parts.some((part) => part.type === "text" && !!part.synthetic)
}

function userHasCompaction(message: SessionMessage) {
  return message.parts.some((part) => part.type === "compaction")
}

function userAttachments(message: SessionMessage) {
  return message.parts.filter((part): part is FilePart => part.type === "file")
}

function attachmentFilePath(part: FilePart) {
  if (part.filename?.trim()) {
    return part.filename.trim()
  }

  const raw = part.url.trim()
  if (!raw) {
    return part.url
  }

  try {
    const parsed = new URL(raw)
    if (parsed.protocol === "file:") {
      return decodeURIComponent(parsed.pathname)
    }
    return decodeURIComponent(`${parsed.hostname}${parsed.pathname}` || raw)
  } catch {
    return raw
  }
}

function fileTypeLabel(part: FilePart) {
  const mime = part.mime.toLowerCase()
  const path = attachmentFilePath(part).toLowerCase()

  if (mime === "application/pdf" || path.endsWith(".pdf")) return "PDF"
  if (mime.startsWith("image/") || /\.(png|jpe?g|gif|webp|bmp|svg|ico|avif|heic|heif)$/.test(path)) return "IMG"
  if (mime.startsWith("audio/") || /\.(mp3|wav|ogg|m4a|flac|aac|opus)$/.test(path)) return "AUDIO"
  if (mime.startsWith("video/") || /\.(mp4|mov|m4v|webm|avi|mkv)$/.test(path)) return "VIDEO"
  if (mime === "application/json" || mime.endsWith("+json") || path.endsWith(".json") || path.endsWith(".jsonc")) return "JSON"
  if (mime === "application/yaml" || mime === "text/yaml" || mime === "text/x-yaml" || path.endsWith(".yaml") || path.endsWith(".yml")) return "YAML"
  if (mime === "application/toml" || path.endsWith(".toml")) return "TOML"
  if (mime === "text/markdown" || path.endsWith(".md") || path.endsWith(".mdx")) return "MD"
  if (mime.startsWith("text/") && !mime.includes("markdown") && !mime.includes("yaml") && !mime.includes("javascript") && !mime.includes("typescript") && !mime.includes("jsx") && !mime.includes("tsx") && !mime.includes("html") && !mime.includes("css") && !mime.includes("xml") && !mime.includes("json")) return "TXT"
  if (mime.includes("javascript") || mime.includes("typescript") || mime.includes("jsx") || mime.includes("tsx") || mime.includes("html") || mime.includes("css") || mime.includes("xml") || mime.includes("python") || mime.includes("java") || mime.includes("rust") || mime.includes("go") || mime.includes("php") || mime.includes("ruby") || mime.includes("shellscript") || mime.includes("x-sh") || /\.(c|cc|cpp|cs|go|java|js|jsx|mjs|cjs|ts|tsx|py|rb|rs|php|swift|kt|kts|scala|sh|bash|zsh|fish|html|css|scss|sass|less|xml|sql)$/.test(path)) return "CODE"
  if (path.endsWith(".txt") || path.endsWith(".log")) return "TXT"
  return "TXT"
}

export function imagePreviewUrl(part: FilePart) {
  return fileTypeLabel(part) === "IMG" && part.url.startsWith("data:image/") ? part.url : ""
}

function latestActiveToolId(parts: MessagePart[]) {
  for (let i = parts.length - 1; i >= 0; i -= 1) {
    const part = parts[i]
    if (part?.type === "tool" && part.state?.status !== "completed") {
      return part.id
    }
  }
  return ""
}

function assistantSummary(messages: SessionMessage[]) {
  if (messages.length === 0) {
    return ""
  }

  const first = messages[0]?.info
  const last = messages[messages.length - 1]?.info
  const parts: string[] = []
  const finish = lastStepFinish(messages)

  const model = assistantModel(last)
  if (model) parts.push(model)

  const duration = assistantDuration(first, last)
  if (duration) parts.push(duration)

  const tokenSummary = assistantTokens(last)
  if (tokenSummary) parts.push(tokenSummary)

  if (typeof last?.cost === "number" && Number.isFinite(last.cost)) {
    parts.push(`$${last.cost.toFixed(4)}`)
  }

  if (finish) {
    const reason = textValue(finish.reason)
    if (reason) parts.push(reason)
  }

  return parts.join(" · ")
}

function assistantTurnMeta(messages: SessionMessage[]) {
  if (messages.length === 0) {
    return ""
  }

  const parts: string[] = []
  const first = messages[0]?.info
  const agent = first?.agent?.trim()
  const created = formatTime(first?.time?.created)
  const summary = assistantSummary(messages)

  if (agent) parts.push(agent)
  if (created) parts.push(created)
  if (summary) parts.push(summary)

  return parts.join(" · ")
}

function lastStepFinish(messages: SessionMessage[]) {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const parts = messages[i]?.parts || []
    for (let j = parts.length - 1; j >= 0; j -= 1) {
      const part = parts[j]
      if (part?.type === "step-finish") {
        return part as Record<string, unknown>
      }
    }
  }
}

type PartBucket = "primary" | "secondary" | "divider" | "hidden"

function partBucket(part: MessagePart, options: { showThinking: boolean; showInternals: boolean }): PartBucket {
  if (part.type === "text") {
    return part.text?.trim() && !part.synthetic && !part.ignored ? "primary" : "hidden"
  }
  if (part.type === "reasoning") {
    return options.showThinking && cleanReasoning(part.text || "").trim() ? "secondary" : "hidden"
  }
  if (part.type === "tool" || part.type === "file") {
    return "secondary"
  }
  if (part.type === "step-start") {
    return "hidden"
  }
  if (part.type === "retry" || part.type === "agent" || part.type === "subtask") {
    return "divider"
  }
  if (part.type === "step-finish" || part.type === "snapshot" || part.type === "patch") {
    return options.showInternals ? "secondary" : "hidden"
  }
  return options.showInternals ? "secondary" : "hidden"
}

function visibleAssistantPart(part: MessagePart, options: { showThinking: boolean; showInternals: boolean }) {
  return partBucket(part, options) !== "hidden"
}

function assistantModel(info?: MessageInfo) {
  const modelID = info?.model?.modelID?.trim()
  const providerID = info?.model?.providerID?.trim()
  if (modelID && providerID) {
    return `${providerID}/${modelID}`
  }
  return modelID || providerID || ""
}

function assistantDuration(first?: MessageInfo, last?: MessageInfo) {
  const start = first?.time?.created
  const end = last?.time?.completed
  if (typeof start !== "number" || typeof end !== "number" || end < start) {
    return ""
  }
  const seconds = Math.max(0, Math.round((end - start) / 1000))
  return formatDuration(seconds)
}

function assistantTokens(info?: MessageInfo) {
  const output = info?.tokens?.output
  const reasoning = info?.tokens?.reasoning
  const tokens: string[] = []
  if (typeof output === "number" && output > 0) tokens.push(`${output} out`)
  if (typeof reasoning === "number" && reasoning > 0) tokens.push(`${reasoning} reasoning`)
  return tokens.join(" · ")
}

function formatTime(value?: number) {
  if (typeof value !== "number") {
    return ""
  }
  try {
    return new Date(value).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
  } catch {
    return ""
  }
}

function cleanReasoning(value: string) {
  return value.replace(/\[REDACTED\]/g, "").trim()
}

function textValue(value: unknown) {
  return typeof value === "string" ? value : ""
}

function formatDuration(seconds: number) {
  if (seconds < 60) {
    return `${seconds}s`
  }
  const minutes = Math.floor(seconds / 60)
  const rest = seconds % 60
  if (minutes < 60) {
    return rest > 0 ? `${minutes}m ${rest}s` : `${minutes}m`
  }
  const hours = Math.floor(minutes / 60)
  const remainMinutes = minutes % 60
  return remainMinutes > 0 ? `${hours}h ${remainMinutes}m` : `${hours}h`
}
