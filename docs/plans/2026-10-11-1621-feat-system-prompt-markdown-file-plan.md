---
title: System Prompt from a Markdown File - Plan
type: feat
date: 2026-10-11
topic: system-prompt-markdown-file
artifact_contract: ce-unified-plan/v1
product_contract_source: ce-plan-bootstrap
execution: code
---

# System Prompt from a Markdown File - Plan

## Goal Capsule

- **Objective:** Filip steers every reply by editing one markdown file — the next request already uses the new instructions, with no code change and no restart.
- **Means:** One optional config value points at the file; its content is read per request and attached at the assembly point both chat endpoints already share (KTD1, KTD2, KTD3).
- **Product authority:** Linear SPE-5, then this plan's Key Decisions, then `STRATEGY.md` (Tools and knowledge track, "bricks swapped most often" positioning).
- **Implementation authority:** Product Contract wins on behavior; Planning Contract KTDs win on mechanism; Implementation Units override neither.
- **Stop conditions:** Stop and ask if meeting the acceptance criteria would require changing a request or response shape, adding an error code, or letting a configured-but-broken file pass silently.
- **Execution profile:** Local single-developer change on the Next.js 16 app; no deployment, no migrations, no data.
- **Finisher:** `ce-work` (or Filip) implements and verifies; Filip runs the live freshness check with his own OpenRouter key.

---

## Product Contract

### Summary

The core chat API reads its instructions from one markdown file whose location an optional environment variable sets. Editing the file changes what the model sees on the next request from every interface. Unset or empty means today's behavior; a configured but unreadable file fails loudly before any reply.

### Problem Frame

Instructions are the brick Filip wants to tweak most often during experiments (Linear SPE-5). SPE-1 deliberately sent none — its plan recorded the choice to defer an editable `.md` instructions file over a constant in code — and left one assembly point so they could be added later without touching the caller contract. Today the only way to give the model instructions is a code change, which breaks the evening-experiment loop: every tweak means a rebuild and a commit. `STRATEGY.md`'s Tools and knowledge track treats these bricks as the ones swapped most often, so instructions belong where experiments live: in a file, not in code.

### Key Decisions

- **Instructions live in one editable markdown file, not in code.** Deferred from SPE-1, whose plan chose to wait rather than hardcode: tweakable during experiments without a rebuild. (see origin: Linear SPE-5; `docs/plans/2026-09-30-1257-feat-core-chat-api-plan.md`) Governs R1.
- **The knob is opt-in: no file configured means exactly today's behavior.** Chosen in the issue over a default file or a built-in prompt: nothing changes for a setup that does not opt in. Governs R3.
- **Every interface gets the same instructions through the shared assembly point.** Chosen in the issue over per-interface prompts: parity is a Core property; per-interface behavior is a separate ticket. Governs R2.

### Requirements

**Prompt source and freshness**

- R1. The system prompt is the full content of one file whose location one config value sets, so editing the file changes the model's behavior on the next request without a code change.
- R2. Both chat endpoints attach the prompt at the single assembly point, with no endpoint- or interface-specific wiring.

**Behavior without a prompt**

- R3. When no file is configured, or the configured file's content is empty after trimming whitespace, the model call carries exactly today's messages — no system prompt, no added instructions.

**Failure and contract**

- R4. A configured file that is missing or unreadable produces a clear error naming the file, before the streaming endpoint sends anything.
- R5. The caller's request and response contract is unchanged, including the existing error codes.

### Acceptance Examples

- AE1. **Covers R1, R2:** Given `SPEKTER_SYSTEM_PROMPT` points at a file saying "answer in exactly one word", the next reply to a question is one word, on both endpoints.
- AE2. **Covers R3:** Given the variable is unset or the file is empty, a request behaves exactly as before this plan: the model sees only the caller's messages.
- AE3. **Covers R4, R5:** Given the variable points at a missing file, the caller receives the documented JSON error with status 503 and code `not_configured`, naming the file — on the stream endpoint, before any frame is sent.

### Scope Boundaries

Non-goals, from the issue:

- No prompt templating or variable substitution — file content passes through verbatim.
- No per-request or per-interface prompts — every interface gets the same instructions.
- No prompt-content authoring — what the file says is Filip's to write.

Considered and not built:

