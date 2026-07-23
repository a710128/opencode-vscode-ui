import React from "react"
import type { ComposerPathResult, HostMessage, SessionSnapshot } from "../../../bridge/types"
import { reduceSessionSnapshot } from "../../shared/session-reducer"
import { summarizeSessionSnapshot } from "../../shared/session-summary"
import { bootstrapFromSnapshot, normalizeSnapshotPayload, type AppState, type VsCodeApi } from "../app/state"

export function dispatchHostMessage(message: HostMessage, handlers: {
  fileRefStatus: Map<string, boolean>
  onFileSearchResults: (payload: { requestID: string; query: string; results: ComposerPathResult[] }) => void
  onForkCompleted?: (messageID: string) => void
  onForkFailed?: (payload: { messageID: string; error: string }) => void
  onForkStarted?: (messageID: string) => void
  onMessageCopied?: (messageID: string) => void
  onRestoreComposer: (payload: { parts: import("../../../bridge/types").ComposerPromptPart[] }) => void
  onShellCommandSucceeded: () => void
  setPendingMcpActions: React.Dispatch<React.SetStateAction<Record<string, boolean>>>
  setState: React.Dispatch<React.SetStateAction<AppState>>
}) {
  if (message?.type === "colorScheme") {
    document.body.dataset.colorScheme = message.value
    return
  }

  if (message?.type === "bootstrap") {
    handlers.setState((current) => ({ ...current, bootstrap: message.payload, error: "" }))
    return
  }

  if (message?.type === "snapshot") {
    handlers.setState((current) => {
      const nextSnapshot = normalizeSnapshotPayload(message.payload, current.snapshot)
      return {
        ...current,
        bootstrap: bootstrapFromSnapshot(message.payload),
        snapshot: nextSnapshot,
        error: "",
      }
    })
    return
  }

  if (message?.type === "sessionEvent") {
    handlers.setState((current) => {
      const nextSnapshotState = reduceSessionSnapshot(asSessionSnapshot(current), message.event)
      if (!nextSnapshotState) {
        return current
      }

      const nextSnapshot = normalizeSnapshotPayload(nextSnapshotState)
      return {
        ...current,
        bootstrap: {
          ...bootstrapFromSnapshot(nextSnapshotState),
          message: summarizeSessionSnapshot(nextSnapshotState),
        },
        snapshot: nextSnapshot,
        error: "",
      }
    })
    return
  }

  if (message?.type === "deferredUpdate") {
    handlers.setState((current) => {
      const nextSnapshot = {
        ...current.snapshot,
        ...message.payload,
      }
      return {
        ...current,
        bootstrap: {
          ...current.bootstrap,
          message: summarizeSessionSnapshot({
            ...nextSnapshot,
            status: current.bootstrap.status,
            workspaceName: current.bootstrap.workspaceName,
            sessionRef: current.bootstrap.sessionRef,
          }),
        },
        snapshot: {
          ...nextSnapshot,
        },
        error: "",
      }
    })
    return
  }

  if (message?.type === "submitting") {
    handlers.setState((current) => ({
      ...current,
      bootstrap: {
        ...current.bootstrap,
        message: summarizeSessionSnapshot({
          ...current.snapshot,
          submitting: message.value,
          status: current.bootstrap.status,
          workspaceName: current.bootstrap.workspaceName,
          sessionRef: current.bootstrap.sessionRef,
        }),
      },
      snapshot: {
        ...current.snapshot,
        submitting: message.value,
      },
    }))
    return
  }

  if (message?.type === "error") {
    handlers.setState((current) => ({ ...current, error: message.message || "Unknown error" }))
    return
  }

  if (message?.type === "fileRefsResolved") {
    for (const item of message.refs) {
      handlers.fileRefStatus.set(item.key, item.exists)
    }
    window.dispatchEvent(new CustomEvent("oc-file-refs-updated"))
    return
  }

  if (message?.type === "fileSearchResults") {
    handlers.onFileSearchResults(message)
    return
  }

  if (message?.type === "restoreComposer") {
    handlers.onRestoreComposer(message)
    return
  }

  if (message?.type === "shellCommandSucceeded") {
    handlers.onShellCommandSucceeded()
    return
  }

  if (message?.type === "messageCopied") {
    handlers.onMessageCopied?.(message.messageID)
    return
  }

  if (message?.type === "forkStarted") {
    handlers.onForkStarted?.(message.messageID)
    return
  }

  if (message?.type === "forkCompleted") {
    handlers.onForkCompleted?.(message.sourceMessageID)
    return
  }

  if (message?.type === "forkFailed") {
    handlers.onForkFailed?.(message)
    return
  }

  if (message?.type === "mcpActionFinished") {
    handlers.setPendingMcpActions((current) => {
      if (!current[message.name]) {
        return current
      }
      const next = { ...current }
      delete next[message.name]
      return next
    })
  }
}

