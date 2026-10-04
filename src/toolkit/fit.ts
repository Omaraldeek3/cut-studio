import type { Point } from './types';
import type { Curve, Seg } from './path';
import { flattenCurve } from './path';

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

/** Simplifies an outline within `tolerance` mm. Every run of segments that
 *  stays that close to one straight line becomes that line, so a nearly
 *  straight stretch a tracer left full of nodes becomes two nodes; a run of
 *  smooth curves becomes one cubic with the same end tangents. */
export function straightenCurve(curve: Curve, tolerance: number): Curve {
  // Checks run on samples, so they keep a margin under the promised tolerance.
  const limit = tolerance * 0.9;
  const n = curve.segs.length, ends = [curve.start, ...curve.segs.map(s => s.to)];
  // Each segment as points along it, ending at its end; its start is ends[i].
  const along = curve.segs.map((s, i) => flattenCurve({ start: ends[i], segs: [s] }, false, tolerance / 4).slice(1));
  const unit = (x: number, y: number) => { const l = Math.hypot(x, y); return l > 1e-12 ? { x: x / l, y: y / l } : null; };
  // Directions leaving a segment's start and entering its end.
  const head = (i: number) => { const s = curve.segs[i], a = ends[i]; const q = s.type === 'C' ? (Math.hypot(s.c1.x - a.x, s.c1.y - a.y) > 1e-9 ? s.c1 : s.c2) : s.type === 'A' ? along[i][0] : s.to; return unit(q.x - a.x, q.y - a.y); };
  const tail = (i: number) => { const s = curve.segs[i], b = s.to; const q = s.type === 'C' ? (Math.hypot(s.c2.x - b.x, s.c2.y - b.y) > 1e-9 ? s.c2 : s.c1) : s.type === 'A' ? (along[i].at(-2) ?? ends[i]) : ends[i]; return unit(b.x - q.x, b.y - q.y); };
  const line = (i: number, j: number) => {
    const a = ends[i], b = ends[j + 1], l = Math.hypot(b.x - a.x, b.y - a.y);
    if (l < 1e-9) return false;
    const slack = limit / l;
    for (let k = i; k <= j; k++) for (const p of along[k]) {
      if (Math.abs(cross(a, b, p)) / l > limit) return false;
      const t = ((p.x - a.x) * (b.x - a.x) + (p.y - a.y) * (b.y - a.y)) / (l * l);
      if (t < -slack || t > 1 + slack) return false;
    }
    return true;
  };
  // One cubic through segments i..j, keeping both end tangents, or null.
  const cubic = (i: number, j: number): Seg | null => {
    for (let k = i; k < j; k++) { const a = tail(k), b = head(k + 1); if (!a || !b || a.x * b.x + a.y * b.y < CORNER) return null; }
    const t1 = head(i), t2 = tail(j);
    if (!t1 || !t2) return null;
    const p0 = ends[i], p3 = ends[j + 1], pts = [p0];
    for (let k = i; k <= j; k++) pts.push(...along[k]);
    const u = [0];
    for (let k = 1; k < pts.length; k++) u.push(u[k - 1] + Math.hypot(pts[k].x - pts[k - 1].x, pts[k].y - pts[k - 1].y));
    const total = u[u.length - 1];
    if (total < 1e-9) return null;
    for (let k = 0; k < u.length; k++) u[k] /= total;
    const at = (c1: Point, c2: Point, t: number) => { const m = 1 - t; return { x: m * m * m * p0.x + 3 * m * m * t * c1.x + 3 * m * t * t * c2.x + t * t * t * p3.x, y: m * m * m * p0.y + 3 * m * m * t * c1.y + 3 * m * t * t * c2.y + t * t * t * p3.y }; };
    // Least-squares handle lengths along the fixed tangents, then each point's
    // parameter moved to its nearest place on the curve and fitted again (Schneider).
    let c1 = p0, c2 = p3;
    for (let round = 0; round < 6; round++) {
      let c00 = 0, c01 = 0, c11 = 0, x0 = 0, x1 = 0;
      pts.forEach((p, k) => {
        const t = u[k], m = 1 - t, b1 = 3 * m * m * t, b2 = 3 * m * t * t;
        const a1 = { x: t1.x * b1, y: t1.y * b1 }, a2 = { x: -t2.x * b2, y: -t2.y * b2 };
        const base = at(p0, p3, t);
        c00 += a1.x * a1.x + a1.y * a1.y; c01 += a1.x * a2.x + a1.y * a2.y; c11 += a2.x * a2.x + a2.y * a2.y;
        x0 += a1.x * (p.x - base.x) + a1.y * (p.y - base.y); x1 += a2.x * (p.x - base.x) + a2.y * (p.y - base.y);
      });
      const det = c00 * c11 - c01 * c01;
      if (Math.abs(det) < 1e-12) return null;
      const l1 = (x0 * c11 - x1 * c01) / det, l2 = (c00 * x1 - c01 * x0) / det;
      if (!(l1 > 1e-6 && l2 > 1e-6) || l1 > 2 * total || l2 > 2 * total) return null;
      c1 = { x: p0.x + t1.x * l1, y: p0.y + t1.y * l1 }; c2 = { x: p3.x - t2.x * l2, y: p3.y - t2.y * l2 };
      for (let k = 1; k < u.length - 1; k++) {
        const t = u[k], m = 1 - t, q = at(c1, c2, t), p = pts[k];
        const d1 = { x: 3 * (m * m * (c1.x - p0.x) + 2 * m * t * (c2.x - c1.x) + t * t * (p3.x - c2.x)), y: 3 * (m * m * (c1.y - p0.y) + 2 * m * t * (c2.y - c1.y) + t * t * (p3.y - c2.y)) };
        const d2 = { x: 6 * (m * (c2.x - 2 * c1.x + p0.x) + t * (p3.x - 2 * c2.x + c1.x)), y: 6 * (m * (c2.y - 2 * c1.y + p0.y) + t * (p3.y - 2 * c2.y + c1.y)) };
        const num = (q.x - p.x) * d1.x + (q.y - p.y) * d1.y, den = d1.x * d1.x + d1.y * d1.y + (q.x - p.x) * d2.x + (q.y - p.y) * d2.y;
        if (Math.abs(den) > 1e-12) u[k] = Math.max(0, Math.min(1, t - num / den));
      }
    }
    // Every original point must lie within tolerance of the new curve.
    const samples = Array.from({ length: 65 }, (_, k) => at(c1, c2, k / 64));
    const far = (p: Point) => { let best = Infinity; for (let k = 0; k < 64; k++) { const a = samples[k], b = samples[k + 1], dx = b.x - a.x, dy = b.y - a.y, l2 = dx * dx + dy * dy, t = l2 ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2)) : 0; best = Math.min(best, Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy)); } return best > limit; };
    if (pts.some(far)) return null;
    // And the new curve must stay within tolerance of the original points.
    const ring = (q: Point) => { let best = Infinity; for (let k = 0; k + 1 < pts.length; k++) { const a = pts[k], b = pts[k + 1], dx = b.x - a.x, dy = b.y - a.y, l2 = dx * dx + dy * dy, t = l2 ? Math.max(0, Math.min(1, ((q.x - a.x) * dx + (q.y - a.y) * dy) / l2)) : 0; best = Math.min(best, Math.hypot(q.x - a.x - t * dx, q.y - a.y - t * dy)); } return best > limit; };
    if (samples.some(ring)) return null;
    return { type: 'C', c1, c2, to: p3 };
  };
  const segs: Seg[] = [];
  for (let i = 0; i < n;) {
    let j = i;
    while (j + 1 < n && line(i, j + 1)) j++;
    if (j > i || (curve.segs[i].type !== 'L' && line(i, i))) { segs.push({ type: 'L', to: ends[j + 1] }); i = j + 1; continue; }
    let k = i, best: Seg | null = null;
    for (let c = k + 1 < n ? cubic(i, k + 1) : null; c; c = k + 1 < n ? cubic(i, k + 1) : null) { best = c; k++; }
    if (best && k > i) { segs.push(best); i = k + 1; } else { segs.push(curve.segs[i]); i++; }
  }
  return { start: curve.start, segs };
}
