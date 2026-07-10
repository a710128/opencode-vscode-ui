# Spec: Git Submodule Discovery + Lazy Server Start for opencode-vscode-ui

Target repository: https://github.com/a710128/opencode-vscode-ui
Scope: design/implementation spec only. All file paths below are relative to the repo root.

---

## 1. Background and Motivation

The extension shows opencode sessions grouped by workspace. Today the set of workspaces is exactly `vscode.workspace.workspaceFolders`. For each folder the extension spawns a dedicated local server process (`opencode serve --port <port> --hostname 127.0.0.1`) and talks to it via the opencode SDK.

The user works in a monorepo-style setup where the root repo (e.g. `cfa`) contains **git submodules** (e.g. `kaze-js`, `blockchain`, `status-svr`). VS Code's built-in Source Control view lists submodules as sibling repositories automatically. This extension does not: only the root folder appears in the Sessions tree, so sessions cannot be scoped to a submodule unless the user manually adds each submodule as a workspace folder.

**Goal 1 (submodules):** automatically discover git submodules of every open workspace folder and show them in the Sessions tree as top-level workspaces, siblings of the root repo — mirroring the Source Control behavior.

**Goal 2 (lazy-start):** because each workspace costs one `opencode serve` process, discovering N submodules would spawn N+1 servers at activation. Add a lazy-start mode so servers are started on demand instead of eagerly at activation.

Both features must work in Remote-SSH (`extensionKind: ["workspace"]` — the extension host runs on the remote, so all filesystem access via `vscode.workspace.fs` / Node `fs` happens on the correct machine).

---

## 2. Current Architecture (as of commit on `main`, July 2026)

Understanding this flow is required before making changes.

### 2.1 Activation flow — `src/extension.ts`

- `activate()` constructs, in order: `WorkspaceManager` (`mgr`), `EventHub`, `SessionStore`, `SessionPanelManager`, `TabManager`, `FocusedSessionStore`, `SidebarProvider` (tree), two `SidebarViewProvider` webviews (todo/diff), and a `SessionPanelSerializer`.
- Then: `await mgr.sync(vscode.workspace.workspaceFolders ?? [])` → `await sessions.refreshAll()` → `await events.sync()`.
- Subscribes to `vscode.workspace.onDidChangeWorkspaceFolders` and re-runs `mgr.sync(...)` + `events.sync()`.
- The sessions tree is registered with `vscode.window.registerTreeDataProvider("opencode-ui.sessions", tree)` — note this returns a `Disposable`, **not** a `TreeView`, so there is currently no access to expand/collapse events (relevant for lazy-start, see §4.3).

### 2.2 Workspace lifecycle — `src/core/workspace.ts`

- `WorkspaceManager` holds `state: Map<workspaceId, WorkspaceRuntime>` and `dirIndex: Map<fsPath, workspaceId>`.
- `sync(folders: readonly vscode.WorkspaceFolder[])`: computes the diff between current runtimes and incoming folders; removes gone ones, calls `ensure(folder)` for each incoming folder.
- `ensure(folder)` → serialized `ensureNow(folder)`: allocates a free port (`freeport()` in `src/core/server.ts`), spawns the server (`spawn(dir, port)` in `src/core/server.ts`), builds a `WorkspaceRuntime`, waits for `health()` or startup failure, then creates the SDK client via `client(url, dir)` from `src/core/sdk.ts` and sets `state = "ready"`.
- `restart(id)`: **re-resolves the folder by searching `vscode.workspace.workspaceFolders`** (line ~41). This is one of the couplings that breaks for submodules.
- `workspaceId(folder)` = `folder.uri.toString()`; `hostLabel(folder)` uses `folder.uri.scheme` and `folder.name` for logging.
- `WorkspaceRuntime` (defined in `src/core/server.ts`) already stores plain data: `workspaceId: string`, `dir: string`, `name: string`, `port`, `url`, `state: "starting" | "ready" | "error" | "stopped" | "stopping"`, session maps, `proc`, `sdk`. Nothing downstream holds a `vscode.WorkspaceFolder` — a helpful property for this task.