function asSessionSnapshot(state: AppState): SessionSnapshot {
  return {
    ...state.snapshot,
    status: state.bootstrap.status,
    workspaceName: state.bootstrap.workspaceName,
    sessionRef: state.bootstrap.sessionRef,
    session: state.snapshot.session,
    message: state.bootstrap.message || "",
  }
}

export function useHostMessages({
  fileRefStatus,
  onFileSearchResults,
  onForkCompleted,
  onForkFailed,
  onForkStarted,
  onMessageCopied,
  onRestoreComposer,
  onShellCommandSucceeded,
  setPendingMcpActions,
  setState,
  vscode,
}: {
  fileRefStatus: Map<string, boolean>
  onFileSearchResults: (payload: { requestID: string; query: string; results: ComposerPathResult[] }) => void
  onForkCompleted?: (messageID: string) => void
  onForkFailed?: (payload: { messageID: string; error: string }) => void
  onForkStarted?: (messageID: string) => void
  onMessageCopied?: (messageID: string) => void
  onRestoreComposer: (payload: { parts: import("../../../bridge/types").ComposerPromptPart[] }) => void
  onShellCommandSucceeded: () => void
  setPendingMcpActions: React.Dispatch<React.SetStateAction<Record<string, boolean>>>
  setState: React.Dispatch<React.SetStateAction<AppState>>
  vscode: VsCodeApi
}) {
  const fileSearchHandlerRef = React.useRef(onFileSearchResults)
  const restoreComposerHandlerRef = React.useRef(onRestoreComposer)
  const shellSucceededHandlerRef = React.useRef(onShellCommandSucceeded)
  const forkCompletedHandlerRef = React.useRef(onForkCompleted ?? (() => {}))
  const forkFailedHandlerRef = React.useRef(onForkFailed ?? (() => {}))
  const forkStartedHandlerRef = React.useRef(onForkStarted ?? (() => {}))
  const messageCopiedHandlerRef = React.useRef(onMessageCopied ?? (() => {}))

  React.useEffect(() => {
    fileSearchHandlerRef.current = onFileSearchResults
  }, [onFileSearchResults])

  React.useEffect(() => {
    restoreComposerHandlerRef.current = onRestoreComposer
  }, [onRestoreComposer])

  React.useEffect(() => {
    shellSucceededHandlerRef.current = onShellCommandSucceeded
  }, [onShellCommandSucceeded])

  React.useEffect(() => {
    forkCompletedHandlerRef.current = onForkCompleted ?? (() => {})
    forkFailedHandlerRef.current = onForkFailed ?? (() => {})
    forkStartedHandlerRef.current = onForkStarted ?? (() => {})
    messageCopiedHandlerRef.current = onMessageCopied ?? (() => {})
  }, [onForkCompleted, onForkFailed, onForkStarted, onMessageCopied])

  React.useEffect(() => {
    const handler = (event: MessageEvent<HostMessage>) => {
      dispatchHostMessage(event.data, {
        fileRefStatus,
        onFileSearchResults: (payload) => fileSearchHandlerRef.current(payload),
        onRestoreComposer: (payload) => restoreComposerHandlerRef.current(payload),
        onShellCommandSucceeded: () => shellSucceededHandlerRef.current(),
        onForkCompleted: (messageID) => forkCompletedHandlerRef.current(messageID),
        onForkFailed: (payload) => forkFailedHandlerRef.current(payload),
        onForkStarted: (messageID) => forkStartedHandlerRef.current(messageID),
        onMessageCopied: (messageID) => messageCopiedHandlerRef.current(messageID),
        setPendingMcpActions,
        setState,
      })
    }

    window.addEventListener("message", handler)
    vscode.postMessage({ type: "ready" })
    return () => window.removeEventListener("message", handler)
  }, [fileRefStatus, setPendingMcpActions, setState, vscode])
}
