import { crc32 } from './upscale-core';

/* Splits a large print into panels a printer can take. Panels are strips the
   full height (or width) of the print, overlapping by a set amount so they
   can be joined without a gap, each with an optional white border for
   eyelets, hems or welding and a label saying where it goes. Everything here
   is arithmetic in centimetres and source pixels; drawing happens elsewhere. */

export type TileDirection = 'columns' | 'rows';

export type TileOptions = {
  /** Finished print size, in cm. */
  width: number;
  height: number;
  /** Width of the roll or the printer's widest print, in cm. */
  media: number;
  /** How far neighbouring panels overlap, in cm. */
  overlap: number;
  /** White border added around every panel, in cm. */
  margin: number;
  direction: TileDirection;
};

export type Panel = {
  index: number;
  /** The part of the print this panel carries, in cm from the top left. */
  x: number;
  y: number;
  width: number;
  height: number;
  /** The same part in source pixels. */
  px: { x: number; y: number; width: number; height: number };
  /** Size of the printed panel including its border, in cm. */
  sheetWidth: number;
  sheetHeight: number;
};

export type TilePlan = {
  panels: Panel[];
  /** Pixels per cm in the source image at this print size. */
  pixelsPerCm: number;
  dpi: number;
  /** Roll length used, in metres, and printed area, in square metres. */
  rollLength: number;
  area: number;
};

function check(value: number, min: number, max: number, name: string) {
  if (!Number.isFinite(value) || value < min || value > max) throw new Error(`${name} must be between ${min} and ${max}.`);
}

export function planTiles(imageWidth: number, imageHeight: number, o: TileOptions): TilePlan {
  check(o.width, 1, 100000, 'Print width');
  check(o.height, 1, 100000, 'Print height');
  check(o.overlap, 0, 100, 'Overlap');
  check(o.margin, 0, 50, 'Border');
  const usable = o.media - 2 * o.margin;
  if (!(usable > o.overlap)) throw new Error('The roll must be wider than the overlap plus both borders.');
  const along = o.direction === 'columns' ? o.width : o.height;
  const across = o.direction === 'columns' ? o.height : o.width;
  // The fewest strips that fit, then the same width for all of them.
  const count = along <= usable ? 1 : Math.ceil((along - o.overlap) / (usable - o.overlap));
  if (count > 200) throw new Error('That makes more than 200 panels. Check the sizes.');
  const strip = count === 1 ? along : (along + (count - 1) * o.overlap) / count;
  const pixelsPerCm = imageWidth / o.width;
  const panels: Panel[] = [];
  for (let i = 0; i < count; i++) {
    const start = i * (strip - o.overlap);
    const rect = o.direction === 'columns'
      ? { x: start, y: 0, width: strip, height: across }
      : { x: 0, y: start, width: across, height: strip };
    const x0 = Math.round(rect.x * pixelsPerCm), y0 = Math.round(rect.y * (imageHeight / o.height));
    const x1 = Math.min(imageWidth, Math.round((rect.x + rect.width) * pixelsPerCm));
    const y1 = Math.min(imageHeight, Math.round((rect.y + rect.height) * (imageHeight / o.height)));
    panels.push({
      index: i + 1,
      ...rect,
      px: { x: x0, y: y0, width: x1 - x0, height: y1 - y0 },
      sheetWidth: rect.width + 2 * o.margin,
      sheetHeight: rect.height + 2 * o.margin,
    });
  }
  // Every panel runs along the roll: the roll's width holds the strip.
  const rollLength = panels.reduce((sum, p) => sum + (o.direction === 'columns' ? p.sheetHeight : p.sheetWidth), 0) / 100;
  const area = panels.reduce((sum, p) => sum + p.sheetWidth * p.sheetHeight, 0) / 10000;
  return { panels, pixelsPerCm, dpi: pixelsPerCm * 2.54, rollLength, area };
}

/** Positions for eyelet marks along a border, every `spacing` cm, starting
 *  and ending a little in from each corner. */
export function eyelets(length: number, spacing: number, inset = 3) {
  if (!(spacing > 0) || length <= inset * 2) return [];
  const span = length - inset * 2;
  const count = Math.max(1, Math.round(span / spacing));
  return Array.from({ length: count + 1 }, (_, i) => inset + (span * i) / count);
}

// ——— ZIP, stored without compression (JPEG and PNG are compressed already) ———


export async function zip(files: { name: string; blob: Blob }[]): Promise<Blob> {
  const encoder = new TextEncoder();
  const parts: BlobPart[] = [];
  const central: Uint8Array<ArrayBuffer>[] = [];
  let offset = 0;
  for (const file of files) {
    const data = new Uint8Array(await file.blob.arrayBuffer());
    const name = encoder.encode(file.name);
    const crc = (crc32(data) ^ 0xffffffff) >>> 0;
    const local = new Uint8Array(30 + name.length);
    const l = new DataView(local.buffer);
    l.setUint32(0, 0x04034b50, true); l.setUint16(4, 20, true); l.setUint16(6, 0x0800, true); l.setUint16(8, 0, true);
    l.setUint32(14, crc, true); l.setUint32(18, data.length, true); l.setUint32(22, data.length, true);
    l.setUint16(26, name.length, true); local.set(name, 30);
    const entry = new Uint8Array(46 + name.length);
    const c = new DataView(entry.buffer);
    c.setUint32(0, 0x02014b50, true); c.setUint16(4, 20, true); c.setUint16(6, 20, true); c.setUint16(8, 0x0800, true);
    c.setUint32(16, crc, true); c.setUint32(20, data.length, true); c.setUint32(24, data.length, true);
    c.setUint16(28, name.length, true); c.setUint32(42, offset, true); entry.set(name, 46);
    parts.push(local, data);
    central.push(entry);
    offset += local.length + data.length;
  }
  const size = central.reduce((n, e) => n + e.length, 0);
  const end = new Uint8Array(22);
  const e = new DataView(end.buffer);
  e.setUint32(0, 0x06054b50, true); e.setUint16(8, files.length, true); e.setUint16(10, files.length, true);
  e.setUint32(12, size, true); e.setUint32(16, offset, true);
  return new Blob([...parts, ...central, end], { type: 'application/zip' });
}
