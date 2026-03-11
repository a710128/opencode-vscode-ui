import type { ComposerEditorPart } from "./state"

const MAX_BREAKS = 200

export function createTextFragment(content: string): DocumentFragment {
  const fragment = document.createDocumentFragment()
  let breaks = 0
  for (const char of content) {
    if (char !== "\n") {
      continue
    }
    breaks += 1
    if (breaks > MAX_BREAKS) {
      const text = content.endsWith("\n") ? content.slice(0, -1) : content
      if (text) {
        fragment.appendChild(document.createTextNode(text))
      }
      if (content.endsWith("\n")) {
        fragment.appendChild(document.createElement("br"))
      }
      return fragment
    }
  }

  const lines = content.split("\n")
  lines.forEach((line, index) => {
    if (line) {
      fragment.appendChild(document.createTextNode(line))
    }
    if (index < lines.length - 1) {
      fragment.appendChild(document.createElement("br"))
    }
  })
  return fragment
}

export function renderComposerEditor(root: HTMLElement, parts: ComposerEditorPart[]) {
  root.replaceChildren()

  for (const part of parts) {
    if (part.type === "text") {
      root.appendChild(createTextFragment(part.content))
      continue
    }
    root.appendChild(createPill(part))
  }

  const last = root.lastChild
  if (last?.nodeType === Node.ELEMENT_NODE && (last as HTMLElement).tagName === "BR") {
    root.appendChild(document.createTextNode("\u200B"))
  }
}

export function parseComposerEditor(root: HTMLElement): ComposerEditorPart[] {
  const parts: ComposerEditorPart[] = []
  let position = 0
  let buffer = ""

  const flushText = () => {
    let content = buffer.replace(/\r\n?/g, "\n").replace(/\u200B/g, "")
    buffer = ""
    if (!content && parts.length > 0) {
      return
    }
    parts.push({ type: "text", content, start: position, end: position + content.length })
    position += content.length
  }

  const visit = (node: Node) => {
    if (node.nodeType === Node.TEXT_NODE) {
      buffer += node.textContent ?? ""
      return
    }
    if (node.nodeType !== Node.ELEMENT_NODE) {
      return
    }

    const el = node as HTMLElement
    if (el.dataset.type === "agent") {
      flushText()
      const content = el.textContent ?? ""
      parts.push({ type: "agent", name: el.dataset.name || content.slice(1), content, start: position, end: position + content.length })
      position += content.length
      return
    }
    if (el.dataset.type === "file") {
      flushText()
      const content = el.textContent ?? ""
      parts.push({
        type: "file",
        path: el.dataset.path || content.slice(1),
        kind: el.dataset.kind === "directory" ? "directory" : "file",
        selection: el.dataset.startLine ? {
          startLine: Number(el.dataset.startLine),
          endLine: el.dataset.endLine ? Number(el.dataset.endLine) : undefined,
        } : undefined,
        content,
        start: position,
        end: position + content.length,
      })
      position += content.length
      return
    }
    if (el.dataset.type === "resource") {
      flushText()
      const content = el.textContent ?? ""
      parts.push({
        type: "resource",
        uri: el.dataset.uri || "",
        name: el.dataset.name || content.slice(1),
        clientName: el.dataset.clientName || "",
        mimeType: el.dataset.mimeType || undefined,
        content,
        start: position,
        end: position + content.length,
      })
      position += content.length
      return
    }
    if (el.tagName === "BR") {
      buffer += "\n"
      return
    }

    for (const child of Array.from(el.childNodes)) {
      visit(child)
    }
  }

  const children = Array.from(root.childNodes)
  children.forEach((child, index) => {
    const isBlock = child.nodeType === Node.ELEMENT_NODE && ["DIV", "P"].includes((child as HTMLElement).tagName)
    visit(child)
    if (isBlock && index < children.length - 1) {
      buffer += "\n"
    }
  })
  flushText()
  return parts
}

export function getNodeLength(node: Node): number {
  if (node.nodeType === Node.ELEMENT_NODE && (node as HTMLElement).tagName === "BR") {
    return 1
  }
  return (node.textContent ?? "").replace(/\u200B/g, "").length
}

