import sharp from "sharp";
import { mkdir, writeFile, readFile, readdir, stat } from "node:fs/promises";
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

/**
 * The large rungs are the ones anyone actually inspects — the hero fills the
 * viewport with them and the lightbox loads the widest on zoom — so they get a
 * higher AVIF quality than the browsing sizes.
 *
 * 60 is right for a 640px thumbnail and visibly thin at 4500px on a good
 * display. The widths below 2400 are unchanged: raising them would cost
 * bandwidth on every grid view for a difference nobody sees at that size.
 */
const AVIF_QUALITY_LARGE = 72;
const LARGE_RUNG_FROM = 2400;
const avifQualityFor = (width: number) =>
  width >= LARGE_RUNG_FROM ? AVIF_QUALITY_LARGE : AVIF_QUALITY;

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
  master: { url: string; width: number; height: number; bytes: number; format: string; space: string };
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
        .avif({ quality: avifQualityFor(width), chromaSubsampling: "4:4:4", effort: 2 })
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
      space: masterColourSpace(meta),
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
/**
 * The bundle id inside a derivative url, or null if it is not one of ours.
 * `/api/media/derivatives/<id>/3200.webp` -> `<id>`.
 *
 * The bundle id and the master's filename are the same value — processUpload
 * uses one uuid for both — so this is also how you find an image's original.
 */
export function bundleIdFromUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  const m = url.match(/\/api\/media\/derivatives\/([0-9a-fA-F-]{36})\//);
  return m ? m[1] : null;
}

/** The master file on disk for a bundle id, or null when there is none. */
export async function findMaster(
  bundleId: string
): Promise<{ absPath: string; url: string; bytes: number } | null> {
  const dir = path.join(mediaRoot(), "masters");
  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch {
    return null;
  }
  // Extensions vary (jpg/png/webp/…), so match on the id rather than guessing.
  const name = entries.find((f) => f.startsWith(bundleId + "."));
  if (!name) return null;
  const absPath = path.join(dir, name);
  const info = await stat(absPath);
  return { absPath, url: `/api/media/masters/${name}`, bytes: info.size };
}

export type RegenerateResult = DerivativeFields & {
  bundleId: string;
  master: { url: string; bytes: number; width: number; height: number; space: string };
  wrote: number;
};

/**
 * Re-encode a bundle's derivatives from its master, in place.
 *
 * In place matters: OverviewItem rows and Project.coverImage both reference
 * derivative urls as plain strings. Writing a new bundle id would leave every
 * one of those pointing at the old files, so the same id is reused and the
 * files are overwritten. Callers therefore do not need to update any url.
 *
 * Throws if the bundle has no master — regeneration never invents an original,
 * and never re-encodes a derivative into another derivative.
 */
export async function regenerateBundle(bundleId: string): Promise<RegenerateResult> {
  const master = await findMaster(bundleId);
  if (!master) throw new Error(`no master on file for ${bundleId}`);

  const buf = await readFile(master.absPath);
  const meta = await sharp(buf, { failOn: "none" }).metadata();
  if (!meta.width || !meta.height) throw new Error(`unreadable master for ${bundleId}`);

  const derivDir = path.join(mediaRoot(), "derivatives", bundleId);
  await mkdir(derivDir, { recursive: true });

  const widths = DERIVATIVE_WIDTHS.filter((w) => w <= meta.width!);
  if (widths.length === 0) widths.push(meta.width as never);

  const encoded = await Promise.all(
    widths.map(async (width) => {
      const base = () =>
        sharp(buf, { failOn: "none" })
          .rotate()
          .resize({ width, withoutEnlargement: true })
          .withIccProfile("srgb");
      const avifBuf = await base()
        .avif({ quality: avifQualityFor(width), chromaSubsampling: "4:4:4", effort: 2 })
        .toBuffer();
      const webpBuf = AVIF_ONLY_WIDTHS.has(width)
        ? null
        : await base().webp({ quality: WEBP_QUALITY, smartSubsample: true }).toBuffer();
      return { width, avifBuf, webpBuf };
    })
  );

  const avif: Derivative[] = [];
  const webp: Derivative[] = [];
  let wrote = 0;
  for (const { width, avifBuf, webpBuf } of encoded) {
    await writeFile(path.join(derivDir, `${width}.avif`), avifBuf);
    avif.push({ width, url: `/api/media/derivatives/${bundleId}/${width}.avif`, bytes: avifBuf.length });
    wrote++;
    if (webpBuf) {
      await writeFile(path.join(derivDir, `${width}.webp`), webpBuf);
      webp.push({ width, url: `/api/media/derivatives/${bundleId}/${width}.webp`, bytes: webpBuf.length });
      wrote++;
    }
  }

  const srcset = (list: Derivative[]) => list.map((d) => `${d.url} ${d.width}w`).join(", ");
  return {
    bundleId,
    srcsetAvif: srcset(avif),
    srcsetWebp: srcset(webp),
    width: meta.width,
    height: meta.height,
    master: { url: master.url, bytes: master.bytes, width: meta.width, height: meta.height, space: masterColourSpace(meta) },
    wrote,
  };
}

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

