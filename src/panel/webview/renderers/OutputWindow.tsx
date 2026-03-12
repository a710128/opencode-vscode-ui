import React from "react"

const OUTPUT_WINDOW_COLLAPSED_LINES = 10
const OUTPUT_WINDOW_EXPANDED_LINES = 100
const OUTPUT_WINDOW_FONT_SIZE_PX = 12
const OUTPUT_WINDOW_LINE_HEIGHT = 1.65
const OUTPUT_WINDOW_VERTICAL_PADDING_PX = 24

export function OutputWindow({ ToolStatus, action, title, running = false, lineCount, className = "", children }: { ToolStatus: ({ state }: { state?: string }) => React.JSX.Element | null; action: string; title: React.ReactNode; running?: boolean; lineCount: number; className?: string; children: React.ReactNode }) {
  const [expanded, setExpanded] = React.useState(false)
  const [contentHeight, setContentHeight] = React.useState(0)
  const toggleRef = React.useRef<HTMLButtonElement | null>(null)
  const scrollAdjustRef = React.useRef<{ scrollNode: HTMLElement; top: number } | null>(null)
  const contentRef = React.useRef<HTMLDivElement | null>(null)
  const collapsedHeight = React.useMemo(() => outputWindowBodyHeight(OUTPUT_WINDOW_COLLAPSED_LINES), [])
  const expandedHeight = React.useMemo(() => outputWindowBodyHeight(OUTPUT_WINDOW_EXPANDED_LINES), [])
  const collapsible = contentHeight > collapsedHeight + 1
  const scrollable = contentHeight > expandedHeight + 1

  React.useLayoutEffect(() => {
    const node = contentRef.current
    if (!node) {
      return
    }
    const measure = () => {
      const next = Math.ceil(node.scrollHeight)
      setContentHeight((current) => current === next ? current : next)
    }
    measure()
    const Observer = window.ResizeObserver
    if (!Observer) {
      return
    }
    const observer = new Observer(() => measure())
    observer.observe(node)
    return () => observer.disconnect()
  }, [children, expanded])

  React.useEffect(() => {
    if (!collapsible && expanded) {
      setExpanded(false)
    }
  }, [collapsible, expanded])

  React.useLayoutEffect(() => {
    const pending = scrollAdjustRef.current
    const toggleNode = toggleRef.current
    if (!pending || !toggleNode) {
      return
    }
    const nextTop = toggleNode.getBoundingClientRect().top
    pending.scrollNode.scrollTop += nextTop - pending.top
    scrollAdjustRef.current = null
  }, [expanded])

  const bodyClassName = [
    "oc-outputWindowBody",
    collapsible ? "is-collapsible" : "",
    collapsible && expanded ? "is-expanded" : "",
    collapsible && !expanded ? "is-collapsed" : "",
    collapsible && expanded && scrollable ? "is-scrollable" : "",
  ].filter(Boolean).join(" ")

  return (
    <section className={["oc-outputWindow", className].filter(Boolean).join(" ")}>
      <div className="oc-outputWindowHead">
        <div className="oc-outputWindowTitleRow">
          <span className="oc-outputWindowAction">{action}</span>
          <span className="oc-outputWindowTitle">{title}</span>
        </div>
        <span className="oc-outputWindowSpinnerSlot">{running ? <ToolStatus state="running" /> : null}</span>
      </div>
      <div className={bodyClassName}>
        <div ref={contentRef} className="oc-outputWindowBodyInner">{children}</div>
      </div>
      {collapsible ? (
        <button ref={toggleRef} type="button" className="oc-outputWindowToggle" aria-expanded={expanded} aria-label={expanded ? "Collapse output" : "Expand output"} onClick={(event) => {
          const toggleNode = event.currentTarget
          if (expanded) {
            const scrollNode = toggleNode.closest(".oc-transcript")
            if (scrollNode instanceof HTMLElement) {
              scrollAdjustRef.current = { scrollNode, top: toggleNode.getBoundingClientRect().top }
            } else {
              scrollAdjustRef.current = null
            }
          } else {
            scrollAdjustRef.current = null
          }
          setExpanded((current) => !current)
        }}>
          <svg className="oc-outputWindowToggleIcon" viewBox="0 0 16 16" aria-hidden="true">
            {expanded ? <path d="M4 10l4-4 4 4" /> : <path d="M4 6l4 4 4-4" />}
          </svg>
          <span className="oc-outputWindowToggleMeta">{formatLineCount(lineCount)}</span>
        </button>
      ) : null}
    </section>
  )
}

export function normalizedLineCount(value: string) {
  if (!value) {
    return 0
  }
  return value.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n").length
}

function outputWindowBodyHeight(lines: number) {
  const lineHeightPx = OUTPUT_WINDOW_FONT_SIZE_PX * OUTPUT_WINDOW_LINE_HEIGHT
  return Math.round(lines * lineHeightPx + OUTPUT_WINDOW_VERTICAL_PADDING_PX)
}

function formatLineCount(value: number) {
  return `${value} ${value === 1 ? "line" : "lines"}`
}
