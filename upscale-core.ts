/* The parts of the upscaler that do not need a GPU: how many pixels a print
   needs, how an image is cut into tiles for the model, how rows at 4x are
   resampled to the size asked for, and two encoders that write JPEG or PNG a
   band of rows at a time. Streaming matters because a shop-front print can be
   hundreds of megapixels, far more than a browser canvas will hold. */

// ——— Print planning ————————————————————————————————————————————————————

/** Pixels per inch the eye cannot resolve past at `distanceM` metres, with a
 *  margin: a 20/20 eye resolves one arc-minute, 3438 / inches, and prints
 *  look clean at about 1.8 times that. Capped at the 300 of close work. */
export function recommendedDpi(distanceM: number) {
  if (!Number.isFinite(distanceM) || distanceM <= 0) throw new Error('Viewing distance must be above zero.');
  const inches = distanceM * 39.3701;
  return Math.round(Math.min(300, Math.max(20, (1.8 * 3438) / inches)));
}

export type PrintPlan = {
  dpi: number;
  neededWidth: number;
  neededHeight: number;
  /** DPI the image already has at this print size. */
  currentDpi: number;
  /** Enlargement that reaches the recommended DPI, never below 1. */
  scale: number;
};

export function planPrint(imageWidth: number, imageHeight: number, printWidthCm: number, distanceM: number): PrintPlan {
  if (!(printWidthCm > 0)) throw new Error('Print width must be above zero.');
  const dpi = recommendedDpi(distanceM);
  const inchesWide = printWidthCm / 2.54;
  const neededWidth = Math.round(inchesWide * dpi);
  const neededHeight = Math.round((neededWidth * imageHeight) / imageWidth);
  const currentDpi = imageWidth / inchesWide;
  return { dpi, neededWidth, neededHeight, currentDpi, scale: Math.max(1, neededWidth / imageWidth) };
}

// ——— Tiles ———————————————————————————————————————————————————————————

export type Tile = { x: number; y: number; width: number; height: number };

/** Row-major tiles covering the image. Each tile is sent to the model with
 *  `pad` pixels of context on every side, so seams fall inside overlaps. */
export function tilePlan(width: number, height: number, size: number): Tile[][] {
  const rows: Tile[][] = [];
  for (let y = 0; y < height; y += size) {
    const row: Tile[] = [];
    for (let x = 0; x < width; x += size) row.push({ x, y, width: Math.min(size, width - x), height: Math.min(size, height - y) });
    rows.push(row);
  }
  return rows;
}

/** Model input for one tile: planar RGB in [0, 1], `size + 2 * pad` square,
 *  with the image edge repeated where the tile reaches past it. */
export function tileInput(rgba: Uint8ClampedArray, width: number, height: number, tile: Tile, size: number, pad: number) {
  const side = size + pad * 2, plane = side * side;
  const input = new Float32Array(plane * 3);
  for (let y = 0; y < side; y++) {
    const sy = Math.min(height - 1, Math.max(0, tile.y - pad + y));
    for (let x = 0; x < side; x++) {
      const sx = Math.min(width - 1, Math.max(0, tile.x - pad + x));
      const i = (sy * width + sx) * 4, o = y * side + x;
      // Transparent pixels are traced on white, like everything printed.
      const a = rgba[i + 3] / 255;
      input[o] = (rgba[i] * a + 255 * (1 - a)) / 255;
      input[plane + o] = (rgba[i + 1] * a + 255 * (1 - a)) / 255;
      input[2 * plane + o] = (rgba[i + 2] * a + 255 * (1 - a)) / 255;
    }
  }
  return input;
}

// ——— Resampling rows ——————————————————————————————————————————————————

/** Shrinks a stream of rows by area averaging, the right filter for going
 *  down from the model's 4x to any smaller factor. Rows go in one at a time
 *  and come out as soon as each output row is complete. */
export class RowResampler {
  private readonly xStart: Int32Array;
  private readonly xEnd: Int32Array;
  private readonly xWeights: Float32Array[];
  private readonly scaleY: number;
  private current: Float32Array;
  private next: Float32Array;
  private outRow = 0;
  private inRow = 0;
  private readonly horizontal: Float32Array;
  readonly srcWidth: number;
  readonly srcHeight: number;
  readonly dstWidth: number;
  readonly dstHeight: number;
  readonly channels: number;
  private readonly emit: (row: Uint8Array, index: number) => void;

