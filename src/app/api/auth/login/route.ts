import { NextRequest, NextResponse } from "next/server";
import { ADMIN_TOKEN } from "@/lib/auth";

/**
 * POST /api/auth/login  — { password } -> sets admin_token cookie (httpOnly, 7 days)
 * GET  /api/auth/me     — returns { admin: boolean }
 */
export async function POST(req: NextRequest) {
  const { password } = await req.json();
  if (password !== ADMIN_TOKEN) {
    return NextResponse.json({ error: "Invalid password" }, { status: 401 });
  }
  const res = NextResponse.json({ ok: true });
  res.cookies.set("admin_token", ADMIN_TOKEN, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 7,
  });
  return res;
}

export async function GET(req: NextRequest) {
  const cookie = req.headers.get("cookie") || "";
  const isAdmin = cookie.includes(`admin_token=${ADMIN_TOKEN}`);
  return NextResponse.json({ admin: isAdmin });
}
