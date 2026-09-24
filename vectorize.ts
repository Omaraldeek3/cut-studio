import type { Raster } from './image';

/* Image to vector, in two modes.

   colour   Reduce the picture to a palette, clean away specks, and trace every
            colour as smooth filled shapes: the result prints and enlarges like
            the original, the way Illustrator's Image Trace does.
   outline  Separate dark from light and trace the shapes as clean closed
            outlines for the laser or the plotter.

   Both modes share one tracer. Each colour becomes a mask; the mask is
   sampled up, softened by a fraction of a pixel and cut at half height, which
   places the edge between pixels instead of on their staircase. The edge is
   then fitted with cubic Bézier curves within a set error, keeping corners
   sharp where the outline really turns. */

export type VectorMode = 'color' | 'outline';
export type Layering = 'stacked' | 'cutout';

export type VectorizeOptions = {
  mode: VectorMode;
  /** Colour mode: how many colours the picture is reduced to. */
  colors: number;
  /** Colour mode: stacked shapes overlap and never leave gaps (print);
   *  cut-out shapes never overlap (one vinyl per colour). */
  layering: Layering;
  /** Smooth away JPEG noise before reading the colours. */
  denoise: boolean;
  /** 0–100: higher keeps smaller details, lower removes more specks. */
  detail: number;
  /** 0–100: how far the curves may simplify the traced edge. */
  smoothing: number;
  /** 0–100: how readily a sharp turn is kept as a corner. */
  corners: number;
  /** Outline mode: grey level that separates dark from light, or -1 for automatic. */
  threshold: number;
  /** Outline mode: trace the light parts instead of the dark. */
  invert: boolean;
  /** Treat transparent pixels as empty rather than as white. */
  transparent: boolean;
  /** Colours (as #rrggbb) to leave out, as if they were transparent. */
  hidden: string[];
};

export const defaultVectorize: VectorizeOptions = {
  mode: 'color', colors: 8, layering: 'stacked', denoise: true, detail: 60, smoothing: 35, corners: 50,
  threshold: -1, invert: false, transparent: true, hidden: [],
};

/** A cubic segment: first control, second control, end point. */
export type Curve = [number, number, number, number, number, number];
/** A closed path that starts at (x, y). */
export type VectorPath = { x: number; y: number; curves: Curve[] };
export type VectorLayer = { color: string; area: number; paths: VectorPath[] };
export type PaletteEntry = { color: string; area: number; hidden: boolean };
export type VectorResult = {
  width: number;
  height: number;
  layers: VectorLayer[];
  palette: PaletteEntry[];
  nodes: number;
  /** The grey level outline mode used, useful when it was chosen automatically. */
  threshold: number;
};

type Progress = (stage: string, fraction: number) => void;
type Pt = { x: number; y: number };

const TRANSPARENT = 255;
export const MAX_PIXELS = 6_000_000;

function check(value: number, min: number, max: number, name: string) {
  if (!Number.isFinite(value) || value < min || value > max) throw new Error(`${name} must be between ${min} and ${max}.`);
}

