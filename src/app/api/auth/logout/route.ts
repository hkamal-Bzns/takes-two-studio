import { NextResponse } from "next/server";
import { SESSION_COOKIE } from "@/lib/auth";

/** POST /api/auth/logout — clears the session cookie */
export async function POST() {
  const res = NextResponse.json({ ok: true });
  // Overwrite with an expired cookie carrying the same attributes the login
  // route set, so the browser reliably drops it.
  res.cookies.set(SESSION_COOKIE, "", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 0,
  });
  return res;
}
