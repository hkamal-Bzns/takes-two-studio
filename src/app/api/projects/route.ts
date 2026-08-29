import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { checkAdmin } from "@/lib/auth";
import { pickDerivatives, pickFocus, pickPortrait } from "@/lib/images";

/**
 * GET /api/projects?category=advertising
 *   Public — returns published projects (with images) for the gallery.
 *   Projects and their images carry srcsetAvif / srcsetWebp / width / height,
 *   which are null for anything uploaded before the image pipeline existed.
 *   Consumers must fall back to `coverImage` / `url` when srcsetAvif is null.
 * POST /api/projects
 *   Admin — creates a project.
 *   Body: { title, category, coverImage, description?, order?,
 *           srcsetAvif?, srcsetWebp?, width?, height? }
 */
export async function GET(req: NextRequest) {
  const category = req.nextUrl.searchParams.get("category");
  // `includeUnpublished=1` is admin-only and opt-in: the admin panel needs to
  // see drafts, otherwise unticking Published makes a project vanish from the
  // only screen that could bring it back. Falls through to published-only for
  // anyone without a session, so the public site is unaffected either way.
  const includeUnpublished =
    req.nextUrl.searchParams.get("includeUnpublished") === "1" && checkAdmin(req);
  const where: { published?: boolean; category?: string; overview?: boolean } =
    includeUnpublished ? {} : { published: true };
  // Cover-only images exist so a cover has a record (original, quality
  // setting); they are not pictures the studio chose to exhibit. Filtering
  // here rather than in the front end keeps the gallery, the image count and
  // the lightbox consistent — they all read this one array.
  const imageWhere = includeUnpublished ? undefined : { coverOnly: false };
  if (category && category !== "overview" && category !== "all") {
    where.category = category;
  }
  // For the Overview homepage: prefer projects flagged `overview`.
  // If none are flagged yet, fall back to all published (so the page is never empty).
  let projects;
  if (category === "overview") {
    const flagged = await db.project.findMany({
      where: { ...where, overview: true },
      orderBy: [{ order: "asc" }, { createdAt: "desc" }],
      include: { images: { where: imageWhere, orderBy: { order: "asc" } } },
    });
    projects = flagged.length > 0 ? flagged : await db.project.findMany({
      where,
      orderBy: [{ order: "asc" }, { createdAt: "desc" }],
      include: { images: { where: imageWhere, orderBy: { order: "asc" } } },
    });
  } else {
    projects = await db.project.findMany({
      where,
      orderBy: [{ order: "asc" }, { createdAt: "desc" }],
      include: { images: { where: imageWhere, orderBy: { order: "asc" } } },
    });
  }
  return NextResponse.json({ projects });
}

export async function POST(req: NextRequest) {
  if (!checkAdmin(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = await req.json();
  const { title, category, coverImage, description, order, published, featured, overview } = body;
  if (!title || !category || !coverImage) {
    return NextResponse.json({ error: "title, category, coverImage are required" }, { status: 400 });
  }
  const project = await db.project.create({
    data: {
      title,
      category,
      coverImage,
      description: description ?? null,
      order: typeof order === "number" ? order : 0,
      // `published` was previously dropped here, so unticking Published on a
      // new project silently fell through to the schema default of true.
      published: typeof published === "boolean" ? published : true,
      featured: typeof featured === "boolean" ? featured : false,
      overview: typeof overview === "boolean" ? overview : false,
      // Derivatives for coverImage, when the caller uploaded through the
      // pipeline. All null when it didn't — coverImage still renders.
      ...pickDerivatives(body),
      // Centre crop unless the caller nominated a focal point.
      ...pickFocus(body),
      // The optional tall crop for the hero on upright phones.
      ...pickPortrait(body),
    },
  });
  return NextResponse.json({ project }, { status: 201 });
}