### 2.3 Consumers of `mgr.list()` (all keyed by `workspaceId` / plain runtime fields)

- `src/core/session.ts` — `SessionStore`. `sync()` and `refreshAll()` iterate `mgr.list()` and only touch runtimes with `state === "ready" && rt.sdk`. Idle/stopped runtimes are naturally skipped.
- `src/core/events.ts` — `EventHub.sync()` starts an SSE subscription loop per runtime, again only for `state === "ready" && rt.sdk`, and aborts loops for runtimes that disappeared from `mgr.list()`.
- `src/sidebar/provider.ts` — `SidebarProvider.getChildren()` renders one `WorkspaceItem` per runtime at the root level, and per-workspace children based on `rt.state` (`starting` → status row, `error` → error row, not-`ready` → `"Server stopped"`, `ready` → session list).
- `src/sidebar/item.ts` — `WorkspaceItem` is always `TreeItemCollapsibleState.Expanded`, label = `runtime.name`, `desc()` renders `ready :<port>` / `starting :<port>` / `error` / `stopped`.

### 2.4 Places that still reach for `vscode.workspace.workspaceFolders` directly

These will misbehave for submodule workspaces (a submodule dir is *inside* a workspace folder but is not itself one):

1. `src/core/workspace.ts` — `restart(id)` (see §2.2).
2. `src/core/commands.ts` — the `opencode-ui.refresh` command re-runs `mgr.sync(vscode.workspace.workspaceFolders ?? [])`. If discovery isn't wired in here too, hitting Refresh will **drop all submodule workspaces**.
3. `src/panel/provider/index.ts` — `canRestoreRef(ref, vscode.workspace.workspaceFolders)` gates webview panel restore after window reload. Implementation in the same directory (`restore-state`-adjacent file): returns true only if some folder's `uri.toString() === ref.workspaceId || uri.fsPath === ref.dir`. Exact-match ⇒ restored submodule session panels would be rejected.
4. `src/panel/provider/files.ts` — `workspaceFolder(workspace: WorkspaceRef)` finds the folder by exact `workspaceId`/`fsPath` match; used by `absoluteUri()` to preserve the remote URI scheme/authority (`vscode-remote://...`) when building file URIs. For a submodule there is no exact match; the local fallback (`vscode.Uri.file(...)`) works for local windows but **loses the remote authority in Remote-SSH**.

### 2.5 Server spawn — `src/core/server.ts`

`spawn(dir, port)` runs the executable from `getOpencodeExecutablePath()` (`src/core/settings.ts`) with `cwd: dir`. One process per workspace. `stop()` performs SIGINT → SIGTERM → SIGKILL escalation (taskkill on Windows).

### 2.6 Settings — `src/core/settings.ts` + `contributes.configuration` in `package.json`

Existing keys: `opencode-ui.showThinking`, `showInternals`, `diffMode`, `httpProxy`, `executablePath`. Pattern to follow for new keys: constant in `settings.ts`, getter, `affects*Setting(event)` helper, entry in `package.json` `contributes.configuration.properties` with `scope: "machine-overridable"`.

### 2.7 Tests

Bun test (`bun test ./src/panel ./src/test`), with a vscode API mock in `src/test/preload-vscode.ts` (currently stubs `workspaceFolders: []` and `onDidChangeWorkspaceFolders`). New core logic should come with unit tests in the same style.

---

## 3. Feature 1 — Submodule Discovery

### 3.1 New module: `src/core/submodules.ts`

Responsibilities:

