import { NextResponse, type NextRequest } from "next/server";

const LOCAL_HOSTNAMES = new Set(["127.0.0.1", "localhost", "[::1]"]);

// Single access gate for every API route. Rejecting non-local Host headers
// blocks DNS-rebinding pages from driving the API through the user's browser.
export function proxy(request: NextRequest) {
  const hostname = request.headers.get("host")?.replace(/:\d+$/, "");
  if (!hostname || !LOCAL_HOSTNAMES.has(hostname)) {
    return NextResponse.json(
      { error: { code: "forbidden", message: "Spekter only accepts requests addressed to localhost" } },
      { status: 403 },
    );
  }
  return NextResponse.next();
}

export const config = {
  matcher: "/api/:path*",
};
