import sharp from "sharp";
import { mkdir, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";

/**
 * Image pipeline for Takes Two Studio.
 *
 * Principle: the uploaded file is preserved byte-for-byte as the "master" and
 * never served to browsers. Everything visitors see is a derivative generated
 * from that master, so quality decisions are always reversible — change the
 * settings below, re-run the pipeline, and every image on the site improves
 * without re-uploading anything.
 *
 * Colour: derivatives are converted to sRGB with the profile EMBEDDED. This is
 * the fix for the 324 existing images that have their ICC profile stripped.
 * Without an embedded profile a browser guesses sRGB, and anything exported in
 * Adobe RGB renders with shifted colour — unacceptable for food and product work.
 *
 * Chroma: 4:4:4 subsampling on both formats. The default 4:2:0 throws away
 * three quarters of the colour information, which shows up as smearing on
 * saturated high-contrast edges — a red can against a dark background, for example.
 */

/**
 * Widths generated for every image. Widths above the master's own width are
 * skipped, so a 3000px master simply stops at 2400.
 *
 * 4500 is the zoom rung. This is a photography portfolio and visitors pixel-peep
 * in the lightbox, so the top rung matches a typical master's long edge rather
 * than stopping at a browsing size. Measured on real project files it costs
 * ~0.72 MB in AVIF — actually less than the 3200 WebP the lightbox used to load.
 */
export const DERIVATIVE_WIDTHS = [640, 1024, 1600, 2400, 3200, 4500] as const;

/**
 * Widths emitted as AVIF only. The zoom rung is fetched by one viewer in a
 * hundred, and only after they choose to zoom, so paying for a second copy in
 * WebP doubles the storage and upload for almost nothing. Browsers without AVIF
 * (~4%, older Safari) fall back to the widest WebP, which is unchanged at 3200 —
 * exactly the behaviour they had before this rung existed.
 */
export const AVIF_ONLY_WIDTHS: ReadonlySet<number> = new Set([4500]);

const AVIF_QUALITY = 60; // AVIF is perceptually stronger; 60 ≈ WebP 84
const WEBP_QUALITY = 84;

/** Reject anything over this. A 3200px master lands well under it. */
export const MAX_UPLOAD_BYTES = 80 * 1024 * 1024; // 80 MB

/**
 * Persistent storage root. MUST be outside the application directory, or every
 * deploy wipes the uploads. On Hostinger use an absolute path under $HOME,
 * e.g. /home/u123456789/domains/takestwostudio.com/media
 */
export function mediaRoot(): string {
  const root = process.env.MEDIA_ROOT;
  if (!root) throw new Error("MEDIA_ROOT is not set");
  return root;
}

export type Derivative = { width: number; url: string; bytes: number };

export type ProcessedImage = {
  id: string;
  master: { url: string; width: number; height: number; bytes: number; format: string };
  avif: Derivative[];
  webp: Derivative[];
  /** Ready-to-use srcset strings for a <picture> element. */
  srcset: { avif: string; webp: string };
  /** Sensible default src for browsers without <picture> support. */
  fallback: string;
  aspectRatio: number;
};

/** Magic-byte sniffing. The filename extension is not trusted. */
export function sniffFormat(buf: Buffer): "jpeg" | "png" | "webp" | "avif" | "tiff" | null {
  if (buf.length < 12) return null;
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "jpeg";
  if (buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])))
    return "png";
  if (buf.subarray(0, 4).toString("ascii") === "RIFF" && buf.subarray(8, 12).toString("ascii") === "WEBP")
    return "webp";
  if (buf.subarray(4, 8).toString("ascii") === "ftyp") {
    const brand = buf.subarray(8, 12).toString("ascii");
    if (brand.startsWith("avif") || brand.startsWith("avis")) return "avif";
  }
  if (
    buf.subarray(0, 4).equals(Buffer.from([0x49, 0x49, 0x2a, 0x00])) ||
    buf.subarray(0, 4).equals(Buffer.from([0x4d, 0x4d, 0x00, 0x2a]))
  )
    return "tiff";
  return null;
}

/**
 * Store the master untouched and generate AVIF + WebP derivatives.
 * Returns everything the front end needs to build a <picture> element.
 */
