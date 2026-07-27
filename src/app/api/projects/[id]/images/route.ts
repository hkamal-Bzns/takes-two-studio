import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { checkAdmin } from "@/lib/auth";
import { pickDerivatives } from "@/lib/images";

/**
 * POST /api/projects/[id]/images   — admin, add an image to a project.
 *   Body: { url, caption?, order?, srcsetAvif?, srcsetWebp?, width?, height? }
 *   The derivative fields are optional; null means "render the plain url".
 */
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  if (!checkAdmin(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await ctx.params;
  const body = await req.json();
  const { url, caption, order } = body;
  if (!url) return NextResponse.json({ error: "url is required" }, { status: 400 });
  const image = await db.projectImage.create({
    data: {
      projectId: id,
      url,
      caption: caption ?? null,
      order: typeof order === "number" ? order : 0,
      ...pickDerivatives(body),
    },
  });
  return NextResponse.json({ image }, { status: 201 });
}
