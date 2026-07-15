import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { checkAdmin } from "@/lib/auth";

/**
 * GET /api/settings   — public, returns sections + clients + siteSettings (key/value).
 * PATCH /api/settings — admin, updates sections AND/OR siteSettings.
 *   Body: { sections?: [...], siteSettings?: { key: value, ... } }
 */
export async function GET() {
  const sections = await db.siteSection.findMany({ orderBy: { order: "asc" } });
  const clients = await db.client.findMany({ orderBy: { order: "asc" } });
  const settingRows = await db.siteSetting.findMany();
  // turn into a plain object { heroTitle: "...", logo: "...", ... }
  const siteSettings: Record<string, string> = {};
  for (const s of settingRows) siteSettings[s.key] = s.value;
  return NextResponse.json({ sections, clients, siteSettings });
}

export async function PATCH(req: NextRequest) {
  if (!checkAdmin(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = await req.json();

  // update sections
  if (Array.isArray(body.sections)) {
    for (const s of body.sections) {
      const data: Record<string, unknown> = {};
      if (typeof s.label === "string") data.label = s.label;
      if (typeof s.visible === "boolean") data.visible = s.visible;
      if (typeof s.order === "number") data.order = s.order;
      if (Object.keys(data).length && s.id) {
        await db.siteSection.update({ where: { id: s.id }, data });
      }
    }
  }

  // update site settings (key/value)
  if (body.siteSettings && typeof body.siteSettings === "object") {
    for (const [key, value] of Object.entries(body.siteSettings)) {
      if (typeof value === "string") {
        await db.siteSetting.upsert({
          where: { key },
          create: { key, value },
          update: { value },
        });
      }
    }
  }

  const updated = await db.siteSection.findMany({ orderBy: { order: "asc" } });
  const settingRows = await db.siteSetting.findMany();
  const siteSettings: Record<string, string> = {};
  for (const s of settingRows) siteSettings[s.key] = s.value;
  return NextResponse.json({ sections: updated, siteSettings });
}
