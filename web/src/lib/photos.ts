/**
 * Photos on the boss card, its checkpoints, and the ledger's Highlight / Notes (server: media.ts).
 * Pure helpers only (no DOM), so `bun test` covers them; the canvas resize lives in photoPrepare.ts.
 */

/** Photos per target. Mirrors server/src/domain.ts LIMITS.photosPerTarget (type-only import rule); media.test.ts checks it. */
export const MAX_PHOTOS = 6;
/** Re-encode settings for uploads: longest side in px, JPEG quality. */
export const PHOTO_MAX_SIDE = 1600;
export const PHOTO_QUALITY = 0.82;

/** Mirrors server/src/media.ts MEDIA_PATH_RE. */
export const MEDIA_PATH_RE = /^media\/(\d{4})-(0[1-9]|1[0-2])\/([A-Za-z0-9_-]{8,64})\.(jpg|png|webp)$/;

/** The URL a stored photo is served from (`media/2026-11/abc.jpg` → `/api/media/2026-11/abc.jpg`). */
export function photoUrl(path: string): string {
  return `/api/${path.split('/').map(encodeURIComponent).join('/')}`;
}

/** A page's photo list as the UI shows it: valid media paths only (a hand edit may hold anything). */
export function photosOf(list: unknown): string[] {
  return Array.isArray(list) ? list.filter((p): p is string => typeof p === 'string' && MEDIA_PATH_RE.test(p)) : [];
}

/** Scale (w, h) so the longest side is at most `max` (never upscales). Integer pixels, at least 1. */
export function fitWithin(w: number, h: number, max = PHOTO_MAX_SIDE): { width: number; height: number } {
  const long = Math.max(w, h);
  const k = long > max ? max / long : 1;
  return { width: Math.max(1, Math.round(w * k)), height: Math.max(1, Math.round(h * k)) };
}

/** How many more photos fit next to `have`. */
export function slotsLeft(have: number, max = MAX_PHOTOS): number {
  return Math.max(0, max - have);
}