/** A small, seeded generator, so the same picture always gives the same palette. */
function seeded(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const hex = (r: number, g: number, b: number) =>
  '#' + [r, g, b].map(v => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('');

// ——— Pixels ——————————————————————————————————————————————————————————————

type Pixels = { w: number; h: number; r: Uint8Array; g: Uint8Array; b: Uint8Array; opaque: Uint8Array };

function readPixels(raster: Raster, transparent: boolean): Pixels {
  const { width: w, height: h, data } = raster;
  const n = w * h;
  const r = new Uint8Array(n), g = new Uint8Array(n), b = new Uint8Array(n), opaque = new Uint8Array(n);
  for (let i = 0, j = 0; i < n; i++, j += 4) {
    const a = data[j + 3] / 255;
    // Everything is composited on white; a transparent pixel is also marked
    // empty when the caller asked for transparency to be kept.
    r[i] = Math.round(data[j] * a + 255 * (1 - a));
    g[i] = Math.round(data[j + 1] * a + 255 * (1 - a));
    b[i] = Math.round(data[j + 2] * a + 255 * (1 - a));
    opaque[i] = transparent && data[j + 3] < 128 ? 0 : 1;
  }
  return { w, h, r, g, b, opaque };
}

/** Averages each pixel with the neighbours that are close to it in colour, so
 *  JPEG noise flattens while real edges stay where they are. */
function denoise(p: Pixels): Pixels {
  const { w, h } = p;
  const r = new Uint8Array(w * h), g = new Uint8Array(w * h), b = new Uint8Array(w * h);
  const limit = 54;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x;
    let sr = 0, sg = 0, sb = 0, count = 0;
    for (let dy = -2; dy <= 2; dy++) {
      const yy = y + dy;
      if (yy < 0 || yy >= h) continue;
      for (let dx = -2; dx <= 2; dx++) {
        const xx = x + dx;
        if (xx < 0 || xx >= w) continue;
        const j = yy * w + xx;
        if (Math.abs(p.r[j] - p.r[i]) + Math.abs(p.g[j] - p.g[i]) + Math.abs(p.b[j] - p.b[i]) > limit) continue;
        sr += p.r[j]; sg += p.g[j]; sb += p.b[j]; count++;
      }
    }
    r[i] = Math.round(sr / count); g[i] = Math.round(sg / count); b[i] = Math.round(sb / count);
  }
  return { ...p, r, g, b };
}

const linear = new Float32Array(256).map((_, i) => {
  const c = i / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
});

function lab(r: number, g: number, b: number): [number, number, number] {
  const lr = linear[r], lg = linear[g], lb = linear[b];
  const f = (t: number) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  const fx = f((0.4124564 * lr + 0.3575761 * lg + 0.1804375 * lb) / 0.95047);
  const fy = f(0.2126729 * lr + 0.7151522 * lg + 0.072175 * lb);
  const fz = f((0.0193339 * lr + 0.119192 * lg + 0.9503041 * lb) / 1.08883);
  // Lightness counts a little more than hue: line art and lettering are
  // mostly light-against-dark, and a pale grey line on white must stay a line.
  return [(116 * fy - 16) * 1.2, 500 * (fx - fy), 200 * (fy - fz)];
}

// ——— Colour reduction ——————————————————————————————————————————————————

/** k-means in Lab on a sample of the picture, seeded with k-means++. */
function findPalette(p: Pixels, k: number): Float32Array {
  const n = p.w * p.h;
  const random = seeded(n * 31 + k);
  const step = Math.max(1, Math.floor(n / 60000));
  const samples: number[] = [];
  for (let base = 0; base < n; base += step) {
    const i = Math.min(n - 1, base + Math.floor(random() * step));
    if (!p.opaque[i]) continue;
    samples.push(...lab(p.r[i], p.g[i], p.b[i]));
  }
  const S = Float32Array.from(samples);
  const sampleCount = S.length / 3;
  if (!sampleCount) return new Float32Array(0);
  const count = Math.min(k, sampleCount);
  const C = new Float32Array(count * 3);
  const nearest = new Float32Array(sampleCount).fill(Infinity);
  const d2 = (s: number, c: number) => {
    const a = S[s * 3] - C[c * 3], b = S[s * 3 + 1] - C[c * 3 + 1], e = S[s * 3 + 2] - C[c * 3 + 2];
    return a * a + b * b + e * e;
  };
  let pick = Math.floor(random() * sampleCount);
  for (let c = 0; c < count; c++) {
    C.set(S.subarray(pick * 3, pick * 3 + 3), c * 3);
    let total = 0;
    for (let s = 0; s < sampleCount; s++) { nearest[s] = Math.min(nearest[s], d2(s, c)); total += nearest[s]; }
    if (total === 0) return C.slice(0, (c + 1) * 3);
    let target = random() * total;
    pick = sampleCount - 1;
    for (let s = 0; s < sampleCount; s++) { target -= nearest[s]; if (target <= 0) { pick = s; break; } }
  }
  const assign = new Int32Array(sampleCount);
  const best = new Float32Array(sampleCount);
  const iterate = (rounds: number) => {
    for (let iteration = 0; iteration < rounds; iteration++) {
      let moved = 0;
      for (let s = 0; s < sampleCount; s++) {
        let pickC = 0, bestD = Infinity;
        for (let c = 0; c < count; c++) { const d = d2(s, c); if (d < bestD) { bestD = d; pickC = c; } }
        if (assign[s] !== pickC) moved++;
        assign[s] = pickC;
        best[s] = bestD;
      }
      const sum = new Float64Array(count * 3), members = new Int32Array(count);
      for (let s = 0; s < sampleCount; s++) {
        const c = assign[s];
        sum[c * 3] += S[s * 3]; sum[c * 3 + 1] += S[s * 3 + 1]; sum[c * 3 + 2] += S[s * 3 + 2]; members[c]++;
      }
      for (let c = 0; c < count; c++) if (members[c]) for (let j = 0; j < 3; j++) C[c * 3 + j] = sum[c * 3 + j] / members[c];
      if (iteration > 2 && moved < sampleCount * 0.001) break;
    }
  };
  iterate(16);
  // k-means spends its colours on large areas. A small group of pixels that
  // no colour fits (a pale veil line, a thin red outline) gets a colour of its
  // own, taken from the two colours that are most alike, which merge.
  for (let round = 0; round < 3 && count > 2; round++) {
    const far: number[] = [];
    for (let s = 0; s < sampleCount; s++) if (best[s] > 16 * 16) far.push(s);
    if (far.length < Math.max(24, sampleCount * 0.002)) break;
    let a = 0, b = 1, closest = Infinity;
    for (let i = 0; i < count; i++) for (let j = i + 1; j < count; j++) {
      const d = (C[i * 3] - C[j * 3]) ** 2 + (C[i * 3 + 1] - C[j * 3 + 1]) ** 2 + (C[i * 3 + 2] - C[j * 3 + 2]) ** 2;
      if (d < closest) { closest = d; a = i; b = j; }
    }
    // Only give up a colour when the two are closer than the outliers are far.
    const outlier = far.reduce((m, s) => Math.max(m, best[s]), 0);
    if (closest > outlier) break;
    const mean = [0, 0, 0];
    for (const s of far) { mean[0] += S[s * 3]; mean[1] += S[s * 3 + 1]; mean[2] += S[s * 3 + 2]; }
    for (let j = 0; j < 3; j++) { C[a * 3 + j] = (C[a * 3 + j] + C[b * 3 + j]) / 2; C[b * 3 + j] = mean[j] / far.length; }
    iterate(8);
  }
  // Colours that differ by less than about five Lab units read as one colour
  // in print, and keeping both only scatters blotches across a flat area.
  const kept: number[][] = [];
  for (let c = 0; c < count; c++) {
    const L = C[c * 3], A = C[c * 3 + 1], B = C[c * 3 + 2];
    if (!kept.some(q => (q[0] - L) ** 2 + (q[1] - A) ** 2 + (q[2] - B) ** 2 < 25)) kept.push([L, A, B]);
  }
  return Float32Array.from(kept.flat());
}

function assignColours(p: Pixels, centres: Float32Array): Uint8Array {
  const n = p.w * p.h, k = centres.length / 3;
  const labels = new Uint8Array(n).fill(TRANSPARENT);
  const cache = new Map<number, number>();
  for (let i = 0; i < n; i++) {
    if (!p.opaque[i]) continue;
    const key = (p.r[i] << 16) | (p.g[i] << 8) | p.b[i];
    let label = cache.get(key);
    if (label === undefined) {
      const [L, A, B] = lab(p.r[i], p.g[i], p.b[i]);
      let bestD = Infinity;
      label = 0;
      for (let c = 0; c < k; c++) {
        const d = (L - centres[c * 3]) ** 2 + (A - centres[c * 3 + 1]) ** 2 + (B - centres[c * 3 + 2]) ** 2;
        if (d < bestD) { bestD = d; label = c; }
      }
      if (cache.size < 1 << 20) cache.set(key, label);
    }
    labels[i] = label;
  }
  return labels;
}

/** Otsu's threshold on the grey levels of the opaque pixels. */
export function otsu(histogram: ArrayLike<number>) {
  let total = 0, sum = 0;
  for (let i = 0; i < 256; i++) { total += histogram[i]; sum += i * histogram[i]; }
  let background = 0, sumB = 0, best = 0, threshold = 128;
  for (let t = 0; t < 256; t++) {
    background += histogram[t];
    if (!background) continue;
    const foreground = total - background;
    if (!foreground) break;
    sumB += t * histogram[t];
    const mB = sumB / background, mF = (sum - sumB) / foreground;
    const between = background * foreground * (mB - mF) ** 2;
    if (between > best) { best = between; threshold = t + 0.5; }
  }
  return Math.round(threshold);
}

// ——— Clean-up ——————————————————————————————————————————————————————————

/** A pixel with at most one like neighbour takes the colour most around it. */
function isolate(labels: Uint8Array, w: number, h: number) {
  const out = labels.slice();
  const counts = new Map<number, number>();
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x, own = labels[i];
    let same = 0;
    counts.clear();
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      if (!dx && !dy) continue;
      const xx = x + dx, yy = y + dy;
      if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
      const l = labels[yy * w + xx];
      if (l === own) same++;
      else counts.set(l, (counts.get(l) ?? 0) + 1);
    }
    if (same > 1 || !counts.size) continue;
    let best = own, bestCount = 0;
    for (const [l, c] of counts) if (c > bestCount) { best = l; bestCount = c; }
    out[i] = best;
  }
  return out;
}

