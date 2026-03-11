# OpenCode UI Plan

## Composer Mention Parity Roadmap

### Goal

Bring the VS Code session composer closer to the OpenCode TUI `@` mention experience without pretending to have parity where the extension still lacks the same editor model, search surface, or prompt-part semantics.

This roadmap replaces the earlier bootstrap plan. The initial autocomplete system is already shipped. The remaining work is now about closing the concrete parity gaps between the current VS Code implementation and the upstream TUI, especially for `@file`.

### What Exists Today

The current composer in `src/panel/webview/app/App.tsx` already supports:

- shared `/` and `@` autocomplete popup state in the webview
- keyboard navigation, active-item auto-scroll, and match highlighting
- compact single-line menu rows with bounded internal scrolling
- `@agent` and `@file` insertion into the textarea
- full-text-first submit payloads with typed `agent` and `file` parts using `source` offsets
- host-backed recent file, file, and directory lookup for `@` suggestions
- distinct autocomplete source kinds for agents, recent files, files, and directories
- fuzzy ranking and fuzzy-match highlighting for mention suggestions
- host-side conversion of file and directory mentions into honest SDK prompt parts
- focused regression coverage for path search behavior in `src/panel/provider/file-search.test.ts`

### Current Mismatches Versus The TUI

The main remaining differences are:

- the TUI edits a structured prompt with atomic pills; the extension still edits plain textarea text plus sidecar mention ranges
- the TUI has stronger caret, deletion, and IME behavior around mention boundaries than a textarea can provide today
- the upstream runtime owns file indexing and `find.files` behavior centrally; the extension now approximates that behavior locally and still needs ongoing parity verification for edge-case query shapes
- the TUI has extra mention affordances such as directory drill-in on `Tab` and line-range-aware file search that the extension does not yet implement

### Design Principles

- Optimize for behavioral truth, not visual imitation alone
- Close semantic gaps before spending more time on cosmetic polish
- Keep bridge and SDK type changes explicit and typed
- Prefer incremental upgrades that can ship independently
- Avoid rewriting the entire composer editor model unless the remaining parity gaps justify it
- Preserve current working behavior while replacing weaker internals step by step

### Important Decision

The highest-value parity gap is no longer the popup itself. It is the submit model.

The TUI sends:

- one full text part containing the complete prompt text
- separate typed file or agent parts with `source` ranges pointing into that text

That mismatch is now closed. The next highest-value gap is mention editing robustness inside the textarea model.

---

## Phase A - Align Prompt-Part Semantics

Status: completed

### Objective

Make the extension submit the same high-level prompt structure as the TUI: full prompt text first, typed mentions second.

### Why First

This is the most important behavior gap. Even if the popup looks similar, the model receives different prompt data today.

### Scope

- change webview serialization so submit always preserves the full draft as one `text` part
- append typed `agent` and `file` parts separately using `source` offsets into that full text
- keep backward compatibility for plain-text prompts
- update host submit conversion so it no longer depends on interleaved text fragments
- verify source offsets remain correct after mention insertion and editing

### Files Most Likely To Change

- `src/panel/webview/app/App.tsx`
- `src/bridge/types.ts`
- `src/panel/provider/actions.ts`
- `src/core/sdk.ts`

### Acceptance Criteria

- submit always includes the complete draft text unchanged as the first text part
- typed file and agent parts still submit with valid `source.start` and `source.end`
- plain prompts with no mentions still behave exactly as they do now
- unresolved file mentions degrade clearly and predictably

### Progress

- completed in the webview and host submit pipeline
- submit now preserves the full draft as the first text part and appends typed mentions after it
- unresolved file mentions no longer duplicate plain text during host conversion

---

## Phase B - Expand Search Sources To Match TUI Intent

Status: completed

### Objective

Make `@` feel like a context picker rather than only a token filter.

### Scope

- add a recent-file source for the mention popup
- decide how to source recent files in the extension, such as open editors, visible tabs, or session-related files
- extend host search to optionally include directories, not only files
- keep the search lazy and query-driven; do not bloat snapshot payloads
- hide sources the extension cannot actually submit or open cleanly

### Notes

The TUI exposes agents, recent files, and backend file or directory search. The extension should move toward the same shape even if the exact provider differs.

### Files Most Likely To Change

- `src/panel/provider/files.ts`
- `src/panel/provider/controller.ts`
- `src/bridge/types.ts`
- `src/panel/webview/app/App.tsx`

### Acceptance Criteria

