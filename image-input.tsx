'use client';
import { useEffect } from 'react';
import type { Raster } from './image';
import { tx, type Language } from './copy';
import { Icon } from './ui';

export const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/bmp'];

export type DecodedImage = { raster: Raster; naturalWidth: number; naturalHeight: number; scaled: boolean };

/** Decodes an image file and, if it holds more than `maxPixels`, scales it
 *  down with high-quality resampling. The pixels never leave the browser. */
export async function decodeImage(file: Blob, maxPixels: number): Promise<DecodedImage> {
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    throw new Error('This image could not be opened. Try saving it again as PNG or JPEG.');
  }
  const naturalWidth = bitmap.width, naturalHeight = bitmap.height;
  const scale = Math.min(1, Math.sqrt(maxPixels / (naturalWidth * naturalHeight)));
  const width = Math.max(1, Math.round(naturalWidth * scale)), height = Math.max(1, Math.round(naturalHeight * scale));
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) throw new Error('Canvas is unavailable in this browser.');
  context.imageSmoothingQuality = 'high';
  context.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();
  const data = context.getImageData(0, 0, width, height).data;
  return { raster: { width, height, data }, naturalWidth, naturalHeight, scaled: scale < 1 };
}

/** Lets a picture be pasted straight from the clipboard (Ctrl+V), the way a
 *  screenshot or a copied image usually arrives in the workshop. */
export function usePastedImage(onFile: (file: File) => void, enabled = true) {
  useEffect(() => {
    if (!enabled) return;
    const onPaste = (event: ClipboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) return;
      const item = [...(event.clipboardData?.items ?? [])].find(entry => entry.kind === 'file' && entry.type.startsWith('image/'));
      const file = item?.getAsFile();
      if (file) { event.preventDefault(); onFile(file); }
    };
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  }, [onFile, enabled]);
}

export function ImageDrop({ lang, onFile, busy, note, accept = IMAGE_TYPES.join(',') }: { lang: Language; onFile: (file: File) => void; busy?: boolean; note?: string; accept?: string }) {
  return (
    <label className="upload-zone">
      <input type="file" accept={accept} aria-label={tx(lang, 'Import image', 'استيراد صورة')} disabled={busy}
        onChange={event => { const file = event.target.files?.[0]; if (file) onFile(file); event.target.value = ''; }} />
      <span className="upload-icon"><Icon name="upload" /></span>
      <strong>{busy ? tx(lang, 'Reading image…', 'جارٍ فتح الصورة…') : tx(lang, 'Import, drop or paste an image', 'استورد صورة أو اسحبها أو الصقها')}</strong>
      <span dir="ltr">{note ?? 'PNG · JPEG · WebP · Ctrl+V'}</span>
    </label>
  );
}

/** Starts a download of `data` under `name`. */
export function saveFile(data: BlobPart | Blob, name: string, type: string) {
  const blob = data instanceof Blob ? data : new Blob([data], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

/** A friendly byte count, like "4.2 MB". */
export function bytes(size: number) {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(0)} KB`;
  return `${(size / 1024 / 1024).toFixed(1)} MB`;
}