  constructor(srcWidth: number, srcHeight: number, dstWidth: number, dstHeight: number, channels: number, emit: (row: Uint8Array, index: number) => void) {
    this.srcWidth = srcWidth; this.srcHeight = srcHeight; this.dstWidth = dstWidth; this.dstHeight = dstHeight;
    this.channels = channels; this.emit = emit;
    if (dstWidth > srcWidth || dstHeight > srcHeight) throw new Error('RowResampler only shrinks.');
    const sx = srcWidth / dstWidth;
    this.xStart = new Int32Array(dstWidth);
    this.xEnd = new Int32Array(dstWidth);
    this.xWeights = [];
    for (let x = 0; x < dstWidth; x++) {
      const a = x * sx, b = (x + 1) * sx;
      const first = Math.floor(a), last = Math.min(srcWidth - 1, Math.ceil(b) - 1);
      const weights = new Float32Array(last - first + 1);
      for (let s = first; s <= last; s++) weights[s - first] = (Math.min(b, s + 1) - Math.max(a, s)) / sx;
      this.xStart[x] = first; this.xEnd[x] = last; this.xWeights.push(weights);
    }
    this.scaleY = srcHeight / dstHeight;
    this.current = new Float32Array(dstWidth * channels);
    this.next = new Float32Array(dstWidth * channels);
    this.horizontal = new Float32Array(dstWidth * channels);
  }

  push(row: ArrayLike<number>) {
    const { channels: c, dstWidth } = this;
    const h = this.horizontal;
    for (let x = 0; x < dstWidth; x++) {
      const first = this.xStart[x], weights = this.xWeights[x];
      for (let k = 0; k < c; k++) {
        let sum = 0;
        for (let s = 0; s < weights.length; s++) sum += row[(first + s) * c + k] * weights[s];
        h[x * c + k] = sum;
      }
    }
    // This source row covers [inRow, inRow + 1) and may straddle two outputs.
    const top = this.inRow, bottom = this.inRow + 1;
    const edge = (this.outRow + 1) * this.scaleY;
    const inCurrent = (Math.min(bottom, edge) - top) / this.scaleY;
    for (let i = 0; i < h.length; i++) this.current[i] += h[i] * inCurrent;
    if (bottom >= edge - 1e-9) {
      this.flush();
      const rest = (bottom - edge) / this.scaleY;
      if (rest > 1e-9) for (let i = 0; i < h.length; i++) this.current[i] += h[i] * rest;
    }
    this.inRow++;
  }

  private flush() {
    if (this.outRow >= this.dstHeight) return;
    const out = new Uint8Array(this.current.length);
    for (let i = 0; i < out.length; i++) out[i] = Math.max(0, Math.min(255, Math.round(this.current[i])));
    this.emit(out, this.outRow++);
    [this.current, this.next] = [this.next, this.current];
    this.current.fill(0);
  }

  /** Emits any row still open once every source row has been pushed. */
  finish() { while (this.outRow < this.dstHeight) this.flush(); }
}

/** Enlarges a stream of rows by bilinear interpolation, for the part of an
 *  enlargement past the model's own 4x. The model has already drawn the
 *  detail; this only spreads it smoothly over more pixels. */
export class RowUpsampler {
  private readonly x0: Int32Array;
  private readonly x1: Int32Array;
  private readonly fx: Float32Array;
  private readonly rows = new Map<number, Float32Array>();
  private nextOut = 0;
  private received = 0;
  readonly srcWidth: number;
  readonly srcHeight: number;
  readonly dstWidth: number;
  readonly dstHeight: number;
  readonly channels: number;
  private readonly emit: (row: Uint8Array, index: number) => void;

  constructor(srcWidth: number, srcHeight: number, dstWidth: number, dstHeight: number, channels: number, emit: (row: Uint8Array, index: number) => void) {
    if (dstWidth < srcWidth || dstHeight < srcHeight) throw new Error('RowUpsampler only enlarges.');
    this.srcWidth = srcWidth; this.srcHeight = srcHeight; this.dstWidth = dstWidth; this.dstHeight = dstHeight;
    this.channels = channels; this.emit = emit;
    this.x0 = new Int32Array(dstWidth); this.x1 = new Int32Array(dstWidth); this.fx = new Float32Array(dstWidth);
    for (let x = 0; x < dstWidth; x++) {
      const u = Math.min(srcWidth - 1, Math.max(0, ((x + 0.5) * srcWidth) / dstWidth - 0.5));
      this.x0[x] = Math.floor(u); this.x1[x] = Math.min(srcWidth - 1, this.x0[x] + 1); this.fx[x] = u - this.x0[x];
    }
  }

