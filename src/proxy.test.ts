import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";
import { proxy } from "./proxy";

function apiRequest(host: string) {
  return new NextRequest("http://127.0.0.1:3000/api/chat", {
    method: "POST",
    headers: { host },
  });
}

describe("proxy", () => {
  it.each(["127.0.0.1:3000", "localhost:3000", "localhost", "[::1]:3000"])(
    "lets requests addressed to %s through",
    (host) => {
      expect(proxy(apiRequest(host)).status).toBe(200);
    },
  );

  it("rejects requests whose Host is not this machine, such as DNS-rebinding attacks", async () => {
    const response = proxy(apiRequest("evil.example:3000"));

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({
      error: { code: "forbidden", message: "Spekter only accepts requests addressed to localhost" },
    });
  });
});
