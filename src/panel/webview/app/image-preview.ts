export type ImagePreviewSide = "above" | "below"

const PREVIEW_VERTICAL_SPACE = 280

export function imagePreviewSide(rect: Pick<DOMRect, "top" | "bottom">, viewportHeight: number): ImagePreviewSide {
  const spaceAbove = rect.top
  const spaceBelow = viewportHeight - rect.bottom

  if (spaceAbove >= PREVIEW_VERTICAL_SPACE) {
    return "above"
  }

  if (spaceBelow >= PREVIEW_VERTICAL_SPACE) {
    return "below"
  }

  return spaceAbove >= spaceBelow ? "above" : "below"
}