/** Regions smaller than `minArea` pixels are absorbed by the neighbour they
 *  share the longest border with. */
export function despeckle(labels: Uint8Array, w: number, h: number, minArea: number) {
  if (minArea <= 1) return labels;
  const n = w * h;
  const component = new Int32Array(n);
  const stack = new Int32Array(n);
  for (let pass = 0; pass < 4; pass++) {
    component.fill(-1);
    const areas: number[] = [];
    for (let start = 0; start < n; start++) {
      if (component[start] >= 0) continue;
      const id = areas.length, label = labels[start];
      let top = 0, area = 0;
      stack[top++] = start; component[start] = id;
      while (top) {
        const i = stack[--top];
        area++;
        const x = i % w;
        if (x > 0 && component[i - 1] < 0 && labels[i - 1] === label) { component[i - 1] = id; stack[top++] = i - 1; }
        if (x < w - 1 && component[i + 1] < 0 && labels[i + 1] === label) { component[i + 1] = id; stack[top++] = i + 1; }
        if (i >= w && component[i - w] < 0 && labels[i - w] === label) { component[i - w] = id; stack[top++] = i - w; }
        if (i < n - w && component[i + w] < 0 && labels[i + w] === label) { component[i + w] = id; stack[top++] = i + w; }
      }
      areas.push(area);
    }
    const small = (id: number) => areas[id] < minArea;
    // Border lengths from each small region to each neighbouring label.
    const border = new Map<number, Map<number, number>>();
    for (let i = 0; i < n; i++) {
      const c = component[i];
      if (!small(c)) continue;
      const x = i % w;
      const neighbours = [x > 0 ? i - 1 : -1, x < w - 1 ? i + 1 : -1, i >= w ? i - w : -1, i < n - w ? i + w : -1];
      for (const j of neighbours) {
        if (j < 0 || component[j] === c) continue;
        let tally = border.get(c);
        if (!tally) border.set(c, (tally = new Map()));
        // A large neighbour outweighs a small one, so specks drain into the
        // surrounding colour rather than into each other.
        tally.set(labels[j], (tally.get(labels[j]) ?? 0) + (small(component[j]) ? 1 : 8));
      }
    }
    if (!border.size) break;
    const target = new Map<number, number>();
    for (const [c, tally] of border) {
      let best = -1, bestCount = 0;
      for (const [l, count] of tally) if (count > bestCount) { best = l; bestCount = count; }
      if (best >= 0) target.set(c, best);
    }
    let changed = 0;
    for (let i = 0; i < n; i++) {
      const t = target.get(component[i]);
      if (t !== undefined && t !== labels[i]) { labels[i] = t; changed++; }
    }
    if (!changed) break;
  }
  return labels;
}

/** Anti-aliased edges leave a strip of in-between colour along the border of
 *  two colours: a grey rim between black and white, a brown one between black
 *  and skin. A region that is at most two pixels thick and whose colour lies
 *  between the two colours it separates is such a strip, and each of its
 *  pixels goes to whichever side it is closer to. A thin line with the same
 *  colour on both sides (a grey stroke on white) is a real line and stays. */
