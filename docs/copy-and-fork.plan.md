# Plan: Copy and Fork from Here

## 1. Purpose

Add compact actions to ordinary chat messages in a session panel:

- **Copy** copies the message's visible textual content as plain text / original Markdown.
- **Fork from here** creates an OpenCode child session containing the source history through the selected message, opens that child session immediately, and leaves the source session unchanged.

This is an incremental extension change. It must reuse the existing OpenCode SDK client, session-panel webview, command-based session opening, and session refresh mechanisms. It must not create a separate client, CLI, external service, or edit OpenCode session files directly.

## 2. Current Architecture

| Responsibility | Existing location | Planned integration |
| --- | --- | --- |
| Extension composition | `src/extension.ts` | No structural change required. |
| OpenCode SDK client and domain types | `src/core/sdk.ts` | Add the typed `session.fork` method. |
| Session-list refresh and cache | `src/core/session.ts` | Reuse it to refresh the workspace after a fork. |
| Open/open-focus session command | `src/core/commands.ts` | Reuse `opencode-ui.openSessionById` for the new session. |
| Host-side webview message routing | `src/panel/provider/controller.ts` | Route Copy and Fork requests and validate their context. |
| Host-side panel actions | `src/panel/provider/actions.ts` | Add clipboard and fork operations with guards and error mapping. |
| Host/webview contract | `src/bridge/types.ts` | Add typed request and result messages. |
| Session snapshot and messages | `src/panel/provider/snapshot.ts` | Existing `SessionMessage.info.id` and ordered parts are the authoritative UI model. |
| Message rendering | `src/panel/webview/app/timeline.tsx` | Render the message action row for supported messages. |
| Webview state and callbacks | `src/panel/webview/app/App.tsx` | Track Copy acknowledgement and per-message fork progress. |
| Timeline styling | `src/panel/webview/timeline.css` | Add theme-variable-based hover/focus action styles. |

The main sidebar intentionally tracks root sessions only: `src/core/session-list.ts` excludes sessions with `parentID`. A forked session is therefore expected to appear as a child branch in the existing session navigation. The implementation must immediately open the forked session; it must not alter the root-only sidebar policy as part of this feature.

## 3. Verified SDK Contract and Required Runtime Verification

The extension uses `@opencode-ai/sdk` version `1.2.21` through `@opencode-ai/sdk/v2/client`. Its generated v2 client exposes:

```text
POST /session/{sessionID}/fork?directory={directory}
Content-Type: application/json
Body: { "messageID": "..." }
Response: 200 Session
```

The extension's local `Client` facade does not yet declare this method, so the implementation must add:

```ts
session.fork({
  sessionID: string
  messageID: string
  directory?: string
  workspace?: string
}): Promise<{ data?: SessionInfo }>
```

Before enabling the final UI behaviour, verify against the actual `opencode serve` version used by the extension:

1. A fork from a user message includes that message and excludes later messages.
2. A fork from an assistant message has the same inclusive semantics.
3. Tool calls and their outcomes remain consistent in a forked transcript.
4. The response contains the child `SessionInfo` and a `parentID` when applicable.
5. An unavailable endpoint produces a recognizable 404/error that can be presented as an upgrade requirement.

The SDK shape confirms the HTTP endpoint, but these semantic checks require a real server; they must not be inferred from the generated type alone.

### Verification note — 2026-07-23

The installed OpenCode CLI (`1.17.15`) was checked using an isolated temporary workspace. It accepted a `POST /session/{sessionID}/fork` request with a user-message `messageID`, returned a newly created session, and assigned a readable `… (fork #1)` title. The source message was created with `prompt_async` and `noReply: true`, so assistant-message/tool-call semantics still require a configured-model manual test.

In the same run, the returned child was visible in `GET /session` but an immediate `GET /session/{id}` returned 404. The implementation therefore verifies that the returned child can be loaded before opening it and reports `Fork was created, but the new session could not be loaded.` if that consistency check fails.

### Manual smoke test — 2026-07-23

The user manually confirmed that Copy works and that Fork successfully creates and opens a branch through the VS Code extension. Assistant-message/tool-call fork semantics remain an optional dedicated regression check if they were not part of that scenario.

## 4. Scope and Product Decisions

### In scope

- Copy and Fork actions for ordinary user and assistant messages with a valid message ID.
- Copying ordered text parts only, without UI markup or technical metadata.
- A per-message loading state and duplicate-request protection for Fork.
- Automatic session-list refresh and opening the returned child session.
- Clear in-panel errors and operational logging to the `OpenCode UI` output channel.
- Unit tests and real-server integration verification.

### Out of scope