- empty or near-empty `@` can surface useful recent file suggestions
- file search can return directories when the extension can represent them honestly
- agents, recents, and searched paths remain distinguishable in the UI and data model

### Progress

- completed with host-provided recent files plus searchable file and directory results
- composer items now distinguish `agent`, `recent`, `file`, and `directory` sources in the UI and data model
- directory mentions now submit honestly as `application/x-directory`

---

## Phase C - Replace Local Ranking With TUI-Like Filtering

Status: completed

### Objective

Improve result quality so file and agent hits behave more like the TUI under partial, fuzzy, and path-oriented queries.

### Scope

- replace the current exact and prefix and substring ranking with a proper fuzzy ranking strategy
- preserve stable ordering within result groups when scores tie
- compare whether ranking should happen entirely in the webview, entirely in the host, or in a split model by source
- revisit highlight rendering so it reflects the actual fuzzy match spans instead of plain substring matches

### Notes

The TUI uses `fuzzysort` in grouped lists. The extension should not copy blindly, but it should stop relying on the current narrow rule set once the source set expands.

### Files Most Likely To Change

- `src/panel/webview/hooks/useComposerAutocomplete.ts`
- `src/panel/webview/app/App.tsx`
- `src/panel/provider/files.ts`

### Acceptance Criteria

- path searches behave well for basename, subpath, and fuzzy partial matches
- result ordering feels consistent across agents, recents, and searched files
- highlighted text reflects what actually matched

### Progress

- completed with fuzzy subsequence ranking in the webview and broader host-side path candidate collection
- match highlighting now follows actual fuzzy match indexes instead of plain substring matches
- host path search was refactored away from narrow query-shaped globs toward ranked full-path matching
- regression tests now cover basename, nested path-prefix, directory-without-trailing-slash, root-file, hidden-path, and fuzzy partial queries

---

## Phase D - Harden Mention Editing In The Textarea Model

Status: completed

### Objective

Reduce the editing fragility caused by representing mentions as plain textarea text.

### Scope

- audit mention invalidation behavior when the user edits inside a mention token
- add stricter rules for when a mention should be preserved, shifted, or dropped
- improve deletion behavior around mention edges, especially Backspace and Delete near token boundaries
- review IME and composition interactions before commit acceptance
- tighten cursor heuristics so reopening and closing the popup does not fight normal editing

### Notes

This phase does not attempt to fully recreate TUI pills in a textarea. It hardens the current model so it fails less often.

### Progress

- completed with extracted composer mention helpers in `src/panel/webview/app/composer-mentions.ts`
- textarea Backspace and Delete now remove an entire touched mention token instead of leaving partial tracked-state corruption at the edges
- autocomplete reopening is now suppressed while the caret or selection remains inside a tracked mention range
- IME composition state now prevents Enter from accidentally accepting a mention while composing
- regression tests now cover mention insertion, range shifting, inside-edit degradation, boundary deletion, and autocomplete suppression in `src/panel/webview/app/composer-mentions.test.ts`

### Files Most Likely To Change

- `src/panel/webview/app/App.tsx`
- `src/panel/webview/app/composer-mentions.ts`
- `src/panel/webview/app/composer-mentions.test.ts`

### Acceptance Criteria

- editing adjacent to a mention is stable under insert, delete, and paste operations
- partial edits inside a mention produce predictable degradation into plain text
- IME and normal Enter handling do not accidentally select or submit mentions

---

## Phase E - Decide Whether To Introduce Atomic Mention Chips

Status: completed

### Objective

Make an explicit architectural decision about whether textarea-based mentions are sufficient, or whether parity now requires moving to an atomic inline representation.

### Decision Gate

At the start of this phase, review the remaining gaps after Phase D.

If the remaining issues are mostly ranking and source quality, keep the textarea.

If the remaining issues are still dominated by caret, deletion, selection, and edit-boundary bugs, plan a separate editor-model upgrade.

### Option 1 - Stay With Textarea

- keep sidecar mention ranges
- continue incremental heuristics
- document known non-parity behaviors clearly

### Option 2 - Move Toward Atomic Inline Mentions

- prototype a richer editor surface for atomic file and agent tokens
- evaluate whether a contenteditable or segmented input model is maintainable inside the panel webview
- preserve the bridge and submit model from Phase A so the editor swap is mostly local to the webview

### Acceptance Criteria

- a documented decision exists with tradeoffs, risks, and recommended path
- if a prototype is built, it proves whether atomic mentions materially reduce bug surface

### Progress