  private source(y: number) { return (Math.min(this.srcHeight - 1, Math.max(0, ((y + 0.5) * this.srcHeight) / this.dstHeight - 0.5))); }

  push(row: ArrayLike<number>) {
    const c = this.channels, wide = new Float32Array(this.dstWidth * c);
    for (let x = 0; x < this.dstWidth; x++) {
      const a = this.x0[x] * c, b = this.x1[x] * c, f = this.fx[x];
      for (let k = 0; k < c; k++) wide[x * c + k] = row[a + k] * (1 - f) + row[b + k] * f;
    }
    this.rows.set(this.received, wide);
    this.rows.delete(this.received - 2);
    this.received++;
    this.drain(false);
  }

  private drain(final: boolean) {
    while (this.nextOut < this.dstHeight) {
      const v = this.source(this.nextOut), y0 = Math.floor(v), y1 = Math.min(this.srcHeight - 1, y0 + 1);
      if (!final && y1 >= this.received) return;
      const top = this.rows.get(y0) ?? this.rows.get(this.received - 1)!, bottom = this.rows.get(y1) ?? top, f = v - y0;
      const out = new Uint8Array(top.length);
      for (let i = 0; i < out.length; i++) out[i] = Math.max(0, Math.min(255, Math.round(top[i] * (1 - f) + bottom[i] * f)));
      this.emit(out, this.nextOut++);
    }
  }

  finish() { this.drain(true); }
}

// ——— Shared byte helpers ——————————————————————————————————————————————

