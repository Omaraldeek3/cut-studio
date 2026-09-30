/* Photo engraving preparation. A laser engraves one dot per pixel per line,
   so the picture is first resampled to its real size at the machine's line
   resolution, then adjusted and turned into dots. Dithering at any other
   resolution and resizing afterwards smears the dots, which is the most
   common reason an engraved photo comes out muddy. */

export type Dither = 'floyd' | 'jarvis' | 'stucki' | 'atkinson' | 'sierra' | 'bayer' | 'halftone' | 'threshold' | 'grayscale';

export type EngraveOptions = {
  /** −100…100 */
  brightness: number;
  /** −100…100 */
  contrast: number;
  /** 0.3…3: above 1 opens up the shadows, below 1 deepens them. */
  gamma: number;
  /** 0…100: unsharp mask strength. */
  sharpen: number;
  /** Engrave the light parts instead of the dark (slate, anodised metal, glass). */
  invert: boolean;
  /** Flip left to right (engraving the back of acrylic or glass). */
  mirror: boolean;
  dither: Dither;
  /** Grey level for plain threshold. */
  threshold: number;
  /** Halftone cell size in pixels. */
  cell: number;
};

export const defaultEngrave: EngraveOptions = {
  brightness: 0, contrast: 0, gamma: 1, sharpen: 30, invert: false, mirror: false, dither: 'jarvis', threshold: 128, cell: 6,
};

export type Material = { id: string; en: string; ar: string; dpi: number; options: Partial<EngraveOptions> };

/** Starting points, not rules: a power and speed test on the actual sheet
 *  decides. They follow what most CO2 and fibre workshops start from. */
export const materials: Material[] = [
  { id: 'wood', en: 'Wood / plywood (CO2)', ar: 'خشب / أبلكاش (CO2)', dpi: 254, options: { dither: 'jarvis', gamma: 1.25, contrast: 10, invert: false, mirror: false } },
  { id: 'mdf', en: 'MDF (CO2)', ar: 'MDF (CO2)', dpi: 254, options: { dither: 'stucki', gamma: 1.15, contrast: 15, invert: false, mirror: false } },
  { id: 'leather', en: 'Leather (CO2)', ar: 'جلد (CO2)', dpi: 254, options: { dither: 'jarvis', gamma: 1.1, contrast: 5, invert: false, mirror: false } },
  { id: 'slate', en: 'Slate / stone (CO2)', ar: 'حجر أردواز (CO2)', dpi: 300, options: { dither: 'stucki', gamma: 1, contrast: 10, invert: true, mirror: false } },
  { id: 'acrylic', en: 'Clear acrylic, from the back', ar: 'أكريليك شفاف من الخلف', dpi: 300, options: { dither: 'floyd', gamma: 1, contrast: 10, invert: true, mirror: true } },
  { id: 'glass', en: 'Glass (CO2)', ar: 'زجاج (CO2)', dpi: 254, options: { dither: 'stucki', gamma: 1, contrast: 5, invert: true, mirror: false } },
  { id: 'anodised', en: 'Anodised aluminium', ar: 'ألمنيوم مؤكسد', dpi: 500, options: { dither: 'floyd', gamma: 1, contrast: 10, invert: true, mirror: false } },
  { id: 'steel', en: 'Stainless steel (fibre)', ar: 'ستانلس ستيل (فايبر)', dpi: 500, options: { dither: 'floyd', gamma: 0.9, contrast: 10, invert: false, mirror: false } },
  { id: 'paper', en: 'Paper / card', ar: 'ورق / كرتون', dpi: 300, options: { dither: 'atkinson', gamma: 1.1, contrast: 0, invert: false, mirror: false } },
];

