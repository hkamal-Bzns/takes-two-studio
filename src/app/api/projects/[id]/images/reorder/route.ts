import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { checkAdmin } from "@/lib/auth";

/**
 * PATCH /api/projects/[id]/images/reorder
 *   Admin — reorders images. Body: { order: ["imgId1","imgId2",...] }
 *   Updates each image's `order` field to match its position in the array.
 */
export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  if (!checkAdmin(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await ctx.params;
  const { order } = await req.json();
  if (!Array.isArray(order) || order.length === 0) {
    return NextResponse.json({ error: "order array is required" }, { status: 400 });
  }

  // Update each image's order in a transaction
  await db.$transaction(
    order.map((imageId: string, i: number) =>
      db.projectImage.updateMany({ where: { id: imageId, projectId: id }, data: { order: i } })
    )
  );

  return NextResponse.json({ ok: true });
}
