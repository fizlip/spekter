---
title: Markdown and Math Rendering in Assistant Messages - Plan
type: feat
date: 2026-10-07
topic: markdown-math-messages
artifact_contract: ce-unified-plan/v1
product_contract_source: ce-plan-bootstrap
execution: code
---

# Markdown and Math Rendering in Assistant Messages - Plan

## Goal Capsule

- **Objective:** Filip reads assistant replies as formatted answers — markdown structure and LaTeX math render as designed typography instead of raw syntax — matching the app's current look while the reply is still streaming.
- **Means:** `streamdown` renders the assistant bubble's content with `@streamdown/math` (KaTeX) on default settings, styled by component overrides and KaTeX's bundler-served assets (KTD1, KTD2, KTD3, KTD4).
- **Product authority:** The scoping synthesis confirmed in this planning session, then `STRATEGY.md`'s sequencing of UX polish after the core streaming work this plan follows.
- **Implementation authority:** Product Contract wins on behavior; Planning Contract KTDs win on mechanism; Implementation Units override neither.
- **Stop conditions:** Stop and ask if `streamdown` 2.x fails under React 19.2 / Next 16.3.6 at runtime, or if matching the bubble's current look requires forking streamdown rather than overriding its components.
- **Execution profile:** Local single-developer change on a Next.js 16 app; no deployment, no data changes, no shared consumers.
- **Finisher:** `ce-work` (or Filip) implements and verifies; Filip runs the live browser check with a real OpenRouter reply.
- **Open blockers:** None.

---

## Product Contract

### Summary

Assistant messages in the web chat render as GitHub-flavored markdown with KaTeX math, live during streaming, styled to the app's current typography.
User messages, the reasoning block, and everything outside message content stay as they are.

### Problem Frame

The assistant bubble renders `message.content` as raw text in a `whitespace-pre-wrap` div (`src/components/chat/ChatMessageBubble.tsx:61-68`), the state left by the streaming plan, which deferred markdown rendering to follow-up work.
Markdown the model emits — lists, tables, code fences — shows literally, and LaTeX notation is unreadable, so any substantive reply is harder to read than the transport already allows it to be.

### Key Decisions

- **Full markdown plus math is in scope.** (session-settled: user-directed — chosen over a math-focused subset and over markdown-first-math-later: both are wanted and one renderer covers both.) Governs R1, R2.
- **Only assistant messages render rich content.** (session-settled: user-directed — chosen over Discord-style formatting of user input: typed `*` or `#` changing a user's own message would surprise them.) Governs R8, R9.
- **Code blocks stay plain monospace, no highlighting or copy button.** (session-settled: user-directed — chosen over Shiki highlighting and a copy button: both are deferred polish.) Governs R6.
- **Single-`$` math stays disabled; math uses `$$…$$` delimiters.** (session-settled: user-approved — proposed after surfacing that a reply mentioning "$5 vs $10" would garble into math; single-`$` is off by default in the chosen renderer.) Governs R3, R10.

### Requirements

**Rendering**

- R1. Assistant message content renders as GitHub-flavored markdown: emphasis, lists, tables, links, inline code, fenced code blocks, and headings.
- R2. Math delimited by `$$…$$` — inline on one line, or block on separate lines — renders as typeset equations via KaTeX.
- R3. Single `$` characters always render as literal text, so dollar amounts in a reply are never parsed as math.
- R4. A reply mid-stream renders sensibly at every delta: an unterminated code fence or math block shows its content-so-far, never flashing raw delimiter soup or an error overlay.

**Look and feel**

- R5. Rendered replies match the bubble's current typography: Arial message text at 16px/1.55 in slate-800, with author names and UI chrome unchanged.
- R6. Fenced code blocks render as plain monospace blocks with an unobtrusive background, no syntax highlighting, no action buttons.
- R7. Wide display equations and wide tables scroll horizontally rather than breaking the chat layout.

**Scope**

- R8. User messages keep rendering as plain, pre-wrapped text.
- R9. The reasoning block above an assistant reply keeps its current plain small-text rendering.
- R10. The model is steered to emit math in `$$…$$` delimiters, so math written in replies actually renders.

### Acceptance Examples

- AE1. Formatted markdown reply
  - **Covers:** R1, R5
  - **Given:** A conversation where the assistant replies with a bullet list and a short code fence.
  - **When:** The reply finishes streaming.
  - **Then:** The bubble shows styled list items and a monospace code block, sized and colored like the surrounding message text.
- AE2. Math reply
  - **Covers:** R2, R7
  - **Given:** A reply containing `$$E = mc^2$$` inline and a block equation on its own `$$` lines.
  - **When:** The reply renders.
  - **Then:** Both appear as typeset math; a wide block equation scrolls horizontally instead of overflowing the chat column.
- AE3. Currency stays text
  - **Covers:** R3
  - **Given:** A reply saying "one costs $5 and the other $10".
  - **When:** The reply renders.
  - **Then:** The sentence shows exactly as written, with no math styling.
- AE4. Mid-stream rendering
  - **Covers:** R4
  - **Given:** An assistant reply still streaming, currently inside an unclosed code fence or math block.
  - **When:** Any intermediate delta is on screen.
  - **Then:** The partial content reads as content, and the display settles to the final form when the delimiters close.
- AE5. User message untouched
  - **Covers:** R8
  - **Given:** A user message containing `*asterisks*` and a `# heading line`.
  - **When:** It renders.
  - **Then:** It shows as plain pre-wrapped text, exactly as typed.

### Scope Boundaries

- Syntax highlighting and a copy button on code blocks.
- Single-`$` inline math (one boolean away if ever wanted — see KTD2).
- Changes to the streaming transport, message persistence, the composer, or the sidebar.
- Rendering markdown in user messages or the reasoning block.

**Considered and not built:**

- Tightening streamdown's sanitization — its default pipeline is `rehype-raw` followed by `rehype-sanitize` (GitHub's schema, extended) plus `rehype-harden`, so raw HTML in model output renders but scripts, event handlers, and dangerous protocols are stripped. Spekter is a local single-user app whose only content source is Filip's own model; per the Goal Capsule's risk posture this is accepted, and dropping `defaultRehypePlugins.raw` or allowlisting link protocols stays a one-file override if threat assumptions change (`streamdown.ai/docs/security`).
- Custom report/copy/share affordances on rendered content.

