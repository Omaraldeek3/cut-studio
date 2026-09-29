import { unionD, inflatePathsD, FillRule, JoinType, EndType } from '@countertype/clipper2-ts';
import type { Contour, Point } from './types';
import { fitPolyline } from './fit';
import { flattenCurve } from './path';

/* Weld and offset on the outlines themselves, not on a picture of them.
   Clipper2 works on polygons, so curves go in finely flattened and come out
   refitted into lines and arcs within the tolerance. Its double-precision
   calls round to `precision` decimals: 4 keeps 0.0001 mm. */

const PRECISION = 4;

function toContours(paths: Point[][], tolerance: number): Contour[] {
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
