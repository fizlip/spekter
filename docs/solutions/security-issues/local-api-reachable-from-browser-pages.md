---
title: Binding to 127.0.0.1 does not stop web pages from calling the local API
date: 2026-10-02
category: security-issues
module: core chat API (src/app/api, src/proxy.ts)
problem_type: security_issue
component: api_layer
symptoms:
  - "Any web page open in the user's browser could POST to http://127.0.0.1:3000/api/chat and spend OpenRouter credits"
  - "A DNS-rebinding page could call the API and read the replies"
root_cause: missing_validation
resolution_type: code_fix
severity: high
framework_version: next 16.3.6
tags: [csrf, dns-rebinding, localhost, nextjs-proxy, cors, openrouter, api-route]
---

# Binding to 127.0.0.1 does not stop web pages from calling the local API

## Problem

Spekter's API has no authentication by design (local-only, single user). The plan assumed that binding `next dev` / `next start` to `127.0.0.1` made it reachable "only from this machine". That is false: the user's own browser is on this machine, so any page it loads can send requests to the loopback API. Each accepted request calls OpenRouter and spends credits.

## Symptoms

- A page on any site can fire `fetch("http://127.0.0.1:3000/api/chat", { method: "POST", body: "{...}" })` with the default `text/plain` content type. That is a CORS "simple request", so there is no preflight. The page can't read the response, but the model call still runs and is billed.
- With DNS rebinding (an attacker domain that re-resolves to `127.0.0.1`), the browser treats the request as same-origin, so the page can also read the reply.

Neither shows up in tests, curl, or normal use. A security reviewer found it while reviewing SPE-1 (PR #1).

## What Didn't Work

- **Binding to localhost.** `next dev -H 127.0.0.1` (`package.json:6`) only blocks other devices on the network. It is still needed, because Next.js binds to `0.0.0.0` by default (`node_modules/next/dist/docs/01-app/03-api-reference/06-cli/next.md`), but it does nothing against the user's own browser.
- **Relying on Next.js's dev cross-site protection.** `block-cross-site-dev.js` only protects internal endpoints. It returns early unless the URL is a `/_next` or `/__nextjs` path (`node_modules/next/dist/server/lib/router-utils/block-cross-site-dev.js:86-89`), so app route handlers like `/api/chat` get no protection.
- **Relying on browsers.** Chrome's Local Network Access prompt may block some of these requests, but Firefox and Safari don't, so the server can't depend on it.

## Solution

Two small checks, both merged in PR #1:

1. **Every API route requires `Content-Type: application/json`** (`src/app/api/chat/route.ts:15-16`). A cross-origin JSON POST is not a simple request, so the browser sends a preflight first. The route sends no `Access-Control-Allow-Origin` header (Next.js answers `OPTIONS` with only `allow: OPTIONS, POST`), so the preflight fails and the real request is never sent.

   ```ts
   if (!request.headers.get("content-type")?.startsWith("application/json")) {
     throw new InvalidRequestError("Content-Type must be application/json"); // -> 400
   }
   ```

2. **`src/proxy.ts` rejects any request whose `Host` isn't local**, for every `/api/*` route (`src/proxy.ts:3-19`). A rebinding page sends its own domain in `Host`, so it gets a 403.

   ```ts
   const LOCAL_HOSTNAMES = new Set(["127.0.0.1", "localhost", "[::1]"]);
   // ...
   export const config = { matcher: "/api/:path*" };
   ```

Verified against the running dev server. A `text/plain` POST got 400, a forged `Host: evil.example` got 403, a cross-origin preflight came back with no `Access-Control-Allow-Origin`, and `127.0.0.1` / `localhost` requests were accepted. Unit tests: `src/proxy.test.ts` and the non-JSON content-type case in `src/app/api/chat/route.test.ts`.

## Why This Works

A browser can only send a cross-site request without asking first if it is a simple request (form-style or `text/plain` body). Requiring JSON forces the browser to ask first, and the server never says yes. DNS rebinding gets around origin checks but can't change the `Host` the browser sends, so checking `Host` closes that path. Curl and other local tools send JSON and a local `Host`, so they're unaffected.

## Prevention

- **Every new API route must keep the JSON content-type check.** That includes the planned streaming endpoint and any webhook route. The proxy only checks `Host`. The content-type check lives in each route, so a new route without it can be driven cross-site again. Copy the check from `src/app/api/chat/route.ts`, or move it into `src/proxy.ts` once there is more than one route.
- **Never add CORS headers** (`Access-Control-Allow-Origin`) to API routes. That would let the preflight succeed and undo the first check.
- **Don't loosen the proxy matcher** below `/api/:path*`, and don't widen `LOCAL_HOSTNAMES` without understanding the rebinding risk.
- **Deploying (the VPS plan) needs a real access gate.** Both checks assume a local-only, single-user setup. Put the auth check in `src/proxy.ts`, the single place the plan reserves for it (KTD8).
- **Test each new route for both rejections:** a non-JSON content type returns 400, and a non-local `Host` returns 403.

## Related Issues

- PR #1 (SPE-1, core chat API), which introduced the endpoint and this fix.
- Plan: `docs/plans/2026-09-30-1257-feat-core-chat-api-plan.md` (KTD8: future access gate in `src/proxy.ts`; KTD10: localhost binding).
