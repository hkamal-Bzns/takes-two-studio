import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { checkAdmin } from "@/lib/auth";
import type { DerivativeFields } from "@/lib/images";

const NO_DERIVATIVES: DerivativeFields = {
  srcsetAvif: null,
  srcsetWebp: null,
  width: null,
  height: null,
};

/**
 * GET /api/overview   — public, returns ordered overview items, each carrying
 *                       srcsetAvif / srcsetWebp / width / height.
 * POST /api/overview  — admin, add an item. Body: { url, projectId?, caption? }
 */
export async function GET() {
  const items = await db.overviewItem.findMany({
    orderBy: { order: "asc" },
  });
  if (items.length === 0) return NextResponse.json({ items });

  // An OverviewItem stores only a url — it is a curated pointer at an image
  // that already exists on a project. The derivatives for that url therefore
  // live on the ProjectImage (or Project cover) it was picked from, so they are
  // resolved here rather than copied onto OverviewItem, where the two sets
  // could drift apart after a re-upload.
  const urls = [...new Set(items.map((i) => i.url))];
  const [images, projects] = await Promise.all([
    db.projectImage.findMany({
      where: { url: { in: urls }, NOT: { srcsetAvif: null } },
      select: { url: true, srcsetAvif: true, srcsetWebp: true, width: true, height: true },
    }),
    db.project.findMany({
      where: { coverImage: { in: urls }, NOT: { srcsetAvif: null } },
      select: { coverImage: true, srcsetAvif: true, srcsetWebp: true, width: true, height: true },
    }),
  ]);

  const byUrl = new Map<string, DerivativeFields>();
  // Covers first, then gallery images, so a ProjectImage row wins a tie.
  for (const p of projects) {
    byUrl.set(p.coverImage, {
      srcsetAvif: p.srcsetAvif,
      srcsetWebp: p.srcsetWebp,
      width: p.width,
      height: p.height,
    });
  }
  for (const img of images) {
    byUrl.set(img.url, {
      srcsetAvif: img.srcsetAvif,
      srcsetWebp: img.srcsetWebp,
      width: img.width,
      height: img.height,
    });
  }

  // Anything with no match keeps explicit nulls, which is the signal to render
  // the plain url. Only keys are added here, never removed or renamed, so the
  // existing public/index.html consumer is unaffected.
  const enriched = items.map((item) => ({
    ...item,
    ...(byUrl.get(item.url) ?? NO_DERIVATIVES),
  }));

  return NextResponse.json({ items: enriched });
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
