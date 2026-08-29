import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { checkAdmin } from "@/lib/auth";

/**
 * PATCH /api/projects/[id]/images/[imageId]  — admin, update one image.
 *   Body: { useMaster?: boolean, caption?: string | null }
 *
 * `useMaster` is the Sharpest setting. It is refused when the image has no
 * master on file, rather than stored and silently ignored by the front end —
 * an image with useMaster true and masterUrl null would look enabled in the
 * admin while changing nothing for visitors.
 */
export async function PATCH(req: NextRequest, ctx: { params: Promise<{ imageId: string }> }) {
  if (!checkAdmin(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { imageId } = await ctx.params;
  const body = await req.json();

  const data: { useMaster?: boolean; caption?: string | null } = {};

  if ("useMaster" in body) {
    if (typeof body.useMaster !== "boolean") {
      return NextResponse.json({ error: "useMaster must be a boolean" }, { status: 400 });
    }
    if (body.useMaster) {
      const existing = await db.projectImage.findUnique({
        where: { id: imageId },
        select: { masterUrl: true },
      });
      if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });
      if (!existing.masterUrl) {
        return NextResponse.json(
          { error: "This image has no original on file. Upload the original first." },
          { status: 409 }
        );
      }
    }
    data.useMaster = body.useMaster;
  }

  if ("caption" in body) {
    data.caption = typeof body.caption === "string" && body.caption.trim() !== "" ? body.caption : null;
  }

  if (Object.keys(data).length === 0) {
    return NextResponse.json({ error: "nothing to update" }, { status: 400 });
  }

  const image = await db.projectImage.update({ where: { id: imageId }, data });
  return NextResponse.json({ image });
}

/**
 * DELETE /api/projects/[id]/images/[imageId]  — admin, remove an image from a project.
 */
export async function DELETE(req: NextRequest, ctx: { params: Promise<{ id: string; imageId: string }> }) {
  if (!checkAdmin(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { imageId } = await ctx.params;
  await db.projectImage.delete({ where: { id: imageId } });
  return NextResponse.json({ ok: true });
}
