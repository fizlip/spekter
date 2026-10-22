import { afterEach, describe, expect, it, vi } from "vitest";
import type { Source } from "@/core/chat/contract";
import { streamReply, toConversation, type StreamError } from "./stream-client";
import type { ChatMessage } from "./types";

const conversation = [{ role: "user" as const, content: "What is my name?" }];

function ndjsonResponse(chunks: string[]) {
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      chunks.forEach((chunk) => controller.enqueue(encoder.encode(chunk)));
      controller.close();
    },
  });
  return new Response(body, { headers: { "content-type": "application/x-ndjson" } });
}

function stubFetch(response: Response | (() => Promise<Response>)) {
  const fetchMock = vi.fn(typeof response === "function" ? response : async () => response);
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

async function run(signal?: AbortSignal, model?: string, sessionId?: string) {
  const deltas: string[] = [];
  const errors: StreamError[] = [];
  const done: string[] = [];
  const reasonings: string[] = [];
  const sources: Source[][] = [];
  await streamReply(
    conversation,
    {
      onDelta: (text) => deltas.push(text),
      onError: (error) => errors.push(error),
      onDone: (model) => done.push(model),
      onReasoning: (reasoning) => reasonings.push(reasoning),
      onSources: (list) => sources.push(list),
    },
    signal,
    model,
    sessionId,
  );
  return { deltas, errors, done, reasonings, sources };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("streamReply", () => {
  it("posts the conversation as JSON to the streaming route", async () => {
    const fetchMock = stubFetch(ndjsonResponse(['{"type":"done","model":"m"}\n']));

    await run();

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/api/chat/stream");
    expect(init.method).toBe("POST");
    expect(new Headers(init.headers).get("content-type")).toBe("application/json");
    expect(JSON.parse(init.body as string)).toEqual({ messages: conversation });
  });

  it("includes the session id in the request body when given", async () => {
    const fetchMock = stubFetch(ndjsonResponse(['{"type":"done","model":"m"}\n']));

    await run(undefined, undefined, "s1");

    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(JSON.parse(init.body as string)).toEqual({ messages: conversation, sessionId: "s1" });
  });

  it("delivers each delta and then done with the model id", async () => {
    stubFetch(
      ndjsonResponse([
        '{"type":"delta","text":"Your name "}\n',
        '{"type":"delta","text":"is Filip."}\n',
        '{"type":"done","model":"openai/gpt-test"}\n',
      ]),
    );

    expect(await run()).toEqual({
      deltas: ["Your name ", "is Filip."],
      errors: [],
      done: ["openai/gpt-test"],
      reasonings: [],
      sources: [],
    });
  });

  it("delivers reasoning frames separately from the reply text", async () => {
    stubFetch(
      ndjsonResponse([
        '{"type":"reasoning","text":"The user said "}\n',
        '{"type":"reasoning","text":"their name."}\n',
        '{"type":"delta","text":"Filip."}\n',
        '{"type":"done","model":"m"}\n',
      ]),
    );

    expect(await run()).toEqual({
      deltas: ["Filip."],
      errors: [],
      done: ["m"],
      reasonings: ["The user said ", "their name."],
      sources: [],
    });
  });

  it("delivers the sources frame before the reply text", async () => {
    stubFetch(
      ndjsonResponse([
        '{"type":"sources","sources":[{"type":"knowledge_file","path":"notes/a.md"}]}\n',
        '{"type":"delta","text":"Hi"}\n',
        '{"type":"done","model":"m","sources":[{"type":"knowledge_file","path":"notes/a.md"}]}\n',
      ]),
    );

    expect(await run()).toEqual({
      deltas: ["Hi"],
      errors: [],
      done: ["m"],
      reasonings: [],
      sources: [[{ type: "knowledge_file", path: "notes/a.md" }]],
    });
  });

  it("delivers tool call and tool result frames in order, without treating them as errors", async () => {
    stubFetch(
      ndjsonResponse([
        '{"type":"tool_call","id":"call-1","name":"current_time"}\n',
        '{"type":"tool_result","id":"call-1","name":"current_time","ok":true}\n',
        '{"type":"delta","text":"It is Monday."}\n',
        '{"type":"done","model":"m","sources":[{"type":"tool","name":"current_time"}]}\n',
      ]),
    );
    const events: string[] = [];

    await streamReply(conversation, {
      onDelta: (text) => events.push(`delta ${text}`),
      onReasoning: () => events.push("reasoning"),
      onToolCall: ({ id, name }) => events.push(`call ${id} ${name}`),
      onToolResult: ({ id, name, ok }) => events.push(`result ${id} ${name} ${ok}`),
      onDone: (model) => events.push(`done ${model}`),
      onError: ({ message }) => events.push(`error ${message}`),
    });

    expect(events).toEqual([
      "call call-1 current_time",
      "result call-1 current_time true",
      "delta It is Monday.",
      "done m",
    ]);
  });

  it("parses frames split across chunk boundaries the same as line-aligned ones", async () => {
    stubFetch(
      ndjsonResponse(['{"type":"delta","te', 'xt":"Hé"}\n{"type":"delta","text":"llo"}\n{"type":"do', 'ne","model":"m"}\n']),
    );

    expect(await run()).toEqual({ deltas: ["Hé", "llo"], errors: [], done: ["m"], reasonings: [], sources: [] });
  });

  it("reports a mid-stream error frame after the deltas already delivered, and never done", async () => {
    stubFetch(
      ndjsonResponse([
        '{"type":"delta","text":"Your name "}\n',
        '{"type":"error","code":"provider_error","message":"upstream exploded"}\n',
      ]),
    );

    expect(await run()).toEqual({
      deltas: ["Your name "],
      errors: [{ code: "provider_error", message: "upstream exploded" }],
      done: [],
      reasonings: [],
      sources: [],
    });
  });

  it.each([
    [400, "invalid_request", "Conversation must contain at least one message"],
    [502, "provider_error", "Rate limit exceeded"],
    [503, "not_configured", "Missing environment variable: OPENROUTER_API_KEY"],
  ])("reports a %i JSON error response with its code and message", async (status, code, message) => {
    stubFetch(Response.json({ error: { code, message } }, { status }));

    expect(await run()).toEqual({ deltas: [], errors: [{ code, message }], done: [], reasonings: [], sources: [] });
  });

  it("reports a connection error when the stream ends without done or error", async () => {
    stubFetch(ndjsonResponse(['{"type":"delta","text":"Your name "}\n']));

    const { deltas, errors, done } = await run();

    expect(deltas).toEqual(["Your name "]);
    expect(errors).toEqual([{ code: "network_error", message: "The reply stream ended unexpectedly" }]);
    expect(done).toEqual([]);
  });

  it("reports a connection error when the request itself fails", async () => {
    stubFetch(async () => {
      throw new TypeError("Failed to fetch");
    });

    expect((await run()).errors).toEqual([{ code: "network_error", message: "Failed to fetch" }]);
  });

  it("reports a connection error when the stream breaks while reading", async () => {
    let sent = false;
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (sent) return controller.error(new TypeError("network connection lost"));
        sent = true;
        controller.enqueue(new TextEncoder().encode('{"type":"delta","text":"Your "}\n'));
      },
    });
    stubFetch(new Response(body));

    expect(await run()).toEqual({
      deltas: ["Your "],
      errors: [{ code: "network_error", message: "network connection lost" }],
      done: [],
      reasonings: [],
      sources: [],
    });
  });

  it("stays silent when the caller aborts", async () => {
    const controller = new AbortController();
    stubFetch(async () => {
      controller.abort();
      throw new DOMException("The operation was aborted.", "AbortError");
    });

    expect(await run(controller.signal)).toEqual({ deltas: [], errors: [], done: [], reasonings: [], sources: [] });
  });
});

