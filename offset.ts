import { isolines } from './vectorize';

/* Offsetting a shape by a distance, done on a fine raster instead of on the
   geometry. A polygon offset has to untangle self-intersections, loops at
   sharp corners and overlapping parts; a distance field has none of those:
   every pixel simply knows how far it is from the shape, and the outline at
   any distance is one iso-line of that field. Overlapping letters weld,
   nearby parts merge, holes close, and corners come out rounded, which is
   what a laser, a router or a plotter follows most cleanly. */

type Pt = { x: number; y: number };
const FAR = 1e20;

/** One-dimensional squared distance transform (Felzenszwalb & Huttenlocher). */
function transform1d(f: Float64Array, n: number, d: Float64Array, v: Int32Array, z: Float64Array) {
  let k = 0;
  v[0] = 0; z[0] = -Infinity; z[1] = Infinity;
  for (let q = 1; q < n; q++) {
    let s = ((f[q] + q * q) - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
    while (s <= z[k]) {
      k--;
      s = ((f[q] + q * q) - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
    }
    k++;
    v[k] = q; z[k] = s; z[k + 1] = Infinity;
  }
  k = 0;
  for (let q = 0; q < n; q++) {
    while (z[k + 1] < q) k++;
    d[q] = (q - v[k]) * (q - v[k]) + f[v[k]];
  }
}

/** Exact Euclidean distance, in pixels, from every pixel centre to the
 *  nearest pixel where `target(i)` holds. */
export function distanceField(w: number, h: number, target: (i: number) => boolean): Float32Array {
  const grid = new Float64Array(w * h);
  for (let i = 0; i < w * h; i++) grid[i] = target(i) ? 0 : FAR;
  const n = Math.max(w, h);
  const f = new Float64Array(n), d = new Float64Array(n), v = new Int32Array(n), z = new Float64Array(n + 1);
  for (let x = 0; x < w; x++) {
    for (let y = 0; y < h; y++) f[y] = grid[y * w + x];
    transform1d(f, h, d, v, z);
    for (let y = 0; y < h; y++) grid[y * w + x] = d[y];
  }
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) f[x] = grid[y * w + x];
    transform1d(f, w, d, v, z);
    for (let x = 0; x < w; x++) grid[y * w + x] = d[x];
  }
  const out = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) out[i] = Math.sqrt(grid[i]);
  return out;
}

/** Fills every enclosed hole in a 0/1 mask, so only the outer outline remains. */
export function fillHoles(mask: Uint8Array, w: number, h: number): Uint8Array {
  const outside = new Uint8Array(w * h);
  const stack: number[] = [];
  const seed = (i: number) => { if (!mask[i] && !outside[i]) { outside[i] = 1; stack.push(i); } };
  for (let x = 0; x < w; x++) { seed(x); seed((h - 1) * w + x); }
  for (let y = 0; y < h; y++) { seed(y * w); seed(y * w + w - 1); }
  while (stack.length) {
    const i = stack.pop()!, x = i % w;
    if (x > 0) seed(i - 1);
    if (x < w - 1) seed(i + 1);
    if (i >= w) seed(i - w);
    if (i < w * (h - 1)) seed(i + w);
  }
  const out = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) out[i] = outside[i] ? 0 : 1;
  return out;
}

/** Outlines at `distance` pixels from the shape: outward when positive,
 *  inward when negative, the shape's own edge at zero. The raster must have
 *  room around the shape for an outward offset. Loops are in pixel units. */
export function offsetLoops(mask: Uint8Array, w: number, h: number, distance: number): Pt[][] {
  let field: Float32Array;
  if (distance >= 0) {
    // A pixel centre is half a pixel from the edge it sits against.
    const reach = distance + 0.5;
    const d = distanceField(w, h, i => mask[i] === 1);
    field = new Float32Array(w * h);
    for (let i = 0; i < w * h; i++) field[i] = reach - d[i];
  } else {
    const reach = -distance + 0.5;
    const d = distanceField(w, h, i => mask[i] === 0);
    field = new Float32Array(w * h);
    for (let i = 0; i < w * h; i++) field[i] = d[i] - reach;
  }
  return isolines(field, w, h, 0);
}
