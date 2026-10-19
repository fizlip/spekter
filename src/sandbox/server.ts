import { createHash, timingSafeEqual } from "node:crypto";
import { createServer, type Server } from "node:http";
import { Readable } from "node:stream";
import type { z } from "zod";
import { SandboxError, statusByCode, type SandboxErrorCode } from "./wire";

export type Route = {
  method: string;
  pattern: RegExp;
  handle: (request: Request, params: string[]) => Promise<Response>;
};

const LOCAL_HOSTNAMES = new Set(["127.0.0.1", "localhost", "[::1]"]);

export function json(body: unknown, status = 200): Response {
  return Response.json(body, { status });
}

function errorResponse(code: SandboxErrorCode, message: string): Response {
  return json({ error: { code, message } }, statusByCode[code]);
}

export async function parseBody<T extends z.ZodType>(schema: T, request: Request): Promise<z.infer<T>> {
  const body = await request.json().catch(() => {
    throw new SandboxError("invalid_request", "Request body must be valid JSON");
  });
  const result = schema.safeParse(body);
  if (!result.success) {
    const issue = result.error.issues[0];
    throw new SandboxError("invalid_request", `${issue.path.join(".") || "body"}: ${issue.message}`);
  }
  return result.data;
}

// Hashing first gives equal-length inputs, so the comparison time never depends on the token.
function tokenMatches(presented: string, token: string): boolean {
  const digest = (value: string) => createHash("sha256").update(value).digest();
  return timingSafeEqual(digest(presented), digest(token));
}

// The guard runs before any route: the bearer token separates host callers from guests that
// forge local headers over the NAT gateway; the Host allowlist and JSON-only bodies stop
// browser pages (DNS rebinding, cross-site simple requests). No route sends CORS headers.
function guard(request: Request, token: string): Response | null {
  const presented = request.headers.get("authorization")?.match(/^Bearer (.+)$/)?.[1];
  if (!presented || !tokenMatches(presented, token)) {
    return errorResponse("unauthorized", "Missing or invalid sandbox token");
  }
  const hostname = request.headers.get("host")?.replace(/:\d+$/, "");
  if (!hostname || !LOCAL_HOSTNAMES.has(hostname)) {
    return errorResponse("forbidden", "sandboxd only accepts requests addressed to localhost");
  }
  if (request.method !== "GET" && request.method !== "DELETE" && !request.headers.get("content-type")?.startsWith("application/json")) {
    return errorResponse("invalid_request", "Content-Type must be application/json");
  }
  return null;
}

export function createHandler({ token, routes }: { token: string; routes: Route[] }) {
  const allRoutes: Route[] = [
    { method: "GET", pattern: /^\/healthz$/, handle: async () => json({ ok: true }) },
    ...routes,
  ];

  return async (request: Request): Promise<Response> => {
    const rejected = guard(request, token);
    if (rejected) return rejected;

    const { pathname } = new URL(request.url);
    for (const route of allRoutes) {
      const match = route.method === request.method ? route.pattern.exec(pathname) : null;
      if (!match) continue;
      try {
        return await route.handle(request, match.slice(1).map(decodeURIComponent));
      } catch (error) {
        if (error instanceof SandboxError) return errorResponse(error.code, error.message);
        console.error(`Unexpected error in ${request.method} ${pathname}`, error);
        return errorResponse("internal_error", "Unexpected server error");
      }
    }
    return errorResponse("not_found", `No route for ${request.method} ${pathname}`);
  };
}

// Bridges node:http to the fetch-style handler. The body stays a stream, so nothing is read
// before the guard passes; a client disconnect aborts request.signal so routes can cancel work.
export function serve(handler: (request: Request) => Promise<Response>, port: number): Promise<Server> {
  const server = createServer(async (req, res) => {
    const controller = new AbortController();
    res.on("close", () => {
      if (!res.writableFinished) controller.abort();
    });
    const headers = new Headers();
    for (const [name, value] of Object.entries(req.headers)) {
      if (typeof value === "string") headers.set(name, value);
    }
    const hasBody = req.method !== "GET" && req.method !== "HEAD";
    const request = new Request(`http://127.0.0.1:${port}${req.url}`, {
      method: req.method,
      headers,
      signal: controller.signal,
      ...(hasBody && { body: Readable.toWeb(req) as ReadableStream, duplex: "half" }),
    } as RequestInit);
    const response = await handler(request);
    res.writeHead(response.status, Object.fromEntries(response.headers));
    res.end(Buffer.from(await response.arrayBuffer()));
  });
  return new Promise((resolve) => server.listen(port, "127.0.0.1", () => resolve(server)));
}
