# OpenCode UI Plan

## Composer Slash and Mention Menu

### Goal

Bring the OpenCode TUI composer autocomplete experience into the VS Code session panel in a way that fits the current extension architecture, minimizes churn, and avoids shipping UI that implies unsupported backend behavior.

This work targets two user-visible triggers:

- `/` at the start of the composer input opens a slash-command menu
- `@` in the composer input opens an inline mention menu

### Current State

The current panel composer is a textarea-based input rendered in `src/panel/webview/app/App.tsx`. It now supports:

- shared `/` and `@` autocomplete popup state in the webview
- keyboard navigation and acceptance for popup items
- local slash actions for draft-only behavior
- a typed host-backed slash action path for session refresh
- temporary composer agent override through `@agent`

The current submit path still only sends plain text plus top-level `agent` and `model` through the bridge and into `rt.sdk.session.promptAsync(...)`, so the following are still not implemented:

- structured prompt parts for file, agent, or resource mentions
- host-driven search for files or MCP resources
- TUI-style slash command execution against a richer command backend

### Design Principles

- Keep the first implementation low-risk and low-churn
- Build one shared autocomplete system for both `/` and `@`
- Reuse existing snapshot and bridge patterns before adding new fetch paths
- Do not fake TUI parity where the extension cannot yet execute the same behavior
- Add backend and protocol capabilities only when the UI can use them meaningfully

### Upstream Behavior To Match

The OpenCode TUI uses one shared autocomplete component for slash commands and mentions. The important behavior to preserve is:

- `/` opens only when the cursor is at the start of the prompt token
- `@` opens inside the prompt when preceded by whitespace or the beginning of the input
- the menu filters live as the user types
- the menu supports keyboard navigation, selection, and escape-to-close
- full parity requires structured prompt parts, not just text insertion

### Constraints In This Repository

- `src/panel/webview/app/App.tsx` currently owns all composer input logic
- `src/bridge/types.ts` is the single source of truth for host and webview messages
- `src/panel/provider/controller.ts` is the single host-side router for panel messages
- `src/panel/provider/actions.ts` currently submits only text-based prompt parts
- `src/panel/provider/snapshot.ts` already provides `agents`, `providers`, `mcp`, and `lsp`, but not full file-search or MCP resource candidate data
- `src/core/sdk.ts` does not yet expose the TUI-style file search or command execution surface needed for full slash and mention parity

### Delivery Strategy

Implement the feature in phases so each step is shippable, testable, and honest about what the extension can actually do.

### Progress Snapshot

- Phase 0: completed
- Phase 1: completed
- Phase 2: completed
- Phase 3: completed
- Phase 4: completed
- Phase 5: completed
- Phase 6: completed

### Latest Progress

- the composer popup is now live for both `/` and `@`
- menu rows were tightened into a compact single-line layout
- subtitle text remains visible inline and truncates with ellipsis when space runs out
- `@agent` updates the visible composer identity and the next submit target
- slash refresh now runs through a typed host action path instead of a webview-only shortcut
- composer state now tracks structured `@agent` mentions with stable ranges in the webview
- submit now carries structured prompt parts across the bridge and into the host SDK path
- agent mentions survive submit as typed data while plain-text submit remains backward compatible
- `@file` now issues lazy host-backed workspace search requests and shows ranked file suggestions in the same mention popup
- selected file suggestions are inserted as tracked composer mentions and submit as typed file parts after host-side path resolution
- MCP resource suggestions remain hidden because the current runtime surface only exposes MCP status and connect or disconnect actions, not searchable resources
- popup matching now prefers exact and prefix hits before weaker substring matches, reducing noisy agent and file ordering
- popup rendering now groups mention results into Agents and Files, shows searching and empty-state copy, and stays readable in narrow panel widths
- autocomplete now closes more predictably when the cursor moves into the middle of a token or when a text range is selected

---

## Phase 0 - Composer Autocomplete Foundation

### Objective

Extract the minimum reusable infrastructure needed to support both slash and mention menus without changing submit semantics yet.

### Scope

- move composer-specific menu state out of the inline textarea event handlers in `src/panel/webview/app/App.tsx`
- introduce a dedicated composer autocomplete hook or component in `src/panel/webview/`
- add shared state for:
  - active trigger type
  - active query text
  - selected option index
  - popup visibility
  - anchor and close conditions
- render a popup attached to the composer wrapper
- support keyboard handling for:
  - `ArrowUp`
  - `ArrowDown`
  - `Enter`
  - `Tab`
  - `Escape`

