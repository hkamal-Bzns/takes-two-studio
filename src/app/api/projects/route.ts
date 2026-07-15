import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { checkAdmin } from "@/lib/auth";

/**
 * GET /api/projects?category=advertising
 *   Public — returns published projects (with images) for the gallery.
 * POST /api/projects
 *   Admin — creates a project. Body: { title, category, coverImage, description?, order? }
 */
export async function GET(req: NextRequest) {
  const category = req.nextUrl.searchParams.get("category");
  const where: { published?: boolean; category?: string; overview?: boolean } = { published: true };
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
      include: { images: { orderBy: { order: "asc" } } },
    });
    projects = flagged.length > 0 ? flagged : await db.project.findMany({
      where,
      orderBy: [{ order: "asc" }, { createdAt: "desc" }],
      include: { images: { orderBy: { order: "asc" } } },
    });
  } else {
    projects = await db.project.findMany({
      where,
      orderBy: [{ order: "asc" }, { createdAt: "desc" }],
      include: { images: { orderBy: { order: "asc" } } },
    });
  }
  return NextResponse.json({ projects });
}

export async function POST(req: NextRequest) {
  if (!checkAdmin(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = await req.json();
  const { title, category, coverImage, description, order, featured, overview } = body;
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
      featured: typeof featured === "boolean" ? featured : false,
      overview: typeof overview === "boolean" ? overview : false,
    },
  });
  return NextResponse.json({ project }, { status: 201 });
}
