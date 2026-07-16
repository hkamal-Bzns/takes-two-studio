import { NextRequest, NextResponse } from "next/server";
import { writeFile, mkdir } from "fs/promises";
import path from "path";
import { checkAdmin } from "@/lib/auth";

/**
 * POST /api/upload   — admin, multipart/form-data with field "file".
 * Saves to /public/uploads/<uuid>.<ext> and returns the public URL.
 */
export async function POST(req: NextRequest) {
  if (!checkAdmin(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const formData = await req.formData();
  const file = formData.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "file is required" }, { status: 400 });
  }

  const ext = (file.name.split(".").pop() || "jpg").toLowerCase().replace(/[^a-z0-9]/g, "");
  const safeExt = ["jpg", "jpeg", "png", "webp", "gif", "avif"].includes(ext) ? ext : "jpg";
  const filename = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}.${safeExt}`;

  const uploadsDir = path.join(process.cwd(), "public", "uploads");
  await mkdir(uploadsDir, { recursive: true });

  const bytes = await file.arrayBuffer();
  await writeFile(path.join(uploadsDir, filename), Buffer.from(bytes));

  return NextResponse.json({ url: `/uploads/${filename}`, filename });
}
