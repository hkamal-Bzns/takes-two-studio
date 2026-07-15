import { NextResponse } from "next/server";
import { db } from "@/lib/db";

/**
 * GET /api/export-data — exports ALL projects (with images), overview items,
 * and clients as JSON. Used to migrate data to the live server.
 */
export async function GET() {
  const projects = await db.project.findMany({
    orderBy: [{ order: "asc" }, { createdAt: "desc" }],
    include: { images: { orderBy: { order: "asc" } } },
  });
  const overviewItems = await db.overviewItem.findMany({
    orderBy: { order: "asc" },
  });
  const clients = await db.client.findMany({
    orderBy: { order: "asc" },
  });

  return NextResponse.json({
    projects: projects.map(p => ({
      title: p.title,
      category: p.category,
      coverImage: p.coverImage,
      description: p.description,
      order: p.order,
      published: p.published,
      featured: p.featured,
      overview: p.overview,
      images: p.images.map(img => ({ url: img.url, caption: img.caption, order: img.order })),
    })),
    overviewItems: overviewItems.map(it => ({
      url: it.url,
      projectId: it.projectId,
      caption: it.caption,
      order: it.order,
    })),
    clients: clients.map(c => ({
      name: c.name,
      logo: c.logo,
      order: c.order,
    })),
  });
}
