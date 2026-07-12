import { NextResponse } from "next/server";

/** POST /api/auth/logout — clears the admin_token cookie */
export async function POST() {
  const res = NextResponse.json({ ok: true });
  res.cookies.delete("admin_token");
  return res;
}