#### Deferred to Follow-Up Work

- Shiki highlighting plus a copy button (`@streamdown/code` is the plugin split for this).
- Enabling single-`$` inline math if replies routinely want compact inline notation.

### Dependencies / Assumptions

- Streamed replies already arrive as cumulative `message.content` strings via `streamReply` (`src/components/chat/stream-client.ts`); the renderer consumes the same string.
- React 19.2.8 satisfies streamdown's >= 19.1.1 requirement; Tailwind v4 is present for its `@source` styling integration.
- The model speaks markdown freely today; without delimiter steering (R10) it may emit single-`$` math that stays literal per R3.

### Sources / Research

- `https://streamdown.ai/docs/getting-started` — install, React/Tailwind requirements, `@source` directive for Tailwind v4.
- `https://streamdown.ai/docs/plugins/math` — `@streamdown/math` plugin, `plugins={{ math }}` usage, `$$` delimiters, `singleDollarTextMath: false` default, unterminated-equation handling, `katex/dist/katex.min.css` import.
- `npm view` publish dates 2026-10-07 — `streamdown` 2.7.0 and `@streamdown/math` 1.0.3 both published 2026-09-30, satisfying the 7-day minimum-age rule.
- `docs/plans/2026-10-02-1134-feat-stream-assistant-bubbles-plan.md` — markdown rendering was its explicitly deferred item; this plan picks it up.
- `src/core/chat/complete.ts:7-8` — `assembleChatCall` is the flagged seam where a system prompt attaches.

---

## Planning Contract

### Key Technical Decisions

- KTD1. **The renderer is `streamdown`, mounted inside `AssistantMessage`.** It re-renders on every content delta and its incomplete-markdown handling is the R4 answer — an unclosed fence or `$$` block renders its partial content instead of raw syntax. (session-settled: user-approved — chosen over `react-markdown` + remark/rehype plugins: streamdown inherits that stack and adds streaming-hardened parsing.) Governs R1, R4.
- KTD2. **Math comes from `@streamdown/math` with default options.** Default `singleDollarTextMath: false` is the R3 guarantee; `$$…$$` covers inline and block for R2. KaTeX emits MathML alongside the visual output, which keeps screen-reader behavior reasonable for free. Carries the "Single-`$` math stays disabled" Key Decision. Governs R2, R3.
- KTD3. **KaTeX CSS and fonts are bundler-served, never CDN.** `@import "katex/dist/katex.min.css"` goes in `src/app/globals.css` after the existing imports; its relative `fonts/*.woff2` references are emitted by the Next.js build. KaTeX rules are namespaced under `.katex` and unlayered, so they neither touch nor lose to shadcn/Tailwind layers. A `.katex-display { overflow-x: auto; }` rule in the same file implements R7 for equations. Governs R2, R5, R7.
- KTD4. **Code blocks are streamdown's plain output, styled — the `@streamdown/code` plugin is not installed.** That plugin is what adds Shiki highlighting; omitting it keeps the settled plain-block scope and the bundle small. (session-settled: user-directed — see Key Decisions.) Governs R6.
- KTD5. **Design matching happens through streamdown's `components` overrides, not global CSS.** The overrides set typography per element (Arial 16px/1.55 slate-800 body, monospace blocks, table/link/link-hover styles) so the rendered reply composes with the bubble rather than introducing a second visual language; gg-sans stays on author names only. Governs R5, R6, R7.
- KTD6. **Delimiter steering is one system-prompt line at `assembleChatCall`.** The seam's comment already names system prompts as attaching there (`src/core/chat/complete.ts:7-8`); the line instructs math in `$$…$$` form. The existing "no system prompt" tests in `src/core/chat/complete.test.ts` and `src/core/chat/stream.test.ts` get updated to expect it. Governs R10.

