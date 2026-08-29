import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { checkAdmin, unauthorized } from "@/lib/auth";
import { bundleIdFromUrl, findMaster, regenerateBundle } from "@/lib/images";

export const runtime = "nodejs";
export const maxDuration = 300;

/** How many images one call will re-encode. Kept small on purpose — see below. */
const DEFAULT_BATCH = 5;
const MAX_BATCH = 20;

/**
 * GET  /api/images/regenerate  — admin, how much work is outstanding.
 * POST /api/images/regenerate  — admin, re-encode one batch.
 *   Body: { limit?: number, cursor?: string }
 *
 * Batched deliberately. Re-encoding one 4500px master is ~15s of AVIF on this
 * hardware even after dropping effort to 2, and the upload route's own budget
 * is 120s — a single call over the whole library would run for hours and be
 * killed halfway with no record of where it stopped.
 *
 * Only images that have a master are touched. The other 528 have no original on
 * this server and one cannot be reconstructed from a derivative, so they are
 * counted and skipped rather than re-encoded from their own output, which would
 * degrade them while appearing to be maintenance.
 *
 * Regeneration is in place: same bundle id, same urls, same filenames. Nothing
 * that references an image url needs updating, so a half-finished run leaves a
 * consistent site — some images simply have better pixels than others.
 */
export async function GET(req: NextRequest) {
  if (!checkAdmin(req)) return unauthorized();

  const images = await db.projectImage.findMany({
    where: { url: { startsWith: "/api/media/derivatives/" } },
    select: { id: true, url: true, masterUrl: true },
    orderBy: { id: "asc" },
  });

  let withMaster = 0;
  for (const img of images) if (img.masterUrl) withMaster++;

  return NextResponse.json({
    total: images.length,
    withMaster,
    withoutMaster: images.length - withMaster,
    batchSize: DEFAULT_BATCH,
  });
}

export async function POST(req: NextRequest) {
  if (!checkAdmin(req)) return unauthorized();

  const body = await req.json().catch(() => ({}));
  const limit = Math.min(
    MAX_BATCH,
    Math.max(1, typeof body.limit === "number" ? Math.round(body.limit) : DEFAULT_BATCH)
  );
  const cursor: string | null = typeof body.cursor === "string" && body.cursor ? body.cursor : null;

  // Ordered by id so the cursor is stable across calls even as rows change.
  const candidates = await db.projectImage.findMany({
    where: {
      url: { startsWith: "/api/media/derivatives/" },
      masterUrl: { not: null },
      ...(cursor ? { id: { gt: cursor } } : {}),
    },
    select: { id: true, url: true },
    orderBy: { id: "asc" },
    take: limit,
  });

  const done: string[] = [];
  const failed: { id: string; error: string }[] = [];
  let lastId: string | null = cursor;

  for (const img of candidates) {
    lastId = img.id;
    const bundleId = bundleIdFromUrl(img.url);
    if (!bundleId) {
      failed.push({ id: img.id, error: "not a pipeline url" });
      continue;
    }
    try {
      const result = await regenerateBundle(bundleId);
      // Widths and urls are unchanged by an in-place regen, but the master's
      // recorded size can drift if the file was replaced, so keep it honest.
      await db.projectImage.update({
        where: { id: img.id },
        data: {
          srcsetAvif: result.srcsetAvif,
          srcsetWebp: result.srcsetWebp,
          width: result.width,
          height: result.height,
          masterBytes: result.master.bytes,
        },
      });
      done.push(img.id);
    } catch (err) {
      failed.push({ id: img.id, error: err instanceof Error ? err.message : "failed" });
    }
  }

  const remaining = await db.projectImage.count({
    where: {
      url: { startsWith: "/api/media/derivatives/" },
      masterUrl: { not: null },
      ...(lastId ? { id: { gt: lastId } } : {}),
    },
  });

  return NextResponse.json({
    processed: done.length,
    failed,
    cursor: lastId,
    remaining,
    finished: remaining === 0,
  });
}

/**
 * Backfill helper: find masters for images that have one on disk but no
 * masterUrl recorded. Runs as part of the regenerate GET so the admin can show
 * an accurate count without a separate script.
 */
export async function PUT(req: NextRequest) {
  if (!checkAdmin(req)) return unauthorized();

  const images = await db.projectImage.findMany({
    where: { url: { startsWith: "/api/media/derivatives/" }, masterUrl: null },
    select: { id: true, url: true },
  });

  let linked = 0;
  for (const img of images) {
    const bundleId = bundleIdFromUrl(img.url);
    if (!bundleId) continue;
    const master = await findMaster(bundleId);
    if (!master) continue;
    await db.projectImage.update({
      where: { id: img.id },
      data: { masterUrl: master.url, masterBytes: master.bytes },
    });
    linked++;
  }

  return NextResponse.json({ scanned: images.length, linked });
}
