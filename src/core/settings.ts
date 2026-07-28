import * as vscode from "vscode"

export type DiffMode = "unified" | "split"
export type ServerStartMode = "eager" | "lazy" | "root-eager"
export type ColorScheme = "dark" | "vscode"

export type DisplaySettings = {
  showInternals: boolean
  showThinking: boolean
  diffMode: DiffMode
}

const SECTION = "opencode-ui"

export const HTTP_PROXY_KEY = "httpProxy"
export const OPENCODE_EXECUTABLE_PATH_KEY = "executablePath"
export const SHOW_INTERNALS_KEY = "showInternals"
export const SHOW_THINKING_KEY = "showThinking"
export const DIFF_MODE_KEY = "diffMode"
export const DISCOVER_SUBMODULES_KEY = "discoverSubmodules"
export const SUBMODULE_DEPTH_KEY = "submoduleDepth"
export const SERVER_START_KEY = "serverStart"
export const COLOR_SCHEME_KEY = "colorScheme"

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

export function getOpencodeExecutablePath() {
  return vscode.workspace.getConfiguration(SECTION).get<string>(OPENCODE_EXECUTABLE_PATH_KEY, "").trim() || "opencode"
}

export function getDiscoverSubmodules() {
  return vscode.workspace.getConfiguration(SECTION).get<boolean>(DISCOVER_SUBMODULES_KEY, true)
}

export function getSubmoduleDepth() {
  const value = vscode.workspace.getConfiguration(SECTION).get<number>(SUBMODULE_DEPTH_KEY, 1)
  if (!Number.isFinite(value)) {
    return 1
  }

  return Math.max(0, Math.min(3, Math.trunc(value)))
}

export function getServerStartMode(): ServerStartMode {
  const value = vscode.workspace.getConfiguration(SECTION).get<string>(SERVER_START_KEY, "root-eager")
  return value === "lazy" || value === "eager" ? value : "root-eager"
}

export function getColorScheme(): ColorScheme {
  return vscode.workspace.getConfiguration(SECTION).get<string>(COLOR_SCHEME_KEY, "dark") === "vscode" ? "vscode" : "dark"
}

export function affectsDisplaySettings(event: vscode.ConfigurationChangeEvent) {
  return event.affectsConfiguration(`${SECTION}.${SHOW_INTERNALS_KEY}`)
    || event.affectsConfiguration(`${SECTION}.${SHOW_THINKING_KEY}`)
    || event.affectsConfiguration(`${SECTION}.${DIFF_MODE_KEY}`)
}

export function affectsColorScheme(event: vscode.ConfigurationChangeEvent) {
  return event.affectsConfiguration(`${SECTION}.${COLOR_SCHEME_KEY}`)
}

export function affectsHttpProxySetting(event: vscode.ConfigurationChangeEvent) {
  return event.affectsConfiguration(`${SECTION}.${HTTP_PROXY_KEY}`)
    || event.affectsConfiguration("http.proxy")
}

export function affectsOpencodeExecutablePathSetting(event: vscode.ConfigurationChangeEvent) {
  return event.affectsConfiguration(`${SECTION}.${OPENCODE_EXECUTABLE_PATH_KEY}`)
}

export function affectsWorkspaceTargetsSetting(event: vscode.ConfigurationChangeEvent) {
  return event.affectsConfiguration(`${SECTION}.${DISCOVER_SUBMODULES_KEY}`)
    || event.affectsConfiguration(`${SECTION}.${SUBMODULE_DEPTH_KEY}`)
    || event.affectsConfiguration(`${SECTION}.${SERVER_START_KEY}`)
}

export function openSettingsQuery() {
  return "@ext:zgy.opencode-vscode-ui"
}

export function proxyRestartMessage() {
  return "Proxy setting changed. Restart the editor to apply it to opencode serve."
}

export function executablePathRestartMessage() {
  return "OpenCode executable path changed. Restart the editor to apply it to opencode serve."
}

function hasInheritedProxy() {
  return [
    process.env.HTTP_PROXY,
    process.env.HTTPS_PROXY,
    process.env.http_proxy,
    process.env.https_proxy,
  ].some((value) => typeof value === "string" && value.trim().length > 0)
}
