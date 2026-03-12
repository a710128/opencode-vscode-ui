import React from "react"
import type { MessagePart } from "../../../core/sdk"
import { PartView as BasePartView, ToolPartView as BaseToolPartView } from "./part-views"
import { useChildMessages, useChildSessions, useWorkspaceDir } from "./contexts"
import { renderToolRowExtra, renderToolRowTitle, taskAgentName, taskBody, taskSessionTitle, toolRowExtras } from "./tool-row-meta"
import { TaskToolRow as BaseTaskToolRow, ToolRow as BaseToolRow, ToolStatus } from "./tool-rows"
import { CodeBlock as BaseCodeBlock } from "../renderers/CodeBlock"
import { DiffBlock as BaseDiffBlock, DiffWindowBody as BaseDiffWindowBody, diffOutputLineCount } from "../renderers/DiffBlock"
import { FileRefText as BaseFileRefText } from "../renderers/FileRefText"
import { MarkdownBlock as BaseMarkdownBlock } from "../renderers/MarkdownBlock"
import { OutputWindow as BaseOutputWindow, normalizedLineCount } from "../renderers/OutputWindow"
import { cleanReasoning, dividerText, extractUrls, fileLabel, isDividerPart, partMeta, partTitle, questionAnswerGroups, questionInfoList, retryText, stringList, textValue, todoMarker, uniqueStrings } from "../lib/part-utils"
import { agentColorClass } from "../lib/session-meta"
import { defaultToolExpanded, isMcpTool, lspRendersInline, patchFiles, toolChildSessionId, toolDetails, toolDiagnostics, toolEditDiff, toolFiles, toolLabel, toolTextBody, toolTodos, toolWriteContent } from "../lib/tool-meta"
import { ToolFilesPanel as BaseToolFilesPanel } from "../tools/ToolFilesPanel"
import { ToolLinksPanel as BaseToolLinksPanel } from "../tools/ToolLinksPanel"
import { renderInlineLspToolTitle, ToolLspPanel as BaseToolLspPanel } from "../tools/ToolLspPanel"
import { ToolApplyPatchPanel as BaseToolApplyPatchPanel } from "../tools/ToolApplyPatchPanel"
import { ToolEditPanel as BaseToolEditPanel } from "../tools/ToolEditPanel"
import { ToolQuestionPanel as BaseToolQuestionPanel } from "../tools/ToolQuestionPanel"
import { ToolTextPanel as BaseToolTextPanel } from "../tools/ToolTextPanel"
import { ToolTodosPanel as BaseToolTodosPanel } from "../tools/ToolTodosPanel"
import { ToolWritePanel as BaseToolWritePanel } from "../tools/ToolWritePanel"
import type { VsCodeApi } from "./state"
import { QuestionBlock } from "./docks"

const WebviewBindingsContext = React.createContext<{ fileRefStatus: Map<string, boolean>; vscode: VsCodeApi } | null>(null)

export function WebviewBindingsProvider({ fileRefStatus, vscode, children }: { fileRefStatus: Map<string, boolean>; vscode: VsCodeApi; children: React.ReactNode }) {
  return <WebviewBindingsContext.Provider value={{ fileRefStatus, vscode }}>{children}</WebviewBindingsContext.Provider>
}

function useWebviewBindings() {
  const value = React.useContext(WebviewBindingsContext)
  if (!value) {
    throw new Error("WebviewBindingsProvider missing")
  }
  return value
}

export function PartView({ part, active = false, diffMode = "unified" }: { part: MessagePart; active?: boolean; diffMode?: "unified" | "split" }) {
  return <BasePartView DividerPartView={DividerPartView} MarkdownBlock={MarkdownBlock} ToolPartView={ToolPartView} diffMode={diffMode} part={part} active={active} cleanReasoning={cleanReasoning} fileLabel={fileLabel} isDividerPart={isDividerPart} partMeta={partMeta} partTitle={partTitle} renderPartBody={renderPartBody} />
}