export function getTextLength(node: Node): number {
  if (node.nodeType === Node.TEXT_NODE) {
    return (node.textContent ?? "").replace(/\u200B/g, "").length
  }
  if (node.nodeType === Node.ELEMENT_NODE && (node as HTMLElement).tagName === "BR") {
    return 1
  }
  let length = 0
  for (const child of Array.from(node.childNodes)) {
    length += getTextLength(child)
  }
  return length
}

export function getCursorPosition(root: HTMLElement): number {
  const selection = window.getSelection()
  if (!selection || selection.rangeCount === 0) {
    return 0
  }
  const range = selection.getRangeAt(0)
  if (!root.contains(range.startContainer)) {
    return 0
  }
  const pre = range.cloneRange()
  pre.selectNodeContents(root)
  pre.setEnd(range.startContainer, range.startOffset)
  return getTextLength(pre.cloneContents())
}

export function getSelectionOffsets(root: HTMLElement) {
  const selection = window.getSelection()
  if (!selection || selection.rangeCount === 0) {
    return { start: 0, end: 0 }
  }
  const range = selection.getRangeAt(0)
  if (!root.contains(range.startContainer) || !root.contains(range.endContainer)) {
    return { start: 0, end: 0 }
  }

  const startRange = range.cloneRange()
  startRange.selectNodeContents(root)
  startRange.setEnd(range.startContainer, range.startOffset)

  const endRange = range.cloneRange()
  endRange.selectNodeContents(root)
  endRange.setEnd(range.endContainer, range.endOffset)

  return {
    start: getTextLength(startRange.cloneContents()),
    end: getTextLength(endRange.cloneContents()),
  }
}

export function setCursorPosition(root: HTMLElement, position: number) {
  let remaining = position
  let node = root.firstChild
  while (node) {
    const length = getNodeLength(node)
    const isText = node.nodeType === Node.TEXT_NODE
    const isPill = node.nodeType === Node.ELEMENT_NODE && ((node as HTMLElement).dataset.type === "file" || (node as HTMLElement).dataset.type === "agent" || (node as HTMLElement).dataset.type === "resource")
    const isBreak = node.nodeType === Node.ELEMENT_NODE && (node as HTMLElement).tagName === "BR"

    if (isText && remaining <= length) {
      const range = document.createRange()
      const selection = window.getSelection()
      range.setStart(node, remaining)
      range.collapse(true)
      selection?.removeAllRanges()
      selection?.addRange(range)
      return
    }

    if ((isPill || isBreak) && remaining <= length) {
      const range = document.createRange()
      const selection = window.getSelection()
      if (remaining === 0) {
        range.setStartBefore(node)
      } else {
        range.setStartAfter(node)
      }
      range.collapse(true)
      selection?.removeAllRanges()
      selection?.addRange(range)
      return
    }

    remaining -= length
    node = node.nextSibling
  }

  const range = document.createRange()
  const selection = window.getSelection()
  range.selectNodeContents(root)
  range.collapse(false)
  selection?.removeAllRanges()
  selection?.addRange(range)
}

function createPill(part: Extract<ComposerEditorPart, { type: "agent" | "file" | "resource" }>) {
  const pill = document.createElement("span")
  pill.className = `oc-composerPill is-${part.type}`
  pill.dataset.type = part.type
  pill.contentEditable = "false"
  if (part.type === "agent") {
    pill.dataset.name = part.name
  }
  if (part.type === "file") {
    pill.dataset.path = part.path
    if (part.kind) {
      pill.dataset.kind = part.kind
    }
    if (part.selection) {
      pill.dataset.startLine = String(part.selection.startLine)
      if (part.selection.endLine) {
        pill.dataset.endLine = String(part.selection.endLine)
      }
    }
  }
  if (part.type === "resource") {
    pill.dataset.uri = part.uri
    pill.dataset.name = part.name
    pill.dataset.clientName = part.clientName
    if (part.mimeType) {
      pill.dataset.mimeType = part.mimeType
    }
  }
  pill.textContent = part.content
  return pill
}
