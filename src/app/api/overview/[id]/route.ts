import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { checkAdmin } from "@/lib/auth";
import { pickFocus } from "@/lib/images";

/**
 * DELETE /api/overview/[id]  — admin, remove an overview item
 * PATCH  /api/overview/[id]  — admin, update caption, projectId and/or the
 *                              focal point the homepage grid crops around
 */
export async function DELETE(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  if (!checkAdmin(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await ctx.params;
  await db.overviewItem.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  if (!checkAdmin(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await ctx.params;
  const body = await req.json();
  const data: {
    caption?: string | null;
    projectId?: string | null;
    focusX?: number;
    focusY?: number;
  } = {};
  if ("caption" in body) data.caption = body.caption || null;
  if ("projectId" in body) data.projectId = body.projectId || null;
  // Clamped, and only when sent — same reasoning as on a project cover.
  if ("focusX" in body || "focusY" in body) {
    const focus = pickFocus(body);
    if ("focusX" in body) data.focusX = focus.focusX;
    if ("focusY" in body) data.focusY = focus.focusY;
  }
  const item = await db.overviewItem.update({ where: { id }, data });
  return NextResponse.json({ item });
}
