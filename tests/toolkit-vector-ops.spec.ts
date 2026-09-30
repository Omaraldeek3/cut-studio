import { test, expect } from '@playwright/test';
import { unionContours, offsetContours } from '../src/toolkit/vector-ops';
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
