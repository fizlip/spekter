import { describe, expect, it } from "vitest";
import { z } from "zod";
import { createHandler, json, parseBody } from "./server";

const token = "t".repeat(32);

const handler = createHandler({
  token,
  routes: [
    {
      method: "POST",
      pattern: /^\/echo\/([^/]+)$/,
      handle: async (request, [id]) => json({ id, body: await parseBody(z.object({ cmd: z.string() }), request) }),
    },
  ],
});

function call({
  host = "127.0.0.1:3210",
  method = "GET",
  path = "/healthz",
  contentType = method === "POST" ? "application/json" : null,
  bearer = token,
  body,
}: {
  host?: string;
  method?: string;
  path?: string;
  contentType?: string | null;
  bearer?: string | null;
  body?: string;
} = {}) {
  const headers: Record<string, string> = { host };
  if (contentType) headers["content-type"] = contentType;
  if (bearer) headers.authorization = `Bearer ${bearer}`;
  return handler(new Request(`http://127.0.0.1:3210${path}`, { method, headers, body }));
}

describe("sandboxd handler", () => {
  it.each(["127.0.0.1:3210", "localhost:3210", "localhost", "[::1]:3210"])("serves healthz to a request addressed to %s", async (host) => {
    const response = await call({ host });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
  });

  it("rejects a Host that is not this machine, such as a DNS-rebinding page", async () => {
    const response = await call({ host: "evil.example:3210" });

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({
      error: { code: "forbidden", message: "sandboxd only accepts requests addressed to localhost" },
    });
  });

  it.each([["missing", null], ["wrong", "x".repeat(32)], ["shorter", "t"]])("rejects a %s bearer token", async (_label, bearer) => {
    const response = await call({ bearer });

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({
      error: { code: "unauthorized", message: "Missing or invalid sandbox token" },
    });
  });

  it("rejects a guest forging a local Host and JSON content type without the token", async () => {
    const response = await call({ method: "POST", path: "/echo/a", bearer: null, body: '{"cmd":"id"}' });

    expect(response.status).toBe(401);
  });

  it.each(["text/plain", null])("rejects a POST with content type %s", async (contentType) => {
    const response = await call({ method: "POST", path: "/echo/a", contentType, body: '{"cmd":"id"}' });

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: { code: "invalid_request", message: "Content-Type must be application/json" },
    });
  });

  it("routes a valid JSON request with its path parameters", async () => {
    const response = await call({
      method: "POST",
      path: "/echo/box-1",
      contentType: "application/json; charset=utf-8",
      body: '{"cmd":"uname -a"}',
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ id: "box-1", body: { cmd: "uname -a" } });
  });

  it("rejects a malformed JSON body", async () => {
    const response = await call({ method: "POST", path: "/echo/a", body: "{not json" });

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: { code: "invalid_request", message: "Request body must be valid JSON" },
    });
  });

  it("rejects a body that fails validation, naming the field", async () => {
    const response = await call({ method: "POST", path: "/echo/a", body: '{"cmd":42}' });

    expect(response.status).toBe(400);
    expect((await response.json()).error).toMatchObject({ code: "invalid_request", message: expect.stringContaining("cmd") });
  });

  it("returns a not_found envelope for an unknown route", async () => {
    const response = await call({ path: "/nope" });

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: { code: "not_found", message: "No route for GET /nope" } });
  });

  it("never emits CORS headers", async () => {
    const responses = await Promise.all([call(), call({ host: "evil.example" }), call({ bearer: null })]);

    for (const response of responses) {
      expect([...response.headers.keys()].filter((name) => name.startsWith("access-control-"))).toEqual([]);
    }
  });
});
