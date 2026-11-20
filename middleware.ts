import { NextResponse, type NextRequest } from "next/server";

/**
 * Edge gate: pages without a session cookie go to /login. Real verification happens server-side
 * (SQLite isn't available on the edge); API routes answer 401 themselves.
 * Also issues a per-request nonce CSP (#110, NFR-05): Next.js applies the nonce to its own inline
 * hydration scripts automatically; no third-party script/style/font origins are allowed.
 */
const PUBLIC = ["/login", "/setup", "/healthz", "/offline", "/api/auth/login", "/api/setup"];

function csp(nonce: string): string {
  const dev = process.env.NODE_ENV === "development" ? " 'unsafe-eval'" : "";
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${dev}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self'",
    // browser push services (web push subscription, #109)
    "connect-src 'self' https://fcm.googleapis.com https://*.push.services.mozilla.com https://updates.push.services.mozilla.com https://web.push.apple.com",
    "worker-src 'self'",
    "manifest-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join("; ");
}

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  if (pathname.startsWith("/api/")) return NextResponse.next();

  const nonce = btoa(crypto.randomUUID());
  const policy = csp(nonce);
  const h = new Headers(req.headers);
  h.set("x-nonce", nonce);
  h.set("Content-Security-Policy", policy);
  h.set("x-pathname", pathname);

  if (!PUBLIC.some((p) => pathname === p || pathname.startsWith(`${p}/`)) && !req.cookies.get("ascent_session")) {
    const url = req.nextUrl.clone();
    url.pathname = "/login";
    url.search = pathname !== "/" ? `?next=${encodeURIComponent(pathname)}` : "";
    const redirect = NextResponse.redirect(url);
    redirect.headers.set("Content-Security-Policy", policy);
    return redirect;
  }
  const res = NextResponse.next({ request: { headers: h } });
  res.headers.set("Content-Security-Policy", policy);
  return res;
}

export const config = { matcher: ["/((?!_next/|favicon|icons/|art/|fonts/|sw\\.js|manifest\\.webmanifest).*)"] };