class ByteSink {
  private chunk = new Uint8Array(1 << 16);
  private at = 0;
  readonly parts: Uint8Array<ArrayBuffer>[] = [];
  size = 0;
  byte(b: number) {
    if (this.at === this.chunk.length) this.spill();
    this.chunk[this.at++] = b;
    this.size++;
  }
  word(w: number) { this.byte((w >> 8) & 255); this.byte(w & 255); }
  bytes(list: ArrayLike<number>) { for (let i = 0; i < list.length; i++) this.byte(list[i]); }
  spill() {
    if (!this.at) return;
    this.parts.push(this.chunk.slice(0, this.at));
    this.chunk = new Uint8Array(1 << 16);
    this.at = 0;
  }
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

export function crc32(data: ArrayLike<number>, crc = 0xffffffff) {
  for (let i = 0; i < data.length; i++) crc = CRC_TABLE[(crc ^ data[i]) & 255] ^ (crc >>> 8);
  return crc;
}

// ——— JPEG ——————————————————————————————————————————————————————————————

const ZIGZAG = [0, 1, 5, 6, 14, 15, 27, 28, 2, 4, 7, 13, 16, 26, 29, 42, 3, 8, 12, 17, 25, 30, 41, 43, 9, 11, 18, 24, 31, 40, 44, 53, 10, 19, 23, 32, 39, 45, 52, 54, 20, 22, 33, 38, 46, 51, 55, 60, 21, 34, 37, 47, 50, 56, 59, 61, 35, 36, 48, 49, 57, 58, 62, 63];
const LUMA = [16, 11, 10, 16, 24, 40, 51, 61, 12, 12, 14, 19, 26, 58, 60, 55, 14, 13, 16, 24, 40, 57, 69, 56, 14, 17, 22, 29, 51, 87, 80, 62, 18, 22, 37, 56, 68, 109, 103, 77, 24, 35, 55, 64, 81, 104, 113, 92, 49, 64, 78, 87, 103, 121, 120, 101, 72, 92, 95, 98, 112, 100, 103, 99];
const CHROMA = [17, 18, 24, 47, 99, 99, 99, 99, 18, 21, 26, 66, 99, 99, 99, 99, 24, 26, 56, 99, 99, 99, 99, 99, 47, 66, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99];
const DC_LUMA_CODES = [0, 0, 1, 5, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0];
const DC_LUMA_VALUES = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11];
const AC_LUMA_CODES = [0, 0, 2, 1, 3, 3, 2, 4, 3, 5, 5, 4, 4, 0, 0, 1, 0x7d];
const AC_LUMA_VALUES = [0x01, 0x02, 0x03, 0x00, 0x04, 0x11, 0x05, 0x12, 0x21, 0x31, 0x41, 0x06, 0x13, 0x51, 0x61, 0x07, 0x22, 0x71, 0x14, 0x32, 0x81, 0x91, 0xa1, 0x08, 0x23, 0x42, 0xb1, 0xc1, 0x15, 0x52, 0xd1, 0xf0, 0x24, 0x33, 0x62, 0x72, 0x82, 0x09, 0x0a, 0x16, 0x17, 0x18, 0x19, 0x1a, 0x25, 0x26, 0x27, 0x28, 0x29, 0x2a, 0x34, 0x35, 0x36, 0x37, 0x38, 0x39, 0x3a, 0x43, 0x44, 0x45, 0x46, 0x47, 0x48, 0x49, 0x4a, 0x53, 0x54, 0x55, 0x56, 0x57, 0x58, 0x59, 0x5a, 0x63, 0x64, 0x65, 0x66, 0x67, 0x68, 0x69, 0x6a, 0x73, 0x74, 0x75, 0x76, 0x77, 0x78, 0x79, 0x7a, 0x83, 0x84, 0x85, 0x86, 0x87, 0x88, 0x89, 0x8a, 0x92, 0x93, 0x94, 0x95, 0x96, 0x97, 0x98, 0x99, 0x9a, 0xa2, 0xa3, 0xa4, 0xa5, 0xa6, 0xa7, 0xa8, 0xa9, 0xaa, 0xb2, 0xb3, 0xb4, 0xb5, 0xb6, 0xb7, 0xb8, 0xb9, 0xba, 0xc2, 0xc3, 0xc4, 0xc5, 0xc6, 0xc7, 0xc8, 0xc9, 0xca, 0xd2, 0xd3, 0xd4, 0xd5, 0xd6, 0xd7, 0xd8, 0xd9, 0xda, 0xe1, 0xe2, 0xe3, 0xe4, 0xe5, 0xe6, 0xe7, 0xe8, 0xe9, 0xea, 0xf1, 0xf2, 0xf3, 0xf4, 0xf5, 0xf6, 0xf7, 0xf8, 0xf9, 0xfa];
const DC_CHROMA_CODES = [0, 0, 3, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0];
const DC_CHROMA_VALUES = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11];
const AC_CHROMA_CODES = [0, 0, 2, 1, 2, 4, 4, 3, 4, 7, 5, 4, 4, 0, 1, 2, 0x77];
const AC_CHROMA_VALUES = [0x00, 0x01, 0x02, 0x03, 0x11, 0x04, 0x05, 0x21, 0x31, 0x06, 0x12, 0x41, 0x51, 0x07, 0x61, 0x71, 0x13, 0x22, 0x32, 0x81, 0x08, 0x14, 0x42, 0x91, 0xa1, 0xb1, 0xc1, 0x09, 0x23, 0x33, 0x52, 0xf0, 0x15, 0x62, 0x72, 0xd1, 0x0a, 0x16, 0x24, 0x34, 0xe1, 0x25, 0xf1, 0x17, 0x18, 0x19, 0x1a, 0x26, 0x27, 0x28, 0x29, 0x2a, 0x35, 0x36, 0x37, 0x38, 0x39, 0x3a, 0x43, 0x44, 0x45, 0x46, 0x47, 0x48, 0x49, 0x4a, 0x53, 0x54, 0x55, 0x56, 0x57, 0x58, 0x59, 0x5a, 0x63, 0x64, 0x65, 0x66, 0x67, 0x68, 0x69, 0x6a, 0x73, 0x74, 0x75, 0x76, 0x77, 0x78, 0x79, 0x7a, 0x82, 0x83, 0x84, 0x85, 0x86, 0x87, 0x88, 0x89, 0x8a, 0x92, 0x93, 0x94, 0x95, 0x96, 0x97, 0x98, 0x99, 0x9a, 0xa2, 0xa3, 0xa4, 0xa5, 0xa6, 0xa7, 0xa8, 0xa9, 0xaa, 0xb2, 0xb3, 0xb4, 0xb5, 0xb6, 0xb7, 0xb8, 0xb9, 0xba, 0xc2, 0xc3, 0xc4, 0xc5, 0xc6, 0xc7, 0xc8, 0xc9, 0xca, 0xd2, 0xd3, 0xd4, 0xd5, 0xd6, 0xd7, 0xd8, 0xd9, 0xda, 0xe2, 0xe3, 0xe4, 0xe5, 0xe6, 0xe7, 0xe8, 0xe9, 0xea, 0xf2, 0xf3, 0xf4, 0xf5, 0xf6, 0xf7, 0xf8, 0xf9, 0xfa];
const AAN = [1.0, 1.387039845, 1.306562965, 1.175875602, 1.0, 0.785694958, 0.5411961, 0.275899379];