export function ToolPartView({ part, active = false, diffMode = "unified" }: { part: Extract<MessagePart, { type: "tool" }>; active?: boolean; diffMode?: "unified" | "split" }) {
  return <BaseToolPartView ToolFilesPanel={ToolFilesPanel} ToolLinksPanel={ToolLinksPanel} ToolLspPanel={ToolLspPanel} ToolQuestionPanel={ToolQuestionPanel} ToolRow={ToolRow} ToolShellPanel={ToolShellPanel} ToolTextPanel={ToolTextPanel} ToolTodosPanel={ToolTodosPanel} active={active} diffMode={diffMode} isMcpTool={isMcpTool} lspRendersInline={lspRendersInline} part={part} />
}

export function ToolRow({ part, active = false }: { part: Extract<MessagePart, { type: "tool" }>; active?: boolean }) {
  if (part.tool === "task") {
    return <TaskToolRow part={part} active={active} />
  }

  const workspaceDir = useWorkspaceDir()
  const extras = toolRowExtras(part)
  return <BaseToolRow ToolStatus={ToolStatus} active={active} isMcpTool={isMcpTool} part={part} renderToolRowExtra={(current, item) => renderToolRowExtra(current, item, FileRefText)} renderToolRowTitle={(current) => renderToolRowTitle(current, toolDetails(current), { FileRefText, renderLspToolTitle: renderInlineLspToolTitle, workspaceDir })} extras={extras} toolLabel={toolLabel} />
}

export function TaskToolRow({ part, active = false }: { part: Extract<MessagePart, { type: "tool" }>; active?: boolean }) {
  const { vscode } = useWebviewBindings()
  const childSessionID = toolChildSessionId(part)
  const agentName = taskAgentName(part)
  const child = useChildMessages()
  const sessions = useChildSessions()
  const title = taskSessionTitle(part, sessions[childSessionID])
  const body = taskBody(part, child[childSessionID] || [])
  return <BaseTaskToolRow AgentBadge={AgentBadge} ToolStatus={ToolStatus} active={active} part={part} child={child} sessions={sessions} childSessionID={childSessionID} agentName={agentName} title={title} body={body} onNavigate={(sessionID) => vscode.postMessage({ type: "navigateSession", sessionID })} />
}

export function ToolTextPanel({ part, active = false }: { part: Extract<MessagePart, { type: "tool" }>; active?: boolean }) {
  return <BaseToolTextPanel ToolFallbackText={ToolFallbackText} ToolStatus={ToolStatus} active={active} defaultToolExpanded={defaultToolExpanded} part={part} toolDetails={toolDetails} toolLabel={toolLabel} toolTextBody={toolTextBody} />
}

export function ToolLspPanel({ part, active = false }: { part: Extract<MessagePart, { type: "tool" }>; active?: boolean }) {
  return <BaseToolLspPanel DiagnosticsList={DiagnosticsList} FileRefText={FileRefText} ToolStatus={ToolStatus} active={active} part={part} renderLspToolTitle={renderInlineLspToolTitle} toolDetails={toolDetails} toolDiagnostics={toolDiagnostics} toolLabel={toolLabel} toolTextBody={toolTextBody} />
}

export function ToolShellPanel({ part, active = false }: { part: Extract<MessagePart, { type: "tool" }>; active?: boolean }) {
  const details = toolDetails(part)
  const body = toolTextBody(part)
  const status = part.state?.status || "pending"
  return (
    <OutputWindow action={toolLabel(part.tool)} title={details.title} running={status === "running"} lineCount={normalizedLineCount(body)} className={active ? "is-active" : ""}>
      <pre className="oc-outputWindowContent oc-outputWindowContent-shell">{body || " "}</pre>
    </OutputWindow>
  )
}

export function ToolLinksPanel({ part, active = false }: { part: Extract<MessagePart, { type: "tool" }>; active?: boolean }) {
  return <BaseToolLinksPanel ToolStatus={ToolStatus} active={active} defaultToolExpanded={defaultToolExpanded} extractUrls={extractUrls} part={part} toolDetails={toolDetails} toolLabel={toolLabel} uniqueStrings={uniqueStrings} />
}