### Assumptions

- `streamdown` 2.7.0 and `@streamdown/math` 1.0.3 install cleanly under Next 16.3.6 / React 19.2.8 and are pinned exactly in `package-lock.json`.
- The `@source` paths from `src/app/globals.css` are `../../node_modules/streamdown/dist/*.js` and `../../node_modules/@streamdown/math/dist/*.js`, since this repo keeps the app under `src/` rather than the documented flat layout.
- Per-delta re-rendering of streamdown causes no visible jank at chat message sizes; the live browser check is the proof, and token batching is the fallback if it does.

### Risks & Dependencies

- **Model emits single-`$` math anyway:** renders literally per R3; U3's steering reduces it, and KTD2 documents the one-boolean escape hatch if it becomes a pattern.
- **KaTeX payload:** the CSS plus a handful of woff2 files load once per page from local build output; acceptable for this local app, visible in the build log if not.
- **Plugin interface churn:** streamdown 2.x split code/math into plugins; the pinned versions freeze that surface.

---

## Implementation Units

### U1. Renderer wiring: dependencies, assets, and the bubble swap

**Goal:** Assistant message content renders through streamdown with math enabled, styled by streamdown defaults, working during live streaming.

**Requirements:** R1, R2, R3, R4, R8, R9.

**Dependencies:** None.

**Files:**
- `package.json` / `package-lock.json` (add `streamdown@2.7.0`, `@streamdown/math@1.0.3`, pinned exactly)
- `src/app/globals.css` (modify — KaTeX `@import`, two `@source` directives, `.katex-display` overflow rule per KTD3)
- `src/components/chat/ChatMessageBubble.tsx` (modify — `AssistantMessage` renders content via `<Streamdown plugins={{ math }}>` per KTD1/KTD2; reasoning block, "Thinking …" indicator, error state, and `UserMessage` untouched per R8, R9)

