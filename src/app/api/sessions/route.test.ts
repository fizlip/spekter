import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildSession } from "@/interfaces/web/session";

vi.mock("next/server", () => ({ connection: vi.fn() }));
import { GET, PUT } from "./[id]/route";
import { GET as LIST } from "./route";

const session = (id: string) =>
  buildSession({
    id,
    model: "openai/gpt-test",
    messages: [
      { id: "u1", role: "user", content: `hello ${id}`, createdAt: "2026-10-21T10:00:00Z" },
      { id: "a1", role: "assistant", content: "hi", createdAt: "2026-10-21T10:00:00Z" },
    ],
    createdAt: "2026-10-21T10:00:00Z",
    now: "2026-10-21T10:00:00Z",
  });

const params = (id: string) => ({ params: Promise.resolve({ id }) });

const put = (id: string, body: unknown, contentType = "application/json") =>
  PUT(
    new Request(`http://localhost/api/sessions/${id}`, {
      method: "PUT",
      headers: { "content-type": contentType },
      body: typeof body === "string" ? body : JSON.stringify(body),
    }),
    params(id),
  );

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "spekter-sessions-route-"));
  vi.stubEnv("SPEKTER_SESSIONS_DIR", dir);
});

afterEach(async () => {
  vi.unstubAllEnvs();
  await rm(dir, { recursive: true, force: true });
});

describe("PUT /api/sessions/[id]", () => {
  it("stores a valid session and GET returns it", async () => {
    expect((await put("abc", session("abc"))).status).toBe(200);
    const response = await GET(new Request("http://localhost/api/sessions/abc"), params("abc"));
    expect(response.status).toBe(200);
    expect((await response.json()).id).toBe("abc");
  });

  it("rejects a non-JSON content type", async () => {
    expect((await put("abc", "{}", "text/plain")).status).toBe(400);
  });

  it("rejects a body whose id does not match the URL", async () => {
    expect((await put("abc", session("other"))).status).toBe(400);
  });

  it("rejects a body that fails the session schema", async () => {
    expect((await put("abc", { id: "abc" })).status).toBe(400);
  });
});

describe("GET /api/sessions/[id]", () => {
  it("returns 404 for an unknown id", async () => {
    const response = await GET(new Request("http://localhost/api/sessions/nope"), params("nope"));
    expect(response.status).toBe(404);
  });
});

describe("GET /api/sessions", () => {
  it("lists summaries after saves", async () => {
    expect(await (await LIST()).json()).toEqual([]);
    await put("one", session("one"));
    await put("two", session("two"));
    const body = await (await LIST()).json();
    expect(body.map((s: { id: string }) => s.id).sort()).toEqual(["one", "two"]);
  });
});
