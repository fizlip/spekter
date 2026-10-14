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
  it("posts the conversation to /api/chat as JSON and returns the reply with its sources", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse(200, {
        message: { role: "assistant", content: "hi there" },
        model: "m",
        sources: [{ type: "tool", name: "read_file" }],
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const reply = await askSpekter("http://127.0.0.1:3000", messages);

    expect(reply).toEqual({
      text: "hi there",
      kind: "answer",
      sources: [{ type: "tool", name: "read_file" }],
    });
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

    expect(reply.kind).toBe("error");
    expect(reply.text).toContain("not_configured");
    expect(reply.text).toContain("OPENROUTER_API_KEY");
  });

  it("reports the HTTP status when the error body is not the API's shape", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("nope", { status: 502 })));

    const reply = await askSpekter("http://127.0.0.1:3000", messages);

    expect(reply.kind).toBe("error");
    expect(reply.text).toContain("502");
  });

  it("reports Spekter as unreachable when the request itself fails", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("ECONNREFUSED")));

    expect(await askSpekter("http://127.0.0.1:3000", messages)).toEqual({
      text: UNREACHABLE_MESSAGE,
      kind: "error",
      sources: [],
    });
  });

  it("distinguishes a request timeout from an unreachable server", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(Object.assign(new Error("timed out"), { name: "TimeoutError" })),
    );

    const reply = await askSpekter("http://127.0.0.1:3000", messages);

    expect(reply.kind).toBe("error");
    expect(reply.text).toBe(TIMEOUT_MESSAGE);
  });
});
