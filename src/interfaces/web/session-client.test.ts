import { afterEach, describe, expect, it, vi } from "vitest";
import { buildSession } from "./session";
import { getSession, listSessions, putSession } from "./session-client";

const session = buildSession({
  id: "abc",
  model: null,
  messages: [{ id: "u1", role: "user", content: "hi", createdAt: "2026-10-21T10:00:00Z" }],
  createdAt: "2026-10-21T10:00:00Z",
  now: "2026-10-21T10:00:00Z",
});

afterEach(() => vi.unstubAllGlobals());

describe("listSessions", () => {
  it("returns parsed summaries", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json([{ id: "abc", title: "hi" }])));
    expect(await listSessions()).toEqual([{ id: "abc", title: "hi" }]);
  });
});

describe("getSession", () => {
  it("returns null on 404 and throws on other failures", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 404 })));
    expect(await getSession("missing")).toBeNull();

    vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 500 })));
    await expect(getSession("abc")).rejects.toThrow("status 500");
  });
});

describe("putSession", () => {
  it("PUTs the session JSON to its id path", async () => {
    const fetchMock = vi.fn(async () => Response.json({ ok: true }));
    vi.stubGlobal("fetch", fetchMock);
    await putSession(session);
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/sessions/abc",
      expect.objectContaining({ method: "PUT", headers: { "content-type": "application/json" } }),
    );
  });
});
