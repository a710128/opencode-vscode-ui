import assert from "node:assert/strict"
import { describe, test } from "node:test"
import * as vscode from "vscode"
import { computeTargets, parseGitmodules } from "../core/submodules"

const encoder = new TextEncoder()

describe("submodule discovery", () => {
  test("parses quoted sections, whitespace, CRLF, nested paths, and missing paths", () => {
    assert.deepEqual(parseGitmodules([
      "[submodule \"kaze-js\"]",
      "\tpath = kaze-js",
      "\turl = ../kaze-js.git",
      "[submodule \"libs/foo\"]",
      "  path   =   libs/foo  ",
      "[submodule \"missing\"]",
      "  url = ../missing.git",
      "",
    ].join("\r\n")), ["kaze-js", "libs/foo"])
  })

  test("computes initialized submodule targets with dedupe, depth, and naming", async () => {
    const files = new Map<string, string>([
      ["/repo/.gitmodules", [
        "[submodule \"libs/foo\"]",
        "  path = libs/foo",
        "[submodule \"missing\"]",
        "  path = missing",
      ].join("\n")],
      ["/repo/libs/foo/.gitmodules", [
        "[submodule \"nested/bar\"]",
        "  path = nested/bar",
      ].join("\n")],
    ])
    const dirs = new Set([
      "/repo",
      "/repo/libs/foo",
      "/repo/libs/foo/nested/bar",
      "/repo/explicit",
    ])
    const gitEntries = new Set([
      "/repo/libs/foo/.git",
      "/repo/libs/foo/nested/bar/.git",
      "/repo/explicit/.git",
    ])

    ;(vscode.workspace as any).workspaceFolders = [
      { uri: vscode.Uri.file("/repo"), name: "repo" },
      { uri: vscode.Uri.file("/repo/libs/foo"), name: "explicit-foo" },
    ]
    ;(vscode.workspace as any).getConfiguration = () => ({
      get(key: string, fallback: unknown) {
        if (key === "submoduleDepth") {
          return 2
        }
        if (key === "discoverSubmodules") {
          return true
        }
        return fallback
      },
    })
    ;(vscode.workspace.fs as any).readFile = async (uri: vscode.Uri) => {
      const value = files.get(uri.fsPath)
      if (value === undefined) {
        throw new Error("missing")
      }
      return encoder.encode(value)
    }
    ;(vscode.workspace.fs as any).stat = async (uri: vscode.Uri) => {
      if (dirs.has(uri.fsPath)) {
        return { type: vscode.FileType.Directory }
      }
      if (gitEntries.has(uri.fsPath)) {
        return { type: 0 }
      }
      throw new Error("missing")
    }

    const targets = await computeTargets()

    assert.deepEqual(targets.map((item) => item.name), [
      "repo",
      "explicit-foo",
      "repo/libs/foo/nested/bar",
    ])
    assert.equal(targets[2].parentId, vscode.Uri.file("/repo").toString())
  })

  test("includes nested submodules but skips nested duplicates of root submodules", async () => {
    const files = new Map<string, string>([
      ["/cfa/.gitmodules", [
        "[submodule \"blockchain\"]",
        "  path = blockchain",
        "  url = ../blockchain.git",
        "[submodule \"status-svr\"]",
        "  path = status-svr",
        "  url = ../status-svr.git",
      ].join("\n")],
      ["/cfa/blockchain/.gitmodules", [
        "[submodule \"kaze\"]",
        "  path = kaze",
        "  url = ../kaze.git",
      ].join("\n")],
      ["/cfa/status-svr/.gitmodules", [
        "[submodule \"blockchain\"]",
        "  path = blockchain",
        "  url = ../blockchain.git",
      ].join("\n")],
    ])
    const dirs = new Set([
      "/cfa",
      "/cfa/blockchain",
      "/cfa/blockchain/kaze",
      "/cfa/status-svr",
      "/cfa/status-svr/blockchain",
    ])
    const gitEntries = new Set([
      "/cfa/blockchain/.git",
      "/cfa/blockchain/kaze/.git",
      "/cfa/status-svr/.git",
      "/cfa/status-svr/blockchain/.git",
    ])

    ;(vscode.workspace as any).workspaceFolders = [
      { uri: vscode.Uri.file("/cfa"), name: "cfa" },
    ]
    ;(vscode.workspace as any).getConfiguration = () => ({
      get(key: string, fallback: unknown) {
        if (key === "submoduleDepth") {
          return 2
        }
        if (key === "discoverSubmodules") {
          return true
        }
        return fallback
      },
    })
    ;(vscode.workspace.fs as any).readFile = async (uri: vscode.Uri) => {
      const value = files.get(uri.fsPath)
      if (value === undefined) {
        throw new Error("missing")
      }
      return encoder.encode(value)
    }
    ;(vscode.workspace.fs as any).stat = async (uri: vscode.Uri) => {
      if (dirs.has(uri.fsPath)) {
        return { type: vscode.FileType.Directory }
      }
      if (gitEntries.has(uri.fsPath)) {
        return { type: 0 }
      }
      throw new Error("missing")
    }

    const targets = await computeTargets()

    assert.deepEqual(targets.map((item) => item.name), [
      "cfa",
      "cfa/blockchain",
      "cfa/blockchain/kaze",
      "cfa/status-svr",
    ])
  })
})
