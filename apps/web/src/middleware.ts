import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { isTrustedAdminRequest } from "@/lib/same-origin";

/**
 * Centralized same-origin gate for the admin API. Route-level guards handle
 * WHO may act (session + role); this handles WHERE the request came from, so
 * a cross-origin form POST carrying an admin's ambient session cookie (e.g.
 * from a compromised sibling subdomain — SameSite=Lax does not cover that)
 * can never reach a mutating handler. See src/lib/same-origin.ts for the
 * exact policy. Rejections use the admin surface's fail-closed 404 shape so
 * probers learn nothing.
 *
 * NOTE: Next 16 renamed this convention to `proxy.ts`, and this file's name
 * triggers a deprecation warning at build time. It stays `middleware.ts`
 * deliberately: with Next 16.2.10's Turbopack production build, a
 * `proxy.ts` (src/ or root, named or default export) compiles but is NEVER
 * registered in middleware-manifest.json — i.e. the gate would silently not
 * run in production — while `middleware.ts` registers correctly (verified
 * empirically against both manifests). Rename to proxy.ts only after
 * confirming the manifest actually picks it up on the then-current Next.
 */
export function middleware(request: NextRequest) {
  if (!isTrustedAdminRequest(request.method, request.headers, request.nextUrl.origin)) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  return NextResponse.next();
}

export const config = {
  matcher: "/api/admin/:path*",
};
