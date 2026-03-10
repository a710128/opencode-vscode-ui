import React from "react"
import type { HostMessage } from "../../../bridge/types"
import { bootstrapFromSnapshot, normalizeSnapshotPayload, type AppState, type VsCodeApi } from "../app/state"

export function useHostMessages({
  fileRefStatus,
  onFileSearchResults,
  setPendingMcpActions,
  setState,
  vscode,
}: {
  fileRefStatus: Map<string, boolean>
  onFileSearchResults: (payload: { requestID: string; query: string; results: Array<{ path: string }> }) => void
  setPendingMcpActions: React.Dispatch<React.SetStateAction<Record<string, boolean>>>
  setState: React.Dispatch<React.SetStateAction<AppState>>
  vscode: VsCodeApi
}) {
  React.useEffect(() => {
    const handler = (event: MessageEvent<HostMessage>) => {
      const message = event.data
      if (message?.type === "bootstrap") {
        setState((current) => ({ ...current, bootstrap: message.payload, error: "" }))
        return
      }

      if (message?.type === "snapshot") {
        setState((current) => ({
          ...current,
          bootstrap: bootstrapFromSnapshot(message.payload),
          snapshot: normalizeSnapshotPayload(message.payload),
          error: "",
        }))
        return
      }

      if (message?.type === "error") {
        setState((current) => ({ ...current, error: message.message || "Unknown error" }))
        return
      }

      if (message?.type === "fileRefsResolved") {
        for (const item of message.refs) {
          fileRefStatus.set(item.key, item.exists)
        }
        window.dispatchEvent(new CustomEvent("oc-file-refs-updated"))
        return
      }

      if (message?.type === "fileSearchResults") {
        onFileSearchResults(message)
        return
      }

      if (message?.type === "mcpActionFinished") {
        setPendingMcpActions((current) => {
          if (!current[message.name]) {
            return current
          }
          const next = { ...current }
          delete next[message.name]
          return next
        })
      }
    }

    window.addEventListener("message", handler)
    vscode.postMessage({ type: "ready" })
    return () => window.removeEventListener("message", handler)
  }, [fileRefStatus, onFileSearchResults, setPendingMcpActions, setState, vscode])
}