### Reuse Plan

- use `src/panel/webview/status.css` as the styling reference for popup structure and layering
- keep autoresize behavior in `src/panel/webview/hooks/useComposer.ts`
- keep final submit behavior unchanged until later phases

### Acceptance Criteria

- composer popup opens and closes reliably
- popup does not break textarea autoresize or existing submit shortcuts
- popup keyboard navigation works with no host changes required

### Progress

Completed. The current implementation adds a shared webview autocomplete hook, moves popup state and keyboard navigation out of the inline textarea handlers, and renders a composer-attached popup for `/` and `@` trigger states without changing submit semantics or introducing host-side query dependencies.

---

## Phase 1 - Local Menu Sources And UI MVP

### Objective

Ship the first useful autocomplete experience using data the webview already has or can derive safely.

### Scope

- implement `/` and `@` trigger detection in the webview
- create a shared option model that can represent:
  - local slash actions
  - agent selections
  - placeholder or disabled future sources
- add filtering logic for visible menu items
- display labels, descriptions, and small type hints in the popup

### Initial Data Sources

- slash menu entries defined locally by the panel UI for actions the plugin can really execute
- agent entries from `snapshot.agents`
- current composer identity derived from existing helpers in `src/panel/webview/lib/session-meta.ts`

### Important Limitation

At this phase, `@` should not pretend to create rich prompt parts. It should only support behaviors that map cleanly to the existing submit path.

### Acceptance Criteria

- typing `/` at the start shows a filtered slash menu
- typing `@` in a valid position shows a filtered agent menu
- selecting an item updates composer UI state predictably
- unsupported future sources are not presented as fully working features

### Progress

Completed. The popup now uses real local menu sources instead of Phase 0 placeholders. `/` exposes local slash actions that the panel can already execute, including refresh, draft clear, and resetting a temporary agent override. `@` now renders the live agent list from `snapshot.agents`, filters by query, and shows typed source labels in the popup.

---

## Phase 2 - Agent Selection Through Autocomplete

### Objective

Use the new menu to change the composer target agent without introducing structured prompt parts yet.

### Scope

- add explicit webview state for a temporary or sticky composer agent override
- keep the displayed composer identity aligned with that override
- send the selected agent through the existing `submit` bridge message
- preserve current fallback behavior when no explicit override is selected

### Files Most Likely To Change

- `src/panel/webview/app/App.tsx`
- `src/panel/webview/app/state.ts`
- `src/panel/webview/lib/session-meta.ts`
- `src/bridge/types.ts`

### Acceptance Criteria

- selecting an agent from `@` visibly changes the composer identity
- the next submit uses that selected agent
- existing default-agent logic continues to work when no override is selected

### Progress

Completed. The composer now stores a local agent override in webview state, feeds it through the existing composer identity and selection helpers, clears it with a slash action when needed, and uses it on the next submit without changing the bridge or host submit protocol.

---

## Phase 3 - Host Bridge For Slash Actions

### Objective

Turn the slash menu from a UI-only picker into a command-capable flow.

### Scope

- define slash action message shapes in `src/bridge/types.ts`
- route them through `src/panel/provider/controller.ts`
- implement host-side action handlers in `src/panel/provider/actions.ts` or adjacent modules
- separate actions that:
  - update local composer state
  - invoke SDK-backed operations
  - navigate panel state or open VS Code UI affordances

### Notes

This phase should only ship commands that have a clear extension-side implementation. TUI commands that depend on session command execution or other unsupported APIs should remain deferred until the backend surface exists locally.

### Acceptance Criteria

- slash actions invoke the right host behavior through typed messages
- failed actions report clear user-facing errors
- adding new slash actions follows one clear registration pattern

### Progress

Completed. Slash actions are now explicitly split between local webview behavior and host-backed behavior. The bridge defines a typed `composerAction` message, the panel controller routes it through a dedicated host action handler, host failures flow back through the existing webview error path, and the slash menu now uses that path for session refresh while leaving draft-only actions in the webview.

---

## Phase 4 - Structured Prompt Parts For Mentions

### Objective

Introduce a proper prompt-part model so mentions are first-class data rather than fragile text substitutions.

### Scope

- extend local SDK typings in `src/core/sdk.ts` to support richer prompt parts if available
- extend bridge message types to carry structured composer content
- refactor submit handling so the webview can send both raw text and mention parts
- define a local representation for composer mentions, including insertion, deletion, and serialization behavior

### Candidate Mention Types

- agent mentions
- file mentions
- MCP resource mentions

### Notes