export function removeHalos(labels: Uint8Array, w: number, h: number, centres: Float32Array, pixelLab: (i: number) => [number, number, number]) {
  const n = w * h;
  const component = new Int32Array(n).fill(-1);
  const stack = new Int32Array(n);
  const members: number[][] = [];
  for (let start = 0; start < n; start++) {
    if (component[start] >= 0 || labels[start] === TRANSPARENT) continue;
    const id = members.length, label = labels[start], list: number[] = [];
    let top = 0;
    stack[top++] = start; component[start] = id;
    while (top) {
      const i = stack[--top];
      list.push(i);
      const x = i % w;
      if (x > 0 && component[i - 1] < 0 && labels[i - 1] === label) { component[i - 1] = id; stack[top++] = i - 1; }
      if (x < w - 1 && component[i + 1] < 0 && labels[i + 1] === label) { component[i + 1] = id; stack[top++] = i + 1; }
      if (i >= w && component[i - w] < 0 && labels[i - w] === label) { component[i - w] = id; stack[top++] = i - w; }
      if (i < n - w && component[i + w] < 0 && labels[i + w] === label) { component[i + w] = id; stack[top++] = i + w; }
    }
    members.push(list);
  }
  const distance = (a: number, b: number) =>
    Math.sqrt((centres[a * 3] - centres[b * 3]) ** 2 + (centres[a * 3 + 1] - centres[b * 3 + 1]) ** 2 + (centres[a * 3 + 2] - centres[b * 3 + 2]) ** 2);
  const updates: [number, number][] = [];
  for (let id = 0; id < members.length; id++) {
    const list = members[id], label = labels[list[0]];
    // Any pixel whose whole 3 × 3 neighbourhood shares the region means the
    // region is thicker than a rim.
    let thick = false;
    const contact = new Map<number, number>();
    for (const i of list) {
      const x = i % w, y = (i - x) / w;
      let inside = x > 0 && y > 0 && x < w - 1 && y < h - 1;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dy) continue;
        const xx = x + dx, yy = y + dy;
        if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
        const j = yy * w + xx;
        if (component[j] !== id) {
          inside = false;
          if (labels[j] !== TRANSPARENT) contact.set(labels[j], (contact.get(labels[j]) ?? 0) + 1);
        }
      }
      if (inside) { thick = true; break; }
    }
    if (thick || contact.size < 2) continue;
    const [a, b] = [...contact.entries()].sort((p, q) => q[1] - p[1]).map(([l]) => l);
    const span = distance(a, b);
    if (span < 12 || distance(a, label) + distance(label, b) > span * 1.2) continue;
    for (const i of list) {
      const [L, A, B] = pixelLab(i);
      const da = (L - centres[a * 3]) ** 2 + (A - centres[a * 3 + 1]) ** 2 + (B - centres[a * 3 + 2]) ** 2;
      const db = (L - centres[b * 3]) ** 2 + (A - centres[b * 3 + 1]) ** 2 + (B - centres[b * 3 + 2]) ** 2;
      updates.push([i, da <= db ? a : b]);
    }
  }
  for (const [i, l] of updates) labels[i] = l;
  return labels;
}

// ——— Tracing ———————————————————————————————————————————————————————————

function gaussian(sigma: number) {
  const radius = Math.max(1, Math.ceil(sigma * 3));
  const kernel = new Float32Array(radius * 2 + 1);
  let total = 0;
  for (let i = -radius; i <= radius; i++) { kernel[i + radius] = Math.exp(-(i * i) / (2 * sigma * sigma)); total += kernel[i + radius]; }
  for (let i = 0; i < kernel.length; i++) kernel[i] /= total;
  return { kernel, radius };
}

/** Separable blur that mirrors at the edge, so a shape touching the image
 *  border keeps a straight side there instead of a softened one. */
function blur(field: Float32Array, w: number, h: number, sigma: number) {
  const { kernel, radius } = gaussian(sigma);
  const temp = new Float32Array(w * h), out = new Float32Array(w * h);
  const mirror = (v: number, size: number) => {
    while (v < 0 || v >= size) v = v < 0 ? -v - 1 : 2 * size - v - 1;
    return v;
  };
  for (let y = 0; y < h; y++) {
    const row = y * w;
    for (let x = 0; x < w; x++) {
      let s = 0;
      if (x >= radius && x < w - radius) for (let k = -radius; k <= radius; k++) s += kernel[k + radius] * field[row + x + k];
      else for (let k = -radius; k <= radius; k++) s += kernel[k + radius] * field[row + mirror(x + k, w)];
      temp[row + x] = s;
    }
  }
  for (let y = 0; y < h; y++) {
    const inside = y >= radius && y < h - radius;
    for (let x = 0; x < w; x++) {
      let s = 0;
      if (inside) for (let k = -radius; k <= radius; k++) s += kernel[k + radius] * temp[(y + k) * w + x];
      else for (let k = -radius; k <= radius; k++) s += kernel[k + radius] * temp[mirror(y + k, h) * w + x];
      out[y * w + x] = s;
    }
  }
  return out;
}

/** Bilinear enlargement of a smooth field by a whole factor. */
function enlarge(field: Float32Array, w: number, h: number, scale: number) {
  const W = w * scale, H = h * scale, out = new Float32Array(W * H);
  const axis = (size: number, count: number) => {
    const index = new Int32Array(count), weight = new Float32Array(count);
    for (let i = 0; i < count; i++) {
      const u = Math.min(size - 1, Math.max(0, (i + 0.5) / scale - 0.5));
      index[i] = Math.min(size - 2, Math.floor(u));
      weight[i] = u - index[i];
      if (size === 1) { index[i] = 0; weight[i] = 0; }
    }
    return { index, weight };
  };
  const cols = axis(w, W), rows = axis(h, H);
  for (let Y = 0; Y < H; Y++) {
    const y0 = rows.index[Y], fy = rows.weight[Y], y1 = h > 1 ? y0 + 1 : y0;
    for (let X = 0; X < W; X++) {
      const x0 = cols.index[X], fx = cols.weight[X], x1 = w > 1 ? x0 + 1 : x0;
      const top = field[y0 * w + x0] * (1 - fx) + field[y0 * w + x1] * fx;
      const bottom = field[y1 * w + x0] * (1 - fx) + field[y1 * w + x1] * fx;
      out[Y * W + X] = top * (1 - fy) + bottom * fy;
    }
  }
  return out;
}

/** Closed iso-lines of `field` at `level`, with linear interpolation along
 *  every cell edge. Values outside the field count as 0, so every line closes.
 *  Points are returned in field sample units, where sample (x, y) sits at
 *  (x + 0.5, y + 0.5). */