type Code = [number, number];

function huffman(codes: number[], values: number[]): Code[] {
  const table: Code[] = [];
  let code = 0, at = 0;
  for (let length = 1; length <= 16; length++) {
    for (let j = 0; j < codes[length]; j++) table[values[at++]] = [code++, length];
    code *= 2;
  }
  return table;
}

const HT = {
  dcY: huffman(DC_LUMA_CODES, DC_LUMA_VALUES), acY: huffman(AC_LUMA_CODES, AC_LUMA_VALUES),
  dcC: huffman(DC_CHROMA_CODES, DC_CHROMA_VALUES), acC: huffman(AC_CHROMA_CODES, AC_CHROMA_VALUES),
};

const CATEGORY = new Uint8Array(65535);
const BITCODE: Code[] = new Array(65535);
(() => {
  let lower = 1, upper = 2;
  for (let cat = 1; cat <= 15; cat++) {
    for (let nr = lower; nr < upper; nr++) { CATEGORY[32767 + nr] = cat; BITCODE[32767 + nr] = [nr, cat]; }
    for (let nr = -(upper - 1); nr <= -lower; nr++) { CATEGORY[32767 + nr] = cat; BITCODE[32767 + nr] = [upper - 1 + nr, cat]; }
    lower <<= 1; upper <<= 1;
  }
})();

function quantTables(quality: number) {
  const q = Math.min(100, Math.max(1, Math.round(quality)));
  const scale = q < 50 ? Math.floor(5000 / q) : Math.floor(200 - q * 2);
  const y = new Uint8Array(64), c = new Uint8Array(64);
  for (let i = 0; i < 64; i++) {
    y[ZIGZAG[i]] = Math.min(255, Math.max(1, Math.floor((LUMA[i] * scale + 50) / 100)));
    c[ZIGZAG[i]] = Math.min(255, Math.max(1, Math.floor((CHROMA[i] * scale + 50) / 100)));
  }
  const fy = new Float32Array(64), fc = new Float32Array(64);
  for (let row = 0, k = 0; row < 8; row++) for (let col = 0; col < 8; col++, k++) {
    fy[k] = 1 / (y[ZIGZAG[k]] * AAN[row] * AAN[col] * 8);
    fc[k] = 1 / (c[ZIGZAG[k]] * AAN[row] * AAN[col] * 8);
  }
  return { y, c, fy, fc };
}

/** Baseline JPEG, 4:4:4 (no colour subsampling, so thin coloured edges and
 *  small text stay sharp in print), written eight rows at a time. */
export class JpegStream {
  private readonly sink = new ByteSink();
  private readonly tables: ReturnType<typeof quantTables>;
  private readonly band: Uint8Array;
  private bandRows = 0;
  private rowsIn = 0;
  private bitBuffer = 0;
  private bitCount = 7;
  private dc = [0, 0, 0];
  private readonly du = new Float32Array(64);
  private readonly quant = new Int32Array(64);
  private readonly zz = new Int32Array(64);
  readonly width: number;
  readonly height: number;

