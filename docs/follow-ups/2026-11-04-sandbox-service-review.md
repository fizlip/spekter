# Code review follow-ups — sandbox service merge (2026-11-04)

Findings from the multi-agent review of `feat/sandbox-service` (merged as `a3e3222`).
Two reported P0s were validated as false positives: `src/proxy.ts` already applies the
Host allowlist and JSON content-type gate to every `/api/*` route.

## P1

- [ ] **Exec hangs forever when the guest-side kill stalls.** `runCommand` awaits
  `handle.exited` after `kill()` with no deadline, and the Lima `kill()` awaits a
  `limactl shell` round-trip into the (possibly wedged) guest before SIGTERMing the
  local child. The HTTP call never resolves, `inflightExecs` stays >0, the box is
  never reaped. Fix: signal the local process group without awaiting the guest kill,
  and bound the post-kill wait on `exited`.
  `src/sandbox/exec.ts:65`, `src/sandbox/backend/lima.ts:220`

- [ ] **Corrupt box state file crashes sandboxd on every boot.** `reconcile()` calls
  `JSON.parse` inside a `.then` fulfillment callback — a `SyntaxError` propagates and
  kills startup. State writes are also non-atomic (unlike session-store's tmp+rename).
  `src/sandbox/boxes.ts:188`

- [ ] **Model history permanently poisoned by one command-bearing user message.**
  `reconcile` compares stored user text to `commandStripped(content)`, but the
  display-only append path stores the raw form — every later turn diverges and
  returns null, silently disabling stored tool history for that session.
  `src/core/chat/model-history.ts:92`

- [ ] **Aborted turn is never persisted.** The unmount cleanup aborts the stream but
  the save-on-settle effect never fires for an aborted reply — the user's message
  and partial reply are lost on session switch or new chat.
  `src/components/chat/ChatInterface.tsx:58`

- [ ] **Malformed request target crashes sandboxd pre-auth.** `new Request(...)`
  throws on absolute-form request targets with no try/catch in `serve()`.
  `src/sandbox/server.ts:98`

## P2

- [ ] **Destroy races an in-flight create** — ghost VM or a failed destroy stamping
  `ready` over a still-booting box. Serialize create under `withLock`; restore prior
  state on destroy failure. `src/sandbox/boxes.ts:88-93,145`
- [ ] **Guest kill silently no-ops when the pidfile isn't written yet** (`|| exit 0`),
  and the pidfile is guest-writable so a command can defeat its own kill.
  `src/sandbox/backend/lima.ts:115`
- [ ] **One failing instance aborts `reconcile()`** — a single bad box blocks daemon
  startup; `reap()` already isolates per-box failures. `src/sandbox/boxes.ts:210`
- [ ] **No timeout on any `limactl` call** — a hung create wedges a box in `creating`
  and holds a `maxBoxes` slot until restart. `src/sandbox/backend/lima.ts:66`
- [ ] **No `sandbox_list` tool** — the model can only rediscover live box ids by
  provoking an error; `client.list()` exists but is unreachable.
  `src/core/tools/registry.ts`
- [ ] **`sandbox_destroy` on a stale id advises creating a fresh box** — exec-specific
  error text applied to a cleanup call. `src/core/tools/sandbox-destroy.ts:21`
- [ ] **`sandbox_exec` drops the created box id when exec fails after create** —
  orphaned boxes silently consume the box budget. `src/core/tools/sandbox-exec.ts:82`
- [ ] **`openSession` has no staleness guard** — last-resolved fetch wins over last
  click; sequence-number the opens. `src/components/chat/chat-session.tsx:31`
- [ ] **Untested branches:** exec-on-non-ready-box rejection, destroy-failure state
  recovery, session-identity invariants (plan U3). `src/sandbox/boxes.test.ts`,
  `src/components/chat/chat-session.tsx`
- [ ] **`chat-data.ts` is dead code; README says "eight" tools** (registry has ten).
  `src/components/chat/chat-data.ts`, `README.md:25`

## P3

- `locks` map never pruned — `src/sandbox/boxes.ts:73`
- Port `3210` duplicated as a literal — `src/core/tools/sandbox-exec.ts:20`
- Malformed percent-encoding in a path param → 500 instead of 400 — `src/sandbox/server.ts:74`
- Restored session's `createdAt` rewritten to now on next save — `src/components/chat/ChatInterface.tsx:77`
- Tool rows persisted `state: "running"` restore as permanently running —
  `src/interfaces/web/session.ts:54`
- `daemon: "unreachable"` conflates auth/config errors — `src/core/workspace/tree.ts:45`
- Stale citation in `docs/solutions/security-issues/local-api-reachable-from-browser-pages.md`
  (gate lives in `src/proxy.ts:17`, not the chat route)

## Verified clean

Daemon security posture held up: bearer token on every route, Host allowlist, no CORS,
argv-only `limactl` with minimal env, port forwarding disabled, mount verification
before start, box-id validation — conforms to the documented local-API posture.
