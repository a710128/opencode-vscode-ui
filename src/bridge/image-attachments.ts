export const SUPPORTED_IMAGE_MIMES = ["image/png", "image/jpeg", "image/gif", "image/webp"] as const

export type SupportedImageMime = typeof SUPPORTED_IMAGE_MIMES[number]

const IMAGE_MIME_BY_EXTENSION: Record<string, SupportedImageMime> = {
  ".gif": "image/gif",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
}

export function supportedImageMime(value?: string | null): SupportedImageMime | undefined {
  const normalized = value?.trim().toLowerCase()
  return SUPPORTED_IMAGE_MIMES.find((mime) => mime === normalized)
}

export function imageMimeFromFilename(filename: string): SupportedImageMime | undefined {
  const match = filename.toLowerCase().match(/\.[^.\/\\]+$/)
  return match ? IMAGE_MIME_BY_EXTENSION[match[0]] : undefined
}

export function isSupportedImageFilename(filename: string) {
  return !!imageMimeFromFilename(filename)
}
