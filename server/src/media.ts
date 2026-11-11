/**
 * Photos (boss quest, boss checkpoints, a day's Highlight and Notes). Files live under `DATA_DIR/media/` and are
 * NEVER committed, not even to the local data repo: `media/` is in the data repo's `.gitignore` (written by init
 * for new repos, and ensured here before the first file is written for repos initialised before photos existed),
 * and git.ts additionally excludes `media` from `git add`. Pages reference photos by path string only:
 * `media/<YYYY-MM>/<random id>.<jpg|png|webp>`.
 *
 * Orphans are left on disk on purpose: removing a photo from a page only drops the reference. The files are not in
 * git, so the copy on disk is the only one; deleting it would make a git revert of the page (or a hand edit that
 * puts the line back) point at nothing. Abandoned uploads are orphans too. Both are harmless and can be cleaned by
 * hand.
 */
import { randomBytes } from "node:crypto";
import { lstat, mkdir, open, readFile, realpath, rename, rm } from "node:fs/promises";
import { join, sep } from "node:path";
import { LIMITS } from "./domain";
import { withFileLock } from "./store";

export const MEDIA_DIR = "media";

/** The only photo reference format the app writes, accepts on attach, and serves. */
export const MEDIA_PATH_RE = /^media\/(\d{4})-(0[1-9]|1[0-2])\/([A-Za-z0-9_-]{8,64})\.(jpg|png|webp)$/;

export type ImageExt = "jpg" | "png" | "webp";

export const CONTENT_TYPES: Readonly<Record<ImageExt, string>> = {
  jpg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
};

/** The image type by magic bytes (JPEG, PNG, WebP only), or null. The file name and Content-Type are never trusted. */
export function sniffImage(bytes: Uint8Array): ImageExt | null {
  const b = bytes;
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "jpg";
  if (
    b.length >= 8 &&
    b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 &&
    b[4] === 0x0d && b[5] === 0x0a && b[6] === 0x1a && b[7] === 0x0a
  ) {
    return "png";
  }
  const ascii = (from: number, to: number) => String.fromCharCode(...b.subarray(from, to));
  if (b.length >= 12 && ascii(0, 4) === "RIFF" && ascii(8, 12) === "WEBP") return "webp";
  return null;
}

export function isMediaPath(p: unknown): p is string {
  return typeof p === "string" && MEDIA_PATH_RE.test(p);
}

/** Ignore lines that keep `media/` out of git (any of the usual spellings). */
const IGNORE_LINE = /^\/?media\/?(\*\*?)?$/;

/**
 * Make sure `DATA_DIR/.gitignore` lists `media/` (idempotent; appends one line, keeps everything else).
 * Must run before the first file is written under `media/`, because the auto-commit uses `git add -A`.
 */
export async function ensureMediaIgnored(dataDir: string): Promise<boolean> {
  const file = join(dataDir, ".gitignore");
  return withFileLock(file, async () => {
    let text = "";
    try {
      text = await readFile(file, "utf8");
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
    }
    if (text.split(/\r?\n/).some((l) => IGNORE_LINE.test(l.trim()))) return false;
    const eol = /\r\n/.test(text) ? "\r\n" : "\n";
    const sepLine = text === "" || text.endsWith("\n") ? "" : eol;
    const out = `${text}${sepLine}# Photos stay on this machine only (never committed).${eol}media/${eol}`;
    const tmp = `${file}.tmp-${randomBytes(6).toString("hex")}`;
    await writeBytes(tmp, new TextEncoder().encode(out));
    try {
      await rename(tmp, file);
    } catch (e) {
      await rm(tmp, { force: true });
      throw e;
    }
    return true;
  });
}

async function writeBytes(path: string, bytes: Uint8Array): Promise<void> {
  const fh = await open(path, "wx", 0o600);
  try {
    await fh.writeFile(bytes);
    await fh.sync();
  } finally {
    await fh.close();
  }
}

export class MediaError extends Error {
  override name = "MediaError";
  constructor(
    readonly status: 400 | 413,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

/**
 * Store an uploaded image as `media/<month>/<random id>.<ext>` and return that path. `month` is `YYYY-MM`.
 * The bytes are stored as received (the web already re-encoded them, which also dropped EXIF/GPS).
 */
export async function saveMedia(dataDir: string, bytes: Uint8Array, month: string): Promise<string> {
  if (bytes.length > LIMITS.photoBytes) throw new MediaError(413, "too_large", "Photos are at most 8 MB.");
  const ext = sniffImage(bytes);
  if (!ext) throw new MediaError(400, "unsupported_image", "Only JPEG, PNG or WebP photos can be added.");
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw new Error(`saveMedia: bad month ${month}`);
  await ensureMediaIgnored(dataDir);
  const rel = `${MEDIA_DIR}/${month}/${randomBytes(12).toString("base64url")}.${ext}`;
  const abs = join(dataDir, rel);
  await mkdir(join(dataDir, MEDIA_DIR, month), { recursive: true });
  const tmp = `${abs}.tmp-${randomBytes(6).toString("hex")}`;
  await writeBytes(tmp, bytes);
  try {
    await rename(tmp, abs);
  } catch (e) {
    await rm(tmp, { force: true });
    throw e;
  }
  return rel;
}

/**
 * The absolute path of a stored photo, or null when `rel` isn't a media path, doesn't exist, isn't a regular
 * file, or resolves (through a symlink anywhere on the way) outside `DATA_DIR/media/`.
 */
export async function resolveMedia(dataDir: string, rel: string): Promise<string | null> {
  if (!isMediaPath(rel)) return null;
  try {
    const root = await realpath(join(dataDir, MEDIA_DIR));
    const real = await realpath(join(dataDir, rel));
    if (!real.startsWith(root + sep)) return null;
    const st = await lstat(real);
    return st.isFile() ? real : null;
  } catch {
    return null;
  }
}

/** Photo list as written to a page: media paths only, duplicates dropped, order kept. */
export function dedupePhotos(list: readonly string[]): string[] {
  return Array.from(new Set(list));
}

/**
 * Validate the photo list a write sends for one target. Paths already on the page are kept as they are (a hand
 * edit or a since-removed file must not block an unrelated save); new ones must match the media format AND exist.
 * Returns the deduped list, or the first bad path.
 */
export async function checkPhotoList(
  dataDir: string,
  next: readonly string[],
  current: readonly string[] | undefined,
): Promise<{ ok: true; list: string[] } | { ok: false; bad: string }> {
  const list = dedupePhotos(next);
  const had = new Set(current ?? []);
  for (const p of list) {
    if (had.has(p)) continue;
    if ((await resolveMedia(dataDir, p)) === null) return { ok: false, bad: p };
  }
  return { ok: true, list };
}

/** Whether a boss (or its checkpoints) carries any photo: such a boss counts as touched (never swapped by the AI). */
export function bossHasPhotos(b: { photos?: readonly unknown[] | undefined; checkpoints?: readonly { photos?: readonly unknown[] | undefined }[] | undefined } | null | undefined): boolean {
  if (!b) return false;
  return (b.photos?.length ?? 0) > 0 || (b.checkpoints ?? []).some((c) => (c.photos?.length ?? 0) > 0);
}