describe("toConversation", () => {
  const at = "2026-10-07T09:00:00.000Z";
  const message = (id: string, role: ChatMessage["role"], content: string, extra: Partial<ChatMessage> = {}) => ({
    id,
    role,
    content,
    createdAt: at,
    ...extra,
  });

  it("keeps completed exchanges as role and content only", () => {
    expect(toConversation([message("1", "user", "Hi"), message("2", "assistant", "Hello")])).toEqual([
      { role: "user", content: "Hi" },
      { role: "assistant", content: "Hello" },
    ]);
  });

  it("drops a failed reply and the user message it answered", () => {
    expect(
      toConversation([
        message("1", "user", "Hi"),
        message("2", "assistant", "Hello"),
        message("3", "user", "What is my name?"),
        message("4", "assistant", "Your na", { status: "error", error: "upstream exploded" }),
        message("5", "user", "Try again: what is my name?"),
      ]),
    ).toEqual([
      { role: "user", content: "Hi" },
      { role: "assistant", content: "Hello" },
      { role: "user", content: "Try again: what is my name?" },
    ]);
  });

  it("drops display-only messages that are not part of the exchange", () => {
    expect(
      toConversation([
        message("1", "user", "Hi"),
        message("2", "source", "Read notes/a.md"),
        message("3", "reasoning", "Thinking about the question"),
        message("4", "tool", "", { tool: { id: "call-1", name: "current_time", state: "succeeded" } }),
        message("5", "assistant", "Hello"),
      ]),
    ).toEqual([
      { role: "user", content: "Hi" },
      { role: "assistant", content: "Hello" },
    ]);
  });

  it("drops the user message a failed reply answered even when display messages sit between them", () => {
    expect(
      toConversation([
        message("1", "user", "Hi"),
        message("2", "assistant", "Hello"),
        message("3", "user", "What is my name?"),
        message("4", "source", "Read notes/a.md"),
        message("5", "assistant", "Your na", { status: "error", error: "upstream exploded" }),
        message("6", "user", "Try again: what is my name?"),
      ]),
    ).toEqual([
      { role: "user", content: "Hi" },
      { role: "assistant", content: "Hello" },
      { role: "user", content: "Try again: what is my name?" },
    ]);
  });
});
