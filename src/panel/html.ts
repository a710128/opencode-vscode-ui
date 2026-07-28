import * as vscode from "vscode"
import type { SessionPanelRef } from "../bridge/types"
import { getColorScheme } from "../core/settings"

export function sessionPanelHtml(webview: vscode.Webview, extensionUri: vscode.Uri, ref?: SessionPanelRef) {
  const nonce = nonceText()
  const initialState = JSON.stringify(ref ?? null)
  const scriptUri = assetUri(webview, extensionUri, "panel-webview.js")
  const styleUri = assetUri(webview, extensionUri, "panel-webview.css")
  const colorScheme = getColorScheme()

  return /* html */ `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${webview.cspSource} https: data:; style-src ${webview.cspSource}; script-src 'nonce-${nonce}' ${webview.cspSource}; font-src ${webview.cspSource};" />
    <title>OpenCode Session</title>
    <link rel="stylesheet" href="${styleUri}" />
  </head>
  <body data-color-scheme="${colorScheme}">
    <div id="root"></div>
    <script nonce="${nonce}">
      window.__OPENCODE_INITIAL_STATE__ = ${initialState}
    </script>
    <script nonce="${nonce}" src="${scriptUri}"></script>
  </body>
</html>`
}

function assetUri(webview: vscode.Webview, extensionUri: vscode.Uri, name: string) {
  return webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, "dist", name))
}

function nonceText() {
  const chars = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789"
  let result = ""

  for (let i = 0; i < 32; i += 1) {
    result += chars[Math.floor(Math.random() * chars.length)]
  }

  return result
}
