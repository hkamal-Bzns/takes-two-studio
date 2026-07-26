import { NextRequest } from "next/server";
import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Admin auth.
 *
 * Two secrets, both REQUIRED as environment variables — there is deliberately
 * no fallback value. If either is missing the app fails closed.
 *
 *   ADMIN_PASSWORD  the password typed into the /admin login screen
 *   SESSION_SECRET  random 32+ byte string used to sign session cookies
 *
 * The session cookie is NOT the password. It is a signed, expiring token, so
 * a leaked cookie cannot be replayed forever and does not reveal the password.
 */

export const SESSION_COOKIE = "tts_session";
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 7; // 7 days

class ConfigError extends Error {}

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v || v.length < 8) {
    throw new ConfigError(
      `${name} is not set (or is too short). Set it in the hosting environment panel.`
    );
  }
  return v;
}

/** Timing-safe string comparison. Returns false on any length mismatch. */
function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a, "utf8");
  const bb = Buffer.from(b, "utf8");
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

function sign(payload: string): string {
  return createHmac("sha256", requireEnv("SESSION_SECRET"))
    .update(payload)
    .digest("hex");
}

/** Mint a session token valid for SESSION_TTL_SECONDS. */
export function createSessionToken(): { token: string; maxAge: number } {
  const exp = Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS;
  const payload = `v1.${exp}`;
  return { token: `${payload}.${sign(payload)}`, maxAge: SESSION_TTL_SECONDS };
}

/** Verify a session token's signature and expiry. */
export function verifySessionToken(token: string | undefined): boolean {
  if (!token) return false;
  const parts = token.split(".");
  if (parts.length !== 3 || parts[0] !== "v1") return false;

  const exp = Number(parts[1]);
  if (!Number.isFinite(exp) || exp <= Math.floor(Date.now() / 1000)) return false;

  try {
    return safeEqual(parts[2], sign(`v1.${exp}`));
  } catch (e) {
    if (e instanceof ConfigError) return false;
    throw e;
  }
}

/** Check the submitted login password against ADMIN_PASSWORD. */
export function verifyPassword(password: unknown): boolean {
  if (typeof password !== "string") return false;
  return safeEqual(password, requireEnv("ADMIN_PASSWORD"));
}

/**
 * Parse cookies properly rather than using String.includes(), which would
 * match a token appearing anywhere in the header.
 */
function readCookie(req: NextRequest, name: string): string | undefined {
  const direct = req.cookies.get(name)?.value;
  if (direct) return direct;

  const header = req.headers.get("cookie");
  if (!header) return undefined;
  for (const pair of header.split(";")) {
    const idx = pair.indexOf("=");
    if (idx === -1) continue;
    if (pair.slice(0, idx).trim() === name) {
      return decodeURIComponent(pair.slice(idx + 1).trim());
    }
  }
  return undefined;
}

/**
 * Returns true only for a request carrying a valid, unexpired session cookie.
 * Fails closed if SESSION_SECRET is missing.
 */
export function checkAdmin(req: NextRequest): boolean {
  return verifySessionToken(readCookie(req, SESSION_COOKIE));
}

/** Standard 401 body, so every route responds identically. */
export function unauthorized() {
  return Response.json({ error: "Unauthorized" }, { status: 401 });
}