export async function processUpload(buf: Buffer, originalName: string): Promise<ProcessedImage> {
  const format = sniffFormat(buf);
  if (!format) throw new Error("Unrecognised image format");

  const meta = await sharp(buf, { failOn: "none" }).metadata();
  if (!meta.width || !meta.height) throw new Error("Could not read image dimensions");

  const id = randomUUID();
  const root = mediaRoot();
  const masterDir = path.join(root, "masters");
  const derivDir = path.join(root, "derivatives", id);
  await mkdir(masterDir, { recursive: true });
  await mkdir(derivDir, { recursive: true });

  // 1. Master: exactly the bytes that were uploaded. Never served publicly.
  const masterExt = format === "jpeg" ? "jpg" : format;
  const masterName = `${id}.${masterExt}`;
  await writeFile(path.join(masterDir, masterName), buf);

  // 2. Derivatives.
  const widths = DERIVATIVE_WIDTHS.filter((w) => w <= meta.width!);
  // Always emit at least one, even for a small source image.
  if (widths.length === 0) widths.push(meta.width as never);

  // Every rung is encoded concurrently rather than one after another. The old
  // sequential loop spent 84s on a 4500px master — over two thirds of the
  // route's 120s budget — on a box with 64 cores sitting idle.
  const encoded = await Promise.all(
    widths.map(async (width) => {
      // .rotate() with no argument applies the EXIF orientation flag, so images
      // straight off a camera are not served sideways.
      const base = () =>
        sharp(buf, { failOn: "none" })
          .rotate()
          .resize({ width, withoutEnlargement: true })
          .withIccProfile("srgb");

      // AVIF `effort` only decides how hard the encoder searches for a smaller
      // file; it is not a quality setting — `quality` and the 4:4:4 subsampling
      // below are what govern how the image looks. Dropping 4 -> 2 measured 6x
      // faster on this hardware with the output marginally *smaller*.
      const avifBuf = await base()
        .avif({ quality: AVIF_QUALITY, chromaSubsampling: "4:4:4", effort: 2 })
        .toBuffer();

      // The zoom rung is AVIF only — see AVIF_ONLY_WIDTHS. Skipping WebP here is
      // what keeps `fallback` (and so every stored `url`) pointing at 3200.webp.
      const webpBuf = AVIF_ONLY_WIDTHS.has(width)
        ? null
        : await base().webp({ quality: WEBP_QUALITY, smartSubsample: true }).toBuffer();

      return { width, avifBuf, webpBuf };
    })
  );

  const avif: Derivative[] = [];
  const webp: Derivative[] = [];

  // Written in width order so the srcsets stay narrow -> wide, which the
  // readers that pick "narrowest at least N" depend on.
  for (const { width, avifBuf, webpBuf } of encoded) {
    await writeFile(path.join(derivDir, `${width}.avif`), avifBuf);
    avif.push({ width, url: `/api/media/derivatives/${id}/${width}.avif`, bytes: avifBuf.length });
    if (webpBuf) {
      await writeFile(path.join(derivDir, `${width}.webp`), webpBuf);
      webp.push({ width, url: `/api/media/derivatives/${id}/${width}.webp`, bytes: webpBuf.length });
    }
  }

  const srcset = (list: Derivative[]) => list.map((d) => `${d.url} ${d.width}w`).join(", ");

  return {
    id,
    master: {
      url: `/api/media/masters/${masterName}`,
      width: meta.width,
      height: meta.height,
      bytes: buf.length,
      format,
    },
    avif,
    webp,
    srcset: { avif: srcset(avif), webp: srcset(webp) },
    fallback: webp[webp.length - 1]?.url ?? "",
    aspectRatio: meta.width / meta.height,
  };
}

/**
 * The subset of a ProcessedImage that gets persisted alongside a stored url.
 * A null `srcsetAvif` is the agreed signal for "no derivatives exist, render
 * the plain url" — every reader keys off that rather than off missing keys.
 */
export type DerivativeFields = {
  srcsetAvif: string | null;
  srcsetWebp: string | null;
  width: number | null;
  height: number | null;
};

/**
 * Pull the derivative fields off an untrusted request body, normalising
 * anything absent or malformed to null. Shared by every route that persists an
 * upload manifest, so the null-means-fallback rule is enforced in one place.
 */
export function pickDerivatives(body: unknown): DerivativeFields {
  const b = (body ?? {}) as Record<string, unknown>;
  const str = (v: unknown) => (typeof v === "string" && v.trim() !== "" ? v : null);
  const num = (v: unknown) =>
    typeof v === "number" && Number.isFinite(v) && v > 0 ? Math.round(v) : null;
  return {
    srcsetAvif: str(b.srcsetAvif),
    srcsetWebp: str(b.srcsetWebp),
    width: num(b.width),
    height: num(b.height),
  };
}
