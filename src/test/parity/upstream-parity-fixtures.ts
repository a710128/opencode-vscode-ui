import type { UpstreamFixture } from "./upstream-parity"

export const upstreamParityFixtures: UpstreamFixture[] = [
  {
    name: "web slash basic",
    target: "web",
    draft: "/re",
    cursor: 3,
    commands: {
      builtin: [
        { id: "session.refresh", trigger: "refresh", title: "Refresh", description: "Reload session" },
        { id: "session.reset", trigger: "reset-agent", title: "Reset agent", description: "Reset agent" },
      ],
      custom: [
        { name: "review", description: "Review prompt", source: "command" },
      ],
    },
  },
  {
    name: "web mention directory and recents",
    target: "web",
    draft: "@panel/we",
    cursor: 9,
    agents: [{ name: "helper", mode: "subagent" }],
    recent: ["README.md", "src/panel/webview/"],
    files: ["src/panel/webview/", "src/panel/webview/app/", "src/panel/provider/"],
  },
  {
    name: "tui mention resource empty",
    target: "tui",
    draft: "@",
    cursor: 1,
    agents: [{ name: "helper", mode: "subagent" }, { name: "build", mode: "all" }],
    files: ["src/panel/webview/", "README.md"],
    resources: [{ name: "docs", uri: "mcp://docs/reference", client: "reference", description: "Reference docs" }],
  },
  {
    name: "tui mention file range and directory",
    target: "tui",
    draft: "@src/panel/webview/app/App.tsx#12-20",
    cursor: 36,
    files: ["src/panel/webview/app/App.tsx", "src/panel/webview/", "src/panel/webview/app/"],
  },
]
