import { afterEach, describe, expect, it, vi } from "vitest";
import { askSpekter, TIMEOUT_MESSAGE, UNREACHABLE_MESSAGE } from "./spekter-api";

const messages = [{ role: "user" as const, content: "hello" }];

function jsonResponse(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

afterEach(() => vi.unstubAllGlobals());

describe("askSpekter", () => {
  it("posts the conversation to /api/chat as JSON and returns the assistant text", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse(200, { message: { role: "assistant", content: "hi there" }, model: "m", sources: [] }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const reply = await askSpekter("http://127.0.0.1:3000", messages);

    expect(reply).toBe("hi there");
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("http://127.0.0.1:3000/api/chat");
    expect(init.method).toBe("POST");
    expect(init.headers).toEqual({ "content-type": "application/json" });
    expect(JSON.parse(init.body)).toEqual({ messages });
  });

  it("surfaces the API's error code and message on a non-2xx response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        jsonResponse(503, { error: { code: "not_configured", message: "Missing environment variable: OPENROUTER_API_KEY" } }),
      ),
    );

    const reply = await askSpekter("http://127.0.0.1:3000", messages);

    expect(reply).toContain("not_configured");
    expect(reply).toContain("OPENROUTER_API_KEY");
  });

  it("reports the HTTP status when the error body is not the API's shape", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("nope", { status: 502 })));

    expect(await askSpekter("http://127.0.0.1:3000", messages)).toContain("502");
  });

  it("reports Spekter as unreachable when the request itself fails", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("ECONNREFUSED")));

    expect(await askSpekter("http://127.0.0.1:3000", messages)).toBe(UNREACHABLE_MESSAGE);
  });

  it("distinguishes a request timeout from an unreachable server", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(Object.assign(new Error("timed out"), { name: "TimeoutError" })),
    );

    expect(await askSpekter("http://127.0.0.1:3000", messages)).toBe(TIMEOUT_MESSAGE);
  });
});