export function isolines(field: Float32Array, w: number, h: number, level: number): Pt[][] {
  const at = (x: number, y: number) => (x < 0 || y < 0 || x >= w || y >= h ? 0 : field[y * w + x]);
  const stride = w + 2;
  const index = new Map<number, number>();
  const xs: number[] = [], ys: number[] = [], a: number[] = [], b: number[] = [];
  const node = (id: number, px: number, py: number) => {
    let k = index.get(id);
    if (k === undefined) { k = xs.length; index.set(id, k); xs.push(px); ys.push(py); a.push(-1); b.push(-1); }
    return k;
  };
  const link = (p: number, q: number) => {
    if (a[p] < 0) a[p] = q; else b[p] = q;
    if (a[q] < 0) a[q] = p; else b[q] = p;
  };
  const H = (x: number, y: number) => ((y + 1) * stride + (x + 1)) * 2;
  const V = (x: number, y: number) => ((y + 1) * stride + (x + 1)) * 2 + 1;
  for (let y = -1; y < h; y++) for (let x = -1; x < w; x++) {
    const v0 = at(x, y), v1 = at(x + 1, y), v2 = at(x + 1, y + 1), v3 = at(x, y + 1);
    const c = (v0 > level ? 1 : 0) | (v1 > level ? 2 : 0) | (v2 > level ? 4 : 0) | (v3 > level ? 8 : 0);
    if (c === 0 || c === 15) continue;
    const top = () => node(H(x, y), x + 0.5 + (level - v0) / (v1 - v0), y + 0.5);
    const right = () => node(V(x + 1, y), x + 1.5, y + 0.5 + (level - v1) / (v2 - v1));
    const bottom = () => node(H(x, y + 1), x + 0.5 + (level - v3) / (v2 - v3), y + 1.5);
    const left = () => node(V(x, y), x + 0.5, y + 0.5 + (level - v0) / (v3 - v0));
    const centre = (v0 + v1 + v2 + v3) / 4 > level;
    switch (c) {
      case 1: case 14: link(top(), left()); break;
      case 2: case 13: link(top(), right()); break;
      case 3: case 12: link(left(), right()); break;
      case 4: case 11: link(right(), bottom()); break;
      case 6: case 9: link(top(), bottom()); break;
      case 7: case 8: link(left(), bottom()); break;
      case 5:
        if (centre) { link(top(), right()); link(bottom(), left()); } else { link(top(), left()); link(right(), bottom()); }
        break;
      case 10:
        if (centre) { link(top(), left()); link(right(), bottom()); } else { link(top(), right()); link(left(), bottom()); }
        break;
    }
  }
  const seen = new Uint8Array(xs.length);
  const loops: Pt[][] = [];
  for (let start = 0; start < xs.length; start++) {
    if (seen[start]) continue;
    const loop: Pt[] = [];
    let previous = -1, current = start;
    while (current >= 0 && !seen[current]) {
      seen[current] = 1;
      loop.push({ x: xs[current], y: ys[current] });
      const next = a[current] !== previous && a[current] >= 0 ? a[current] : b[current];
      previous = current;
      current = next;
    }
    if (loop.length >= 3) loops.push(loop);
  }
  return loops;
}

export function polygonArea(points: Pt[]) {
  let area = 0;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) area += points[j].x * points[i].y - points[i].x * points[j].y;
  return area / 2;
}

/** Traces a 0/1 mask into smooth loops, in source pixel coordinates. The
 *  work is confined to the mask's bounding box, so a small colour costs
 *  little however large the picture is. */
export function traceMask(mask: Uint8Array, w: number, h: number, scale: number, sigma: number): Pt[][] {
  let x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let y = 0; y < h; y++) {
    const row = y * w;
    for (let x = 0; x < w; x++) if (mask[row + x]) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  }
  if (x1 < 0) return [];
  const pad = Math.ceil(sigma * 3) + 2;
  const bx = Math.max(0, x0 - pad), by = Math.max(0, y0 - pad);
  const bw = Math.min(w - 1, x1 + pad) - bx + 1, bh = Math.min(h - 1, y1 + pad) - by + 1;
  let field = new Float32Array(bw * bh);
  for (let y = 0; y < bh; y++) for (let x = 0; x < bw; x++) field[y * bw + x] = mask[(by + y) * w + bx + x];
  if (sigma > 0) field = blur(field, bw, bh, sigma);
  const fine = scale > 1 ? enlarge(field, bw, bh, scale) : field;
  return isolines(fine, bw * scale, bh * scale, 0.5).map(loop => loop.map(p => ({ x: bx + p.x / scale, y: by + p.y / scale })));
}

// ——— Curve fitting ————————————————————————————————————————————————————

type V = { x: number; y: number };
const sub = (a: V, b: V): V => ({ x: a.x - b.x, y: a.y - b.y });
const add = (a: V, b: V): V => ({ x: a.x + b.x, y: a.y + b.y });
const mul = (a: V, s: number): V => ({ x: a.x * s, y: a.y * s });
const dot = (a: V, b: V) => a.x * b.x + a.y * b.y;
const len = (a: V) => Math.hypot(a.x, a.y);
const unit = (a: V): V => { const l = len(a) || 1; return { x: a.x / l, y: a.y / l }; };

type Bez = [V, V, V, V];

function bezierAt(b: Bez, t: number): V {
  const mt = 1 - t, a = mt * mt * mt, c = 3 * mt * mt * t, d = 3 * mt * t * t, e = t * t * t;
  return { x: a * b[0].x + c * b[1].x + d * b[2].x + e * b[3].x, y: a * b[0].y + c * b[1].y + d * b[2].y + e * b[3].y };
}

function chordParameters(d: V[], first: number, last: number) {
  const u = [0];
  for (let i = first + 1; i <= last; i++) u.push(u[u.length - 1] + len(sub(d[i], d[i - 1])));
  const total = u[u.length - 1] || 1;
  return u.map(v => v / total);
}