- No content validation (encoding, markdown lint, size cap): the file is Filip's own, and a bad prompt shows up directly in replies, so the failure is its own alarm.
- No default file location or starter prompt: a default would silently change behavior for setups that have not opted in.
- No caching or file watching: per-request reads already deliver edit-freshness; caching would only risk staleness.

#### Deferred to Follow-Up Work

- Knowledge `.md` files — separate ticket per the issue; will share the assembly point with instructions.

### Sources

- Linear SPE-5 — origin; its four acceptance criteria map to R1, R3, R4, R5.
- `docs/plans/2026-09-30-1257-feat-core-chat-api-plan.md` — KTD4 (assembly function owns the model call; system prompt added inside later), KTD5 (per-request config reads), R3/R9 (assembly point extensible without contract change).
- `src/core/chat/complete.ts` — the assembly point; its comment marks where the system prompt attaches.
- `src/core/config.ts` — env reading per request, with injectable env for tests.
- `src/core/instrumentation/request-log.ts` — the repo's precedent for an optional env var resolving to a file path read via `node:fs/promises`.
- `src/app/api/chat/stream/route.ts` — lazy stream consumption, which motivates KTD2.

---

## Planning Contract

### Key Technical Decisions

- KTD1. **One optional variable, `SPEKTER_SYSTEM_PROMPT`, holds the file path; the file is read once per request.** Per-request reads are what make an edit land on the next request, and they keep `next dev` and `next build` working the way the SPE-1 plan's KTD5 established for the model. Relative paths resolve against the server working directory, matching the request log's path handling. Governs R1.
- KTD2. **The route handlers read the prompt inside their existing try blocks, through a Core helper; the core chat functions take the resolved text as an argument.** `streamChat` is a lazy generator whose body first runs inside the route's `ReadableStream`, after the 200 status is sent, so a read failure there would arrive as a broken stream instead of the documented pre-stream JSON error. Reading in the routes keeps the stream error contract intact (R4) and keeps the core functions pure conversation-in, reply-out — testable with the existing mock models. Routes already resolve config this way (`readConfig()` in both handlers). Governs R2, R4.
- KTD3. **The prompt attaches in `assembleChatCall` as one system message ahead of the caller's messages; nothing else about the call changes.** The assembled message list stays the single record of what the model sees, which is exactly what the mock-model assertions inspect, and the reasoning-effort choice keeps deriving from the last caller message. The AI SDK's separate `system` call option would work too; prepending keeps the call object's shape unchanged. Governs R1, R2, R3.
- KTD4. **A configured-but-unreadable file throws `not_configured` (503) with a message naming the file and the variable.** Reusing the existing code honors the unchanged-contract criterion instead of widening the error-code union, and the request log already records this code, so failure visibility comes free. Governs R4, R5.

---

## Implementation Units

### U1. Core system-prompt resolver

- **Goal:** Turn config and one file into the effective prompt text — or nothing — with SPE-1-style error clarity.
- **Requirements:** R1, R3, R4.
- **Dependencies:** none.
- **Files:** create `src/core/chat/system-prompt.ts`, `src/core/chat/system-prompt.test.ts`.
- **Approach:** One async helper takes the env (defaulting to `process.env`, like `readConfig` in `src/core/config.ts`), trims the variable, and returns null before touching the filesystem when it is unset or blank; resolves the path against the server working directory (pattern: `logPath()` in `src/core/instrumentation/request-log.ts`); returns file content verbatim unless it trims to empty, which returns null; any read failure throws `NotConfiguredError` naming the file and the variable (KTD4).
- **Patterns to follow:** `readConfig`/`readConfiguredModel` (`src/core/config.ts`) for env injection and trimming; `logPath()` (`src/core/instrumentation/request-log.ts`) for path resolution; `NotConfiguredError` (`src/core/errors.ts`) for the failure.
- **Test scenarios:**
  - An unset variable returns null without touching the filesystem.
  - A blank value (spaces only) returns null.
  - A configured file with content returns the content verbatim, preserving inner whitespace and trailing newlines.
  - A configured file that is empty or whitespace-only returns null.
  - A configured file that does not exist throws `NotConfiguredError` naming the file path and the variable.
  - A configured path that is a directory, or otherwise unreadable, throws the same error.
  - A relative path resolves against the server working directory, not the module's directory.
- **Verification:** the new unit tests pass with no network and no real API key.

### U2. Attach the prompt at the assembly point and wire both endpoints

