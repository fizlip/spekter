import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";
import { proxy } from "./proxy";

function apiRequest({
  host = "127.0.0.1:3000",
  method = "POST",
  contentType = "application/json",
  path = "/api/chat",
}: { host?: string; method?: string; contentType?: string | null; path?: string } = {}) {
  const headers: Record<string, string> = { host };
  if (contentType) headers["content-type"] = contentType;
  return new NextRequest(`http://127.0.0.1:3000${path}`, { method, headers });
}

describe("proxy", () => {
  it.each(["127.0.0.1:3000", "localhost:3000", "localhost", "[::1]:3000"])(
    "lets JSON requests addressed to %s through",
    (host) => {
      expect(proxy(apiRequest({ host })).status).toBe(200);
    },
  );

  it("rejects requests whose Host is not this machine, such as DNS-rebinding attacks", async () => {
    const response = proxy(apiRequest({ host: "evil.example:3000" }));

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({
      error: { code: "forbidden", message: "Spekter only accepts requests addressed to localhost" },
    });
  });

  it.each(["/api/chat", "/api/chat/stream"])(
    "rejects a non-JSON POST to %s so cross-site simple requests never reach the model",
    async (path) => {
      for (const contentType of ["text/plain", null]) {
        const response = proxy(apiRequest({ path, contentType }));

        expect(response.status).toBe(400);
        expect(await response.json()).toEqual({
          error: { code: "invalid_request", message: "Content-Type must be application/json" },
        });
      }
    },
  );

  it("accepts a JSON content type with a charset", () => {
    expect(proxy(apiRequest({ contentType: "application/json; charset=utf-8" })).status).toBe(200);
  });

  it("does not require a content type on non-POST requests", () => {
    expect(proxy(apiRequest({ method: "GET", contentType: null })).status).toBe(200);
  });
});