- `discoverSubmodules(folder: WorkspaceTarget): Promise<WorkspaceTarget[]>` — for a given root directory:
  1. Read `<root>/.gitmodules` (via `vscode.workspace.fs.readFile` so it works over remote FS; the extension runs on the workspace host, so Node `fs` is also acceptable — prefer `vscode.workspace.fs` for consistency).
  2. Parse it. `.gitmodules` is INI-like:
     ```
     [submodule "kaze-js"]
         path = kaze-js
         url = ../kaze-js.git
     ```
     Only the `path` values are needed. A small hand-rolled parser (regex over sections) is sufficient; do **not** add an npm dependency for this. Handle: quoted section names, tabs/spaces, CRLF, `path` values with subdirectories (`libs/foo`).
  3. Resolve each `path` against the root URI (`vscode.Uri.joinPath`).
  4. Filter out **uninitialized** submodules: the directory must exist and contain a `.git` entry (for submodules this is usually a *file* containing `gitdir: ...`, not a directory — check for existence of either).
  5. Optionally recurse into discovered submodules (nested submodules). Recommend supporting one config-controlled depth, default depth 1 (direct submodules only), max e.g. 3 to avoid pathological trees.
- Return `WorkspaceTarget[]` where each target carries `uri`, `name` (see naming, §3.4), and `parentId` (the root workspace's id — useful for dedupe/labeling).

Alternative considered and rejected: shelling out to `git submodule status` or using the built-in `vscode.git` extension API. Parsing `.gitmodules` is simpler, dependency-free, works when git is slow/absent, and matches what Source Control effectively shows. Do note in code comments that `.gitmodules` may list modules whose worktrees are absent — hence the initialization check in step 4.

### 3.2 Decouple `WorkspaceManager` from `vscode.WorkspaceFolder` — `src/core/workspace.ts`

- Introduce a light target type (place it in `workspace.ts` or `server.ts` next to `WorkspaceRuntime`):
  ```
  WorkspaceTarget = { uri: vscode.Uri; name: string; parentId?: string }
  ```
  `vscode.WorkspaceFolder` is structurally assignable to it (has `uri`, `name`), so call sites passing folders keep working.
- Change signatures: `sync(targets: readonly WorkspaceTarget[])`, `ensure(target)`, `ensureNow(target)`, `workspaceId(target)`, `hostLabel(target)`.
- **Add a target registry**: `private targets = new Map<string, WorkspaceTarget>()`, updated in `sync()`/`ensure()`. Rewrite `restart(id)` to look up the target in this registry instead of searching `vscode.workspace.workspaceFolders`. Remove stale entries in `sync()` when a target disappears.
- `WorkspaceRuntime` gains optional `parentId?: string` (copied from the target) so the sidebar can label submodules.

### 3.3 Single source of truth for the target list — new helper + wiring

- Add `computeTargets(): Promise<WorkspaceTarget[]>` (suggested location: `src/core/submodules.ts` or a tiny `src/core/targets.ts`): takes `vscode.workspace.workspaceFolders`, appends discovered submodules for each folder, **dedupes by `uri.fsPath`** (case-insensitively on Windows/macOS) — this covers the case where the user already added a submodule as an explicit workspace folder in a multi-root workspace.
- Replace every `mgr.sync(vscode.workspace.workspaceFolders ?? [])` call with `mgr.sync(await computeTargets())`. Call sites:
  - `src/extension.ts` — initial activation sync.
  - `src/extension.ts` — `onDidChangeWorkspaceFolders` handler.
  - `src/core/commands.ts` — `opencode-ui.refresh` command (**critical**, see §2.4 item 2).
- Add a `vscode.workspace.createFileSystemWatcher("**/.gitmodules")` in `extension.ts`; on create/change/delete → re-run `mgr.sync(await computeTargets())` + `events.sync()`. Debounce (~500 ms) to avoid churn during `git submodule update`. Push the watcher into `ctx.subscriptions`.

### 3.4 Naming and sidebar presentation

- Submodule target `name` = `<rootFolder.name>/<submodulePathRelativeToRoot>` (e.g. `cfa/kaze-js`, `cfa/libs/foo`). This disambiguates when two roots contain same-named submodules and makes the hierarchy visible even though the tree stays flat (sessions remain one level under each workspace item, matching the current UX and the Source Control analogy).
- Sorting: `WorkspaceManager.list()` already sorts by name; with the naming scheme above, submodules naturally group under their root. Keep it.
- `src/sidebar/item.ts` — `WorkspaceItem`: optionally use a distinct icon for submodule runtimes (`parentId` set), e.g. `repo` vs `repo-forked`/`file-submodule` ThemeIcon, so users can tell roots from submodules. Tooltip already shows `dir`, keep it.

### 3.5 Fix the exact-match couplings for panel restore and file URIs

- `src/panel/provider/index.ts` + `canRestoreRef(...)`: change the predicate from exact folder match to **containment**: restore is allowed if `ref.dir` equals a folder's `fsPath` **or is located under one** (normalize paths, compare with `path.relative` not starting with `..`). Rationale: after a reload, submodule discovery may not have completed before the serializer runs; containment is a safe over-approximation (the dir is inside the trusted workspace).
- `src/panel/provider/files.ts` — `workspaceFolder(workspace)`: same change — return the workspace folder that **contains** `workspace.dir` (longest matching prefix wins) so `absoluteUri()` keeps the remote scheme/authority for submodule paths in Remote-SSH.

### 3.6 New settings (package.json + `src/core/settings.ts`)

- `opencode-ui.discoverSubmodules` (boolean, default `true`) — master switch.
- `opencode-ui.submoduleDepth` (number, default `1`, min 0, max 3) — nested discovery depth; `0` disables (equivalent to the switch off, keep both for clarity or collapse into one setting — implementer's choice, document it).
- On change of either → re-run `computeTargets()` + `mgr.sync(...)` (no window reload needed; follow the `onDidChangeConfiguration` pattern in `extension.ts` but sync instead of prompting to reload).

### 3.7 Session panel restore ordering (activation race)

In `activate()`, the `SessionPanelSerializer` is registered before `mgr.sync()` completes; VS Code may call `deserializeWebviewPanel` while discovery is still running. `SessionPanelManager.restore` resolves the runtime via `mgr.get(...)`. Ensure restore for a not-yet-registered submodule workspace either (a) waits for the initial `sync()` promise (expose it from `extension.ts` / the manager), or (b) `restore` retries once after `mgr.onDidChange`. Option (a) is simpler: store the initial sync promise and `await` it at the top of `restore`.

---

## 4. Feature 2 — Lazy Server Start

### 4.1 Design

- New runtime state `"idle"`: the workspace is **registered** (visible in the tree) but no server process exists yet. Extend the `RuntimeState` union in `src/core/server.ts`.
- New setting `opencode-ui.serverStart` (string enum, `scope: "machine-overridable"`):
  - `"eager"` — current behavior, start everything on sync. **Default**, to avoid changing behavior for existing users.
  - `"lazy"` — register all workspaces as `idle`; start on demand.
  - `"root-eager"` — start workspace-folder roots eagerly, submodules lazily. Likely the best default for submodule-heavy repos; recommend it in the setting description.
- `WorkspaceManager.sync()` splits into two phases: **register** (create/refresh an `idle` runtime entry for every target; remove gone ones) and **start** (call `ensureNow` only for targets the policy says to start eagerly). Add `startPolicy(target): boolean` derived from the setting + `target.parentId`.
- Add a public `start(id: string)` on `WorkspaceManager` (thin wrapper over `ensure(this.targets.get(id))`) — the on-demand entry point.

Key property that makes this cheap: `SessionStore.sync/refreshAll` (`src/core/session.ts`) and `EventHub.sync` (`src/core/events.ts`) already filter on `state === "ready" && rt.sdk`, so `idle` runtimes are inert with **zero changes** to those files. Verify with a test.

### 4.2 On-demand start triggers

Start the server when the user expresses intent to use a workspace:

1. **Explicit**: new command `opencode-ui.startWorkspaceServer` (register in `src/core/commands.ts`, add to `package.json` `contributes.commands` and `view/item/context` menu with `when: viewItem == workspace-idle`, inline play icon `$(play)`).
2. **New session**: in `opencode-ui.newSession` / `newSessionAndOpen` (`src/core/commands.ts`), if the resolved runtime is `idle` → `await mgr.start(id)` first, then proceed once `ready` (surface `runtimeNotReadyMessage` from `src/core/runtime-errors.ts` on failure, as today).
3. **Open session** (`opencode-ui.openSession`) and **panel restore** (`SessionPanelManager.restore`, `src/panel/provider/index.ts`): same pattern — start if idle, await ready, then continue. For restore this also interacts with §3.7.
4. **Tree expand** (optional, nice UX): switch `extension.ts` from `registerTreeDataProvider` to `vscode.window.createTreeView("opencode-ui.sessions", { treeDataProvider: tree })` to obtain a `TreeView`, subscribe to `onDidExpandElement`, and start idle workspaces when their item is expanded. To make this meaningful, `WorkspaceItem` for `idle` runtimes should be created with `TreeItemCollapsibleState.Collapsed` (currently always `Expanded`, `src/sidebar/item.ts`). Non-idle items keep `Expanded`.

### 4.3 Sidebar changes — `src/sidebar/provider.ts`, `src/sidebar/item.ts`

- `WorkspaceItem`: for `state === "idle"` → `contextValue = "workspace-idle"` (enables the play button), description `"idle"`, icon e.g. `$(circle-outline)`, collapsible state `Collapsed`.
- `SidebarProvider.getChildren` for an idle workspace → single `StatusItem("Server not started", "click ▶ to start")` (or auto-start on expand per §4.2.4 and show `"Starting server..."`).
- `desc()` and `icon()` in `item.ts`: add the `idle` branch.

### 4.4 Idle-stop (explicitly out of scope, note for the agent)

Do **not** implement auto-shutdown of idle servers in this task. Mention in code comments / README that `serverStart` only controls startup; a future `idleShutdownMinutes` setting could stop servers with no open panels and no busy sessions. Keeping scope tight avoids touching the SSE/event lifecycle.

---

## 5. Edge Cases Checklist

- `.gitmodules` exists but submodule not initialized (no worktree / no `.git` entry) → skip silently; log once to the `OpenCode UI` output channel.
- Submodule path listed in `.gitmodules` but directory deleted → skip; watcher re-sync removes a previously registered runtime (existing `sync()` diff logic handles removal → `removeNow` stops the process).
- Submodule also added as an explicit workspace folder → dedupe by `fsPath` in `computeTargets()`; the explicit folder wins (keeps its own name, eager policy).
- Two workspace roots with identically named submodules → names are prefixed with the root name (§3.4), ids are full URIs — no collision.
- Windows paths: normalize separators when computing containment (`canRestoreRef`, `workspaceFolder`) and dedupe case-insensitively.
- Remote-SSH: all discovery must go through `vscode.workspace.fs` or run in the (remote) extension host — both fine given `extensionKind: ["workspace"]`; verify `absoluteUri` keeps the `vscode-remote` authority for submodule dirs (§3.5).
- `git submodule update`/`git checkout` rewriting `.gitmodules` mid-operation → watcher debounce (§3.3).
- Setting changed `eager` → `lazy` at runtime: do not kill already-running servers; the policy applies to future syncs only (document this in the setting description).

---

## 6. Testing

Follow the existing bun-test setup (`src/test/preload-vscode.ts` mock; may need to extend the mock with `createFileSystemWatcher`, `workspace.fs.readFile`, `createTreeView` stubs).

- Unit: `.gitmodules` parser — sections with quotes/tabs/CRLF, nested paths, missing `path` key, empty file.
- Unit: `computeTargets` — dedupe against explicit folders, initialized-only filter, depth limit, naming.
- Unit: `WorkspaceManager.sync` with targets — register/remove diff, `idle` registration under `lazy` policy, `start()` transitions `idle → starting → ready` (mock `spawn`/`health`).
- Unit: `canRestoreRef` containment logic (exact, nested, outside, Windows-style paths).
- Manual: multi-root workspace where one folder is itself a submodule of another root; Remote-SSH smoke test; `opencode-ui.refresh` keeps submodules listed.

---

## 7. Acceptance Criteria

1. Opening a repo with initialized submodules shows each submodule as a top-level entry in the Sessions tree, named `<root>/<path>`, alongside the root — with no manual configuration.
2. `opencode-ui.refresh`, window reload, and `.gitmodules` edits all keep the submodule list correct.
3. Sessions can be created/opened/deleted in a submodule workspace exactly as in a root workspace, including panel restore after reload (also in Remote-SSH).
4. With `serverStart: "lazy"` (or `"root-eager"`), no `opencode serve` process is spawned for a workspace until the user starts it (command/new session/open session/expand); with `"eager"` behavior is unchanged from today.
5. Idle workspaces render distinctly in the tree and never trigger session polling or SSE subscriptions.
6. `discoverSubmodules: false` restores exactly today's behavior.
7. Existing tests pass; new logic covered per §6.

---

## 8. Implementation Tasks

- [x] Add `WorkspaceTarget` and decouple `WorkspaceManager` from `vscode.WorkspaceFolder`.
- [x] Add target registry in `WorkspaceManager` and make `restart(id)` resolve targets from the registry.
- [x] Extend `WorkspaceRuntime` with `parentId?: string`.
- [x] Add runtime state `"idle"` and implement lazy registration without spawning a server.
- [x] Add `WorkspaceManager.start(id)` for on-demand server startup.
- [x] Add `opencode-ui.serverStart` setting with `"eager"`, `"lazy"`, and `"root-eager"` policies.
- [x] Add `opencode-ui.discoverSubmodules` and `opencode-ui.submoduleDepth` settings.
- [x] Implement `src/core/submodules.ts` with `.gitmodules` parsing and initialized-submodule filtering.
- [x] Implement `computeTargets()` with submodule discovery, depth handling, and path-based dedupe.
- [x] Replace activation sync with `mgr.sync(await computeTargets())`.
- [x] Replace workspace-folder change sync with `mgr.sync(await computeTargets())`.
- [x] Replace refresh-command sync with `mgr.sync(await computeTargets())`.
- [x] Add a debounced `**/.gitmodules` file watcher that recomputes targets.
- [x] React to submodule/lazy-start setting changes without requiring window reload.
- [x] Switch sessions tree registration to `createTreeView` and start idle workspaces on expand.
- [x] Add `opencode-ui.startWorkspaceServer` command and tree item menu contribution.
- [x] Start idle workspaces before `newSession` and `newSessionAndOpen`.
- [x] Start idle workspaces before `openSession` and `openSessionById`.
- [x] Make session panel restore wait for the initial workspace sync before attaching.
- [x] Start idle workspaces during session panel restore when needed.
- [x] Update sidebar workspace item presentation for idle and submodule runtimes.
- [x] Add containment-based panel restore matching for submodule directories.
- [x] Add containment-based workspace folder lookup for file URI generation.
- [x] Update `package.json` activation events, commands, menus, and configuration schema.
- [x] Extend the VS Code test preload mock for filesystem reads, watchers, and tree views.
- [x] Add parser tests for quoted sections, whitespace, CRLF, nested paths, and missing paths.
- [x] Add target computation tests for dedupe, initialized-only filtering, depth, and naming.
- [x] Add workspace manager tests for idle registration, remove diff, and `start()` transition.
- [x] Add restore containment tests for exact, nested, outside, and Windows-style paths.
- [x] Verify `bun run check-types`.
- [x] Verify `bun run lint`.
- [x] Verify `bun run compile`.
- [x] Verify `bun run test`.
