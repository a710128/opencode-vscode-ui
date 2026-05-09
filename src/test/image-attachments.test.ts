import assert from "node:assert/strict"
import { describe, test } from "node:test"

import { imageMimeFromFilename, supportedImageMime } from "../bridge/image-attachments"

describe("image attachment helpers", () => {
  test("normalizes supported MIME values", () => {
    assert.equal(supportedImageMime("image/png"), "image/png")
    assert.equal(supportedImageMime("IMAGE/JPEG"), "image/jpeg")
    assert.equal(supportedImageMime("image/bmp"), undefined)
  })

  test("detects supported image extensions", () => {
    assert.equal(imageMimeFromFilename("cat.jpg"), "image/jpeg")
    assert.equal(imageMimeFromFilename("diagram.WEBP"), "image/webp")
    assert.equal(imageMimeFromFilename("icon.svg"), undefined)
  })
})