export function ToolFilesPanel({ part, active = false, diffMode = "unified" }: { part: Extract<MessagePart, { type: "tool" }>; active?: boolean; diffMode?: "unified" | "split" }) {
  return <BaseToolFilesPanel ToolApplyPatchPanel={ToolApplyPatchPanel} ToolEditPanel={ToolEditPanel} ToolFallbackText={ToolFallbackText} ToolStatus={ToolStatus} ToolWritePanel={ToolWritePanel} active={active} defaultToolExpanded={defaultToolExpanded} diffMode={diffMode} part={part} toolDetails={toolDetails} toolFiles={toolFiles} toolLabel={toolLabel} toolTextBody={toolTextBody} />
}

export function ToolWritePanel({ part, active = false }: { part: Extract<MessagePart, { type: "tool" }>; active?: boolean }) {
  return <BaseToolWritePanel CodeBlock={CodeBlock} DiagnosticsList={DiagnosticsList} ToolFallbackText={ToolFallbackText} ToolStatus={ToolStatus} active={active} defaultToolExpanded={defaultToolExpanded} part={part} toolDetails={toolDetails} toolDiagnostics={toolDiagnostics} toolLabel={toolLabel} toolTextBody={toolTextBody} toolWriteContent={toolWriteContent} />
}

export function ToolEditPanel({ part, active = false, diffMode = "unified" }: { part: Extract<MessagePart, { type: "tool" }>; active?: boolean; diffMode?: "unified" | "split" }) {
  return <BaseToolEditPanel DiagnosticsList={DiagnosticsList} DiffBlock={DiffBlock} ToolFallbackText={ToolFallbackText} ToolStatus={ToolStatus} active={active} defaultToolExpanded={defaultToolExpanded} diffMode={diffMode} part={part} toolDetails={toolDetails} toolDiagnostics={toolDiagnostics} toolEditDiff={toolEditDiff} toolLabel={toolLabel} toolTextBody={toolTextBody} />
}

export function ToolApplyPatchPanel({ part, active = false, diffMode = "unified" }: { part: Extract<MessagePart, { type: "tool" }>; active?: boolean; diffMode?: "unified" | "split" }) {
  return <BaseToolApplyPatchPanel DiagnosticsList={DiagnosticsList} DiffWindowBody={DiffWindowBody} FileRefText={FileRefText} OutputWindow={OutputWindow} ToolFallbackText={ToolFallbackText} ToolStatus={ToolStatus} active={active} diffMode={diffMode} diffOutputLineCount={diffOutputLineCount} normalizedLineCount={normalizedLineCount} part={part} patchFiles={patchFiles} toolDetails={toolDetails} toolDiagnostics={toolDiagnostics} toolLabel={toolLabel} toolTextBody={toolTextBody} />
}

export function ToolTodosPanel({ part, active = false }: { part: Extract<MessagePart, { type: "tool" }>; active?: boolean }) {
  return <BaseToolTodosPanel ToolStatus={ToolStatus} active={active} part={part} todoMarker={todoMarker} toolDetails={toolDetails} toolTodos={toolTodos} />
}

export function ToolQuestionPanel({ part, active = false }: { part: Extract<MessagePart, { type: "tool" }>; active?: boolean }) {
  return <BaseToolQuestionPanel QuestionBlock={QuestionBlock} ToolStatus={ToolStatus} active={active} part={part} questionAnswerGroups={questionAnswerGroups} questionInfoList={questionInfoList} toolDetails={toolDetails} />
}

export function ToolFallbackText({ part, body }: { part: Extract<MessagePart, { type: "tool" }>; body: string }) {
  if (!body) {
    return null
  }
  if (part.state?.error) {
    return <pre className="oc-errorBlock">{body}</pre>
  }
  return <pre className="oc-partTerminal">{body}</pre>
}

export function CodeBlock({ value, filePath }: { value: string; filePath?: string }) {
  return <BaseCodeBlock value={value} filePath={filePath} />
}

export function DiffBlock({ value, mode = "unified" }: { value: string; mode?: "unified" | "split" }) {
  return <BaseDiffBlock value={value} mode={mode} />
}

export function DiffWindowBody({ value, mode = "unified", filePath }: { value: string; mode?: "unified" | "split"; filePath?: string }) {
  return <BaseDiffWindowBody value={value} mode={mode} filePath={filePath} />
}

