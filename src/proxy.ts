import { NextResponse, type NextRequest } from "next/server";

const LOCAL_HOSTNAMES = new Set(["127.0.0.1", "localhost", "[::1]"]);

// Single access gate for every API route. Rejecting non-local Host headers
// blocks DNS-rebinding pages from driving the API through the user's browser.
// Requiring JSON on POST forces a CORS preflight, which fails because no route
// sends CORS headers, so other sites can't fire "simple" requests at the API.
export function proxy(request: NextRequest) {
  const hostname = request.headers.get("host")?.replace(/:\d+$/, "");
  if (!hostname || !LOCAL_HOSTNAMES.has(hostname)) {
    return NextResponse.json(
      { error: { code: "forbidden", message: "Spekter only accepts requests addressed to localhost" } },
      { status: 403 },
    );
  }
  if (request.method === "POST" && !request.headers.get("content-type")?.startsWith("application/json")) {
    return NextResponse.json(
      { error: { code: "invalid_request", message: "Content-Type must be application/json" } },
      { status: 400 },
    );
  }
  return NextResponse.next();
}

export const config = {
  matcher: "/api/:path*",
};
