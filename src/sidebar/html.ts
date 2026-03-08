import * as vscode from "vscode"
import type { SidebarViewMode } from "./view-types"

export function sidebarViewHtml(webview: vscode.Webview, extensionUri: vscode.Uri, mode: SidebarViewMode) {
  const nonce = nonceText()
  const scriptUri = assetUri(webview, extensionUri, "sidebar-webview.js")
  const styleUri = assetUri(webview, extensionUri, "sidebar-webview.css")

  return /* html */ `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${webview.cspSource} https: data:; style-src ${webview.cspSource}; script-src 'nonce-${nonce}' ${webview.cspSource}; font-src ${webview.cspSource};" />
    <title>${mode === "todo" ? "Todo" : "Modified Files"}</title>
    <link rel="stylesheet" href="${styleUri}" />
  </head>
  <body>
    <div id="root"></div>
    <script nonce="${nonce}">window.__OPENCODE_SIDEBAR_MODE__ = ${JSON.stringify(mode)}</script>
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
