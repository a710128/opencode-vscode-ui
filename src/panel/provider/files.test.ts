import assert from "node:assert/strict"
import { describe, test } from "node:test"
import * as vscode from "vscode"
import { toFileUri } from "./files"

describe("panel file URI resolution", () => {
  test("keeps remote authority while resolving relative paths from submodule dirs", () => {
    const folderUri = {
      scheme: "vscode-remote",
      authority: "ssh-remote+box",
      path: "/workspace",
      fsPath: "/workspace",
      toString: () => "vscode-remote://ssh-remote+box/workspace",
      with(change: { path?: string }) {
        const nextPath = change.path ?? this.path
        return {
          ...this,
          path: nextPath,
          fsPath: nextPath,
          toString: () => `vscode-remote://ssh-remote+box${nextPath}`,
        }
      },
    }

    ;(vscode.workspace as any).workspaceFolders = [{
      uri: folderUri,
      name: "workspace",
    }]

    const uri = toFileUri("src/app.ts", {
      workspaceId: "vscode-remote://ssh-remote+box/workspace/libs/foo",
      dir: "/workspace/libs/foo",
    })

    assert.equal(uri?.scheme, "vscode-remote")
    assert.equal(uri?.authority, "ssh-remote+box")
    assert.equal(uri?.fsPath, "/workspace/libs/foo/src/app.ts")
  })
})
