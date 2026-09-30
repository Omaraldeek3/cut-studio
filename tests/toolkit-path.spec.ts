import { test, expect } from '@playwright/test';
import { arcCenter, arcToCubics, circleCurve, curveToSvg, flattenCurve, mapCurve, reverseCurve, type Curve } from '../src/toolkit/path';
import { mapShape } from '../src/toolkit/geometry';

test('bulge 1 is a half circle and its centre sits on the chord', () => {
  const a = arcCenter({ x: 0, y: 0 }, { x: 20, y: 0 }, 1);
  expect(a.radius).toBeCloseTo(10); expect(a.center.x).toBeCloseTo(10); expect(a.center.y).toBeCloseTo(0);
  expect(Math.abs(a.sweep)).toBeCloseTo(Math.PI);
});
test('a circle curve flattens onto its radius and closes', () => {
  const pts = flattenCurve(circleCurve(50, 40, 25), true, 0.01);
  for (const p of pts) expect(Math.hypot(p.x - 50, p.y - 40)).toBeCloseTo(25, 1);
  expect(pts.length).toBeGreaterThan(40);
});
test('arc to cubics stays within 0.03% of the radius', () => {
  const segs = arcToCubics({ x: 100, y: 0 }, { to: { x: -100, y: 0 }, bulge: 1 });
  expect(segs.length).toBe(2);
  const pts = flattenCurve({ start: { x: 100, y: 0 }, segs }, false, 0.001);
  for (const p of pts) expect(Math.abs(Math.hypot(p.x, p.y) - 100)).toBeLessThan(0.03);
});
test('reverse keeps the same geometry', () => {
  const c: Curve = { start: { x: 0, y: 0 }, segs: [{ type: 'L', to: { x: 10, y: 0 } }, { type: 'A', to: { x: 10, y: 10 }, bulge: 0.5 }, { type: 'C', c1: { x: 5, y: 12 }, c2: { x: 2, y: 12 }, to: { x: 0, y: 10 } }] };
  const a = flattenCurve(c, true, 0.01), b = flattenCurve(reverseCurve(c), true, 0.01);
  const near = (p: { x: number; y: number }, set: { x: number; y: number }[]) => Math.min(...set.map(q => Math.hypot(p.x - q.x, p.y - q.y)));
  for (const p of a) expect(near(p, b)).toBeLessThan(0.02);
});
test('similarity keeps arcs, mirror flips the bulge, a stretch turns arcs into cubics', () => {
  const circle = circleCurve(0, 0, 10);
  const moved = mapCurve(circle, p => ({ x: p.x + 5, y: p.y + 5 }));
  expect(moved.segs.every(s => s.type === 'A')).toBe(true);
  const mirrored = mapCurve(circle, p => ({ x: -p.x, y: p.y }));
  expect((mirrored.segs[0] as { bulge: number }).bulge).toBeCloseTo(-(circle.segs[0] as { bulge: number }).bulge);
  const stretched = mapCurve(circle, p => ({ x: p.x * 2, y: p.y }));
  expect(stretched.segs.every(s => s.type === 'C')).toBe(true);
  for (const p of flattenCurve(stretched, true, 0.01)) expect((p.x / 20) ** 2 + (p.y / 10) ** 2).toBeCloseTo(1, 2);
});
test('mapShape carries curves along with points', () => {
  const shape = { id: 's', name: 's', contours: [{ closed: true, points: flattenCurve(circleCurve(0, 0, 5), true, 0.05), curve: circleCurve(0, 0, 5) }] };
  const moved = mapShape(shape, p => ({ x: p.x + 1, y: p.y }));
  expect(moved.contours[0].curve!.start.x).toBeCloseTo(6);
});
test('svg path data writes arcs with the right flags', () => {
  const d = curveToSvg({ start: { x: 0, y: 0 }, segs: [{ type: 'A', to: { x: 20, y: 0 }, bulge: 1 }] }, false);
  expect(d).toMatch(/^M0 0 A10 10 0 0 1 20 0$/);
});
