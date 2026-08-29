import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { checkAdmin } from "@/lib/auth";
import { pickDerivatives } from "@/lib/images";

/**
 * GET /api/projects/[id]            — public, single project + images
 * PATCH /api/projects/[id]          — admin, update project fields
 * DELETE /api/projects/[id]         — admin, delete project (cascades images)
 */
export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  // Same rule as the list route: cover-only images are part of the cover, not
  // the gallery, so the public sees the project without them. This is the
  // route the static site calls when it opens a project.
  const imageWhere = checkAdmin(req) ? undefined : { coverOnly: false };
  const project = await db.project.findUnique({
    where: { id },
    include: { images: { where: imageWhere, orderBy: { order: "asc" } } },
  });
  if (!project) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ project });
}

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  if (!checkAdmin(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await ctx.params;
  const body = await req.json();
  const data: Record<string, unknown> = {};
  for (const k of ["title", "category", "coverImage", "description", "order", "published", "featured", "overview"]) {
    if (k in body) data[k] = body[k];
  }
  // Derivatives travel with coverImage: if the cover is being replaced, the
  // srcsets for the old cover must not survive it. Explicit nulls are honoured
  // so re-uploading a non-pipeline image clears stale derivative data.
  if ("coverImage" in body || "srcsetAvif" in body) {
    Object.assign(data, pickDerivatives(body));
  }
  const project = await db.project.update({ where: { id }, data });
  return NextResponse.json({ project });
}

export async function DELETE(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  if (!checkAdmin(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await ctx.params;
  await db.project.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
