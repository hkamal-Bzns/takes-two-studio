import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { checkAdmin, unauthorized } from "@/lib/auth";
import { sniffFormat } from "@/lib/images";
import { ICON_MAX_BYTES, storeUploadedIcon } from "@/lib/icons";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * POST /api/icon — admin only, multipart/form-data with field "file".
 *
 * Takes one square source and writes the whole icon set from it, then records
 * the new version in the `siteIcon` setting. Until this is called, the icon
 * routes render from the brand wordmark, so the site keeps the icon it has.
 */
export async function POST(req: NextRequest) {
  if (!checkAdmin(req)) return unauthorized();

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
  if (file.size > ICON_MAX_BYTES) {
    return NextResponse.json(
      { error: `Icon is ${(file.size / 1048576).toFixed(1)} MB. The limit is ${ICON_MAX_BYTES / 1048576} MB.` },
      { status: 413 }
    );
  }

  const buf = Buffer.from(await file.arrayBuffer());

  // SVG has no magic number to sniff, so it is detected by its own shape. Every
  // other format is checked by bytes rather than filename, as everywhere else.
  const head = buf.subarray(0, 512).toString("utf8").trimStart();
  const isSvg = head.startsWith("<svg") || (head.startsWith("<?xml") && head.includes("<svg"));
  const raster = sniffFormat(buf);
  if (!isSvg && raster !== "png" && raster !== "webp" && raster !== "jpeg") {
    return NextResponse.json(
      { error: "Upload a PNG or SVG (JPEG and WebP also work). Square, 512×512 or larger." },
      { status: 415 }
    );
  }

  let version: string;
  try {
    version = await storeUploadedIcon(buf);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Could not read that image";
    return NextResponse.json({ error: message }, { status: 500 });
  }

  await db.siteSetting.upsert({
    where: { key: "siteIcon" },
    create: { key: "siteIcon", value: version },
    update: { value: version },
  });

  return NextResponse.json({ siteIcon: version }, { status: 201 });
}
