import type { Point } from './types';

/* Exact outlines. A contour's polyline is enough to nest and preview; files
   need the real geometry: straight lines, circular arcs (stored the way DXF
   stores them, as a bulge) and cubic Béziers. Drawing coordinates are y-down;
   bulge = tan(sweep / 4), with the sweep measured by atan2 in those
   coordinates, so a positive bulge is SVG's sweep-flag 1. */

export type Seg =
  | { type: 'L'; to: Point }
  | { type: 'A'; to: Point; bulge: number }
  | { type: 'C'; c1: Point; c2: Point; to: Point };
export type Curve = { start: Point; segs: Seg[] };

export function arcCenter(a: Point, b: Point, bulge: number) {
  const sweep = 4 * Math.atan(bulge);
  const chord = Math.hypot(b.x - a.x, b.y - a.y);
  const radius = chord / (2 * Math.abs(Math.sin(sweep / 2)));
  // From the chord's middle to the centre: to the left of the chord for a
  // positive sweep under half a turn, to the right for a larger one.
  const h = chord / 2 / Math.tan(sweep / 2);
  const nx = -(b.y - a.y) / chord, ny = (b.x - a.x) / chord;
  const center = { x: (a.x + b.x) / 2 + nx * h, y: (a.y + b.y) / 2 + ny * h };
  return { center, radius, start: Math.atan2(a.y - center.y, a.x - center.x), sweep };
}

export function arcPoint(a: Point, b: Point, bulge: number, t: number): Point {
  const { center, radius, start, sweep } = arcCenter(a, b, bulge);
  const angle = start + sweep * t;
  return { x: center.x + radius * Math.cos(angle), y: center.y + radius * Math.sin(angle) };
}

/** The arc as cubic Béziers of at most 90° each. */
export function arcToCubics(a: Point, seg: { to: Point; bulge: number }): Seg[] {
  const { center, radius, start, sweep } = arcCenter(a, seg.to, seg.bulge);
  const pieces = Math.max(1, Math.ceil(Math.abs(sweep) / (Math.PI / 2) - 1e-9));
  const step = sweep / pieces, k = (4 / 3) * Math.tan(step / 4);
  const out: Seg[] = [];
  let p0 = a;
  for (let i = 0; i < pieces; i++) {
    const t0 = start + step * i, t1 = t0 + step;
    const p1 = i === pieces - 1 ? seg.to : { x: center.x + radius * Math.cos(t1), y: center.y + radius * Math.sin(t1) };
    out.push({
      type: 'C',
      c1: { x: p0.x - k * radius * Math.sin(t0), y: p0.y + k * radius * Math.cos(t0) },
      c2: { x: p1.x + k * radius * Math.sin(t1), y: p1.y - k * radius * Math.cos(t1) },
      to: p1,
    });
    p0 = p1;
  }
  return out;
}

export function circleCurve(cx: number, cy: number, r: number): Curve {
  return { start: { x: cx + r, y: cy }, segs: [{ type: 'A', to: { x: cx - r, y: cy }, bulge: 1 }, { type: 'A', to: { x: cx + r, y: cy }, bulge: 1 }] };
}

/** Points along the curve, never further than `tolerance` from it. */
export function flattenCurve(curve: Curve, closed: boolean, tolerance: number): Point[] {
  const out: Point[] = [curve.start];
  let at = curve.start;
  const split = (p0: Point, p1: Point, p2: Point, p3: Point, depth: number) => {
    const dx = p3.x - p0.x, dy = p3.y - p0.y, chord = Math.hypot(dx, dy) || 1e-12;
    const d1 = Math.abs((p1.x - p3.x) * dy - (p1.y - p3.y) * dx) / chord, d2 = Math.abs((p2.x - p3.x) * dy - (p2.y - p3.y) * dx) / chord;
    if (d1 + d2 <= tolerance || depth > 16) { out.push(p3); return; }
    const m = (u: Point, v: Point) => ({ x: (u.x + v.x) / 2, y: (u.y + v.y) / 2 });
    const a = m(p0, p1), b = m(p1, p2), c = m(p2, p3), e = m(a, b), f = m(b, c), g = m(e, f);
    split(p0, a, e, g, depth + 1); split(g, f, c, p3, depth + 1);
  };
  for (const s of curve.segs) {
    if (s.type === 'L') out.push(s.to);
    else if (s.type === 'A') {
      const { radius, sweep } = arcCenter(at, s.to, s.bulge);
      const step = radius > tolerance ? 2 * Math.acos(1 - tolerance / radius) : Math.PI / 4;
      const n = Number.isFinite(radius) ? Math.max(2, Math.ceil(Math.abs(sweep) / step)) : 1;
      for (let i = 1; i < n; i++) out.push(arcPoint(at, s.to, s.bulge, i / n));
      out.push(s.to);
    } else split(at, s.c1, s.c2, s.to, 0);
    at = s.to;
  }
  if (closed && out.length > 1) {
    const first = out[0], last = out[out.length - 1];
    if (Math.hypot(first.x - last.x, first.y - last.y) < 1e-9) out.pop();
  }
  return out;
}

