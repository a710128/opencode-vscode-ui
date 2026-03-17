import * as vscode from "vscode"

export type DiffMode = "unified" | "split"

export type DisplaySettings = {
  showInternals: boolean
  showThinking: boolean
  diffMode: DiffMode
}

const SECTION = "opencode-ui"

export const HTTP_PROXY_KEY = "httpProxy"
export const SHOW_INTERNALS_KEY = "showInternals"
export const SHOW_THINKING_KEY = "showThinking"
export const DIFF_MODE_KEY = "diffMode"

export function getDisplaySettings(): DisplaySettings {
  const config = vscode.workspace.getConfiguration(SECTION)
  return {
    showInternals: config.get<boolean>(SHOW_INTERNALS_KEY, false),
    showThinking: config.get<boolean>(SHOW_THINKING_KEY, true),
    diffMode: config.get<DiffMode>(DIFF_MODE_KEY, "unified") === "split" ? "split" : "unified",
  }
}

export function getHttpProxy() {
  const config = vscode.workspace.getConfiguration(SECTION)
  const proxy = config.get<string>(HTTP_PROXY_KEY, "").trim()

  if (proxy) {
    return proxy
  }

  if (hasInheritedProxy()) {
    return ""
  }

  return vscode.workspace.getConfiguration("http").get<string>("proxy", "").trim()
}

export function affectsDisplaySettings(event: vscode.ConfigurationChangeEvent) {
  return event.affectsConfiguration(`${SECTION}.${SHOW_INTERNALS_KEY}`)
    || event.affectsConfiguration(`${SECTION}.${SHOW_THINKING_KEY}`)
    || event.affectsConfiguration(`${SECTION}.${DIFF_MODE_KEY}`)
}

export function affectsHttpProxySetting(event: vscode.ConfigurationChangeEvent) {
  return event.affectsConfiguration(`${SECTION}.${HTTP_PROXY_KEY}`)
    || event.affectsConfiguration("http.proxy")
}

export function openSettingsQuery() {
  return "@ext:zgy.opencode-vscode-ui"
}

export function proxyRestartMessage() {
  return "Proxy setting changed. Restart the editor to apply it to opencode serve."
}

function hasInheritedProxy() {
  return [
    process.env.HTTP_PROXY,
    process.env.HTTPS_PROXY,
    process.env.http_proxy,
    process.env.https_proxy,
  ].some((value) => typeof value === "string" && value.trim().length > 0)
}
