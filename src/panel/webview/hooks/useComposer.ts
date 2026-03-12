import React from "react"

export function useComposerResize(composerRef: React.RefObject<HTMLElement | null>, draft: string) {
  React.useEffect(() => {
    resizeComposer(composerRef.current)
    ensureComposerCursorVisible(composerRef.current)
  }, [composerRef, draft])

  React.useEffect(() => {
    const onResize = () => {
      resizeComposer(composerRef.current)
      ensureComposerCursorVisible(composerRef.current)
    }
    window.addEventListener("resize", onResize)
    return () => window.removeEventListener("resize", onResize)
  }, [composerRef])
}

export function resizeComposer(node: HTMLElement | null) {
  if (!node) {
    return
  }
}

export function ensureComposerCursorVisible(node: HTMLElement | null) {
  if (!node) {
    return
  }

  const selection = window.getSelection()
  if (!selection || selection.rangeCount === 0) {
    return
  }

  const range = selection.getRangeAt(0)
  if (!node.contains(range.endContainer)) {
    return
  }

  if (selection.isCollapsed && isCollapsedSelectionAtEnd(node, range)) {
    node.scrollTop = node.scrollHeight
    return
  }

  const caretRange = range.cloneRange()
  caretRange.collapse(false)
  const rects = caretRange.getClientRects()
  const caretRect = rects[rects.length - 1] ?? caretRange.getBoundingClientRect()
  if (!caretRect || (caretRect.width === 0 && caretRect.height === 0 && caretRect.top === 0 && caretRect.bottom === 0)) {
    return
  }

  const nodeRect = node.getBoundingClientRect()
  const style = window.getComputedStyle(node)
  const paddingTop = Number.parseFloat(style.paddingTop) || 0
  const paddingBottom = Number.parseFloat(style.paddingBottom) || 0
  const visibleTop = nodeRect.top + paddingTop
  const visibleBottom = nodeRect.bottom - paddingBottom

  if (caretRect.bottom > visibleBottom) {
    node.scrollTop += caretRect.bottom - visibleBottom
  } else if (caretRect.top < visibleTop) {
    node.scrollTop -= visibleTop - caretRect.top
  }
}

function isCollapsedSelectionAtEnd(node: HTMLElement, range: Range) {
  const probe = range.cloneRange()
  probe.selectNodeContents(node)
  probe.setStart(range.endContainer, range.endOffset)
  return (probe.toString().replace(/\u200B/g, "") === "")
}
