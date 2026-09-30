import type { Contour, Drawing, Point } from '../../src/toolkit/types';

/* Measures what makes a file need "delete overlap" or manual cleanup before
   cutting: cut lines drawn twice, cut lines crossing each other, open paths
   and node counts. Engrave contours are counted but not checked. */

const EPS = 0.02; // mm

type Segment = [Point, Point];
const len = (a: Point, b: Point) => Math.hypot(b.x - a.x, b.y - a.y);

function segments(c: Contour): Segment[] {
  const s: Segment[] = [], n = c.points.length;
  for (let i = 0; i < n - 1; i++) s.push([c.points[i], c.points[i + 1]]);
  if (c.closed && n > 2) s.push([c.points[n - 1], c.points[0]]);
  return s;
}

/** Length along which two segments lie on top of each other (0 unless collinear). */
function overlap(a: Segment, b: Segment) {
  const L = len(a[0], a[1]);
  if (L < 1e-9) return 0;
  const ux = (a[1].x - a[0].x) / L, uy = (a[1].y - a[0].y) / L;
  const off = (p: Point) => Math.abs((p.x - a[0].x) * uy - (p.y - a[0].y) * ux);
  if (off(b[0]) > EPS || off(b[1]) > EPS) return 0;
  const t = (p: Point) => (p.x - a[0].x) * ux + (p.y - a[0].y) * uy;
  return Math.max(0, Math.min(L, Math.max(t(b[0]), t(b[1]))) - Math.max(0, Math.min(t(b[0]), t(b[1]))));
}

function crosses(a: Segment, b: Segment) {
  const d = (p: Point, q: Point, r: Point) => (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x);
  const d1 = d(a[0], a[1], b[0]), d2 = d(a[0], a[1], b[1]), d3 = d(b[0], b[1], a[0]), d4 = d(b[0], b[1], a[1]);
  return ((d1 > 1e-9 && d2 < -1e-9) || (d1 < -1e-9 && d2 > 1e-9)) && ((d3 > 1e-9 && d4 < -1e-9) || (d3 < -1e-9 && d4 > 1e-9));
}

export function audit(d: Drawing) {
  const cut: { c: Contour; s: Segment[]; box: number[] }[] = [];
  let engrave = 0, points = 0, openCut = 0, cutLength = 0;
  for (const shape of d.shapes) for (const c of shape.contours) {
    if (c.layer === 'engrave') { engrave++; continue; }
    const s = segments(c);
    points += c.points.length;
    if (!c.closed) openCut++;
    for (const [a, b] of s) cutLength += len(a, b);
    const xs = c.points.map(p => p.x), ys = c.points.map(p => p.y);
    cut.push({ c, s, box: [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)] });
  }
  const near = (a: number[], b: number[]) => a[0] <= b[2] + EPS && b[0] <= a[2] + EPS && a[1] <= b[3] + EPS && b[1] <= a[3] + EPS;
  let duplicate = 0, crossings = 0, selfCrossings = 0;
  for (let i = 0; i < cut.length; i++) {
    const s = cut[i].s;
    if (s.length < 400) for (let a = 0; a < s.length; a++) for (let b = a + 2; b < s.length; b++) {
      if (a === 0 && b === s.length - 1 && cut[i].c.closed) continue;
      if (crosses(s[a], s[b])) selfCrossings++;
    }
    for (let j = i + 1; j < cut.length; j++) {
      if (!near(cut[i].box, cut[j].box)) continue;
      for (const a of cut[i].s) for (const b of cut[j].s) { duplicate += overlap(a, b); if (crosses(a, b)) crossings++; }
    }
  }
  return {
    contours: cut.length, engrave, points, openCut,
    duplicateMm: Math.round(duplicate * 10) / 10,
    crossings, selfCrossings, cutMm: Math.round(cutLength * 10) / 10,
  };
}
