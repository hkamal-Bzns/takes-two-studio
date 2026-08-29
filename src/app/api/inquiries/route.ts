import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { checkAdmin } from "@/lib/auth";

/**
 * GET /api/inquiries — admin, list all inquiries (newest first).
 *
 * There is no POST any more: the public contact form was removed, so nothing
 * creates inquiries. This route stays so previously submitted ones remain
 * readable in the admin panel. It is admin-only, and was never public.
 */
export async function GET(req: NextRequest) {
  if (!checkAdmin(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const status = req.nextUrl.searchParams.get("status");
  const where: { status?: string } = {};
  if (status) where.status = status;
  const inquiries = await db.inquiry.findMany({
    where,
    orderBy: { createdAt: "desc" },
  });
  return NextResponse.json({ inquiries });
}
