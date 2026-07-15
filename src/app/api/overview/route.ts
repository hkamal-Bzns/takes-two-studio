import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { checkAdmin } from "@/lib/auth";

/**
 * GET /api/overview   — public, returns ordered overview items
 * POST /api/overview  — admin, add an item. Body: { url, projectId?, caption? }
 */
export async function GET() {
  const items = await db.overviewItem.findMany({
    orderBy: { order: "asc" },
  });
  return NextResponse.json({ items });
}

export async function POST(req: NextRequest) {
  if (!checkAdmin(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { url, projectId, caption } = await req.json();
  if (!url) return NextResponse.json({ error: "url is required" }, { status: 400 });
  const count = await db.overviewItem.count();
  const item = await db.overviewItem.create({
    data: {
      url,
      projectId: projectId || null,
      caption: caption || null,
      order: count,
    },
  });
  return NextResponse.json({ item }, { status: 201 });
}