This is the phase where the extension starts to converge with the TUI mental model. Before this phase, parity is intentionally partial.

### Acceptance Criteria

- mentions survive submit as typed data, not only as display text
- composer editing remains stable when text around mentions changes
- the submit path remains backward compatible for plain-text prompts

### Progress

Completed. Phase 4 was implemented by introducing a minimal structured composer mention model in the webview, starting with `@agent` mentions only. The composer now tracks agent mention ranges locally, removes or shifts them as the textarea content changes, and serializes the draft into mixed text and agent prompt parts on submit. The `submit` bridge message now carries structured `parts` alongside the flattened text view, `src/panel/provider/actions.ts` prefers those structured parts when calling `rt.sdk.session.promptAsync(...)`, and `src/core/sdk.ts` now exposes a local prompt-part input union that includes both text and agent parts. Existing plain-text prompts continue to submit through the same path with a text-part fallback.

---

## Phase 5 - File Search And Resource Search Providers

### Objective

Add the host-backed search sources needed for useful `@file` and `@resource` autocomplete.

### Scope

- add host-side search messages for file lookup
- decide whether file lookup comes from:
  - OpenCode SDK support, if available
  - VS Code workspace search as a compatibility path
- add MCP resource list or search support if the runtime exposes it
- keep search lazy and query-driven instead of bloating the session snapshot

### Ranking Requirements

- prefer exact and prefix matches over weak fuzzy matches
- keep file ranking stable and workspace-aware
- cap result count to keep the popup responsive

### Acceptance Criteria

- `@file` can search and insert valid file references
- resource suggestions only appear when the runtime can actually provide them
- search requests do not block normal typing or panel updates

### Progress

Completed. Phase 5 adds a typed query and response path for lazy file lookup between the webview and host, using VS Code workspace search as the compatibility path instead of bloating the session snapshot. The composer now requests ranked file candidates on demand while the mention popup is active, merges those results into the existing `@` menu, and inserts selected files as tracked composer mentions. On submit, the host resolves those relative file paths against the workspace and converts them into SDK file prompt parts with `file://` URLs and source ranges. MCP resource suggestions remain intentionally hidden because the current local runtime surface still only exposes MCP status and connect or disconnect actions, not resource listing or search.

---

## Phase 6 - TUI Parity Polish

### Objective

Close the remaining UX gap with the upstream TUI once the core behavior is correct.

### Scope

- refine reopen and close heuristics around cursor movement
- improve filtering and ranking quality
- consider directory expansion and richer file suffix parsing if the host data model supports it
- add visual treatments for active items, empty states, and source grouping
- ensure mobile-like narrow panel widths still behave cleanly in the webview

### Acceptance Criteria

- menu behavior feels consistent under repeated typing, deletion, and cursor movement
- grouped results remain readable and keyboard accessible
- no regression in composer stability or panel responsiveness

### Progress

Completed. Phase 6 refines the popup behavior and presentation without changing the bridge or provider contracts. The autocomplete matcher now closes when the caret sits in the middle of a slash or mention token instead of at its trailing edge, and it also stays closed while a text range is selected, which makes repeated cursor movement and editing more predictable. Filtering now ranks exact and prefix matches ahead of weaker substring hits. In the popup, mention results are grouped into lightweight Agents and Files sections, empty and searching states use more specific copy, and the item layout now uses a compact two-line structure with scrolling and narrow-width adjustments so grouped results remain readable in the session panel.

---

## Cross-Cutting Work Items

### State And Ownership

- keep ephemeral popup state in the webview
- keep authoritative runtime data and executable actions in the host
- avoid adding snapshot payload fields for data that is better queried on demand

### UI And Styling

- place the popup near `oc-composerInputWrap`
- reuse current panel color tokens and popover styling patterns
- keep the menu visually aligned with the existing extension UI, not the terminal UI

### Error Handling

- unsupported actions should fail clearly instead of silently
- query failures should degrade to empty states, not composer crashes
- host-side execution failures should reuse existing panel error reporting patterns

### Verification

For each implementation phase, validate with:

- `bun run check-types`
- `bun run lint`
- `bun run compile`

### Non-Goals For The First Implementation

- full upstream slash-command parity on day one
- extmark-like editor behavior inside the textarea
- eager loading of large file or resource indexes into the session snapshot
- broad refactors outside the composer, bridge, provider, and SDK boundary files

### Recommended Implementation Order

1. Phase 0
2. Phase 1
3. Phase 2
4. Phase 3
5. Phase 4
6. Phase 5
7. Phase 6
