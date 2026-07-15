import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { checkAdmin } from "@/lib/auth";

/**
 * PATCH /api/overview/reorder — admin. Body: { order: ["itemId1","itemId2",...] }
 */
export async function PATCH(req: NextRequest) {
  if (!checkAdmin(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { order } = await req.json();
  if (!Array.isArray(order)) {
    return NextResponse.json({ error: "order array is required" }, { status: 400 });
  }
  await db.$transaction(
    order.map((id: string, i: number) =>
      db.overviewItem.update({ where: { id }, data: { order: i } })
    )
  );
  return NextResponse.json({ ok: true });
}
