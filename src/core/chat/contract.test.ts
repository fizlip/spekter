import { describe, expect, it } from "vitest";
import { InvalidRequestError } from "../errors";
import { parseChatRequest } from "./contract";

describe("parseChatRequest", () => {
  it("accepts a user, assistant, user conversation unchanged", () => {
    const body = {
      messages: [
        { role: "user", content: "My name is Filip." },
        { role: "assistant", content: "Nice to meet you, Filip." },
        { role: "user", content: "What is my name?" },
      ],
    };

    expect(parseChatRequest(body)).toEqual(body);
  });

  it.each([
    ["an empty message list", { messages: [] }],
    ["a missing messages field", {}],
    ["a non-object body", "hello"],
    ["a system message", { messages: [{ role: "system", content: "Be terse." }, { role: "user", content: "Hi" }] }],
    ["empty content", { messages: [{ role: "user", content: "" }] }],
    ["non-string content", { messages: [{ role: "user", content: 42 }] }],
    [
      "a conversation ending with an assistant message",
      { messages: [{ role: "user", content: "Hi" }, { role: "assistant", content: "Hello" }] },
    ],
  ])("rejects %s", (_label, body) => {
    expect(() => parseChatRequest(body)).toThrow(InvalidRequestError);
  });
});
