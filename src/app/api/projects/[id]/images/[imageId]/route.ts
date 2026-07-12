import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { checkAdmin } from "@/lib/auth";

/**
 * DELETE /api/projects/[id]/images/[imageId]  — admin, remove an image from a project.
 */
export async function DELETE(req: NextRequest, ctx: { params: Promise<{ id: string; imageId: string }> }) {
  if (!checkAdmin(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { imageId } = await ctx.params;
  await db.projectImage.delete({ where: { id: imageId } });
  return NextResponse.json({ ok: true });
}