function generate(d: V[], first: number, last: number, u: number[], t1: V, t2: V): Bez {
  let c00 = 0, c01 = 0, c11 = 0, x0 = 0, x1 = 0;
  const p0 = d[first], p3 = d[last];
  for (let i = 0; i < u.length; i++) {
    const t = u[i], mt = 1 - t;
    const b0 = mt * mt * mt, b1 = 3 * t * mt * mt, b2 = 3 * t * t * mt, b3 = t * t * t;
    const a1 = mul(t1, b1), a2 = mul(t2, b2);
    c00 += dot(a1, a1); c01 += dot(a1, a2); c11 += dot(a2, a2);
    const tmp = sub(d[first + i], add(mul(p0, b0 + b1), mul(p3, b2 + b3)));
    x0 += dot(a1, tmp); x1 += dot(a2, tmp);
  }
  const det = c00 * c11 - c01 * c01;
  let alpha1 = det ? (x0 * c11 - x1 * c01) / det : 0;
  let alpha2 = det ? (c00 * x1 - c01 * x0) / det : 0;
  const segment = len(sub(p3, p0));
  if (alpha1 < 1e-6 * segment || alpha2 < 1e-6 * segment || alpha1 > segment * 2 || alpha2 > segment * 2) alpha1 = alpha2 = segment / 3;
  return [p0, add(p0, mul(t1, alpha1)), add(p3, mul(t2, alpha2)), p3];
}

function maxError(d: V[], first: number, last: number, b: Bez, u: number[]) {
  let worst = 0, split = Math.floor((first + last) / 2);
  for (let i = first + 1; i < last; i++) {
    const p = bezierAt(b, u[i - first]);
    const e = (p.x - d[i].x) ** 2 + (p.y - d[i].y) ** 2;
    if (e >= worst) { worst = e; split = i; }
  }
  return { worst, split };
}

function reparameterise(d: V[], first: number, b: Bez, u: number[]) {
  const q1: V[] = [mul(sub(b[1], b[0]), 3), mul(sub(b[2], b[1]), 3), mul(sub(b[3], b[2]), 3)];
  const q2: V[] = [mul(sub(q1[1], q1[0]), 2), mul(sub(q1[2], q1[1]), 2)];
  return u.map((t, i) => {
    const p = bezierAt(b, t), mt = 1 - t;
    const d1 = add(add(mul(q1[0], mt * mt), mul(q1[1], 2 * mt * t)), mul(q1[2], t * t));
    const d2 = add(mul(q2[0], mt), mul(q2[1], t));
    const diff = sub(p, d[first + i]);
    const numerator = dot(diff, d1), denominator = dot(d1, d1) + dot(diff, d2);
    const next = denominator ? t - numerator / denominator : t;
    return Math.min(1, Math.max(0, next));
  });
}

function fitCubic(d: V[], first: number, last: number, t1: V, t2: V, error: number, out: Bez[], depth = 0) {
  if (last - first === 1 || depth > 24) {
    const distance = len(sub(d[last], d[first])) / 3;
    out.push([d[first], add(d[first], mul(t1, distance)), add(d[last], mul(t2, distance)), d[last]]);
    return;
  }
  let u = chordParameters(d, first, last);
  let b = generate(d, first, last, u, t1, t2);
  let { worst, split } = maxError(d, first, last, b, u);
  const limit = error * error;
  if (worst < limit) { out.push(b); return; }
  if (worst < limit * 4) {
    for (let i = 0; i < 4; i++) {
      u = reparameterise(d, first, b, u);
      b = generate(d, first, last, u, t1, t2);
      ({ worst, split } = maxError(d, first, last, b, u));
      if (worst < limit) { out.push(b); return; }
    }
  }
  split = Math.min(last - 1, Math.max(first + 1, split));
  const centre = unit(sub(d[split - 1], d[split + 1]));
  fitCubic(d, first, split, t1, centre, error, out, depth + 1);
  fitCubic(d, split, last, mul(centre, -1), t2, error, out, depth + 1);
}

/** Direction from point `i` towards the points `direction` steps away,
 *  averaged over about `reach` pixels so a staircase does not tilt it. */
function tangent(d: V[], i: number, direction: 1 | -1, reach: number, wrap: boolean): V {
  const n = d.length;
  let j = i, travelled = 0, steps = 0;
  while (travelled < reach && steps < 12) {
    const next = j + direction;
    if (!wrap && (next < 0 || next >= n)) break;
    const k = (next + n) % n;
    travelled += len(sub(d[k], d[(j + n) % n]));
    j = next;
    steps++;
  }
  const target = d[(j + n) % n];
  const t = sub(target, d[i]);
  return len(t) ? unit(t) : { x: direction, y: 0 };
}

/** Indices where the loop turns more sharply than `angle` degrees. */
function findCorners(d: V[], angle: number): number[] {
  const n = d.length, reach = 2.5, limit = Math.cos((angle * Math.PI) / 180);
  const sharp = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const back = tangent(d, i, -1, reach, true), ahead = tangent(d, i, 1, reach, true);
    // back points behind, ahead points forward: a straight run gives -1.
    const turn = -dot(back, ahead);
    sharp[i] = turn < limit ? limit - turn : 0;
  }
  const corners: number[] = [];
  for (let i = 0; i < n; i++) {
    if (!sharp[i]) continue;
    let best = true;
    for (let k = -4; k <= 4 && best; k++) if (k && sharp[(i + k + n) % n] > sharp[i]) best = false;
    if (best && (!corners.length || i - corners[corners.length - 1] > 2)) corners.push(i);
  }
  if (corners.length > 1 && corners[0] + n - corners[corners.length - 1] <= 2) corners.pop();
  return corners;
}

/** Moves a rounded corner point to where its two sides would meet, when that
 *  point is close, so a traced corner comes out square instead of blunted. */
