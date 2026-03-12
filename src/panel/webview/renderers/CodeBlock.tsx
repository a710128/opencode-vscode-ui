import React from "react"
import hljs from "highlight.js"

export function CodeBlock({ value, filePath }: { value: string; filePath?: string }) {
  const html = React.useMemo(() => highlightCode(value, codeLanguage(filePath)), [filePath, value])
  return <pre className="oc-codeBlock"><code dangerouslySetInnerHTML={{ __html: html }} /></pre>
}

export function highlightCode(value: string, language: string) {
  if (language && hljs.getLanguage(language)) {
    return hljs.highlight(value, { language }).value
  }
  return hljs.highlightAuto(value).value
}

export function renderMarkdownCodeWindow(value: string, language: string) {
  const lang = normalizeCodeLanguage(language)
  const title = lang ? capitalize(lang) : "Code"
  const lines = codeWindowRows(value, lang)
  const gutterDigits = codeWindowGutterDigits(value)
  return [
    '<section class="oc-outputWindow oc-outputWindow-markdownCode">',
    '<div class="oc-outputWindowHead">',
    '<div class="oc-outputWindowTitleRow">',
    '<span class="oc-outputWindowAction">Code</span>',
    `<span class="oc-outputWindowTitle">${escapeAttribute(title)}</span>`,
    '</div>',
    '<button type="button" class="oc-outputWindowCopyBtn" aria-label="Copy code"',
    ` data-copy-code="${escapeAttribute(value)}">`,
    '<svg class="oc-outputWindowCopyIcon" viewBox="0 0 16 16" aria-hidden="true">',
    '<rect x="5" y="3" width="8" height="10" rx="1.5" />',
    '<path d="M3.5 10.5V5.5c0-.828.672-1.5 1.5-1.5h5" />',
    '</svg>',
    '<span class="oc-outputWindowCopyTip">Copied!</span>',
    '</button>',
    '</div>',
    '<div class="oc-outputWindowBody">',
    '<div class="oc-outputWindowBodyInner">',
    `<pre class="oc-codeWindowBody oc-codeWindowBody-gutter-${gutterDigits}"><code class="oc-codeWindowText">`,
    lines,
    '</code></pre>',
    '</div>',
    '</div>',
    '</section>',
  ].join("")
}

function codeWindowRows(value: string, language: string) {
  const rows = normalizedLines(value)
  return rows.map((line, index) => {
    const html = highlightCode(line, language)
    return [
      '<span class="oc-codeWindowLine">',
      `<span class="oc-codeWindowLineNo">${index + 1}</span>`,
      `<span class="oc-codeWindowLineText hljs${language ? ` language-${escapeAttribute(language)}` : ""}">${html || " "}</span>`,
      '</span>',
    ].join("")
  }).join("")
}

function normalizeCodeLanguage(value: string) {
  const lang = value.trim().toLowerCase().split(/\s+/)[0] || ""
  if (!lang) {
    return ""
  }
  if (hljs.getLanguage(lang)) {
    return lang
  }
  if (lang === "ts") return "typescript"
  if (lang === "js") return "javascript"
  if (lang === "md") return "markdown"
  if (lang === "sh" || lang === "shell") return "bash"
  if (lang === "yml") return "yaml"
  return ""
}

function normalizedLines(value: string) {
  return value.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n")
}

function codeWindowGutterDigits(value: string) {
  return Math.min(Math.max(String(normalizedLines(value).length).length, 2), 6)
}

function escapeAttribute(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
}

function codeLanguage(filePath?: string) {
  const value = stringValue(filePath)
  const normalized = value.toLowerCase()
  if (normalized.endsWith(".ts")) return "typescript"
  if (normalized.endsWith(".tsx")) return "tsx"
  if (normalized.endsWith(".js")) return "javascript"
  if (normalized.endsWith(".jsx")) return "jsx"
  if (normalized.endsWith(".json")) return "json"
  if (normalized.endsWith(".css")) return "css"
  if (normalized.endsWith(".html")) return "html"
  if (normalized.endsWith(".md")) return "markdown"
  if (normalized.endsWith(".sh")) return "bash"
  if (normalized.endsWith(".yml") || normalized.endsWith(".yaml")) return "yaml"
  return ""
}

function stringValue(value: unknown) {
  return typeof value === "string" ? value : ""
}

function capitalize(value: string) {
  if (!value) {
    return ""
  }
  return value[0].toUpperCase() + value.slice(1)
}
