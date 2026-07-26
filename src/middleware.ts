import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

/**
 * Edge guard for the admin dashboard.
 *
 * Checks only for the presence of a session cookie — cryptographic verification
 * happens in the route/action via `auth()` / `requireAdmin()`. That split is
 * deliberate: the middleware runs on every matched request and should stay
 * cheap, while the real authorisation decision is made where the data is
 * touched. A forged cookie gets past middleware and is then rejected by
 * `requireAdmin()`.
 */
const SESSION_COOKIES = [
  "authjs.session-token",
  "__Secure-authjs.session-token",
  // NextAuth v4 names, in case an older cookie is still in the browser.
  "next-auth.session-token",
  "__Secure-next-auth.session-token",
];

export function middleware(request: NextRequest) {
  const hasSession = SESSION_COOKIES.some((name) => request.cookies.has(name));

  if (!hasSession) {
    const loginUrl = new URL("/login", request.url);
    // Bounce the operator back where they were headed after signing in.
    loginUrl.searchParams.set("next", request.nextUrl.pathname);
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
}

export const config = {
  // Everything under /admin. The login page itself lives at /login so it is
  // never matched here (which would be a redirect loop).
  matcher: ["/admin", "/admin/:path*"],
};