function sharpen(d: V[], i: number): V {
  const n = d.length;
  const along = (direction: 1 | -1) => {
    const near = d[(i + direction * 3 + n) % n], far = d[(i + direction * 8 + n) % n];
    return { origin: near, dir: unit(sub(near, far)) };
  };
  const a = along(-1), b = along(1);
  const cross = a.dir.x * b.dir.y - a.dir.y * b.dir.x;
  if (Math.abs(cross) < 0.2) return d[i];
  const diff = sub(b.origin, a.origin);
  const t = (diff.x * b.dir.y - diff.y * b.dir.x) / cross;
  const meet = add(a.origin, mul(a.dir, t));
  return len(sub(meet, d[i])) < 2 ? meet : d[i];
}

/** Fits one closed loop with cubic curves, splitting it at its corners. */
export function fitLoop(points: Pt[], error: number, cornerAngle: number): VectorPath {
  const d: V[] = [];
  for (const p of points) if (!d.length || len(sub(p, d[d.length - 1])) > 1e-6) d.push(p);
  if (d.length > 1 && len(sub(d[0], d[d.length - 1])) < 1e-6) d.pop();
  const n = d.length;
  const out: Bez[] = [];
  if (n < 3) return { x: d[0]?.x ?? 0, y: d[0]?.y ?? 0, curves: [] };
  const corners = findCorners(d, cornerAngle);
  if (!corners.length) {
    const ring = [...d, d[0]];
    const t = unit(sub(d[1], d[n - 1]));
    fitCubic(ring, 0, n, t, mul(t, -1), error, out);
  } else {
    const sharp = new Map(corners.map(i => [i, sharpen(d, i)]));
    for (let c = 0; c < corners.length; c++) {
      const from = corners[c], to = corners[(c + 1) % corners.length];
      const span = to > from ? to - from : to + n - from;
      const piece: V[] = [];
      for (let k = 0; k <= span; k++) piece.push(d[(from + k) % n]);
      piece[0] = sharp.get(from)!;
      piece[piece.length - 1] = sharp.get(to)!;
      if (piece.length === 2) { fitCubic(piece, 0, 1, unit(sub(piece[1], piece[0])), unit(sub(piece[0], piece[1])), error, out); continue; }
      const t1 = tangent(piece, 0, 1, 2, false), t2 = tangent(piece, piece.length - 1, -1, 2, false);
      fitCubic(piece, 0, piece.length - 1, t1, t2, error, out);
    }
  }
  const start = out[0][0];
  return { x: start.x, y: start.y, curves: out.map(b => [b[1].x, b[1].y, b[2].x, b[2].y, b[3].x, b[3].y] as Curve) };
}

// ——— The whole pipeline ————————————————————————————————————————————————

export function vectorize(raster: Raster, options: VectorizeOptions, progress: Progress = () => {}): VectorResult {
  const { width: w, height: h } = raster;
  if (!Number.isInteger(w) || !Number.isInteger(h) || w < 1 || h < 1) throw new Error('Image dimensions must be positive whole numbers.');
  if (w * h > MAX_PIXELS) throw new Error(`Images are limited to ${MAX_PIXELS.toLocaleString('en-US')} pixels.`);
  if (raster.data.length !== w * h * 4) throw new Error('Image data must be RGBA.');
  check(options.colors, 2, 32, 'Colours'); check(options.detail, 0, 100, 'Detail');
  check(options.smoothing, 0, 100, 'Smoothing'); check(options.corners, 0, 100, 'Corners');
  if (options.threshold !== -1) check(options.threshold, 0, 255, 'Threshold');

  progress('read', 0.02);
  let pixels = readPixels(raster, options.transparent);
  if (options.denoise) { progress('denoise', 0.05); pixels = denoise(pixels); }
  const n = w * h;
  let labels: Uint8Array;
  let colours: string[];
  let threshold = -1;
  let paletteAreas = new Float64Array(0);

  if (options.mode === 'color') {
    progress('palette', 0.15);
    const centres = findPalette(pixels, Math.round(options.colors));
    labels = assignColours(pixels, centres);
    const k = centres.length / 3;
    const hidden = new Set(options.hidden.map(c => c.toLowerCase()));
    // The colour shown for each label is the average of its own pixels.
    const sums = new Float64Array(k * 4);
    for (let i = 0; i < n; i++) {
      const l = labels[i];
      if (l === TRANSPARENT) continue;
      sums[l * 4] += pixels.r[i]; sums[l * 4 + 1] += pixels.g[i]; sums[l * 4 + 2] += pixels.b[i]; sums[l * 4 + 3]++;
    }
    colours = Array.from({ length: k }, (_, l) => (sums[l * 4 + 3] ? hex(sums[l * 4] / sums[l * 4 + 3], sums[l * 4 + 1] / sums[l * 4 + 3], sums[l * 4 + 2] / sums[l * 4 + 3]) : '#000000'));
    // Hidden colours are cut out after the clean-up, so their regions still
    // absorb specks like any other colour.
    progress('clean', 0.3);
    labels = isolate(labels, w, h);
    labels = removeHalos(labels, w, h, centres, i => lab(pixels.r[i], pixels.g[i], pixels.b[i]));
    labels = despeckle(labels, w, h, speckArea(options.detail, n));
    paletteAreas = new Float64Array(k);
    for (let i = 0; i < n; i++) if (labels[i] !== TRANSPARENT) paletteAreas[labels[i]]++;
    if (hidden.size) for (let i = 0; i < n; i++) if (labels[i] !== TRANSPARENT && hidden.has(colours[labels[i]])) labels[i] = TRANSPARENT;
  } else {
    const histogram = new Float64Array(256);
    const grey = new Uint8Array(n);
    for (let i = 0; i < n; i++) {
      grey[i] = Math.round(0.299 * pixels.r[i] + 0.587 * pixels.g[i] + 0.114 * pixels.b[i]);
      if (pixels.opaque[i]) histogram[grey[i]]++;
    }
    threshold = options.threshold === -1 ? otsu(histogram) : Math.round(options.threshold);
    labels = new Uint8Array(n);
    for (let i = 0; i < n; i++) {
      const dark = grey[i] < threshold;
      labels[i] = pixels.opaque[i] && (options.invert ? !dark : dark) ? 1 : 0;
    }
    progress('clean', 0.3);
    labels = isolate(labels, w, h);
    labels = despeckle(labels, w, h, speckArea(options.detail, n));
    colours = ['#ffffff', '#000000'];
  }

  // Areas decide the stacking order: the largest colour lies at the bottom.
  const areas = new Float64Array(colours.length);
  for (let i = 0; i < n; i++) if (labels[i] !== TRANSPARENT) areas[labels[i]]++;
  const order = options.mode === 'outline'
    ? [1]
    : colours.map((_, l) => l).filter(l => areas[l] > 0).sort((a, b) => areas[b] - areas[a]);
  const rank = new Int16Array(colours.length).fill(-1);
  order.forEach((l, r) => { rank[l] = r; });

  // Tracing on a finer grid than the pixels places edges more precisely; the
  // grid is chosen so the whole job stays around the same amount of work.
  const scale = Math.max(1, Math.min(3, Math.floor(Math.sqrt(3_500_000 / n / Math.max(1, order.length / 6)))));
  const sigma = 0.45 + (options.smoothing / 100) * 0.35;
  const error = 0.4 + (options.smoothing / 100) * 1.6;
  const cornerAngle = 110 - options.corners * 0.8;
  const minLoop = Math.max(0.5, speckArea(options.detail, n) * 0.5);
  const stacked = options.mode === 'color' && options.layering === 'stacked';
  const mask = new Uint8Array(n);
  const layers: VectorLayer[] = [];
  let nodes = 0;

  order.forEach((label, r) => {
    progress('trace', 0.35 + (0.6 * r) / order.length);
    for (let i = 0; i < n; i++) {
      const l = labels[i];
      mask[i] = l === TRANSPARENT ? 0 : stacked ? (rank[l] >= r ? 1 : 0) : l === label ? 1 : 0;
    }
    const loops = traceMask(mask, w, h, scale, sigma).filter(loop => Math.abs(polygonArea(loop)) >= minLoop);
    const paths = loops.map(loop => fitLoop(loop, error, cornerAngle)).filter(p => p.curves.length);
    nodes += paths.reduce((sum, p) => sum + p.curves.length, 0);
    if (paths.length) layers.push({ color: colours[label], area: areas[label] / n, paths });
  });

  // The palette lists every colour found, hidden or not, largest first, so a
  // hidden colour can be brought back from the same place it was hidden.
  const hiddenSet = new Set(options.hidden.map(c => c.toLowerCase()));
  const palette: PaletteEntry[] = options.mode === 'color'
    ? colours.map((color, l) => ({ color, area: paletteAreas[l] / n, hidden: hiddenSet.has(color) }))
        .filter(entry => entry.area > 0)
        .sort((a, b) => b.area - a.area)
    : [{ color: '#000000', area: areas[1] / n, hidden: false }];
  progress('done', 1);
  return { width: w, height: h, layers, palette, nodes, threshold };
}

