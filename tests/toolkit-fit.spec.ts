import { test, expect } from '@playwright/test';
import { fitPolyline } from '../src/toolkit/fit';
import { circle, roundedRect, gearDrawing, defaultGear, puzzleDrawing, defaultPuzzle } from '../src/toolkit/generators';
import { flattenCurve } from '../src/toolkit/path';

type P = { x: number; y: number };
/** Distance from p to the polyline through `set`. */
const dist = (p: P, set: P[]) => Math.min(...set.map((a, i) => {
  const b = set[(i + 1) % set.length], dx = b.x - a.x, dy = b.y - a.y, l = dx * dx + dy * dy;
  const t = l ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / l)) : 0;
  return Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy);
}));

test('a generated circle becomes two arcs', () => {
  const c = fitPolyline(circle(40, 30, 20), true, 0.02);
  expect(c.segs.map(s => s.type)).toEqual(['A', 'A']);
});
test('a rounded rectangle becomes four lines and four arcs', () => {
  const c = fitPolyline(roundedRect(0, 0, 80, 40, 6), true, 0.02);
  expect(c.segs.filter(s => s.type === 'L')).toHaveLength(4);
  expect(c.segs.filter(s => s.type === 'A')).toHaveLength(4);
});
test('a square stays four exact lines', () => {
  const c = fitPolyline([{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }], true, 0.02);
  expect(c.segs).toHaveLength(4); expect(c.segs.every(s => s.type === 'L')).toBe(true);
});
test('collinear vertices on a side merge into one line', () => {
  const c = fitPolyline([{ x: 0, y: 0 }, { x: 5, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }], true, 0.02);
  expect(c.segs).toHaveLength(4);
});
test('an open zigzag keeps every corner', () => {
  const pts = [{ x: 0, y: 0 }, { x: 5, y: 5 }, { x: 10, y: 0 }, { x: 15, y: 5 }];
  expect(fitPolyline(pts, false, 0.02).segs).toHaveLength(3);
});
for (const [name, drawing] of [['gear', gearDrawing(defaultGear)], ['puzzle', puzzleDrawing(defaultPuzzle)]] as const) {
  test(`fitting the ${name} never moves a vertex further than the tolerance and needs far fewer nodes`, () => {
    for (const contour of drawing.shapes.flatMap(s => s.contours).filter(c => c.layer !== 'engrave')) {
      const curve = fitPolyline(contour.points, contour.closed, 0.02);
      const dense = flattenCurve(curve, contour.closed, 0.002);
      for (const p of contour.points) expect(dist(p, dense)).toBeLessThan(0.025);
      if (contour.points.length > 20) expect(curve.segs.length).toBeLessThan(contour.points.length / 2);
    }
  });
}
test('a regular polygon stays a polygon, not a circle', () => {
  const twelve = Array.from({ length: 12 }, (_, i) => ({ x: 20 * Math.cos((i * Math.PI) / 6), y: 20 * Math.sin((i * Math.PI) / 6) }));
  const c = fitPolyline(twelve, true, 0.02);
  expect(c.segs).toHaveLength(12); expect(c.segs.every(s => s.type === 'L')).toBe(true);
});
