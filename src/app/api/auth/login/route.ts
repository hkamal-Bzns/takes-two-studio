import { NextRequest, NextResponse } from "next/server";
import {
  SESSION_COOKIE,
  createSessionToken,
  verifyPassword,
  checkAdmin,
} from "@/lib/auth";

/**
 * POST /api/auth/login  — { password } -> sets a signed session cookie
 * GET  /api/auth/login  — { admin: boolean }
 */

// Simple in-memory throttle. Resets on restart, which is fine for a single
// small instance; move to the database or Redis if you ever run more than one.
const attempts = new Map<string, { count: number; first: number }>();
const WINDOW_MS = 15 * 60 * 1000;
const MAX_ATTEMPTS = 8;

function rateLimited(ip: string): boolean {
  const now = Date.now();
  // Evict windows that have already expired, so a spray of distinct IPs cannot
  // grow the map without bound. Deleting during Map iteration is safe.
  for (const [key, rec] of attempts) {
    if (now - rec.first > WINDOW_MS) attempts.delete(key);
  }
  const rec = attempts.get(ip);
  if (!rec || now - rec.first > WINDOW_MS) {
    attempts.set(ip, { count: 1, first: now });
    return false;
  }
  rec.count += 1;
  return rec.count > MAX_ATTEMPTS;
}

// NOTE: the limiter trusts x-forwarded-for, which is client-controlled unless
// the reverse proxy overwrites it — Caddy must be configured to set it.
function clientIp(req: NextRequest): string {
  return (
    req.headers.get("x-forwarded-for")?.split(",")[0].trim() ||
    req.headers.get("x-real-ip") ||
    "unknown"
  );
}

export async function POST(req: NextRequest) {
  const ip = clientIp(req);
  if (rateLimited(ip)) {
    return NextResponse.json(
      { error: "Too many attempts. Try again later." },
      { status: 429 }
    );
  }

  let password: unknown;
  try {
    ({ password } = await req.json());
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  let ok = false;
  let session: { token: string; maxAge: number } | null = null;
  try {
    ok = verifyPassword(password);
    // Minted inside the same guard: createSessionToken() needs SESSION_SECRET
    // and throws the same config error if it is missing or too short.
    if (ok) session = createSessionToken();
  } catch {
    // ADMIN_PASSWORD / SESSION_SECRET missing — fail closed, don't leak why.
    console.error("[auth] server is misconfigured: missing ADMIN_PASSWORD or SESSION_SECRET");
    return NextResponse.json({ error: "Server misconfigured" }, { status: 500 });
  }

  if (!ok || !session) {
    return NextResponse.json({ error: "Invalid password" }, { status: 401 });
  }

  attempts.delete(ip);

  const res = NextResponse.json({ ok: true });
  res.cookies.set(SESSION_COOKIE, session.token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: session.maxAge,
  });
  return res;
}

export async function GET(req: NextRequest) {
  return NextResponse.json({ admin: checkAdmin(req) });
}
