import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile, access } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { mediaRoot } from "./images";

/**
 * Site icon generation.
 *
 * One square source produces the whole set a browser might ask for. The source
 * is either an uploaded icon or, until one is uploaded, the brand wordmark the
 * site already uses as its favicon — so shipping this feature does not change
 * what anybody sees.
 *
 * Everything is generated once per source and cached on disk under MEDIA_ROOT,
 * never in public/: a redeploy replaces that directory and the icons would
 * vanish with it.
 */

/** The set of files a source produces. Keys are the public filenames. */
export const ICON_FILES = [
  "favicon.ico",
  "favicon-32.png",
  "apple-touch-icon.png",
  "icon-192.png",
  "icon-512.png",
] as const;
export type IconFile = (typeof ICON_FILES)[number];

/** PNG sizes, keyed by the filename each one is written to. */
const PNG_SIZES: Record<Exclude<IconFile, "favicon.ico">, number> = {
  "favicon-32.png": 32,
  "apple-touch-icon.png": 180,
  "icon-192.png": 192,
  "icon-512.png": 512,
};

/** Sizes embedded in favicon.ico. 16 and 32 is what Windows and tabs ask for. */
const ICO_SIZES = [16, 32];

/** Accepted uploads. SVG is allowed here even though it is not in the photo
 *  pipeline's list: an icon is exactly the case where a vector source is the
 *  right thing to hand over. */
export const ICON_MAX_BYTES = 8 * 1024 * 1024;

/** The wordmark the site used as its favicon before this feature existed. */
const FALLBACK_SOURCE = path.join(process.cwd(), "public", "brand", "logo.webp");

/**
 * Pack PNG buffers into an ICO container.
 *
 * sharp cannot write .ico and the format does not warrant a dependency: an ICO
 * is a 6-byte header, one 16-byte directory entry per image, then the image
 * data. Since Windows Vista that data may be a PNG rather than a BMP, which is
 * what every current browser expects, so the PNGs go in verbatim.
 */
export function encodeIco(images: { size: number; png: Buffer }[]): Buffer {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // 1 = icon
  header.writeUInt16LE(images.length, 4);

  const entries: Buffer[] = [];
  let offset = 6 + images.length * 16;

  for (const { size, png } of images) {
    const e = Buffer.alloc(16);
    // 0 means 256 in this field; nothing here is that large, but be correct.
    e.writeUInt8(size >= 256 ? 0 : size, 0);
    e.writeUInt8(size >= 256 ? 0 : size, 1);
    e.writeUInt8(0, 2); // palette size, 0 for non-palletised
    e.writeUInt8(0, 3); // reserved
    e.writeUInt16LE(1, 4); // colour planes
    e.writeUInt16LE(32, 6); // bits per pixel
    e.writeUInt32LE(png.length, 8);
    e.writeUInt32LE(offset, 12);
    entries.push(e);
    offset += png.length;
  }

  return Buffer.concat([header, ...entries, ...images.map((i) => i.png)]);
}

/**
 * Render one square PNG from a source buffer.
 *
 * `contain` rather than `cover`: a source that is not square gets letterboxed
 * on transparency instead of having its edges cropped off. That matters for the
 * fallback, which is a wide wordmark — cropping it would cut the name in half.
 */
async function square(buf: Buffer, size: number): Promise<Buffer> {
  return sharp(buf, { failOn: "none", density: 384 })
    .resize(size, size, {
      fit: "contain",
      background: { r: 0, g: 0, b: 0, alpha: 0 },
      withoutEnlargement: false,
    })
    .withIccProfile("srgb")
    .png({ compressionLevel: 9 })
    .toBuffer();
}

/** Where a given source's generated set lives. */
function versionDir(version: string): string {
  return path.join(mediaRoot(), "icons", version);
}

const exists = (p: string) => access(p).then(() => true, () => false);

/**
 * Generate the whole set for a source buffer and write it under `version`.
 * Safe to call repeatedly: it returns early once the set is on disk.
 */
export async function generateIconSet(buf: Buffer, version: string): Promise<void> {
  const dir = versionDir(version);
  if (await exists(path.join(dir, "favicon.ico"))) return;
  await mkdir(dir, { recursive: true });

  // Sequential on purpose. This runs on shared hosting and one icon is five
  // small renders — there is nothing to gain from doing them at once, and the
  // upload path is the one place a burst would collide with a visitor request.
  for (const [name, size] of Object.entries(PNG_SIZES)) {
    await writeFile(path.join(dir, name), await square(buf, size));
  }

  const ico: { size: number; png: Buffer }[] = [];
  for (const size of ICO_SIZES) ico.push({ size, png: await square(buf, size) });
  await writeFile(path.join(dir, "favicon.ico"), encodeIco(ico));
}

/**
 * The version id currently in force, generating its files if they are missing.
 * `uploaded` is the value of the siteIcon setting, or null when none has been
 * uploaded — in which case the brand wordmark stands in, under a version id
 * derived from its bytes so a change to that file regenerates the set.
 */
export async function ensureIconSet(uploaded: string | null): Promise<string | null> {
  try {
    // The upload wrote the set. If the directory has since gone, the setting is
    // stale — fall through to the wordmark rather than serving nothing, so a
    // lost MEDIA_ROOT costs the site its custom icon and not its icon entirely.
    if (uploaded && (await exists(path.join(versionDir(uploaded), "favicon.ico")))) {
      return uploaded;
    }
    const buf = await readFile(FALLBACK_SOURCE);
    const version = "brand-" + createHash("sha1").update(buf).digest("hex").slice(0, 12);
    await generateIconSet(buf, version);
    return version;
  } catch {
    return null;
  }
}

/** Read one generated file. Returns null if it is not there. */
export async function readIconFile(version: string, file: IconFile): Promise<Buffer | null> {
  try {
    return await readFile(path.join(versionDir(version), file));
  } catch {
    return null;
  }
}

/** Store an uploaded icon: writes the set and returns its new version id. */
export async function storeUploadedIcon(buf: Buffer): Promise<string> {
  const version = createHash("sha1").update(buf).digest("hex").slice(0, 16);
  await generateIconSet(buf, version);
  return version;
}