/**
 * The master-file columns. Kept separate from pickDerivatives because only
 * ProjectImage carries them — Project has no master, its cover points at an
 * image that does.
 */
export type MasterFields = {
  masterUrl: string | null;
  masterBytes: number | null;
};

export function pickMaster(body: unknown): MasterFields {
  const b = (body ?? {}) as Record<string, unknown>;
  const master = (b.master ?? {}) as Record<string, unknown>;
  // Accept either a flat masterUrl/masterBytes or the manifest's nested
  // `master` object, so callers can pass an upload manifest straight through.
  const url = typeof b.masterUrl === "string" && b.masterUrl.trim() !== ""
    ? b.masterUrl
    : typeof master.url === "string" && master.url.trim() !== ""
      ? master.url
      : null;
  const rawBytes = b.masterBytes ?? master.bytes;
  const bytes =
    typeof rawBytes === "number" && Number.isFinite(rawBytes) && rawBytes > 0
      ? Math.round(rawBytes)
      : null;
  // Bytes without a url is meaningless; never store a half-record.
  return url ? { masterUrl: url, masterBytes: bytes } : { masterUrl: null, masterBytes: null };
}

/* ---------------------------------------------------------------------------
 * Colour space of a master
 *
 * Derivatives are always written with `.withIccProfile("srgb")`, so what the
 * visitor sees is sRGB whatever the master was. That conversion is only correct
 * if sharp knows the source space, which it does when the master carries an ICC
 * profile. Two kinds of master cause trouble:
 *
 *   - CMYK, which is a print file with no business in a web pipeline;
 *   - a wide-gamut profile (Adobe RGB, Display P3, ProPhoto), which converts
 *     correctly but signals that the export settings were wrong for the web.
 *
 * An untagged RGB master is a third case: sharp and every browser assume sRGB,
 * which is usually right and occasionally silently wrong. Worth surfacing, not
 * worth alarming about.
 * ------------------------------------------------------------------------- */

/** Decode a UTF-16BE run, which Node cannot read directly. */
function utf16be(buf: Buffer, start: number, len: number): string {
  const end = Math.min(buf.length, start + len);
  const swapped = Buffer.from(buf.subarray(start, end));
  if (swapped.length % 2 !== 0) return "";
  swapped.swap16();
  return swapped.toString("utf16le").replace(/\0+$/, "");
}

/** Read the human-readable name out of an ICC profile's `desc` tag. */
function iccDescription(icc: Buffer): string | null {
  try {
    if (icc.length < 132) return null;
    const tagCount = icc.readUInt32BE(128);
    if (tagCount < 1 || tagCount > 200) return null;
    for (let i = 0; i < tagCount; i++) {
      const entry = 132 + i * 12;
      if (entry + 12 > icc.length) break;
      if (icc.toString("ascii", entry, entry + 4) !== "desc") continue;

      const start = icc.readUInt32BE(entry + 4);
      const size = icc.readUInt32BE(entry + 8);
      if (start + Math.min(size, 12) > icc.length) return null;
      const type = icc.toString("ascii", start, start + 4);

      // ICC v2 'desc': 4 signature + 4 reserved + 4 ASCII length, then the text.
      if (type === "desc") {
        const len = icc.readUInt32BE(start + 8);
        const text = icc.toString("ascii", start + 12, start + 12 + Math.max(0, len - 1));
        return text.trim() || null;
      }
      // ICC v4 'mluc': record table at +12; the first record is enough to label it.
      if (type === "mluc") {
        const records = icc.readUInt32BE(start + 8);
        if (records < 1) return null;
        const len = icc.readUInt32BE(start + 20);
        const off = icc.readUInt32BE(start + 24);
        return utf16be(icc, start + off, len).trim() || null;
      }
      return null;
    }
  } catch {
    /* a malformed profile is not a reason to fail an upload */
  }
  return null;
}

/** True when a profile name denotes plain sRGB rather than a wider space. */
function looksLikeSrgb(name: string | null): boolean {
  if (!name) return false;
  return /s[\s._-]?rgb/i.test(name) || /^iec[\s._-]?61966/i.test(name);
}

/**
 * A short, storable label for a master's colour space:
 *   "srgb"     — sRGB, by profile
 *   "untagged" — RGB carrying no profile; assumed sRGB, usually correct
 *   "cmyk"     — a print file
 * anything else is the profile's own name, e.g. "Adobe RGB (1998)".
 */
export function masterColourSpace(meta: { space?: string; icc?: Buffer }): string {
  if (meta.space === "cmyk") return "cmyk";
  if (!meta.icc) return "untagged";
  const name = iccDescription(meta.icc);
  if (looksLikeSrgb(name)) return "srgb";
  return name || "untagged";
}

/** Whether a stored colour-space label is one the admin should leave alone. */
export function colourSpaceIsSafe(space: string | null | undefined): boolean {
  return !space || space === "srgb" || space === "untagged";
}
