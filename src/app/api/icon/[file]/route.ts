import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { ICON_FILES, IconFile, ensureIconSet, readIconFile } from "@/lib/icons";

export const runtime = "nodejs";

/**
 * GET /api/icon/<file> — public.
 *
 * Serves the generated site icons and the web manifest. Public by design: a
 * favicon is fetched by the browser before anything else and reveals nothing.
 * These are the only icon URLs the pages reference, so the <head> can stay
 * static while the artwork behind it changes with an upload.
 */

const CONTENT_TYPES: Record<string, string> = {
  "favicon.ico": "image/x-icon",
  "favicon-32.png": "image/png",
  "apple-touch-icon.png": "image/png",
  "icon-192.png": "image/png",
  "icon-512.png": "image/png",
};

/** Cache long enough to be useful, briefly enough that an upload shows up.
 *  The bytes behind a given URL do change — the URL has no version in it — so
 *  `immutable` would be wrong here. */
const CACHE = "public, max-age=3600, must-revalidate, no-transform";

async function currentVersion(): Promise<string | null> {
  // A favicon is the first thing a browser asks for and the least important
  // thing on the page — it must not be able to fail loudly. If the settings
  // lookup is unavailable, fall back to the brand icon rather than erroring.
  let uploaded: string | null = null;
  try {
    const row = await db.siteSetting.findUnique({ where: { key: "siteIcon" } });
    uploaded = row?.value?.trim() || null;
  } catch {
    uploaded = null;
  }
  return ensureIconSet(uploaded);
}

export async function GET(_req: NextRequest, ctx: { params: Promise<{ file: string }> }) {
  const { file } = await ctx.params;

  const version = await currentVersion();
  if (!version) return NextResponse.json({ error: "Not found" }, { status: 404 });

  if (file === "site.webmanifest") {
    const manifest = {
      name: "Takes Two Studio",
      short_name: "Takes Two",
      start_url: "/",
      display: "standalone",
      background_color: "#0a0a0a",
      theme_color: "#0a0a0a",
      icons: [
        { src: "/api/icon/icon-192.png", sizes: "192x192", type: "image/png" },
        { src: "/api/icon/icon-512.png", sizes: "512x512", type: "image/png" },
      ],
    };
    // Its own media type, not application/json — which is what the spec asks
    // for and what `rel="manifest"` is checked against.
    return new NextResponse(JSON.stringify(manifest), {
      headers: {
        "Content-Type": "application/manifest+json",
        "Cache-Control": CACHE,
        ETag: `"${version}-manifest"`,
      },
    });
  }

  if (!(ICON_FILES as readonly string[]).includes(file)) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const body = await readIconFile(version, file as IconFile);
  if (!body) return NextResponse.json({ error: "Not found" }, { status: 404 });

  return new NextResponse(new Uint8Array(body), {
    headers: {
      "Content-Type": CONTENT_TYPES[file],
      "Content-Length": String(body.length),
      "Cache-Control": CACHE,
      // The version id is the hash of the source, so this changes exactly when
      // the artwork does and a revalidation costs one 304.
      ETag: `"${version}-${file}"`,
      "X-Content-Type-Options": "nosniff",
    },
  });
}
