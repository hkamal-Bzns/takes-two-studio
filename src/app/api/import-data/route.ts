import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { checkAdmin } from "@/lib/auth";

/**
 * POST /api/import-data — imports projects, overview items, and clients from a JSON payload.
 * Body: { projects: [...], overviewItems: [...], clients: [...] }
 * Admin-only. Used to migrate data from local to the live server.
 */
export async function POST(req: NextRequest) {
  if (!checkAdmin(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const body = await req.json();
    const log: string[] = [];

    // Import projects
    if (Array.isArray(body.projects)) {
      log.push(`Importing ${body.projects.length} projects...`);
      let projectCount = 0;
      for (const p of body.projects) {
        if (!p.title || !p.category || !p.coverImage) continue;
        const project = await db.project.create({
          data: {
            title: p.title,
            category: p.category,
            coverImage: p.coverImage,
            description: p.description || null,
            order: p.order || 0,
            published: p.published ?? true,
            featured: p.featured ?? false,
            overview: p.overview ?? false,
          },
        });
        // Add images
        if (Array.isArray(p.images)) {
          for (const img of p.images) {
            if (img.url) {
              await db.projectImage.create({
                data: {
                  projectId: project.id,
                  url: img.url,
                  caption: img.caption || null,
                  order: img.order || 0,
                },
              });
            }
          }
        }
        projectCount++;
      }
      log.push(`  ✓ ${projectCount} projects imported`);
    }

    // Import overview items
    if (Array.isArray(body.overviewItems)) {
      log.push(`Importing ${body.overviewItems.length} overview items...`);
      let ovCount = 0;
      for (const it of body.overviewItems) {
        if (!it.url) continue;
        await db.overviewItem.create({
          data: {
            url: it.url,
            projectId: it.projectId || null,
            caption: it.caption || null,
            order: it.order || 0,
          },
        });
        ovCount++;
      }
      log.push(`  ✓ ${ovCount} overview items imported`);
    }

    // Import clients (replace existing)
    if (Array.isArray(body.clients) && body.clients.length > 0) {
      log.push(`Importing ${body.clients.length} clients...`);
      await db.client.deleteMany();
      let clCount = 0;
      for (const c of body.clients) {
        if (!c.name) continue;
        await db.client.create({
          data: {
            name: c.name,
            logo: c.logo || null,
            order: c.order || 0,
          },
        });
        clCount++;
      }
      log.push(`  ✓ ${clCount} clients imported`);
    }

    log.push("");
    log.push("=== Import complete! ===");
    return NextResponse.json({ success: true, log });
  } catch (error) {
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  }
}
