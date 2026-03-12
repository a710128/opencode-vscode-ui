import React from "react"
import MarkdownIt from "markdown-it"
import { renderMarkdownCodeWindow } from "./CodeBlock"
import { parseFileReference, syncMarkdownFileRefs } from "./FileRefText"

const markdown = createMarkdown()
const copyTipTimers = new WeakMap<HTMLButtonElement, number>()

export function MarkdownBlock({ fileRefStatus, onOpenFile, onResolveFileRefs, content, className = "" }: { fileRefStatus: Map<string, boolean>; onOpenFile: (filePath: string, line?: number) => void; onResolveFileRefs: (refs: Array<{ key: string; filePath: string }>) => void; content: string; className?: string }) {
  const html = React.useMemo(() => markdown.render(content || ""), [content])
  const rootRef = React.useRef<HTMLDivElement | null>(null)

  React.useEffect(() => {
    const root = rootRef.current
    if (!root) {
      return
    }
    const sync = () => syncMarkdownFileRefs(root, fileRefStatus, onResolveFileRefs)
    sync()
    window.addEventListener("oc-file-refs-updated", sync)
    return () => window.removeEventListener("oc-file-refs-updated", sync)
  }, [fileRefStatus, html, onResolveFileRefs])

  return <div ref={rootRef} className={`oc-markdown${className ? ` ${className}` : ""}`} dangerouslySetInnerHTML={{ __html: html }} onClick={(event) => {
    const target = event.target
    if (!(target instanceof Element)) {
      return
    }
    const link = target.closest("a")
    if (link instanceof HTMLAnchorElement) {
      const fileRef = parseFileReference(link.getAttribute("href") || "")
      if (fileRef && fileRefStatus.get(fileRef.key) !== false) {
        event.preventDefault()
        event.stopPropagation()
        onOpenFile(fileRef.filePath, fileRef.line)
      }
      return
    }
    const inlineCode = target.closest(".oc-inlineCode")
    if (inlineCode instanceof HTMLElement) {
      if (!event.metaKey && !event.ctrlKey) {
        return
      }
      const fileRef = parseFileReference(inlineCode.textContent || "")
      if (!fileRef || !fileRefStatus.get(fileRef.key)) {
        return
      }
      event.preventDefault()
      event.stopPropagation()
      onOpenFile(fileRef.filePath, fileRef.line)
      return
    }
    const button = target.closest("[data-copy-code]")
    if (!(button instanceof HTMLButtonElement)) {
      return
    }
    const value = button.getAttribute("data-copy-code") || ""
    if (!value) {
      return
    }
    event.preventDefault()
    event.stopPropagation()
    button.blur()
    const timer = copyTipTimers.get(button)
    if (timer) {
      window.clearTimeout(timer)
    }
    button.setAttribute("data-copied", "true")
    copyTipTimers.set(button, window.setTimeout(() => {
      button.removeAttribute("data-copied")
      copyTipTimers.delete(button)
    }, 1200))
    void copyText(value)
  }} />
}

function createMarkdown() {
  const instance = new MarkdownIt({
    breaks: true,
    linkify: true,
    highlight(value: string, language: string) {
      return renderMarkdownCodeWindow(value, language)
    },
  })
  const linkDefault = instance.renderer.rules.link_open
  instance.renderer.rules.link_open = (...args: Parameters<NonNullable<typeof linkDefault>>) => {
    const [tokens, idx, options, env, self] = args
    tokens[idx]?.attrSet("target", "_blank")
    tokens[idx]?.attrSet("rel", "noreferrer noopener")
    return linkDefault ? linkDefault(tokens, idx, options, env, self) : self.renderToken(tokens, idx, options)
  }
  const codeInlineDefault = instance.renderer.rules.code_inline
  instance.renderer.rules.code_inline = (...args: Parameters<NonNullable<typeof codeInlineDefault>>) => {
    const [tokens, idx, options, env, self] = args
    tokens[idx]?.attrSet("class", "oc-inlineCode")
    return codeInlineDefault ? codeInlineDefault(tokens, idx, options, env, self) : self.renderToken(tokens, idx, options)
  }
  instance.renderer.rules.hr = (tokens, idx) => {
    const value = tokens[idx]?.markup || "---"
    return `<p>${instance.utils.escapeHtml(value)}</p>`
  }
  return instance
}

function copyText(value: string) {
  const clipboard = window.navigator?.clipboard
  if (clipboard?.writeText) {
    return clipboard.writeText(value)
  }
  const input = document.createElement("textarea")
  input.value = value
  input.className = "oc-copyScratchpad"
  input.setAttribute("readonly", "true")
  document.body.appendChild(input)
  input.select()
  document.execCommand("copy")
  document.body.removeChild(input)
  return Promise.resolve()
}
