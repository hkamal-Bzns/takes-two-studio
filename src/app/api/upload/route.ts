import { NextRequest, NextResponse } from "next/server";
import { checkAdmin, unauthorized } from "@/lib/auth";
import { processUpload, sniffFormat, MAX_UPLOAD_BYTES } from "@/lib/images";

export const runtime = "nodejs";
export const maxDuration = 120; // AVIF encoding at 3200px is not instant

/**
 * POST /api/upload — admin only, multipart/form-data with field "file".
 *
 * Stores the uploaded file as an untouched master and returns a manifest of
 * AVIF + WebP derivatives ready to drop into a <picture> element.
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

  if (file.size > MAX_UPLOAD_BYTES) {
    return NextResponse.json(
      {
        error: `File is ${(file.size / 1048576).toFixed(1)} MB. The limit is ${
          MAX_UPLOAD_BYTES / 1048576
        } MB — export at 3200px on the long edge.`,
      },
      { status: 413 }
    );
  }

  const buf = Buffer.from(await file.arrayBuffer());

  // Validate the actual bytes, not the filename. The existing library is full
  // of WebP files named .jpg, which is exactly what extension-trust produces.
  const format = sniffFormat(buf);
  if (!format) {
    return NextResponse.json(
      { error: "Not a recognised image (expected JPEG, PNG, WebP, AVIF or TIFF)" },
      { status: 415 }
    );
  }

  try {
    const result = await processUpload(buf, file.name);
    return NextResponse.json(result, { status: 201 });
  } catch (err) {
    console.error("[upload] failed:", err);
    const message = err instanceof Error ? err.message : "Processing failed";
    // MEDIA_ROOT misconfiguration is the most likely cause — say so plainly
    // in the log, but don't leak paths to the client.
    return NextResponse.json(
      { error: message.includes("MEDIA_ROOT") ? "Storage is not configured" : "Processing failed" },
      { status: 500 }
    );
  }
}
