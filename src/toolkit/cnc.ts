import type { Contour, Drawing, Point, Shape } from './types';
import { offsetContours } from './vector-ops';

/* Getting any drawing ready for a CNC router. A round bit cannot cut a sharp
   inside corner: it leaves a fillet its own radius wide, and a square tab
   will not seat. A dogbone, a relief circle the size of the bit through the
   corner, lets it. The same bit cannot enter a hole or slot narrower than
   itself. Holding tabs, as gaps in each part's outline, keep cut parts in the
   sheet when the cutting program has none of its own. */

export type CncOptions = {
  /** Bit diameter, mm. */
  bit: number;
  dogbones: boolean;
  /** Inside corners up to this angle (degrees, measured on the cutter's side) get a dogbone. */
  maxAngle: number;
  /** Holding tabs per part outline (0 for none), and each tab's width in mm. */
  tabs: number; tabWidth: number;
};
export const defaultCnc: CncOptions = { bit: 6, dogbones: true, maxAngle: 135, tabs: 0, tabWidth: 6 };

export type CncResult = { drawing: Drawing; dogbones: number; tooNarrow: number; tooNarrowAt: Point[]; tabs: number };

const area = (p: Point[]) => { let s = 0; for (let i = 0; i < p.length; i++) { const a = p[i], b = p[(i + 1) % p.length]; s += a.x * b.y - b.x * a.y; } return s / 2; };
function inside(p: Point, poly: Point[]) { let yes = false; for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) { const a = poly[i], b = poly[j]; if ((a.y > p.y) !== (b.y > p.y) && p.x < (b.x - a.x) * (p.y - a.y) / (b.y - a.y) + a.x) yes = !yes; } return yes; }
const unit = (a: Point, b: Point) => { const l = Math.hypot(b.x - a.x, b.y - a.y); return l > 1e-12 ? { x: (b.x - a.x) / l, y: (b.y - a.y) / l } : null; };

/** The loop with a dogbone at every corner the cutter cannot reach. The cutter
 *  runs on the left of travel when `cutterLeft`. Returns the new loop and how
 *  many dogbones it has. */
export function dogboneLoop(points: Point[], radius: number, cutterLeft: boolean, maxAngle: number): { points: Point[]; added: number } {
  const n = points.length, out: Point[] = [];
  let added = 0;
  // A turn of at least this much leaves a corner of at most maxAngle on the cutter's side.
  const minTurn = Math.PI - (maxAngle * Math.PI) / 180;
  for (let i = 0; i < n; i++) {
    const prev = points[(i + n - 1) % n], v = points[i], next = points[(i + 1) % n];
    out.push(v);
    const din = unit(prev, v), dout = unit(v, next);
    if (!din || !dout) continue;
    const cross = din.x * dout.y - din.y * dout.x, turn = Math.atan2(cross, din.x * dout.x + din.y * dout.y);
    // The corner is convex on the cutter's side when the path turns towards it.
    if ((cutterLeft ? turn : -turn) < minTurn - 1e-9) continue;
    // The bit's centre sits on the bisector, on the cutter's side, one radius from the corner.
    // dout − din points into the side the path turns towards, which here is the cutter's.
    const w = unit({ x: 0, y: 0 }, { x: dout.x - din.x, y: dout.y - din.y });
    if (!w) continue;
    const c = { x: v.x + radius * w.x, y: v.y + radius * w.y }, start = Math.atan2(v.y - c.y, v.x - c.x);
    // Round the relief circle from the corner and back to it, the way the path turns.
    const steps = Math.max(12, Math.ceil((2 * Math.PI * radius) / 0.2)), dir = cutterLeft ? -1 : 1;
    for (let k = 1; k < steps; k++) { const a = start + dir * (2 * Math.PI * k) / steps; out.push({ x: c.x + radius * Math.cos(a), y: c.y + radius * Math.sin(a) }); }
    out.push({ ...v });
    added++;
  }
  return { points: out, added };
}

