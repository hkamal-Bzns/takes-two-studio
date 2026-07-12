import { NextRequest } from "next/server";

/**
 * Simple admin auth helpers.
 * The token is the "password" used to log into /admin.
 */
export const ADMIN_TOKEN = process.env.ADMIN_TOKEN || "takes-two-admin-2024";

export function checkAdmin(req: NextRequest): boolean {
  const auth = req.headers.get("authorization");
  if (auth === `Bearer ${ADMIN_TOKEN}`) return true;
  const cookie = req.headers.get("cookie") || "";
  return cookie.includes(`admin_token=${ADMIN_TOKEN}`);
}