  constructor(width: number, height: number, quality: number, dpi = 0) {
    this.width = width;
    this.height = height;
    if (width < 1 || height < 1 || width > 65535 || height > 65535) throw new Error('JPEG sides must be between 1 and 65,535 pixels.');
    this.tables = quantTables(quality);
    this.band = new Uint8Array(width * 8 * 3);
    const s = this.sink;
    s.word(0xffd8);
    // JFIF header, with the print resolution as dots per inch.
    s.word(0xffe0); s.word(16); s.bytes([0x4a, 0x46, 0x49, 0x46, 0]); s.byte(1); s.byte(1);
    const density = Math.max(1, Math.min(65535, Math.round(dpi || 72)));
    s.byte(dpi ? 1 : 0); s.word(dpi ? density : 1); s.word(dpi ? density : 1); s.byte(0); s.byte(0);
    // JFIF can only hold a whole number; EXIF holds the exact resolution, which
    // Photoshop reads first, so a 6 m print comes out 6 m and not 5.93.
    if (dpi) s.bytes(exifResolution(dpi));
    s.word(0xffdb); s.word(132);
    s.byte(0); s.bytes(this.tables.y);
    s.byte(1); s.bytes(this.tables.c);
    s.word(0xffc0); s.word(17); s.byte(8); s.word(height); s.word(width); s.byte(3);
    s.bytes([1, 0x11, 0, 2, 0x11, 1, 3, 0x11, 1]);
    s.word(0xffc4); s.word(0x01a2);
    const table = (id: number, codes: number[], values: number[]) => { s.byte(id); for (let i = 1; i <= 16; i++) s.byte(codes[i]); s.bytes(values); };
    table(0x00, DC_LUMA_CODES, DC_LUMA_VALUES); table(0x10, AC_LUMA_CODES, AC_LUMA_VALUES);
    table(0x01, DC_CHROMA_CODES, DC_CHROMA_VALUES); table(0x11, AC_CHROMA_CODES, AC_CHROMA_VALUES);
    s.word(0xffda); s.word(12); s.byte(3); s.bytes([1, 0x00, 2, 0x11, 3, 0x11]); s.byte(0); s.byte(0x3f); s.byte(0);
  }

  /** Adds `rows` complete RGB rows, `width * 3` bytes each. */
  addRows(rgb: Uint8Array, rows = rgb.length / (this.width * 3)) {
    const stride = this.width * 3;
    for (let r = 0; r < rows; r++) {
      if (this.rowsIn >= this.height) throw new Error('More rows than the image height.');
      this.band.set(rgb.subarray(r * stride, (r + 1) * stride), this.bandRows * stride);
      this.bandRows++;
      this.rowsIn++;
      if (this.bandRows === 8) this.encodeBand();
    }
  }

  finish(): Blob {
    if (this.rowsIn !== this.height) throw new Error(`Expected ${this.height} rows, received ${this.rowsIn}.`);
    if (this.bandRows) this.encodeBand();
    if (this.bitCount < 7) this.bits([(1 << (this.bitCount + 1)) - 1, this.bitCount + 1]);
    this.sink.word(0xffd9);
    this.sink.spill();
    return new Blob(this.sink.parts, { type: 'image/jpeg' });
  }

  private encodeBand() {
    const stride = this.width * 3;
    // A short last band repeats its final row, as JPEG blocks are 8 rows tall.
    for (let r = this.bandRows; r < 8; r++) this.band.copyWithin(r * stride, (this.bandRows - 1) * stride, this.bandRows * stride);
    const Y = new Float32Array(64), U = new Float32Array(64), V = new Float32Array(64);
    for (let bx = 0; bx < this.width; bx += 8) {
      for (let row = 0; row < 8; row++) for (let col = 0; col < 8; col++) {
        const x = Math.min(this.width - 1, bx + col);
        const p = row * stride + x * 3;
        const r = this.band[p], g = this.band[p + 1], b = this.band[p + 2];
        const k = row * 8 + col;
        Y[k] = 0.299 * r + 0.587 * g + 0.114 * b - 128;
        U[k] = -0.16874 * r - 0.33126 * g + 0.5 * b;
        V[k] = 0.5 * r - 0.41869 * g - 0.08131 * b;
      }
      this.dc[0] = this.block(Y, this.tables.fy, this.dc[0], HT.dcY, HT.acY);
      this.dc[1] = this.block(U, this.tables.fc, this.dc[1], HT.dcC, HT.acC);
      this.dc[2] = this.block(V, this.tables.fc, this.dc[2], HT.dcC, HT.acC);
    }
    this.bandRows = 0;
  }

  private bits([value, length]: Code) {
    for (let bit = length - 1; bit >= 0; bit--) {
      if (value & (1 << bit)) this.bitBuffer |= 1 << this.bitCount;
      if (--this.bitCount < 0) {
        this.sink.byte(this.bitBuffer);
        if (this.bitBuffer === 0xff) this.sink.byte(0);
        this.bitBuffer = 0;
        this.bitCount = 7;
      }
    }
  }

