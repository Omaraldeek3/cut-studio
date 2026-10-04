import { test, expect } from '@playwright/test';
import { unionContours, offsetContours, stencilContours } from '../src/toolkit/vector-ops';
import { audit } from './helpers/geometry-audit';

const sq = (x: number, y: number, s: number) => [{ x, y }, { x: x + s, y }, { x: x + s, y: y + s }, { x, y: y + s }];
const ring = (r: number, n = 200) => Array.from({ length: n }, (_, i) => ({ x: r * Math.cos((i / n) * 2 * Math.PI), y: r * Math.sin((i / n) * 2 * Math.PI) }));

test('overlapping squares weld into one outline of straight lines', () => {
  const out = unionContours([sq(0, 0, 10), sq(5, 5, 10)]);
  expect(out).toHaveLength(1);
  expect(out[0].curve!.segs.every(s => s.type === 'L')).toBe(true);
  expect(out[0].curve!.segs).toHaveLength(8);
});
test('a ring keeps its hole', () => {
  expect(unionContours([ring(20), ring(10).reverse()])).toHaveLength(2);
});
test('offsetting a square with round joins gives four lines and four arcs', () => {
  const out = offsetContours([sq(0, 0, 20)], 3);
  expect(out).toHaveLength(1);
  const segs = out[0].curve!.segs;
  expect(segs.filter(s => s.type === 'L')).toHaveLength(4);
  expect(segs.filter(s => s.type === 'A')).toHaveLength(4);
  expect(audit({ width: 30, height: 30, shapes: [{ id: 'o', name: 'o', contours: out }] }).selfCrossings).toBe(0);
});
test('two letters that touch after offsetting become one outline', () => {
  expect(offsetContours([sq(0, 0, 10), sq(14, 0, 10)], 3)).toHaveLength(1);
});
test('an inward offset shrinks and can make a shape disappear', () => {
  const inner = offsetContours([sq(0, 0, 20)], -3);
  expect(inner).toHaveLength(1);
  const xs = inner[0].points.map(p => p.x);
  expect(Math.min(...xs)).toBeCloseTo(3, 2); expect(Math.max(...xs)).toBeCloseTo(17, 2);
  expect(offsetContours([sq(0, 0, 4)], -3)).toHaveLength(0);
});

test('stencil bridges tie the inside of a letter to the sheet, so no island is left', () => {
  // An O: a 20 mm square with a 10 mm square counter.
  const outer = [{ x: 0, y: 0 }, { x: 20, y: 0 }, { x: 20, y: 20 }, { x: 0, y: 20 }], counter = [{ x: 5, y: 5 }, { x: 5, y: 15 }, { x: 15, y: 15 }, { x: 15, y: 5 }];
  const { contours, bridges } = stencilContours([outer, counter], 2);
  expect(bridges).toBe(2);
  // Two C-shaped halves, neither inside the other: nothing to fall out.
  expect(contours).toHaveLength(2);
  const inside = (p: { x: number; y: number }, poly: { x: number; y: number }[]) => { let yes = false; for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) { const a = poly[i], b = poly[j]; if ((a.y > p.y) !== (b.y > p.y) && p.x < (b.x - a.x) * (p.y - a.y) / (b.y - a.y) + a.x) yes = !yes; } return yes; };
  for (const a of contours) for (const b of contours) if (a !== b) expect(inside(a.points[0], b.points)).toBe(false);
  // The bridge is 2 mm wide at the middle: the halves stop 1 mm either side of x = 10.
  const spans = contours.map(c => [Math.min(...c.points.map(p => p.x)), Math.max(...c.points.map(p => p.x))]).sort((a, b) => a[0] - b[0]);
  expect(spans[0][0]).toBeCloseTo(0, 3); expect(spans[0][1]).toBeCloseTo(9, 3);
  expect(spans[1][0]).toBeCloseTo(11, 3); expect(spans[1][1]).toBeCloseTo(20, 3);
  // A letter with no inside needs no bridge.
  expect(stencilContours([[{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 3 }, { x: 0, y: 3 }]], 2).bridges).toBe(0);
});
