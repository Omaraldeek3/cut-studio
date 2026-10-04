import type { Drawing, Point } from './types';

/* A check of a drawing before it goes to the machine: the problems a
   cutting program would stumble on, each with where it is, so the preview
   can show it. Only cut lines are checked; engraving may cross anything. */

export type IssueKind = 'open' | 'crossing' | 'overlap' | 'tiny' | 'outside';
export type Issue = { kind: IssueKind; at: Point[] };
/** Locations kept per kind; the count still says how many there are. */
const MAX_PLACES = 500;
/** Lines closer than this lie on top of each other. */
const SAME_LINE = 0.02;
/** A closed outline smaller than this both ways is too small to cut cleanly. */
export const TINY_MM = 1;

type Seg = { a: Point; b: Point; contour: number; index: number; count: number; closed: boolean };

/** Every problem in the drawing, by kind, with a count and where each is. */
export function checkDrawing(d: Drawing): { kind: IssueKind; count: number; at: Point[] }[] {
  const found = new Map<IssueKind, { count: number; at: Point[] }>();
  const add = (kind: IssueKind, p: Point) => { const f = found.get(kind) ?? { count: 0, at: [] }; f.count++; if (f.at.length < MAX_PLACES) f.at.push(p); found.set(kind, f); };
  const cut = d.shapes.flatMap(s => s.contours).filter(c => c.layer !== 'engrave' && !c.pen && c.points.length >= 2);
  const segs: Seg[] = [];
  cut.forEach((c, ci) => {
    const n = c.points.length;
    if (!c.closed) add('open', c.points[0]);
    else {
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for (const p of c.points) { x0 = Math.min(x0, p.x); x1 = Math.max(x1, p.x); y0 = Math.min(y0, p.y); y1 = Math.max(y1, p.y); }
      if (x1 - x0 < TINY_MM && y1 - y0 < TINY_MM) add('tiny', { x: (x0 + x1) / 2, y: (y0 + y1) / 2 });
    }
    const outside = c.points.find(p => p.x < -0.01 || p.y < -0.01 || p.x > d.width + 0.01 || p.y > d.height + 0.01);
    if (outside) add('outside', outside);
    const count = c.closed ? n : n - 1;
    for (let k = 0; k < count; k++) {
      const a = c.points[k], b = c.points[(k + 1) % n];
      if (a.x !== b.x || a.y !== b.y) segs.push({ a, b, contour: ci, index: k, count, closed: c.closed });
    }
  });
  if (segs.length > 1) {
    // Segments are bucketed by the grid cells their bounds cover, so only neighbours meet.
    let length = 0;
    for (const s of segs) length += Math.hypot(s.b.x - s.a.x, s.b.y - s.a.y);
    const cell = Math.max(0.5, length / segs.length, Math.sqrt((d.width * d.height) / segs.length));
    const grid = new Map<string, number[]>();
    segs.forEach((s, i) => {
      const gx0 = Math.floor((Math.min(s.a.x, s.b.x) - SAME_LINE) / cell), gx1 = Math.floor((Math.max(s.a.x, s.b.x) + SAME_LINE) / cell);
      const gy0 = Math.floor((Math.min(s.a.y, s.b.y) - SAME_LINE) / cell), gy1 = Math.floor((Math.max(s.a.y, s.b.y) + SAME_LINE) / cell);
      for (let x = gx0; x <= gx1; x++) for (let y = gy0; y <= gy1; y++) { const k = `${x},${y}`, l = grid.get(k); if (l) l.push(i); else grid.set(k, [i]); }
    });
    const seen = new Set<string>();
    const cross = (o: Point, p: Point, q: Point) => (p.x - o.x) * (q.y - o.y) - (p.y - o.y) * (q.x - o.x);
    for (const list of grid.values()) for (let u = 0; u < list.length; u++) for (let v = u + 1; v < list.length; v++) {
      const i = Math.min(list[u], list[v]), j = Math.max(list[u], list[v]), s = segs[i], t = segs[j];
      // Neighbouring segments of one outline share a corner by design.
      if (s.contour === t.contour) {
        const gap = Math.abs(s.index - t.index);
        if (gap <= 1 || (s.closed && gap === s.count - 1)) continue;
      }
      const key = `${i},${j}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const L = Math.hypot(s.b.x - s.a.x, s.b.y - s.a.y), M = Math.hypot(t.b.x - t.a.x, t.b.y - t.a.y);
      const d1 = cross(s.a, s.b, t.a), d2 = cross(s.a, s.b, t.b), d3 = cross(t.a, t.b, s.a), d4 = cross(t.a, t.b, s.b);
      // Lying on top of each other: both ends of one on the other's line, and sharing a stretch.
      if (Math.abs(d1) / L <= SAME_LINE && Math.abs(d2) / L <= SAME_LINE) {
        const ux = (s.b.x - s.a.x) / L, uy = (s.b.y - s.a.y) / L;
        const ta = (t.a.x - s.a.x) * ux + (t.a.y - s.a.y) * uy, tb = (t.b.x - s.a.x) * ux + (t.b.y - s.a.y) * uy;
        const lo = Math.max(0, Math.min(ta, tb)), hi = Math.min(L, Math.max(ta, tb));
        if (hi - lo > SAME_LINE && M > 0) add('overlap', { x: s.a.x + ux * (lo + hi) / 2, y: s.a.y + uy * (lo + hi) / 2 });
        continue;
      }
      if (d1 * d2 < 0 && d3 * d4 < 0) {
        const f = d1 / (d1 - d2);
        add('crossing', { x: t.a.x + (t.b.x - t.a.x) * f, y: t.a.y + (t.b.y - t.a.y) * f });
      }
    }
  }
  const order: IssueKind[] = ['outside', 'crossing', 'overlap', 'open', 'tiny'];
  return order.filter(k => found.has(k)).map(kind => ({ kind, ...found.get(kind)! }));
}
