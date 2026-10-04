import { test, expect } from '@playwright/test';
import { fitPolyline, straightenCurve } from '../src/toolkit/fit';
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

test('a nearly straight run of many curves becomes one line, and corners stay', () => {
  // A tracer's wobbly edge: twenty small cubics off the x axis by about 0.04 mm, then a corner.
  const segs = Array.from({ length: 20 }, (_, i) => ({ type: 'C' as const, c1: { x: i * 5 + 1.5, y: 0.15 }, c2: { x: i * 5 + 3.5, y: -0.15 }, to: { x: i * 5 + 5, y: 0 } }));
  const curve = { start: { x: 0, y: 0 }, segs: [...segs, { type: 'L' as const, to: { x: 100, y: 40 } }] };
  const out = straightenCurve(curve, 0.1);
  expect(out.segs).toEqual([{ type: 'L', to: { x: 100, y: 0 } }, { type: 'L', to: { x: 100, y: 40 } }]);
  // Below the wobble nothing is merged.
  expect(straightenCurve(curve, 0.01).segs).toHaveLength(21);
});

test('smooth runs merge into one cubic that stays within the tolerance', () => {
  // A quarter circle of radius 50 drawn as eight short cubics.
  const r = 50, n = 8, k = 4 / 3 * Math.tan(Math.PI / 2 / n / 4);
  const p = (a: number) => ({ x: r * Math.cos(a), y: r * Math.sin(a) });
  const segs = Array.from({ length: n }, (_, i) => {
    const a0 = (i * Math.PI) / 2 / n, a1 = ((i + 1) * Math.PI) / 2 / n, s = p(a0), e = p(a1);
    return { type: 'C' as const, c1: { x: s.x - k * s.y, y: s.y + k * s.x }, c2: { x: e.x + k * e.y, y: e.y - k * e.x }, to: e };
  });
  const curve = { start: p(0), segs };
  const out = straightenCurve(curve, 0.05);
  expect(out.segs.length).toBeLessThan(3);
  const before = flattenCurve(curve, false, 0.005), after = flattenCurve(out, false, 0.005);
  for (const q of after) expect(dist(q, before)).toBeLessThan(0.051);
  for (const q of before) expect(dist(q, after)).toBeLessThan(0.051);
});