  private block(data: Float32Array, fdtbl: Float32Array, dc: number, dcTable: Code[], acTable: Code[]) {
    const d = this.du;
    d.set(data);
    // Forward DCT, the Arai–Agui–Nakajima factorisation, rows then columns.
    for (let pass = 0; pass < 2; pass++) {
      const step = pass === 0 ? 1 : 8, next = pass === 0 ? 8 : 1;
      for (let i = 0; i < 8; i++) {
        const o = i * next;
        const d0 = d[o], d1 = d[o + step], d2 = d[o + 2 * step], d3 = d[o + 3 * step], d4 = d[o + 4 * step], d5 = d[o + 5 * step], d6 = d[o + 6 * step], d7 = d[o + 7 * step];
        const t0 = d0 + d7, t7 = d0 - d7, t1 = d1 + d6, t6 = d1 - d6, t2 = d2 + d5, t5 = d2 - d5, t3 = d3 + d4, t4 = d3 - d4;
        let t10 = t0 + t3; const t13 = t0 - t3; let t11 = t1 + t2; let t12 = t1 - t2;
        d[o] = t10 + t11; d[o + 4 * step] = t10 - t11;
        const z1 = (t12 + t13) * 0.707106781;
        d[o + 2 * step] = t13 + z1; d[o + 6 * step] = t13 - z1;
        t10 = t4 + t5; t11 = t5 + t6; t12 = t6 + t7;
        const z5 = (t10 - t12) * 0.382683433, z2 = 0.5411961 * t10 + z5, z4 = 1.306562965 * t12 + z5, z3 = t11 * 0.707106781;
        const z11 = t7 + z3, z13 = t7 - z3;
        d[o + 5 * step] = z13 + z2; d[o + 3 * step] = z13 - z2; d[o + step] = z11 + z4; d[o + 7 * step] = z11 - z4;
      }
    }
    for (let i = 0; i < 64; i++) {
      const v = d[i] * fdtbl[i];
      this.quant[i] = v > 0 ? (v + 0.5) | 0 : (v - 0.5) | 0;
    }
    const zz = this.zz;
    for (let i = 0; i < 64; i++) zz[ZIGZAG[i]] = this.quant[i];
    const diff = zz[0] - dc;
    if (diff === 0) this.bits(dcTable[0]);
    else { this.bits(dcTable[CATEGORY[32767 + diff]]); this.bits(BITCODE[32767 + diff]); }
    let end = 63;
    while (end > 0 && zz[end] === 0) end--;
    if (end === 0) { this.bits(acTable[0]); return zz[0]; }
    let i = 1;
    while (i <= end) {
      const start = i;
      while (zz[i] === 0 && i <= end) i++;
      let zeros = i - start;
      if (zeros >= 16) { for (let m = 0; m < zeros >> 4; m++) this.bits(acTable[0xf0]); zeros &= 15; }
      this.bits(acTable[(zeros << 4) + CATEGORY[32767 + zz[i]]]);
      this.bits(BITCODE[32767 + zz[i]]);
      i++;
    }
    if (end !== 63) this.bits(acTable[0]);
    return zz[0];
  }
}

// ——— PNG ———————————————————————————————————————————————————————————————

/** PNG written row by row through the browser's own deflate, with the print
 *  resolution in its pHYs chunk. Grey, RGB or RGBA, 8 bits per channel. */
export class PngStream {
  private readonly head: Uint8Array<ArrayBuffer>[] = [];
  private readonly body: Uint8Array<ArrayBuffer>[] = [];
  private readonly writer: WritableStreamDefaultWriter<BufferSource>;
  private readonly pump: Promise<void>;
  private previous: Uint8Array;
  private rowsIn = 0;
  readonly width: number;
  readonly height: number;
  readonly channels: 1 | 3 | 4;