/** Splits a closed part outline into open runs with `count` gaps of `width` mm, evenly spaced. */
export function tabbedLoop(points: Point[], count: number, width: number): Point[][] {
  const n = points.length, cum = [0];
  for (let i = 0; i < n; i++) { const a = points[i], b = points[(i + 1) % n]; cum.push(cum[i] + Math.hypot(b.x - a.x, b.y - a.y)); }
  const total = cum[n];
  if (count <= 0 || total <= count * width * 2) return [[...points, points[0]]];
  // The point `d` mm along the loop, d in [0, 2 × total).
  const at = (d: number) => {
    const lap = d >= total ? total : 0, t = d - lap;
    let i = 0; while (i < n - 1 && cum[i + 1] < t) i++;
    const a = points[i], b = points[(i + 1) % n], f = cum[i + 1] > cum[i] ? (t - cum[i]) / (cum[i + 1] - cum[i]) : 0;
    return { x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f };
  };
  const runs: Point[][] = [], step = total / count;
  for (let k = 0; k < count; k++) {
    // Cut from the end of one gap to the start of the next.
    const from = k * step + width / 2, to = (k + 1) * step - width / 2, run = [at(from)];
    for (let j = 1; j <= 2 * n; j++) { const dj = cum[j % n] + (j >= n ? total : 0); if (dj > from && dj < to) run.push(points[j % n]); }
    run.push(at(to));
    runs.push(run);
  }
  return runs;
}

/** Prepares every cut outline for a bit of `o.bit` mm. Engraving is left alone. */
export function prepareForCnc(d: Drawing, o: CncOptions): CncResult {
  if (!(o.bit > 0) || o.bit > 50) throw new Error('Bit diameter must be between 0 and 50 mm.');
  if (!(o.maxAngle >= 60 && o.maxAngle <= 179)) throw new Error('Corner angle must be between 60 and 179 degrees.');
  if (!Number.isInteger(o.tabs) || o.tabs < 0 || o.tabs > 12) throw new Error('Use 0 to 12 tabs per part.');
  if (o.tabs && !(o.tabWidth > 0 && o.tabWidth <= 50)) throw new Error('Tab width must be between 0 and 50 mm.');
  const r = o.bit / 2;
  let dogbones = 0, tooNarrow = 0, tabs = 0;
  const tooNarrowAt: Point[] = [];
  const shapes: Shape[] = d.shapes.map(shape => {
    const rings = shape.contours.filter(c => c.closed && c.layer !== 'engrave' && c.points.length >= 3);
    const contours = shape.contours.flatMap((c): Contour[] => {
      if (!c.closed || c.layer === 'engrave' || c.points.length < 3) return [c];
      // Material is inside an outline at even depth, outside a hole at odd depth.
      const depth = rings.filter(o2 => o2 !== c && inside(c.points[0], o2.points)).length, hole = depth % 2 === 1;
      if (hole && !offsetContours([c.points], -r * 0.999).length) { tooNarrow++; if (tooNarrowAt.length < 200) tooNarrowAt.push(c.points[0]); }
      // Positive area: the inside of the loop is on the left of travel.
      const insideLeft = area(c.points) > 0, cutterLeft = hole ? insideLeft : !insideLeft;
      let points = c.points;
      if (o.dogbones) { const done = dogboneLoop(points, r, cutterLeft, o.maxAngle); points = done.points; dogbones += done.added; }
      if (!hole && o.tabs > 0) { const runs = tabbedLoop(points, o.tabs, o.tabWidth + o.bit); if (runs.length > 1) tabs += runs.length; return runs.map(run => ({ closed: false, points: run })); }
      return [points === c.points ? c : { closed: true, points }];
    });
    return { ...shape, contours };
  });
  return { drawing: { ...d, shapes }, dogbones, tooNarrow, tooNarrowAt, tabs };
}