/** The smallest region kept, in pixels, for a detail setting and image size. */
export function speckArea(detail: number, pixels: number) {
  const loss = 1 - detail / 100;
  return Math.max(1, Math.round(loss * loss * loss * 0.001 * pixels));
}

// ——— Output helpers ————————————————————————————————————————————————————

/** The path as SVG path data, in the result's pixel units. */
export function pathData(path: VectorPath, digits = 2) {
  const f = (v: number) => String(Math.round(v * 10 ** digits) / 10 ** digits);
  let d = `M${f(path.x)} ${f(path.y)}`;
  for (const c of path.curves) d += `C${f(c[0])} ${f(c[1])} ${f(c[2])} ${f(c[3])} ${f(c[4])} ${f(c[5])}`;
  return d + 'Z';
}

/** Straight-line points along the path, never further than `tolerance` from the curve. */
export function flatten(path: VectorPath, tolerance: number): Pt[] {
  const points: Pt[] = [{ x: path.x, y: path.y }];
  const split = (x0: number, y0: number, x1: number, y1: number, x2: number, y2: number, x3: number, y3: number, depth: number) => {
    const dx = x3 - x0, dy = y3 - y0;
    const d1 = Math.abs((x1 - x3) * dy - (y1 - y3) * dx), d2 = Math.abs((x2 - x3) * dy - (y2 - y3) * dx);
    const chord = dx * dx + dy * dy;
    const flat = chord > 1e-12
      ? (d1 + d2) * (d1 + d2) <= tolerance * tolerance * chord
      : Math.hypot(x1 - x0, y1 - y0) + Math.hypot(x2 - x0, y2 - y0) <= tolerance;
    if (flat || depth > 14) { points.push({ x: x3, y: y3 }); return; }
    const ax = (x0 + x1) / 2, ay = (y0 + y1) / 2, bx = (x1 + x2) / 2, by = (y1 + y2) / 2, cx = (x2 + x3) / 2, cy = (y2 + y3) / 2;
    const ex = (ax + bx) / 2, ey = (ay + by) / 2, fx = (bx + cx) / 2, fy = (by + cy) / 2;
    const mx = (ex + fx) / 2, my = (ey + fy) / 2;
    split(x0, y0, ax, ay, ex, ey, mx, my, depth + 1);
    split(mx, my, fx, fy, cx, cy, x3, y3, depth + 1);
  };
  let x = path.x, y = path.y;
  for (const c of path.curves) { split(x, y, c[0], c[1], c[2], c[3], c[4], c[5], 0); x = c[4]; y = c[5]; }
  if (points.length > 1) {
    const first = points[0], last = points[points.length - 1];
    if (Math.hypot(first.x - last.x, first.y - last.y) < 1e-9) points.pop();
  }
  return points;
}