  constructor(width: number, height: number, channels: 1 | 3 | 4, dpi = 0) {
    this.width = width;
    this.height = height;
    this.channels = channels;
    this.head.push(new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]));
    const ihdr = new Uint8Array(13);
    const view = new DataView(ihdr.buffer);
    view.setUint32(0, width); view.setUint32(4, height);
    ihdr[8] = 8; ihdr[9] = channels === 4 ? 6 : channels === 3 ? 2 : 0; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
    this.head.push(chunk('IHDR', ihdr));
    if (dpi) {
      const phys = new Uint8Array(9);
      const ppm = Math.round(dpi / 0.0254);
      new DataView(phys.buffer).setUint32(0, ppm);
      new DataView(phys.buffer).setUint32(4, ppm);
      phys[8] = 1;
      this.head.push(chunk('pHYs', phys));
    }
    this.previous = new Uint8Array(width * channels);
    const stream = new CompressionStream('deflate');
    this.writer = stream.writable.getWriter();
    const reader = stream.readable.getReader();
    this.pump = (async () => {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        if (value?.length) this.body.push(chunk('IDAT', value));
      }
    })();
  }

  /** Adds complete rows, `width * channels` bytes each. Uses the Up filter,
   *  which costs almost nothing and helps photographs compress. */
  async addRows(pixels: Uint8Array, rows = pixels.length / (this.width * this.channels)) {
    const stride = this.width * this.channels;
    const out = new Uint8Array(rows * (stride + 1));
    for (let r = 0; r < rows; r++) {
      if (this.rowsIn++ >= this.height) throw new Error('More rows than the image height.');
      const row = pixels.subarray(r * stride, (r + 1) * stride);
      const base = r * (stride + 1);
      out[base] = 2;
      for (let i = 0; i < stride; i++) out[base + 1 + i] = (row[i] - this.previous[i]) & 255;
      this.previous = row.slice();
    }
    await this.writer.write(out);
  }

  async finish(): Promise<Blob> {
    if (this.rowsIn !== this.height) throw new Error(`Expected ${this.height} rows, received ${this.rowsIn}.`);
    await this.writer.close();
    await this.pump;
    return new Blob([...this.head, ...this.body, chunk('IEND', new Uint8Array(0))], { type: 'image/png' });
  }
}

function chunk(type: string, data: Uint8Array): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(data.length + 12);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  view.setUint32(8 + data.length, (crc32(out.subarray(4, 8 + data.length)) ^ 0xffffffff) >>> 0);
  return out;
}

/** An APP1 EXIF segment holding only X/Y resolution in dots per inch. */
export function exifResolution(dpi: number) {
  const tiff: number[] = [];
  const u16 = (v: number) => tiff.push(v & 255, (v >> 8) & 255);
  const u32 = (v: number) => tiff.push(v & 255, (v >> 8) & 255, (v >> 16) & 255, (v >>> 24) & 255);
  tiff.push(0x49, 0x49); u16(42); u32(8);
  u16(3);
  const rational = 8 + 2 + 3 * 12 + 4;
  u16(0x011a); u16(5); u32(1); u32(rational);
  u16(0x011b); u16(5); u32(1); u32(rational + 8);
  u16(0x0128); u16(3); u32(1); u32(2);
  u32(0);
  const numerator = Math.round(dpi * 10000);
  u32(numerator); u32(10000); u32(numerator); u32(10000);
  const payload = [0x45, 0x78, 0x69, 0x66, 0, 0, ...tiff];
  const length = payload.length + 2;
  return [0xff, 0xe1, (length >> 8) & 255, length & 255, ...payload];
}

/** Writes the resolution into a JPEG made by the browser: the whole-number
 *  JFIF density, plus an EXIF block with the exact value, inserted right after
 *  the JFIF header. A file that already carries EXIF keeps it untouched. */
export function setJpegDpi(jpeg: Uint8Array, dpi: number): Uint8Array<ArrayBuffer> {
  const density = Math.max(1, Math.min(65535, Math.round(dpi)));
  if (jpeg[0] !== 0xff || jpeg[1] !== 0xd8) throw new Error('Not a JPEG file.');
  const hasJfif = jpeg[2] === 0xff && jpeg[3] === 0xe0 && jpeg[6] === 0x4a && jpeg[7] === 0x46 && jpeg[8] === 0x49 && jpeg[9] === 0x46;
  const jfifLength = hasJfif ? 2 + ((jpeg[4] << 8) | jpeg[5]) : 0;
  const after = 2 + jfifLength;
  const hasExif = jpeg[after] === 0xff && jpeg[after + 1] === 0xe1;
  const app0 = hasJfif
    ? Uint8Array.from(jpeg.subarray(2, after))
    : new Uint8Array([0xff, 0xe0, 0, 16, 0x4a, 0x46, 0x49, 0x46, 0, 1, 1, 0, 0, 1, 0, 1, 0, 0]);
  app0[11] = 1;
  app0[12] = density >> 8; app0[13] = density & 255;
  app0[14] = density >> 8; app0[15] = density & 255;
  const exif = hasExif ? new Uint8Array(0) : Uint8Array.from(exifResolution(dpi));
  const rest = jpeg.subarray(after);
  const out = new Uint8Array(2 + app0.length + exif.length + rest.length);
  out.set([0xff, 0xd8], 0);
  out.set(app0, 2);
  out.set(exif, 2 + app0.length);
  out.set(rest, 2 + app0.length + exif.length);
  return out;
}
