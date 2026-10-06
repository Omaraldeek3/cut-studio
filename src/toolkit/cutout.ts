/* The mask the background remover works with: one byte per pixel, 0 for
   background and 255 for the subject, at the model's 1024 × 1024. Everything
   here is plain arithmetic, so it runs and tests without a browser. */

/** The model's own size: photos go in at 1024 × 1024 and the mask comes back so. */
export const MASK_SIDE = 1024;

export type MaskOptions = {
  /** Soft keeps the model's feathered edge (hair, fur); crisp makes it a clean line for cutting and engraving. */
  edge: 'soft' | 'crisp';
  /** Moves the edge in (positive) or out (negative), in percent of the edge's own range. */
  shift: number;
  /** Keeps only the largest connected subject and drops stray patches. */
  mainOnly: boolean;
};
export const defaultMask: MaskOptions = { edge: 'soft', shift: 0, mainOnly: false };

/** The connected areas of the mask above half, and the size of the largest. */
export function largestOnly(mask: Uint8Array, side: number): Uint8Array {
  const n = side * side, label = new Int32Array(n), stack = new Int32Array(n);
  let best = 0, bestSize = 0, next = 0;
  for (let start = 0; start < n; start++) {
    if (mask[start] < 128 || label[start]) continue;
    next++;
    let top = 0, size = 0;
    stack[top++] = start; label[start] = next;
    while (top) {
      const i = stack[--top], x = i % side;
      size++;
      const near = [x > 0 ? i - 1 : -1, x < side - 1 ? i + 1 : -1, i - side, i + side];
      for (const j of near) if (j >= 0 && j < n && !label[j] && mask[j] >= 128) { label[j] = next; stack[top++] = j; }
    }
    if (size > bestSize) { bestSize = size; best = next; }
  }
  const out = new Uint8Array(mask);
  if (!best) return out;
  // The soft fringe round the kept subject stays; everything round the others goes.
  const keep = new Uint8Array(n);
  for (let i = 0; i < n; i++) if (label[i] === best) keep[i] = 1;
  const reach = 6;
  const near = grow(keep, side, reach);
  for (let i = 0; i < n; i++) if (!near[i]) out[i] = 0;
  return out;
}

/** The pixels within `r` of a set pixel (square reach, two separable passes). */
function grow(set: Uint8Array, side: number, r: number): Uint8Array {
  const row = new Uint8Array(set.length), out = new Uint8Array(set.length);
  for (let y = 0; y < side; y++) {
    let last = -Infinity;
    for (let x = 0; x < side; x++) { if (set[y * side + x]) last = x; if (x - last <= r) row[y * side + x] = 1; }
    last = Infinity;
    for (let x = side - 1; x >= 0; x--) { if (set[y * side + x]) last = x; if (last - x <= r) row[y * side + x] = 1; }
  }
  for (let x = 0; x < side; x++) {
    let last = -Infinity;
    for (let y = 0; y < side; y++) { if (row[y * side + x]) last = y; if (y - last <= r) out[y * side + x] = 1; }
    last = Infinity;
    for (let y = side - 1; y >= 0; y--) { if (row[y * side + x]) last = y; if (last - y <= r) out[y * side + x] = 1; }
  }
  return out;
}

/** The mask with the chosen edge: soft or crisp, moved in or out. */
export function refine(mask: Uint8Array, side: number, o: MaskOptions): Uint8Array {
  const base = o.mainOnly ? largestOnly(mask, side) : mask;
  const centre = 128 + (o.shift / 100) * 100, width = o.edge === 'crisp' ? 24 : 255;
  const lo = centre - width / 2, out = new Uint8Array(base.length);
  for (let i = 0; i < base.length; i++) {
    const v = ((base[i] - lo) / width) * 255;
    out[i] = v <= 0 ? 0 : v >= 255 ? 255 : Math.round(v);
  }
  return out;
}

/** The share of the picture the subject covers, 0 to 1. */
export function coverage(mask: Uint8Array) {
  let on = 0;
  for (let i = 0; i < mask.length; i++) if (mask[i] >= 128) on++;
  return on / Math.max(1, mask.length);
}