/** The same outline walked the other way. */
export function reverseCurve(curve: Curve): Curve {
  const ends = [curve.start, ...curve.segs.map(s => s.to)];
  const segs: Seg[] = [];
  for (let i = curve.segs.length - 1; i >= 0; i--) {
    const s = curve.segs[i], to = ends[i];
    if (s.type === 'L') segs.push({ type: 'L', to });
    else if (s.type === 'A') segs.push({ type: 'A', to, bulge: -s.bulge });
    else segs.push({ type: 'C', c1: s.c2, c2: s.c1, to });
  }
  return { start: ends[ends.length - 1], segs };
}

/** Maps a curve through `fn`. Arcs stay arcs when `fn` is a similarity
 *  (checked on a unit frame), and become cubics otherwise. */
export function mapCurve(curve: Curve, fn: (p: Point) => Point): Curve {
  const o = fn({ x: 0, y: 0 }), ex = fn({ x: 1, y: 0 }), ey = fn({ x: 0, y: 1 });
  const ax = { x: ex.x - o.x, y: ex.y - o.y }, ay = { x: ey.x - o.x, y: ey.y - o.y };
  const la = Math.hypot(ax.x, ax.y), lb = Math.hypot(ay.x, ay.y), scale = Math.max(1, la, lb);
  const similar = Math.abs(la - lb) < 1e-9 * scale && Math.abs(ax.x * ay.x + ax.y * ay.y) < 1e-9 * scale * scale;
  const flip = ax.x * ay.y - ax.y * ay.x < 0 ? -1 : 1;
  const segs: Seg[] = [];
  let at = curve.start;
  for (const s of curve.segs) {
    if (s.type === 'L') segs.push({ type: 'L', to: fn(s.to) });
    else if (s.type === 'C') segs.push({ type: 'C', c1: fn(s.c1), c2: fn(s.c2), to: fn(s.to) });
    else if (similar) segs.push({ type: 'A', to: fn(s.to), bulge: s.bulge * flip });
    else for (const c of arcToCubics(at, s)) if (c.type === 'C') segs.push({ type: 'C', c1: fn(c.c1), c2: fn(c.c2), to: fn(c.to) });
    at = s.to;
  }
  return { start: fn(curve.start), segs };
}

/** SVG path data for the curve, in its own units. */
export function curveToSvg(curve: Curve, closed: boolean, digits = 5): string {
  const f = (v: number) => String(Math.round(v * 10 ** digits) / 10 ** digits);
  const p = (q: Point) => `${f(q.x)} ${f(q.y)}`;
  let d = `M${p(curve.start)}`, at = curve.start;
  for (const s of curve.segs) {
    if (s.type === 'L') d += ` L${p(s.to)}`;
    else if (s.type === 'C') d += ` C${p(s.c1)} ${p(s.c2)} ${p(s.to)}`;
    else {
      const { radius, sweep } = arcCenter(at, s.to, s.bulge);
      d += ` A${f(radius)} ${f(radius)} 0 ${Math.abs(sweep) > Math.PI ? 1 : 0} ${s.bulge > 0 ? 1 : 0} ${p(s.to)}`;
    }
    at = s.to;
  }
  return closed ? d + ' Z' : d;
}