export function DiagnosticsList({ items, tone = "warning" }: { items: string[]; tone?: "warning" | "error" }) {
  return <div className={`oc-diagnosticsList is-${tone}`}>{items.map((item) => <div key={item} className={`oc-diagnosticItem is-${tone}`}>{item}</div>)}</div>
}

export function DividerPartView({ part }: { part: MessagePart }) {
  return <div className={`oc-dividerPart oc-dividerPart-${part.type}`}><span className="oc-dividerLine" /><span className="oc-dividerText">{dividerText(part)}</span><span className="oc-dividerLine" /></div>
}

export function renderPartBody(part: MessagePart) {
  if (part.type === "tool") {
    return <pre className="oc-partTerminal">{toolTextBody(part)}</pre>
  }
  if (part.type === "patch") {
    const files = stringList((part as Record<string, unknown>).files)
    return files.length > 0 ? <ul className="oc-list">{files.map((file) => <li key={file}>{file}</li>)}</ul> : <div className="oc-partEmpty">Patch created.</div>
  }
  if (part.type === "subtask") {
    return <MarkdownBlock content={textValue((part as Record<string, unknown>).description) || textValue((part as Record<string, unknown>).prompt) || ""} />
  }
  if (part.type === "snapshot") {
    return <pre className="oc-partTerminal">{textValue((part as Record<string, unknown>).snapshot) || "Workspace snapshot updated."}</pre>
  }
  if (part.type === "retry") {
    return <pre className="oc-partTerminal">{retryText((part as Record<string, unknown>).error)}</pre>
  }
  if (part.type === "agent") {
    return <MarkdownBlock content={textValue((part as Record<string, unknown>).name) || "Agent task"} />
  }
  if (part.type === "compaction") {
    return <MarkdownBlock content={(part as Record<string, unknown>).auto ? "Automatic compaction completed." : "Compaction completed."} />
  }
  return <div className="oc-partEmpty">{partTitle(part)}</div>
}

export function EmptyState({ title, text }: { title: string; text: string }) {
  return <div className="oc-emptyWrap"><section className="oc-emptyState"><div className="oc-kicker">session</div><h2 className="oc-emptyTitle">{title}</h2><p className="oc-emptyText">{text}</p></section></div>
}

export function MarkdownBlock({ content, className = "" }: { content: string; className?: string }) {
  const { fileRefStatus, vscode } = useWebviewBindings()
  return <BaseMarkdownBlock fileRefStatus={fileRefStatus} onOpenFile={(filePath, line) => vscode.postMessage({ type: "openFile", filePath, line })} onResolveFileRefs={(refs) => vscode.postMessage({ type: "resolveFileRefs", refs })} content={content} className={className} />
}

export function OutputWindow({ action, title, running = false, lineCount, className = "", children }: { action: string; title: React.ReactNode; running?: boolean; lineCount: number; className?: string; children: React.ReactNode }) {
  return <BaseOutputWindow ToolStatus={ToolStatus} action={action} title={title} running={running} lineCount={lineCount} className={className}>{children}</BaseOutputWindow>
}

export function AgentBadge({ name }: { name: string }) {
  const colorClass = agentColorClass(name)
  return <span className="oc-agentBadge"><span className={`oc-agentSwatch ${colorClass}`} /><span className={`oc-agentName ${colorClass}`}>{name}</span></span>
}

export function FileRefText({ value, display, tone = "default" }: { value: string; display?: string; tone?: "default" | "muted" }) {
  const { fileRefStatus, vscode } = useWebviewBindings()
  return <BaseFileRefText fileRefStatus={fileRefStatus} onOpenFile={(filePath, line) => vscode.postMessage({ type: "openFile", filePath, line })} onResolveFileRefs={(refs) => vscode.postMessage({ type: "resolveFileRefs", refs })} value={value} display={display} tone={tone} />
}

export function CompactionDivider() {
  return <div className="oc-dividerPart oc-dividerPart-compaction"><span className="oc-dividerCompactionLine" /><span className="oc-dividerText">Compaction</span></div>
}