- Manual modification of OpenCode storage files.
- A fallback implementation that reconstructs sessions locally.
- A new external API client, service, command-line tool, or package dependency.
- Changing global session-list/sidebar hierarchy.
- Automatic interruption of a running source session.
- Renaming the fork unless real-server verification shows the server produces no usable title.

### Supported message types

- User and assistant messages are candidates for both actions.
- Copy is hidden when there are no eligible text parts.
- Reasoning, tool, internal, system-style, and metadata-only blocks do not receive an independent action row.
- Fork availability for assistant messages, especially messages containing tool parts, is finalized only after the runtime verification in section 3. If unsupported or unsafe, the UI must disable or hide Fork with an explanatory tooltip rather than silently choosing a different message.

## 5. Proposed Behaviour

### 5.1 Copy

1. The webview sends only the selected `messageID`.
2. The extension host verifies that the ID belongs to the panel's active session and resolves the matching current message model.
3. A pure helper collects eligible `text` parts in their source order, joins them with newline separators, and excludes synthetic/internal text where appropriate.
4. The extension host calls `vscode.env.clipboard.writeText(text)`.
5. The host sends a success acknowledgement; the webview shows `Copied` briefly on the relevant action without a noisy VS Code notification.

The webview must not be treated as an authority for copy text. Its payload should contain no arbitrary text value.

### 5.2 Fork from here

1. The webview sends the selected `messageID`.
2. The extension host validates the workspace runtime, panel session, selected message, message/session match, and current server availability.
3. The host rejects a request while the source session is actively generating (`SessionStatus.type !== "idle"`) and while the same message has a fork request in flight.
4. The host calls `rt.sdk.session.fork({ sessionID: ref.sessionId, messageID, directory: rt.dir })`.
5. On success, it refreshes the workspace sessions through the existing `SessionStore` pathway and invokes `opencode-ui.openSessionById` for the returned session ID.
6. The webview receives success or failure status. A failed request restores the action; a successful request opens the child session directly and preserves the source panel/session.

Fork requests must always pass `directory: rt.dir`.

## 6. Typed Webview Contract

The exact names may follow surrounding conventions, but the contract must remain discriminated and typed.

```ts
type WebviewMessage =
  | { type: "copyMessage"; messageID: string }
  | { type: "forkSessionFromMessage"; messageID: string }

type HostMessage =
  | { type: "messageCopied"; messageID: string }
  | { type: "forkStarted"; messageID: string }
  | { type: "forkCompleted"; sourceMessageID: string; newSessionID: string }
  | { type: "forkFailed"; messageID: string; error: string }
```

`sessionID` is deliberately omitted from webview requests because the panel already owns an immutable `SessionPanelRef`. The host derives and validates it. This keeps the protocol smaller and prevents a request from targeting another open session.

## 7. Implementation Phases

### Phase 1 — API and host foundation

1. Add `session.fork` to the local SDK facade in `src/core/sdk.ts`.
2. Add the typed request/result variants in `src/bridge/types.ts`.
3. Implement pure helpers for eligible copy text and message/action eligibility.
4. Extend panel action state with per-message in-flight fork tracking.
5. Add host actions for Copy and Fork, including validation, error mapping, clipboard write, and output-channel logging.
6. Route the new webview messages in `SessionPanelController`.

### Phase 2 — Session lifecycle integration

1. Expose/reuse a small command or `SessionStore` operation that refreshes the owning workspace after a successful fork.
2. Reuse `opencode-ui.openSessionById` to reveal the child session, avoiding duplicate tab/session-opening logic.
3. Confirm that an already-open fork panel is revealed rather than duplicated.
4. Preserve the existing root-only sidebar rule and rely on existing child-session navigation for branch discovery.

### Phase 3 — Webview and visual design

1. Add an action row beneath user and assistant message presentation in `timeline.tsx`.
2. Pass typed callbacks from `App.tsx` to `Timeline` rather than coupling the timeline to the VS Code API.
3. Show actions on hover and keyboard focus; retain visible focus styling and accessible labels/tooltips.
4. Use icon buttons, a temporary `Copied` state, and a per-message fork spinner.
5. Disable Fork during source-session generation and while that message's request is pending.
6. Add styles in `timeline.css` using existing `--oc-*`/VS Code variables, with no layout shift for long Markdown, code blocks, or attachments.

### Phase 4 — Compatibility and errors

1. Map 404/endpoint-not-found to `Fork requires a newer version of OpenCode.`
2. Map other failures to `Failed to create fork from this message.` with concise safe detail when available.
3. Log raw operation failures and recovery context to the output channel.
4. On an unexpected child-session load failure, leave the source session open and report that the fork was created but could not be opened.
5. Do not automatically abort or mutate an active source session.

