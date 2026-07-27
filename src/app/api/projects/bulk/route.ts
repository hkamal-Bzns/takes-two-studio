import { NextRequest, NextResponse } from "next/server";
import type { Project } from "@prisma/client";
import { db } from "@/lib/db";
import { checkAdmin } from "@/lib/auth";
import { pickDerivatives } from "@/lib/images";

/**
 * POST /api/projects/bulk
 *   Admin — create multiple projects at once. Each item becomes a project
 *   with the given url as both coverImage and first gallery image.
 *   Body: { items: [{ title, category, url }] }
 *   Returns { created: Project[] }
 */
export async function POST(req: NextRequest) {
  if (!checkAdmin(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { items } = await req.json();
  if (!Array.isArray(items) || items.length === 0) {
    return NextResponse.json({ error: "items array is required" }, { status: 400 });
  }

  const created: Project[] = [];
  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    if (!it.title || !it.category || !it.url) continue;
    // determine order = count of existing projects in that category
    const existing = await db.project.count({ where: { category: it.category } });
    // The same upload manifest backs both the cover and the first gallery
    // image, so both rows get the same derivatives.
    const derivatives = pickDerivatives(it);
    const project = await db.project.create({
      data: {
        title: it.title,
        category: it.category,
        coverImage: it.url,
        order: existing,
        published: true,
        ...derivatives,
      },
    });
    await db.projectImage.create({
      data: { projectId: project.id, url: it.url, order: 0, ...derivatives },
    });
    created.push(project);
  }

  return NextResponse.json({ created }, { status: 201 });
}
