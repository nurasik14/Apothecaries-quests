/**
 * Client-side photo preparation (browser only). Every photo is re-encoded on the device before upload: longest
 * side ≤ PHOTO_MAX_SIDE (1600 px), JPEG at PHOTO_QUALITY (0.82).
 *
 * Privacy: drawing the image onto a canvas and exporting it keeps only the pixels, so EXIF metadata (GPS location,
 * camera, timestamps) never leaves the phone. The original file is never uploaded: if the browser can't decode it
 * (e.g. HEIC on a browser without HEIC support), the caller shows a friendly message instead.
 */
import { fitWithin, PHOTO_QUALITY } from './photos';

/** The browser couldn't decode the picked file (HEIC without support, a broken file, not an image). */
export class PhotoDecodeError extends Error {
  override name = 'PhotoDecodeError';
}

interface Decoded {
  source: CanvasImageSource;
  width: number;
  height: number;
  close(): void;
}

async function decode(file: Blob): Promise<Decoded> {
  // EXIF orientation is applied while decoding, so a portrait phone photo stays upright after re-encoding.
  if (typeof createImageBitmap === 'function') {
    try {
      const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' });
      return { source: bmp, width: bmp.width, height: bmp.height, close: () => bmp.close() };
    } catch {
      // Older Safari rejects the options bag, and some browsers decode a format only through <img>: try that.
    }
  }
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.decoding = 'async';
    img.src = url;
    await img.decode();
    // <img> applies EXIF orientation by default (CSS image-orientation: from-image), and drawImage keeps it.
    return { source: img, width: img.naturalWidth, height: img.naturalHeight, close: () => URL.revokeObjectURL(url) };
  } catch {
    URL.revokeObjectURL(url);
    throw new PhotoDecodeError('decode');
  }
}

/**
 * Resize + re-encode one picked file as a JPEG (≤1600 px, quality 0.82). Re-encoding through a canvas strips all
 * EXIF metadata, including the GPS location. Throws PhotoDecodeError when the browser can't read the file.
 */
export async function preparePhoto(file: Blob): Promise<Blob> {
  const img = await decode(file);
  try {
    if (!img.width || !img.height) throw new PhotoDecodeError('empty');
    const { width, height } = fitWithin(img.width, img.height);
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new PhotoDecodeError('canvas');
    // JPEG has no alpha: white behind a transparent PNG instead of black.
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, width, height);
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img.source, 0, 0, width, height);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', PHOTO_QUALITY));
    if (!blob) throw new PhotoDecodeError('encode');
    return blob;
  } finally {
    img.close();
  }
}
