import { NextRequest, NextResponse } from "next/server";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { db } from "@/lib/db";
import { checkAdmin, unauthorized } from "@/lib/auth";
import {
  bundleIdFromUrl,
  mediaRoot,
  regenerateBundle,
  sniffFormat,
  MAX_UPLOAD_BYTES,
} from "@/lib/images";

export const runtime = "nodejs";
export const maxDuration = 120;

/**
 * POST /api/projects/[id]/images/[imageId]/master
 *   Admin — attach the studio's original file to an image that has none,
 *   multipart/form-data with field "file".
 *
 * The image keeps its id, its position and its urls. The original is stored as
 * the bundle's master and the derivatives are re-encoded in place from it, so
 * every existing reference — including OverviewItem rows and any project cover
 * pointing at this url — keeps working and simply gets better pixels.
 *
 * Refuses when the image already has a master: replacing one silently would
 * discard an original that cannot be recovered.
 */
export async function POST(req: NextRequest, ctx: { params: Promise<{ imageId: string }> }) {
  if (!checkAdmin(req)) return unauthorized();
  const { imageId } = await ctx.params;

  const image = await db.projectImage.findUnique({ where: { id: imageId } });
  if (!image) return NextResponse.json({ error: "Image not found" }, { status: 404 });
  if (image.masterUrl) {
    return NextResponse.json(
      { error: "This image already has an original on file." },
      { status: 409 }
    );
  }

  const bundleId = bundleIdFromUrl(image.url);
  if (!bundleId) {
    return NextResponse.json(
      { error: "This image is not a pipeline image, so it has no bundle to attach an original to." },
      { status: 400 }
    );
  }

  let formData: FormData;
  try {
    formData = await req.formData();
  } catch {
    return NextResponse.json({ error: "Invalid form data" }, { status: 400 });
  }
  const file = formData.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "file is required" }, { status: 400 });
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    return NextResponse.json(
      { error: `File is ${(file.size / 1048576).toFixed(1)} MB. The limit is ${MAX_UPLOAD_BYTES / 1048576} MB.` },
      { status: 413 }
    );
  }

  const buf = Buffer.from(await file.arrayBuffer());
  const format = sniffFormat(buf);
  if (!format) {
    return NextResponse.json(
      { error: "Not a recognised image (expected JPEG, PNG, WebP, AVIF or TIFF)" },
      { status: 415 }
    );
  }

  try {
    // Master filename is the bundle id, which is the convention processUpload
    // established and what findMaster() looks for.
    const ext = format === "jpeg" ? "jpg" : format;
    const masterDir = path.join(mediaRoot(), "masters");
    await mkdir(masterDir, { recursive: true });
    await writeFile(path.join(masterDir, `${bundleId}.${ext}`), buf);

    const result = await regenerateBundle(bundleId);

    const updated = await db.projectImage.update({
      where: { id: imageId },
      data: {
        srcsetAvif: result.srcsetAvif,
        srcsetWebp: result.srcsetWebp,
        width: result.width,
        height: result.height,
        masterUrl: result.master.url,
        masterBytes: result.master.bytes,
      },
    });

    return NextResponse.json({ image: updated, regenerated: result.wrote }, { status: 201 });
  } catch (err) {
    console.error("[master] attach failed:", err);
    const message = err instanceof Error ? err.message : "Processing failed";
    return NextResponse.json(
      { error: message.includes("MEDIA_ROOT") ? "Storage is not configured" : "Processing failed" },
      { status: 500 }
    );
  }
}