/** Luminance of an RGBA image, transparent areas treated as white. */
export function toGray(rgba: Uint8ClampedArray, width: number, height: number) {
  const gray = new Float32Array(width * height);
  for (let i = 0; i < gray.length; i++) {
    const a = rgba[i * 4 + 3] / 255;
    const l = 0.2126 * rgba[i * 4] + 0.7152 * rgba[i * 4 + 1] + 0.0722 * rgba[i * 4 + 2];
    gray[i] = l * a + 255 * (1 - a);
  }
  return gray;
}

/** Brightness, contrast, gamma and sharpening, in place order that keeps
 *  the midtones where a laser shows them best. */
export function adjust(gray: Float32Array, width: number, height: number, o: EngraveOptions) {
  let out = gray;
  if (o.sharpen > 0) {
    // Unsharp mask with a 3 × 3 box: enough to bring back an edge that the
    // resampling softened, not enough to draw halos.
    const blurred = new Float32Array(gray.length);
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      let sum = 0, count = 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const xx = x + dx, yy = y + dy;
        if (xx < 0 || yy < 0 || xx >= width || yy >= height) continue;
        sum += gray[yy * width + xx]; count++;
      }
      blurred[y * width + x] = sum / count;
    }
    const amount = o.sharpen / 50;
    out = new Float32Array(gray.length);
    for (let i = 0; i < gray.length; i++) out[i] = gray[i] + (gray[i] - blurred[i]) * amount;
  } else out = gray.slice();
  const contrast = o.contrast < 0 ? 1 + o.contrast / 100 : 1 + o.contrast / 25;
  for (let i = 0; i < out.length; i++) {
    let v = (out[i] - 128) * contrast + 128 + o.brightness * 2.55;
    v = Math.max(0, Math.min(255, v));
    v = 255 * Math.pow(v / 255, 1 / o.gamma);
    out[i] = o.invert ? 255 - v : v;
  }
  return out;
}

type Kernel = { divisor: number; taps: [number, number, number][] };
const kernels: Record<string, Kernel> = {
  floyd: { divisor: 16, taps: [[1, 0, 7], [-1, 1, 3], [0, 1, 5], [1, 1, 1]] },
  jarvis: { divisor: 48, taps: [[1, 0, 7], [2, 0, 5], [-2, 1, 3], [-1, 1, 5], [0, 1, 7], [1, 1, 5], [2, 1, 3], [-2, 2, 1], [-1, 2, 3], [0, 2, 5], [1, 2, 3], [2, 2, 1]] },
  stucki: { divisor: 42, taps: [[1, 0, 8], [2, 0, 4], [-2, 1, 2], [-1, 1, 4], [0, 1, 8], [1, 1, 4], [2, 1, 2], [-2, 2, 1], [-1, 2, 2], [0, 2, 4], [1, 2, 2], [2, 2, 1]] },
  atkinson: { divisor: 8, taps: [[1, 0, 1], [2, 0, 1], [-1, 1, 1], [0, 1, 1], [1, 1, 1], [0, 2, 1]] },
  sierra: { divisor: 4, taps: [[1, 0, 2], [-1, 1, 1], [0, 1, 1]] },
};

const BAYER = [0, 32, 8, 40, 2, 34, 10, 42, 48, 16, 56, 24, 50, 18, 58, 26, 12, 44, 4, 36, 14, 46, 6, 38, 60, 28, 52, 20, 62, 30, 54, 22, 3, 35, 11, 43, 1, 33, 9, 41, 51, 19, 59, 27, 49, 17, 57, 25, 15, 47, 7, 39, 13, 45, 5, 37, 63, 31, 55, 23, 61, 29, 53, 21];

/** Turns grey levels into what the laser fires: 0 is a burnt dot, 255 is
 *  left alone. `grayscale` keeps the levels, for machines that modulate
 *  power by grey value. Error diffusion runs in a serpentine, alternating
 *  direction each row, which avoids the diagonal worms of a one-way scan. */
