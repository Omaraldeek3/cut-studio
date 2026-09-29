import type { Point } from './types';
import type { Seg } from './path';
import { flattenCurve } from './path';

/* DXF R12 has lines and arcs but no Béziers, so each cubic becomes a chain
   of biarcs: two arcs meeting tangentially at a joint chosen so both tangent
   lines have the same length. A piece that strays further than the tolerance
   is split in half and tried again. */

type Cubic = { c1: Point; c2: Point; to: Point };

const unit = (x: number, y: number) => { const l = Math.hypot(x, y); return l > 1e-12 ? { x: x / l, y: y / l } : null; };

/** Bulge of the arc leaving `a` along unit tangent `t` and ending at `b`. */
function bulgeFrom(a: Point, t: Point, b: Point) {
  const dx = b.x - a.x, dy = b.y - a.y;
  // The tangent-chord angle is half the arc's sweep; bulge is tan(sweep / 4).
  return Math.tan(Math.atan2(t.x * dy - t.y * dx, t.x * dx + t.y * dy) / 2);
}

function biarc(p0: Point, s: Cubic): Seg[] | null {
  const t0 = unit(s.c1.x - p0.x, s.c1.y - p0.y) ?? unit(s.c2.x - p0.x, s.c2.y - p0.y);
  const t1 = unit(s.to.x - s.c2.x, s.to.y - s.c2.y) ?? unit(s.to.x - s.c1.x, s.to.y - s.c1.y);
  if (!t0 || !t1) return null;
  const v = { x: s.to.x - p0.x, y: s.to.y - p0.y }, t = { x: t0.x + t1.x, y: t0.y + t1.y };
  // |v - d(t0 + t1)| = 2d, for the tangent length d.
  const a = 2 * (1 - (t0.x * t1.x + t0.y * t1.y)), b = 2 * (v.x * t.x + v.y * t.y), c = -(v.x * v.x + v.y * v.y);
  const d = Math.abs(a) < 1e-12 ? (b > 1e-12 ? -c / b : NaN) : (-b + Math.sqrt(b * b - 4 * a * c)) / (2 * a);
  if (!Number.isFinite(d) || d <= 1e-12) return null;
  const joint = { x: (p0.x + d * t0.x + s.to.x - d * t1.x) / 2, y: (p0.y + d * t0.y + s.to.y - d * t1.y) / 2 };
  const first = bulgeFrom(p0, t0, joint), second = -bulgeFrom(s.to, { x: -t1.x, y: -t1.y }, joint);
  const piece = (to: Point, bulge: number): Seg => (Math.abs(bulge) < 1e-9 ? { type: 'L', to } : { type: 'A', to, bulge });
  return [piece(joint, first), piece(s.to, second)];
}

const segmentDistance = (p: Point, a: Point, b: Point) => {
  const dx = b.x - a.x, dy = b.y - a.y, l = dx * dx + dy * dy;
  const t = l ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / l)) : 0;
  return Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy);
};

export function cubicToArcs(from: Point, seg: Cubic, tolerance: number, depth = 0): Seg[] {
  const arcs = biarc(from, seg);
  if (arcs) {
    const exact = flattenCurve({ start: from, segs: [{ type: 'C', ...seg }] }, false, tolerance / 8);
    const approx = flattenCurve({ start: from, segs: arcs }, false, tolerance / 8);
    const off = (p: Point) => { let best = Infinity; for (let i = 0; i < approx.length - 1; i++) best = Math.min(best, segmentDistance(p, approx[i], approx[i + 1])); return best; };
    if (exact.every(p => off(p) <= tolerance * 0.75)) return arcs;
  }
  if (depth >= 12) return [{ type: 'L', to: seg.to }];
  const m = (a: Point, b: Point) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
  const a = m(from, seg.c1), b = m(seg.c1, seg.c2), c = m(seg.c2, seg.to), e = m(a, b), f = m(b, c), g = m(e, f);
  return [...cubicToArcs(from, { c1: a, c2: e, to: g }, tolerance, depth + 1), ...cubicToArcs(g, { c1: f, c2: c, to: seg.to }, tolerance, depth + 1)];
}