- completed with a reversed architecture decision: strict parity goals require replacing the current textarea plus sidecar mention-range model
- documented the new direction, tradeoffs, and migration path in `COMPOSER_EDITOR_DECISION.md`
- implemented the first editor-model upgrade by replacing the composer textarea with a structured inline editor that renders atomic file and agent tokens in the panel webview
- preserved the Phase A submit contract by continuing to derive full draft text plus typed file and agent prompt parts from structured editor state
- aligned insertion and editing behavior more closely with upstream web prompt behavior: `@query` replacement now inserts an atomic token plus trailing space, Enter inserts normalized newlines through the structured model, and Backspace and Delete remove adjacent tokens atomically
- added focused structured-editor regression coverage in `src/panel/webview/app/composer-editor.test.ts`

---

## Phase F - Add Missing TUI-Style Entry Paths

Status: completed

### Objective

Close surrounding `@file` affordance gaps beyond plain keyboard search.

### Scope

- support converting dropped files into composer file mentions where appropriate
- review whether file selections or line ranges should be representable in the extension prompt model
- evaluate whether session-context files should be distinguishable from inline `@file` mentions
- bring empty-state and helper copy closer to the real behavior of each source

### Files Most Likely To Change

- `src/panel/webview/app/App.tsx`
- `src/panel/provider/files.ts`
- `src/core/sdk.ts`
- `src/bridge/types.ts`

### Acceptance Criteria

- dropped files can become valid file mentions when that action is unambiguous
- selected file references can carry richer metadata if the host can submit it correctly
- mention entry paths feel coherent rather than bolted on

### Progress

- completed with upstream-style file URI dropping into the structured composer as atomic file mentions
- the mention model now carries optional line-range metadata, so selecting a `@file` result with `#12` or `#12-20` preserves that range through editor state and submit conversion
- host search now surfaces the active editor selection as a distinct `selection` source ahead of recent files when the selection maps cleanly into the current workspace
- host submit now serializes selected-line file mentions to file URLs with `start` and optional `end` query params, matching the upstream web and TUI request shape more closely
- helper copy now points users toward path-plus-range entry (`path#12-20`) and drop-to-mention behavior

---

## Phase G - Revisit MCP Resource Mentions Separately

Status: completed

### Objective

Only add `@resource` behavior when the runtime exposes a real list or search surface.

### Scope

- inspect local SDK and runtime capabilities for MCP resource listing or querying
- define a resource mention source only if the extension can search, insert, and submit it honestly
- avoid mixing speculative MCP UI into the file-parity work before the backend exists

### Acceptance Criteria

- MCP resource suggestions do not appear until the runtime can truly serve them
- if implemented, MCP resources follow the same submit semantics as files and agents

### Progress

- completed after confirming the upstream runtime already exposes `experimental.resource.list`, so the extension now surfaces MCP resources only when the SDK can actually provide them
- session snapshots now carry MCP resource inventory separately from MCP connection status, and composer autocomplete merges those resources into `@` results alongside agents and file-oriented entries
- selecting an MCP resource now inserts an atomic structured resource mention in the composer and submits it as a `file` prompt part with upstream-style `source.type = resource` metadata instead of pretending it is a local workspace path
- regression coverage now includes resource mention serialization and structured editor metadata preservation

---

## Cross-Cutting Work

### Validation

For each implementation phase, validate with:

- `bun run check-types`
- `bun run lint`
- `bun run compile`

### Suggested Manual Verification Matrix

- empty `@` behavior
- `@` with agent-name query
- `@` with basename file query
- `@` with nested path query
- `@` with directory query without trailing slash
- `@` with root-level file query such as `@README` or `@index`
- `@` with fuzzy partial query such as `@bttn`
- keyboard navigation in long result lists
- selecting a file mention in the middle of existing text
- editing before, after, and inside an inserted mention
- submitting one prompt with mixed text, `@agent`, and `@file`
- unresolved file mention fallback behavior
- narrow panel width popup readability

### Non-Goals Until A Later Decision

- full TUI slash-command parity
- copying the TUI editor DOM model wholesale into the extension
- snapshotting large file indexes into panel bootstrap payloads
- exposing MCP resource UI without a real runtime data source

### Success Criteria For This Roadmap

At the end of the roadmap, the extension should either:

- behave close enough to the TUI that remaining differences are small and documented

or:

- have a clear architectural decision showing that true parity requires replacing the textarea editor model

### Recommended Execution Order

1. Phase A
2. Phase B
3. Phase C
4. Phase D
5. Phase E
6. Phase F
7. Phase G