export function toDots(gray: Float32Array, width: number, height: number, o: EngraveOptions): Uint8Array {
  const out = new Uint8Array(width * height);
  if (o.dither === 'grayscale') {
    for (let i = 0; i < out.length; i++) out[i] = Math.round(Math.max(0, Math.min(255, gray[i])));
  } else if (o.dither === 'threshold') {
    for (let i = 0; i < out.length; i++) out[i] = gray[i] < o.threshold ? 0 : 255;
  } else if (o.dither === 'bayer') {
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      const t = ((BAYER[(y % 8) * 8 + (x % 8)] + 0.5) / 64) * 255;
      out[y * width + x] = gray[y * width + x] < t ? 0 : 255;
    }
  } else if (o.dither === 'halftone') {
    // Round dots on a 45° screen, sized by the mean darkness of their cell.
    const cell = Math.max(3, Math.round(o.cell)), c = Math.SQRT1_2;
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      const u = (x * c + y * c) / cell, v = (-x * c + y * c) / cell;
      const fu = u - Math.floor(u) - 0.5, fv = v - Math.floor(v) - 0.5;
      const darkness = 1 - gray[y * width + x] / 255;
      const radius = Math.sqrt(darkness / Math.PI);
      out[y * width + x] = Math.hypot(fu, fv) < radius ? 0 : 255;
    }
  } else {
    const kernel = kernels[o.dither] ?? kernels.floyd;
    const work = gray.slice();
    for (let y = 0; y < height; y++) {
      const forward = y % 2 === 0;
      for (let step = 0; step < width; step++) {
        const x = forward ? step : width - 1 - step;
        const i = y * width + x;
        const old = work[i];
        const value = old < 128 ? 0 : 255;
        out[i] = value;
        const error = (old - value) / kernel.divisor;
        for (const [dx, dy, weight] of kernel.taps) {
          const xx = forward ? x + dx : x - dx, yy = y + dy;
          if (xx < 0 || xx >= width || yy >= height) continue;
          work[yy * width + xx] += error * weight;
        }
      }
    }
  }
  if (o.mirror) for (let y = 0; y < height; y++) out.subarray(y * width, (y + 1) * width).reverse();
  return out;
}

/** An uncompressed BMP, 1-bit when the image holds only black and white and
 *  8-bit grey otherwise, with its resolution in pixels per metre — the format
 *  RDWorks and EZCAD import most readily, at the right size. */
export function toBmp(dots: Uint8Array, width: number, height: number, dpi: number): Uint8Array<ArrayBuffer> {
  const binary = dots.every(v => v === 0 || v === 255);
  const bits = binary ? 1 : 8;
  const colours = binary ? 2 : 256;
  const rowBytes = Math.ceil((width * bits) / 32) * 4;
  const offset = 14 + 40 + colours * 4;
  const size = offset + rowBytes * height;
  const out = new Uint8Array(size);
  const view = new DataView(out.buffer);
  out[0] = 0x42; out[1] = 0x4d;
  view.setUint32(2, size, true); view.setUint32(10, offset, true);
  view.setUint32(14, 40, true); view.setInt32(18, width, true); view.setInt32(22, height, true);
  view.setUint16(26, 1, true); view.setUint16(28, bits, true); view.setUint32(30, 0, true);
  view.setUint32(34, rowBytes * height, true);
  const ppm = Math.round(dpi / 0.0254);
  view.setInt32(38, ppm, true); view.setInt32(42, ppm, true);
  view.setUint32(46, colours, true);
  for (let c = 0; c < colours; c++) {
    const v = binary ? c * 255 : c;
    out.set([v, v, v, 0], 54 + c * 4);
  }
  for (let y = 0; y < height; y++) {
    const row = offset + (height - 1 - y) * rowBytes;
    if (binary) {
      for (let x = 0; x < width; x++) if (dots[y * width + x]) out[row + (x >> 3)] |= 0x80 >> (x & 7);
    } else out.set(dots.subarray(y * width, (y + 1) * width), row);
  }
  return out;
}