### Phase 5 — Tests and verification

1. Add unit tests adjacent to host helpers/actions.
2. Extend timeline tests for action eligibility and UI state derivation.
3. Test the command/session refresh and open-session handoff with mocks.
4. Run the real-server fork scenario in section 9.
5. Run the repository validation commands in section 10.

## 8. Acceptance Criteria

1. Every eligible user and assistant text message exposes compact Copy and Fork actions without visually overloading the chat.
2. The actions are usable by mouse and keyboard, have accessible names/tooltips, and render correctly in light and dark VS Code themes.
3. Copy places the message's original Markdown/plain text into the clipboard, preserving text-part order and separating parts with newlines.
4. Copy never includes rendered HTML, message IDs, JSON tool calls, hidden reasoning, technical metadata, or other internal transcript data.
5. Copy does not show a global VS Code notification on normal success; the affected action gives brief local feedback.
6. Fork sends the selected source session ID and message ID through the official OpenCode SDK/API with the workspace directory.
7. Fork creates a new OpenCode session whose history ends at, and includes, the selected message; later source messages are absent.
8. Fork leaves the source session and its history unchanged.
9. After a successful fork, the extension refreshes session state and opens the new session automatically, ready for the next prompt.
10. A double-click or repeated action cannot create multiple forks for the same pending request.
11. Fork is unavailable while the source session is generating, unless a later verified server contract explicitly permits a safe alternative.
12. Missing runtime, invalid/missing message ID, server errors, unsupported fork endpoint, and child-session opening failures yield clear user-facing feedback and diagnostic output logging.
13. The implementation does not edit session files, add a parallel API client, alter source history, or introduce an unnecessary dependency.
14. Existing behaviour for normal session creation, navigation, rendering, and sidebar root sessions remains intact.

## 9. Manual Integration Scenario

Run this against the actual OpenCode server version launched by the extension:

1. Open a source session with at least three user/assistant turns; include an assistant response with a tool call if supported by the environment.
2. Copy a user message and an assistant message; confirm exact textual clipboard content and no technical data.
3. Fork from a middle user message; confirm the new session contains history through that message only.
4. Fork from a middle assistant message; confirm the same inclusive cut-point semantics.
5. Send a new prompt in the fork and confirm it continues independently.
6. Reopen the source session and confirm no messages, metadata, or branch point were mutated.
7. Attempt Fork while a response is generating; confirm the control is unavailable and the source response is not interrupted.
8. Simulate/verify an unsupported endpoint or unavailable server; confirm recovery UI and output logging.

## 10. Definition of Done

The feature is done only when all of the following are true:

- [x] The real OpenCode server contract and user/assistant fork semantics have been verified and recorded in the implementation notes or pull request. User-message semantics are verified; assistant/tool semantics require a configured-model test.
- [x] `Client.session.fork` is explicitly typed and uses the existing v2 OpenCode SDK client.
- [x] Host/webview messages are discriminated, typed, and validate all host-derived session context.
- [x] Copy and Fork action rows are implemented for every supported message type with accessible hover, focus, disabled, and loading states.
- [x] Copy writes only clean ordered textual content through `vscode.env.clipboard` and shows local success feedback.
- [x] Fork prevents duplicate in-flight requests, refuses unsafe active-generation requests, and never mutates the source session.
- [x] Successful forks refresh session data and automatically open the returned child session when it can be loaded.
- [x] Unsupported server versions and operational failures provide actionable user-facing messages and output-channel diagnostics.
- [x] Unit tests cover text extraction, action eligibility, request construction, success, 404, child-load failure, and duplicate prevention.
- [x] UI/timeline tests cover message eligibility plus loading/copy acknowledgement state.
- [x] The Copy and Fork manual smoke scenario passes against a real server. Assistant-message/tool-call fork remains an optional dedicated regression check.
- [x] `bun run check-types` passes.
- [x] `bun run lint` passes.
- [x] `bun run test` passes.
- [x] `bun run compile` passes.
- [x] The final change list is limited to the necessary host, bridge, webview, styles, and test files; there is no unrelated churn.

## 11. Implementation Checklist

- [x] Verify fork semantics against a real OpenCode server.
- [x] Add the SDK facade method and bridge messages.
- [x] Implement Copy host action and pure text extraction helper.
- [x] Implement Fork host action and per-message duplicate guard.
- [x] Reuse session refresh and session-opening paths after fork.
- [x] Add message action controls and styles.
- [x] Add host, timeline, and integration tests.
- [x] Run automated validation and the Copy/Fork manual smoke check.