- **Goal:** The model receives the configured prompt on both chat endpoints, and requests without one are unchanged.
- **Requirements:** R1, R2, R3, R4, R5.
- **Dependencies:** U1.
- **Files:** modify `src/core/chat/complete.ts`, `src/core/chat/stream.ts`, `src/app/api/chat/route.ts`, `src/app/api/chat/stream/route.ts`; tests `src/core/chat/complete.test.ts`, `src/core/chat/stream.test.ts`, `src/app/api/chat/route.test.ts`, `src/app/api/chat/stream/route.test.ts`.
- **Approach:**
  1. Extend `assembleChatCall` with an optional prompt argument; when present, prepend one system message to the outgoing messages and leave the caller's messages and the reasoning-effort computation untouched (KTD3).
  2. Thread the argument through `completeChat` and `streamChat` without changing their other behavior.
  3. In both route handlers, call the U1 helper inside the existing try block next to `readConfig()` and pass the result to the core call (KTD2).
- **Execution note:** Extend the two "no system prompt" mock-model assertions first — they pin the assembly point's contract — then make them green; wire the routes last.
- **Patterns to follow:** mocked model plus `vi.stubEnv` in the route tests (`src/app/api/chat/route.test.ts`); the temp-file fixture pattern in `src/core/testing/request-log.ts` for prompt fixtures.
- **Test scenarios:**
  - With a prompt passed in, the model's recorded prompt starts with one system message carrying the content verbatim, followed by the caller's messages in order — asserted for `completeChat` and for `streamChat` through their mock models.
  - With no prompt (null), the recorded prompt equals today's message list — the current "no system prompt" assertions keep holding.
  - With a long system prompt and a short last caller message, the assembled call still selects reasoning effort from the last caller message (assert on `assembleChatCall`'s return value).
  - With `SPEKTER_SYSTEM_PROMPT` pointing at a temp file, `POST /api/chat` returns today's success shape and the mocked model received the system message first.
  - The same configured prompt on `POST /api/chat/stream` leaves the frames unchanged (deltas then done) with the system message present in the model's prompt.
  - With the variable pointing at a missing file, `POST /api/chat` returns 503 `not_configured` naming the file, and the model is never called.
  - The same failure on `POST /api/chat/stream` returns the 503 JSON error before any frame — same status and body as the complete endpoint's, no 200.
  - With the variable set but the file empty, both endpoints behave exactly as with the variable unset.
- **Verification:** the full suite passes, including the two extended assembly assertions; no existing contract test needs changes beyond the prompt cases.

### U3. Document the knob

- **Goal:** Anyone, including future Filip, can set the prompt file from `.env.example` and the README without reading code.
- **Requirements:** R1, R5.
- **Dependencies:** U1, U2 — names and documented behavior must match what shipped.
- **Files:** modify `.env.example`, `README.md`.
- **Approach:** Add a commented `SPEKTER_SYSTEM_PROMPT` entry to `.env.example` with a path example and the unset, empty, and missing outcomes; extend the README's "Core chat API" section with a short paragraph (instructions from one markdown file, read fresh each request, both endpoints) and update the `not_configured` row's meaning to include the prompt file. The streaming section's pre-stream error promise already covers this failure and stays as-is.
- **Test scenarios:**
  - Test expectation: none -- documentation-only unit; verified by matching shipped names and behavior (variable name, error code, unset/empty/missing outcomes).
- **Verification:** the README contains no stale claims — the error table, the streaming error promise, and the new paragraph all match the shipped behavior.

---

## Verification Contract

- `npm test` — the full vitest suite, including the new resolver tests and the extended assembly, route, and stream tests, is the primary proof of R2 through R5.
- `npm run lint` — passes on the touched files.
- Live freshness check (requires a real `OPENROUTER_API_KEY` in `.env.local`): start `npm run dev`, point `SPEKTER_SYSTEM_PROMPT` at a file with a distinctive instruction, curl the README's example conversation, edit the file, curl again without restarting, and observe the second reply follow the new instruction. This is the only check that proves R1 end to end.

## Definition of Done

- All four SPE-5 acceptance criteria hold: edit-freshness (live check), unset-is-today (suite), missing-file error (suite), unchanged contract (suite plus README review).
- `npm test` and `npm run lint` pass.
- `.env.example` and the README match the shipped behavior.
- No dead ends: experimental helpers, fixtures, or alternative-signature attempts from implementation are removed from the diff, not left behind.
