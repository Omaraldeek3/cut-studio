import { unionD, differenceD, inflatePathsD, pointInPolygonD, areaD, FillRule, JoinType, EndType, PointInPolygonResult } from '@countertype/clipper2-ts';
import type { Contour, Point } from './types';
import { fitPolyline } from './fit';
import { flattenCurve } from './path';

/* Weld and offset on the outlines themselves, not on a picture of them.
   Clipper2 works on polygons, so curves go in finely flattened and come out
   refitted into lines and arcs within the tolerance. Its double-precision
   calls round to `precision` decimals: 4 keeps 0.0001 mm. */

const PRECISION = 4;

export function toContours(paths: Point[][], tolerance: number): Contour[] {
  return paths.filter(p => p.length >= 3).map(p => {
    const curve = fitPolyline(p, true, tolerance);
    return { closed: true, curve, points: flattenCurve(curve, true, 0.05) };
  });
}

/** Everything the loops cover (non-zero fill) as closed outlines, holes included. */
export function unionContours(loops: Point[][], tolerance = 0.01): Contour[] {
  if (!loops.length) return [];
  const out = unionD(loops.map(l => l.map(p => ({ x: p.x, y: p.y }))), [], FillRule.NonZero, PRECISION);
  if (!out.length) throw new Error('Could not weld these outlines.');
  return toContours(out, tolerance);
}

/** Outlines `distance` mm outside the loops (inside when negative), with round
 *  corners. Loops that end up touching merge into one. */
export function offsetContours(loops: Point[][], distance: number, tolerance = 0.01, fill: 'nonzero' | 'evenodd' = 'nonzero'): Contour[] {
  if (!loops.length) return [];
  // Imported artwork winds its holes either way, so it is read even-odd.
  const merged = unionD(loops.map(l => l.map(p => ({ x: p.x, y: p.y }))), [], fill === 'evenodd' ? FillRule.EvenOdd : FillRule.NonZero, PRECISION);
  // arcTolerance sets how finely round corners are drawn before refitting.
  const out = inflatePathsD(merged, distance, JoinType.Round, EndType.Polygon, 2, PRECISION, 0.002);
  return toContours(out, tolerance);
}

/** Stencil bridges. Cutting letters out of a sheet would drop the islands
 *  inside them (the counter of an O, of ه or ص); each island is tied to the
 *  sheet by two strips `width` mm wide, straight up and straight down through
 *  its middle, which the letter's cut now goes around. Returns the outlines
 *  to cut and how many bridges were made. */
export function stencilContours(loops: Point[][], width: number, tolerance = 0.01): { contours: Contour[]; bridges: number } {
  if (!loops.length) return { contours: [], bridges: 0 };
  if (!(width > 0)) throw new Error('Bridge width must be above zero.');
  const merged = unionD(loops.map(l => l.map(p => ({ x: p.x, y: p.y }))), [], FillRule.NonZero, PRECISION);
  if (!merged.length) throw new Error('Could not weld these outlines.');
  // Clipper winds outer outlines one way and holes the other; the biggest is an outer.
  const sign = Math.sign(merged.reduce((a, p) => (Math.abs(areaD(p)) > Math.abs(a) ? areaD(p) : a), 0));
  const box = (p: { x: number; y: number }[]) => { let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity; for (const q of p) { x0 = Math.min(x0, q.x); x1 = Math.max(x1, q.x); y0 = Math.min(y0, q.y); y1 = Math.max(y1, q.y); } return { x0, y0, x1, y1 }; };
  const outers = merged.filter(p => Math.sign(areaD(p)) === sign).map(p => ({ p, b: box(p), area: Math.abs(areaD(p)) }));
  const strips: { x: number; y: number }[][] = [];
  for (const hole of merged.filter(p => Math.sign(areaD(p)) !== sign)) {
    const hb = box(hole), cx = (hb.x0 + hb.x1) / 2, cy = (hb.y0 + hb.y1) / 2;
    // The smallest outline around the hole is the letter it belongs to.
    const letter = outers.filter(o => o.b.x0 <= hb.x0 && o.b.x1 >= hb.x1 && o.b.y0 <= hb.y0 && o.b.y1 >= hb.y1 && pointInPolygonD(hole[0], o.p) !== PointInPolygonResult.IsOutside).sort((a, b) => a.area - b.area)[0];
    if (!letter) continue;
    const half = Math.min(width, (hb.x1 - hb.x0) * 0.8) / 2;
    strips.push([{ x: cx - half, y: letter.b.y0 - 1 }, { x: cx + half, y: letter.b.y0 - 1 }, { x: cx + half, y: cy }, { x: cx - half, y: cy }]);
    strips.push([{ x: cx - half, y: cy }, { x: cx + half, y: cy }, { x: cx + half, y: letter.b.y1 + 1 }, { x: cx - half, y: letter.b.y1 + 1 }]);
  }
  if (!strips.length) return { contours: toContours(merged, tolerance), bridges: 0 };
  const cut = differenceD(merged, strips, FillRule.NonZero, PRECISION);
  return { contours: toContours(cut, tolerance), bridges: strips.length };
}
