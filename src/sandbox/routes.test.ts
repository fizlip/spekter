import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { createFakeBackend } from "./backend/fake";
import { createBoxRegistry } from "./boxes";
import { boxRoutes } from "./routes";
import { createHandler } from "./server";

const token = "t".repeat(32);
let handler: (request: Request) => Promise<Response>;

beforeEach(async () => {
  const dir = await mkdtemp(join(tmpdir(), "sandboxd-routes-"));
  const boxes = createBoxRegistry({
    backend: createFakeBackend().backend,
    stateDir: join(dir, "boxes"),
    workspaceRoot: join(dir, "workspace"),
    maxBoxes: 4,
    defaultTtlSeconds: 60,
    log: async () => {},
  });
  handler = createHandler({ token, routes: boxRoutes(boxes) });
});

function call(method: string, path: string, body?: unknown) {
  return handler(
    new Request(`http://127.0.0.1:3210${path}`, {
      method,
      headers: {
        host: "127.0.0.1:3210",
        authorization: `Bearer ${token}`,
        ...(body !== undefined && { "content-type": "application/json" }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
  );
}

describe("box routes", () => {
  it("creates, lists, inspects, and destroys a box", async () => {
    const created = await call("POST", "/boxes", { name: "a", ttlSeconds: 90 });
    expect(created.status).toBe(201);
    expect(await created.json()).toMatchObject({ id: "a", state: "ready", ttlSeconds: 90 });

    expect((await (await call("GET", "/boxes")).json()).boxes.map((box: { id: string }) => box.id)).toEqual(["a"]);
    expect(await (await call("GET", "/boxes/a")).json()).toMatchObject({ id: "a" });

    const destroyed = await call("DELETE", "/boxes/a");
    expect(await destroyed.json()).toEqual({ id: "a", destroyed: true });
    expect((await (await call("GET", "/boxes")).json()).boxes).toEqual([]);
  });

  it("creates a box from an empty body", async () => {
    expect((await call("POST", "/boxes", {})).status).toBe(201);
  });

  it("returns a not_found envelope naming live boxes for an unknown id", async () => {
    await call("POST", "/boxes", { name: "a" });

    const response = await call("GET", "/boxes/nope");
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: { code: "not_found", message: 'No box "nope". Live boxes: a' } });
  });

  it("rejects an id in the path that is not a safe box name", async () => {
    const response = await call("DELETE", "/boxes/..%2Fetc");
    expect(response.status).toBe(400);
  });

  it.each([{ ttlSeconds: 0 }, { ttlSeconds: 1.5 }, { name: 7 }])("rejects the create body %j", async (body) => {
    expect((await call("POST", "/boxes", body)).status).toBe(400);
  });
});
