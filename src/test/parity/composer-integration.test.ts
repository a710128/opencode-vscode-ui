import assert from "node:assert/strict"
import { describe, test } from "node:test"
import { runComposerIntegration } from "./composer-integration"

describe("composer integration visibility", () => {
  test("@src shows only host-limited visible results", () => {
    const workspace = [
      "src/core/sdk.ts",
      "src/extension.ts",
      "src/core/tabs.ts",
      "src/bridge/host.ts",
      "src/bridge/types.ts",
      "src/core/commands.ts",
      "src/core/events.ts",
      "src/core/server.ts",
      "src/core/session.ts",
      "src/core/workspace.ts",
      "src/panel/html.ts",
      "src/panel/serializer.ts",
      "src/sidebar/focused.ts",
      "src/sidebar/html.ts",
      "src/sidebar/item.ts",
      "src/sidebar/provider.ts",
      "src/sidebar/view-provider.ts",
      "src/sidebar/view-types.ts",
      "src/panel/provider/actions.ts",
      "src/panel/provider/controller.ts",
      "src/panel/provider/file-search.test.ts",
      "src/panel/provider/file-search.ts",
      "src/panel/provider/files.ts",
      "src/panel/provider/index.ts",
      "src/panel/provider/mutations.ts",
      "src/panel/provider/navigation.ts",
      "src/panel/provider/reducer.ts",
      "src/panel/provider/snapshot.ts",
      "src/panel/provider/utils.ts",
      "src/panel/webview/app/App.tsx",
      "src/panel/webview/app/composer-editor.ts",
    ]

    const result = runComposerIntegration({
      name: "@src visibility",
      draft: "@src",
      cursor: 4,
      host: { workspace },
    })

    assert.equal(result.trigger, "mention")
    assert.equal(result.hostResults.length, 24, "host returns exactly FILE_SEARCH_LIMIT=24 results")
    assert.equal(result.hostResults.every((item) => item.kind === "file"), true, "all host results are files because files exhaust the 24-item limit before directories")
    assert.equal(result.items.some((item) => item.kind === "directory"), false, "no directory is visible to the user")
  })

  test("@src can show directories when recents and files do not exhaust host limit", () => {
    const result = runComposerIntegration({
      name: "@src directories visible",
      draft: "@src",
      cursor: 4,
      host: {
        workspace: [
          "src/panel/webview/app/App.tsx",
          "src/panel/webview/hooks/useComposerAutocomplete.ts",
          "src/core/sdk.ts",
        ],
      },
    })

    assert.deepEqual(result.items.slice(0, 4), [
      { id: "search:directory:src/::", kind: "directory", label: "src/", detail: "src/" },
      { id: "search:directory:src/core/::", kind: "directory", label: "core/", detail: "src/core/" },
      { id: "search:directory:src/panel/::", kind: "directory", label: "panel/", detail: "src/panel/" },
      { id: "search:file:src/core/sdk.ts::", kind: "file", label: "sdk.ts", detail: "src/core/sdk.ts" },
    ])
  })

  test("@src/panel returns panel files and sub-directories, directories not hidden by file limit", () => {
    const result = runComposerIntegration({
      name: "@src/panel visibility",
      draft: "@src/panel",
      cursor: 10,
      host: {
        workspace: [
          "src/panel/html.ts",
          "src/panel/serializer.ts",
          "src/panel/provider/actions.ts",
          "src/panel/provider/files.ts",
          "src/panel/webview/app/App.tsx",
          "src/panel/webview/hooks/useComposerAutocomplete.ts",
        ],
      },
    })

    assert.equal(result.trigger, "mention")
    assert.ok(result.items.length > 0, "some items visible")
    assert.ok(result.items.some((item) => item.kind === "directory"), "directories visible because files don't exhaust limit")
    assert.ok(result.items.some((item) => item.kind === "file"), "files also visible")
    const dirLabels = result.items.filter((item) => item.kind === "directory").map((item) => item.detail)
    assert.ok(dirLabels.some((d) => d.startsWith("src/panel/")), "src/panel/ subdirectories present")
  })

  test("empty @ returns agents, resources, selection, and recents in kind-group order", () => {
    const result = runComposerIntegration({
      name: "empty @ order",
      draft: "@",
      cursor: 1,
      agents: [
        { name: "helper", mode: "subagent" },
        { name: "build", mode: "all" },
      ],
      resources: {
        "ref:docs": { name: "docs", uri: "mcp://docs/ref", client: "ref" },
      },
      host: {
        selected: { path: "src/app.ts", kind: "file", source: "selection", selection: { startLine: 5 } },
        recent: ["README.md", "src/bridge/types.ts"],
        workspace: ["src/core/sdk.ts"],
      },
    })

    assert.equal(result.trigger, "mention")
    const kinds = result.items.map((item) => item.kind)
    const agentIdx = kinds.indexOf("agent")
    const resourceIdx = kinds.indexOf("resource")
    const selectionIdx = kinds.indexOf("selection")
    const recentIdx = kinds.indexOf("recent")
    assert.ok(agentIdx < resourceIdx, "agents before resources")
    assert.ok(resourceIdx < selectionIdx, "resources before selection")
    assert.ok(selectionIdx < recentIdx, "selection before recents")
  })

  test("@file#12-20 range query result is visible and selection metadata preserved", () => {
    const result = runComposerIntegration({
      name: "@file#12-20 visibility",
      draft: "@src/panel/webview/app/App.tsx#12-20",
      cursor: 36,
      host: {
        workspace: [
          "src/panel/webview/app/App.tsx",
          "src/panel/webview/hooks/useComposerAutocomplete.ts",
        ],
      },
    })

    assert.equal(result.trigger, "mention")
    assert.equal(result.items.length, 1)
    assert.equal(result.items[0].label, "App.tsx#12-20")
    assert.equal(result.items[0].detail, "src/panel/webview/app/App.tsx#12-20")
    assert.equal(result.items[0].kind, "file")
  })

  test("/ returns slash actions and no file results", () => {
    const result = runComposerIntegration({
      name: "slash visibility",
      draft: "/",
      cursor: 1,
      host: {
        workspace: ["src/core/sdk.ts"],
      },
    })

    assert.equal(result.trigger, "slash")
    assert.equal(result.hostResults.length, 0, "host search not triggered for slash")
    assert.ok(result.items.every((item) => item.kind === "action"), "only actions returned for /")
  })

  test("recent files appear before workspace search results", () => {
    const result = runComposerIntegration({
      name: "recent before search",
      draft: "@App",
      cursor: 4,
      host: {
        recent: ["src/panel/webview/app/App.tsx"],
        workspace: ["src/panel/webview/app/App.tsx", "src/panel/webview/app/state.ts"],
      },
    })

    assert.equal(result.trigger, "mention")
    const sources = result.hostResults.map((item) => item.source)
    const recentIdx = sources.indexOf("recent")
    const searchIdx = sources.indexOf("search")
    assert.ok(recentIdx < searchIdx, "recent comes before search in host results")
    assert.equal(result.hostResults.filter((item) => item.path === "src/panel/webview/app/App.tsx").length, 1, "deduped: App.tsx appears only once even though it is in both recent and workspace")
  })
})
