import type { Point } from './types';
import type { Curve, Seg } from './path';

/* Turns a polyline back into the geometry it was sampled from: straight
   lines and circular arcs, which every cutting program reads natively.
   Error is measured at the vertices, because the generators and importers
   place every vertex on the true outline and only the chords between them
   cut corners. A free-form curve comes out as a chain of short arcs. */

/** A turn sharper than 30° is a corner and always stays one. */
const CORNER = Math.cos(Math.PI / 6);
/** How far an arc may bulge away from one input segment. Sampled curves
 *  stay well under this (the generators sample within 0.05 mm, SVG import
 *  within 0.09 mm), while a long straight side next to a small curve would
 *  bulge far more, so it can never be swallowed into an arc. */
const ARC_SAG = 0.1;

function clean(points: Point[], closed: boolean) {
  const d: Point[] = [];
  for (const p of points) if (!d.length || Math.hypot(p.x - d[d.length - 1].x, p.y - d[d.length - 1].y) > 1e-9) d.push(p);
  if (closed && d.length > 1 && Math.hypot(d[0].x - d[d.length - 1].x, d[0].y - d[d.length - 1].y) < 1e-9) d.pop();
  return d;
}

function circleThrough(a: Point, b: Point, c: Point) {
  const d = 2 * (a.x * (b.y - c.y) + b.x * (c.y - a.y) + c.x * (a.y - b.y));
  if (Math.abs(d) < 1e-12) return null;
  const a2 = a.x * a.x + a.y * a.y, b2 = b.x * b.x + b.y * b.y, c2 = c.x * c.x + c.y * c.y;
  const x = (a2 * (b.y - c.y) + b2 * (c.y - a.y) + c2 * (a.y - b.y)) / d;
  const y = (a2 * (c.x - b.x) + b2 * (a.x - c.x) + c2 * (b.x - a.x)) / d;
  return { x, y, r: Math.hypot(a.x - x, a.y - y) };
}

const cross = (o: Point, a: Point, b: Point) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);

/** Whether every vertex from i to j lies on the chord p[i]–p[j]. */
function straight(p: Point[], i: number, j: number, tol: number) {
  const a = p[i], b = p[j], l = Math.hypot(b.x - a.x, b.y - a.y);
  if (l < 1e-12) return false;
  for (let k = i + 1; k < j; k++) {
    if (Math.abs(cross(a, b, p[k])) / l > tol) return false;
    const t = ((p[k].x - a.x) * (b.x - a.x) + (p[k].y - a.y) * (b.y - a.y)) / (l * l);
    if (t < 0 || t > 1) return false;
  }
  return true;
}

/** The bulge of one arc from p[i] to p[j] through every vertex between, or null. */
function arc(p: Point[], i: number, j: number, tol: number): number | null {
  if (j - i < 3) return null;
  const c = circleThrough(p[i], p[(i + j) >> 1], p[j]);
  if (!c || c.r > 1e5) return null;
  const sign = Math.sign(cross(p[i], p[i + 1], p[i + 2]));
  if (!sign) return null;
  let sweep = 0;
  for (let k = i; k < j; k++) {
    if (k > i && Math.abs(Math.hypot(p[k].x - c.x, p[k].y - c.y) - c.r) > tol) return null;
    const chord = Math.hypot(p[k + 1].x - p[k].x, p[k + 1].y - p[k].y);
    if (c.r - Math.sqrt(Math.max(0, c.r * c.r - (chord * chord) / 4)) > ARC_SAG) return null;
    if (k + 2 <= j && Math.sign(cross(p[k], p[k + 1], p[k + 2])) !== sign) return null;
    let d = Math.atan2(p[k + 1].y - c.y, p[k + 1].x - c.x) - Math.atan2(p[k].y - c.y, p[k].x - c.x);
    while (d > Math.PI) d -= 2 * Math.PI;
    while (d < -Math.PI) d += 2 * Math.PI;
    sweep += d;
  }
  if (Math.abs(sweep) >= 2 * Math.PI - 1e-6) return null;
  return Math.tan(sweep / 4);
}

/** Fits one run between corners with the longest line or arc at each step. */
function fitRun(p: Point[], tol: number, out: Seg[]) {
  let i = 0;
  while (i < p.length - 1) {
    let line = i + 1;
    while (line + 1 < p.length && straight(p, i, line + 1, tol)) line++;
    // Grow the arc while it fits; a vertex or two of noise may break it early, so look a little further.
    let best = -1, bulge = 0, misses = 0;
    for (let k = i + 3; k < p.length && misses < 3; k++) {
      const b = arc(p, i, k, tol);
      if (b === null) { misses++; continue; }
      best = k; bulge = b; misses = 0;
    }
    if (best > line) { out.push({ type: 'A', to: p[best], bulge }); i = best; }
    else { out.push({ type: 'L', to: p[line] }); i = line; }
  }
}

export function fitPolyline(points: Point[], closed: boolean, tolerance: number): Curve {
  const d = clean(points, closed);
  if (d.length < 2) return { start: d[0] ?? { x: 0, y: 0 }, segs: [] };
  const n = d.length;
  if (closed && n >= 8) {
    const c = circleThrough(d[0], d[Math.floor(n / 3)], d[Math.floor((2 * n) / 3)]);
    const sag = (a: Point, b: Point) => { const l = Math.hypot(b.x - a.x, b.y - a.y); return c!.r - Math.sqrt(Math.max(0, c!.r * c!.r - (l * l) / 4)); };
    if (c && d.every((p, i) => Math.abs(Math.hypot(p.x - c.x, p.y - c.y) - c.r) <= tolerance && sag(p, d[(i + 1) % n]) <= ARC_SAG)) {
      const opposite = { x: 2 * c.x - d[0].x, y: 2 * c.y - d[0].y };
      const b = Math.sign(cross(d[0], d[1], d[2])) || 1;
      return { start: d[0], segs: [{ type: 'A', to: opposite, bulge: b }, { type: 'A', to: d[0], bulge: b }] };
    }
  }
  const turn = (i: number) => {
    const a = d[(i - 1 + n) % n], b = d[i], c = d[(i + 1) % n];
    const ux = b.x - a.x, uy = b.y - a.y, vx = c.x - b.x, vy = c.y - b.y;
    return (ux * vx + uy * vy) / (Math.hypot(ux, uy) * Math.hypot(vx, vy) || 1);
  };
  const corners: number[] = [];
  for (let i = closed ? 0 : 1; i < (closed ? n : n - 1); i++) if (turn(i) < CORNER) corners.push(i);
  let start = 0;
  if (closed && corners.length) start = corners[0];
  else if (closed) {
    // No corner to start from: begin at the longest segment, which is where
    // a straight side meets a curve rather than the middle of an arc.
    let longest = -1;
    for (let i = 0; i < n; i++) { const l = Math.hypot(d[(i + 1) % n].x - d[i].x, d[(i + 1) % n].y - d[i].y); if (l > longest) { longest = l; start = i; } }
  }
  const ring = closed ? [...d.slice(start), ...d.slice(0, start), d[start]] : d;
  const cuts = closed ? [...corners.map(c => (c - start + n) % n).filter(c => c > 0), n] : [...corners, n - 1];
  const segs: Seg[] = [];
  let from = 0;
  for (const to of cuts) { if (to > from) fitRun(ring.slice(from, to + 1), tolerance, segs); from = to; }
  return { start: ring[0], segs };
}
