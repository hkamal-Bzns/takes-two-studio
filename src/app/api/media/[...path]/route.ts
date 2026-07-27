import { NextRequest, NextResponse } from "next/server";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { Readable } from "node:stream";
import path from "node:path";
import { mediaRoot } from "@/lib/images";

export const runtime = "nodejs";

/**
 * GET /api/media/<...path> — serves files from MEDIA_ROOT.
 *
 * Uploads live outside the application directory so a redeploy cannot delete
 * them, which means they can't be served from /public. This route bridges that.
 *
 * If you'd rather skip the Node hop, map the path in the Caddyfile instead:
 *
 *   handle_path /api/media/* {
 *     root * /home/USER/domains/takestwostudio.com/media
 *     file_server
 *     header Cache-Control "public, max-age=31536000, immutable"
 *   }
 */

const CONTENT_TYPES: Record<string, string> = {
  ".avif": "image/avif",
  ".webp": "image/webp",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".tif": "image/tiff",
  ".tiff": "image/tiff",
};

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ path: string[] }> }
) {
  const { path: segments } = await params;

  const root = (() => {
    try {
      return mediaRoot();
    } catch {
      return null;
    }
  })();
  if (!root) return NextResponse.json({ error: "Storage not configured" }, { status: 500 });

  // Resolve, then confirm the result is still inside MEDIA_ROOT. This is what
  // stops ../../etc/passwd style traversal.
  const target = path.resolve(root, ...segments);
  const rootResolved = path.resolve(root);
  if (target !== rootResolved && !target.startsWith(rootResolved + path.sep)) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  let info;
  try {
    info = await stat(target);
  } catch {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  if (!info.isFile()) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const ext = path.extname(target).toLowerCase();
  const contentType = CONTENT_TYPES[ext];
  if (!contentType) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const stream = Readable.toWeb(createReadStream(target)) as ReadableStream;

  return new NextResponse(stream, {
    headers: {
      "Content-Type": contentType,
      "Content-Length": String(info.size),
      // Filenames contain a UUID, so content never changes under a given URL.
      "Cache-Control": "public, max-age=31536000, immutable",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