**Approach:**
1. Install and pin the two packages; `katex` arrives transitively through `@streamdown/math` — only its CSS path is referenced directly.
2. In `globals.css`, after the existing imports: the KaTeX `@import`, then the two `@source` lines with the `src/`-relative paths from the Assumptions list, then the `.katex-display` rule. If the bare-package `@import` does not resolve through the Tailwind v4 / PostCSS pipeline (unstyled math in dev is the symptom), fall back to `import "katex/dist/katex.min.css"` in `src/app/layout.tsx`, Next.js's documented route for global CSS.
3. In `AssistantMessage`, replace the `{message.content}` text node with the streamdown element, keeping the empty-streaming "Thinking …" fallback ahead of it.
4. Import `math` from `@streamdown/math` pre-configured (the package's default-exported plugin instance); the defaults are the KTD2 guarantee, so nothing gets configured explicitly.
5. Do not pass a custom `rehypePlugins` array — it replaces the sanitized default chain wholesale, and the accepted-security decision in Scope Boundaries depends on those defaults staying intact.

**Execution note:** This is mostly dependency and integration wiring; prefer install/runtime smoke verification over unit coverage. There is no React component test seam in this repo today and adding one is out of scope.

**Patterns to follow:** `src/app/globals.css` import ordering and `@theme` block; `streamdown.ai/docs/getting-started` and `/docs/plugins/math` usage snippets.

**Test scenarios:**
- Smoke: a seeded or live assistant message containing a list, bold text, and a fenced block renders all three; the same content in a user message stays plain (AE5).
- Smoke: `$$x^2$$` inline and a two-line `$$` block both typeset; "it costs $5, not $10" renders as literal text (AE2, AE3).
- Smoke: while a reply streams through an unclosed code fence, the partial code shows inside a styled block rather than as raw backticks (AE4).
- Regression: `npm test` (all existing suites) and `npm run build` pass with the new CSS imports resolving.

**Verification:** With `npm run dev`, a real exchange renders markdown and math in the assistant bubble while the user bubbles and day separators look untouched; production build includes the KaTeX fonts as local assets.

### U2. Style the rendered output to the app's design

**Goal:** The rendered reply reads as native app text — same size, leading, and palette as today — with plain styled code blocks and contained wide content.

**Requirements:** R5, R6, R7; AE1, AE2.

**Dependencies:** U1.

**Files:**
- `src/components/chat/ChatMessageBubble.tsx` (modify — `components` overrides and/or wrapping container classes per KTD5)
- `src/app/globals.css` (modify only if an override cannot reach something; prefer component-level classes)

**Approach:**
1. Map body text back to `text-[16px] leading-[1.55] text-slate-800` and Arial; strip streamdown's own heading/display scale down to heading sizes that fit a chat bubble.
2. Style `pre`/`code` as plain monospace blocks with a subtle slate background — the settled scope, not a segment of the deferred highlighting plugin (KTD4).
3. Give tables, blockquotes, and links slate-palette treatments; horizontal scroll for wide display math and tables with no layout break (KTD3 covers the math half).
4. Tune list and paragraph spacing so consecutive paragraphs read like today's pre-wrap rhythm.

**Execution note:** Pure styling work; the live browser check is the proof. Compare against a before-screenshot of the seeded conversation.

**Patterns to follow:** The bubble div's current utility set in `src/components/chat/ChatMessageBubble.tsx`; slate palette usage across `src/components/chat/`.

**Test scenarios:**
- Smoke: the seeded conversation from `chat-data.ts` renders pixel-adjacent to today's appearance aside from the intended formatting gains (AE1).
- Smoke: a long display equation and a wide table both scroll horizontally without widening the message column (AE2, AE3 boundary case).
- Smoke: inline code, fenced code, and a link inside one reply each take the designed treatment.
- Regression: `npm run lint` passes; user bubbles and the reasoning block are visually unchanged (R8, R9).

**Verification:** Side-by-side with the pre-change chat, an unfamiliar reader cannot tell which chrome changed; only the assistant content gained formatting.

### U3. Steer the model to safe math delimiters

**Goal:** Spekter's replies use `$$…$$` math notation, so math the model writes actually renders under KTD2's defaults.

**Requirements:** R10; R2, R3.

**Dependencies:** None (independent of U1/U2; order with U1 doesn't matter).

**Files:**
- `src/core/chat/complete.ts` (modify — attach a short system message at the `assembleChatCall` seam, per KTD6)
- `src/core/chat/complete.test.ts` (modify — the "no system prompt" expectation becomes "system prompt is the delimiter instruction")
- `src/core/chat/stream.test.ts` (modify — same expectation update for the streaming path)

**Approach:**
1. Add a one-or-two-sentence system message at the assembly seam: math in `$$…$$`, block equations on their own `$$` lines, plain `$` reserved for currency.
2. Keep the seam as the single attach point; no endpoint or provider code changes.
3. Update the two assembly tests to assert the system message content lands once, ahead of the caller's messages.

**Execution note:** Implement test-first: change the two assertions to expect the system message, watch them fail, then attach it.

**Patterns to follow:** `src/core/chat/complete.ts` assembly shape; the existing `complete.test.ts` / `stream.test.ts` mock-model assertions.

**Test scenarios:**
- Both complete and streaming assemblies place exactly one system message containing the delimiter instruction before the caller's first message.
- The caller's message order and contents are unchanged after the system message.
- Both endpoints (complete and stream) produce the same assembled input shape for the same conversation.

**Verification:** Core tests pass; a live open-ended mathy question ("explain the quadratic formula") returns `$$`-delimited math that typesets end-to-end once U1 lands.

---

## Verification Contract

| Check | Command / action | Proves |
|---|---|---|
| Unit tests | `npm test` | U3 assembly behavior; no regressions in existing suites |
| Lint | `npm run lint` | U2 component changes |
| Production build | `npm run build` | U1 CSS imports and KaTeX font emission resolve |
| Live browser smoke | `npm run dev`, run AE1–AE5 by hand | R1–R9 end to end, including mid-stream R4 |

## Definition of Done

- Every Implementation Unit's `Verification` line passes.
- AE1–AE5 all hold in the live browser with a real OpenRouter reply.
- User messages, the reasoning block, the composer, the sidebar, and the day separators render exactly as before.
- No CDN font or stylesheet references in the rendered page; KaTeX assets come from the local build.
- No abandoned-attempt code or styling left over from U2 iterations.
