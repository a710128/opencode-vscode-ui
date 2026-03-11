import type { AgentInfo, McpResource } from "../../core/sdk"
import type { ComposerParityFixture } from "./composer-parity"

const agents: AgentInfo[] = [
  { name: "helper", mode: "subagent", model: { providerID: "openai", modelID: "gpt-4.1" } },
  { name: "build", mode: "all", model: { providerID: "openai", modelID: "gpt-4.1" } },
]

const resources: Record<string, McpResource> = {
  docs: {
    name: "docs",
    uri: "mcp://docs/reference",
    description: "Reference docs",
    mimeType: "text/markdown",
    client: "reference",
  },
}

const files = {
  selected: {
    path: "src/panel/webview/app/App.tsx",
    kind: "file" as const,
    source: "selection" as const,
    selection: { startLine: 12, endLine: 20 },
  },
  recent: [
    "README.md",
    "src/panel/webview/app/App.tsx",
  ],
  workspace: [
    "README.md",
    "src/panel/webview/app/App.tsx",
    "src/panel/webview/app/composer-editor.ts",
    "src/panel/webview/hooks/useComposerAutocomplete.ts",
    "src/panel/provider/files.ts",
  ],
}

const searchOnlyFiles = {
  recent: ["README.md"],
  workspace: files.workspace,
}

export const composerParityFixtures: ComposerParityFixture[] = [
  {
    name: "slash actions filter and order",
    draft: "/re",
    cursor: 3,
    composerAgentOverride: "helper",
    expected: {
      trigger: "slash",
      query: "re",
      items: [
        {
          id: "slash-refresh",
          kind: "action",
          label: "refresh",
          detail: "Ask the host to reload the current session snapshot.",
        },
        {
          id: "slash-reset-agent",
          kind: "action",
          label: "reset-agent",
          detail: "Return the composer to the default agent selection.",
        },
        {
          id: "slash-clear",
          kind: "action",
          label: "clear",
          detail: "Clear the current composer draft locally.",
        },
      ],
      accepted: {
        action: "slash-refresh",
      },
    },
    acceptIndex: 0,
  },
  {
    name: "mention empty query mixes agent resource selection and recents",
    draft: "@",
    cursor: 1,
    agents,
    mcpResources: resources,
    files,
    expected: {
      trigger: "mention",
      query: "",
      items: [
        { id: "agent:helper", kind: "agent", label: "helper", detail: "Subagent" },
        { id: "agent:build", kind: "agent", label: "build", detail: "Agent" },
        { id: "resource:reference:mcp://docs/reference", kind: "resource", label: "docs", detail: "reference - mcp://docs/reference" },
        { id: "selection:file:src/panel/webview/app/App.tsx:12:20", kind: "selection", label: "App.tsx#12-20", detail: "src/panel/webview/app/App.tsx - Selected lines 12-20" },
        { id: "recent:file:README.md::", kind: "recent", label: "README.md", detail: "README.md" },
      ],
    },
  },
  {
    name: "mention directory query returns directory result",
    draft: "@panel/we",
    cursor: 9,
    files,
    expected: {
      trigger: "mention",
      query: "panel/we",
      items: [
        { id: "search:directory:src/panel/webview/::", kind: "directory", label: "webview/", detail: "src/panel/webview/" },
        { id: "search:directory:src/panel/webview/app/::", kind: "directory", label: "app/", detail: "src/panel/webview/app/" },
        { id: "search:directory:src/panel/webview/hooks/::", kind: "directory", label: "hooks/", detail: "src/panel/webview/hooks/" },
        { id: "search:file:src/panel/webview/app/composer-editor.ts::", kind: "file", label: "composer-editor.ts", detail: "src/panel/webview/app/composer-editor.ts" },
        { id: "search:file:src/panel/webview/hooks/useComposerAutocomplete.ts::", kind: "file", label: "useComposerAutocomplete.ts", detail: "src/panel/webview/hooks/useComposerAutocomplete.ts" },
      ],
      accepted: {
        draft: "@src/panel/webview/ ",
        submitParts: [
          { type: "text", text: "@src/panel/webview/ " },
          {
            type: "file",
            path: "src/panel/webview/",
            kind: "directory",
            selection: undefined,
            source: {
              value: "@src/panel/webview/",
              start: 0,
              end: 19,
            },
          },
        ],
      },
    },
    acceptIndex: 0,
  },
  {
    name: "mention file range query preserves selected lines in submit parts",
    draft: "open @src/panel/webview/app/App.tsx#12-20",
    cursor: 41,
    files: searchOnlyFiles,
    expected: {
      trigger: "mention",
      query: "src/panel/webview/app/App.tsx#12-20",
      items: [
        {
          id: "search:file:src/panel/webview/app/App.tsx::",
          kind: "file",
          label: "App.tsx#12-20",
          detail: "src/panel/webview/app/App.tsx#12-20",
        },
      ],
      accepted: {
        draft: "open @src/panel/webview/app/App.tsx#12-20 ",
        submitParts: [
          { type: "text", text: "open @src/panel/webview/app/App.tsx#12-20 " },
          {
            type: "file",
            path: "src/panel/webview/app/App.tsx",
            kind: "file",
            selection: { startLine: 12, endLine: 20 },
            source: {
              value: "@src/panel/webview/app/App.tsx#12-20",
              start: 5,
              end: 41,
            },
          },
        ],
      },
    },
    acceptIndex: 0,
  },
]
