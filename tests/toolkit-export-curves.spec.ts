import { test, expect } from '@playwright/test';
import { toSvg, toDxf } from '../src/toolkit/export';
import { circle, roundedRect } from '../src/toolkit/generators';
import { parseDxf } from '../src/toolkit/dxf-import';
import { cubicToArcs } from '../src/toolkit/biarc';
import { flattenCurve } from '../src/toolkit/path';

type P = { x: number; y: number };
const drawing = (points: P[]) => ({ width: 100, height: 100, shapes: [{ id: 'a', name: 'a', contours: [{ closed: true, points }] }] });
const dist = (p: P, set: P[]) => Math.min(...set.slice(0, -1).map((a, i) => {
  const b = set[i + 1], dx = b.x - a.x, dy = b.y - a.y, l = dx * dx + dy * dy;
  const t = l ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / l)) : 0;
  return Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy);
}));

test('a circle exports as two SVG arcs', () => {
  const svg = toSvg(drawing(circle(50, 50, 20)));
  expect((svg.match(/ A/g) || []).length).toBe(2);
  expect(svg).not.toMatch(/ L/);
});
test('a circle exports as two DXF bulge vertices and imports back round', () => {
  const dxf = toDxf(drawing(circle(50, 50, 20)));
  expect((dxf.match(/\n42\n/g) || []).length).toBe(2);
  const back = parseDxf(dxf);
  expect(back.width).toBeCloseTo(40, 2); expect(back.height).toBeCloseTo(40, 2);
  for (const p of back.shapes[0].contours[0].points) expect(Math.hypot(p.x - 20, p.y - 20)).toBeCloseTo(20, 2);
});
test('a rounded rectangle exports 4 lines and 4 arcs, and imports back to size', () => {
  const d = drawing(roundedRect(10, 10, 60, 30, 5));
  const svg = toSvg(d);
  expect((svg.match(/ A/g) || []).length).toBe(4);
  expect((svg.match(/ L/g) || []).length).toBe(4);
  const back = parseDxf(toDxf(d));
  expect(back.width).toBeCloseTo(60, 2); expect(back.height).toBeCloseTo(30, 2);
});
test('a cubic becomes arcs within 0.01 mm', () => {
  const from = { x: 0, y: 0 }, seg = { c1: { x: 10, y: 20 }, c2: { x: 30, y: -10 }, to: { x: 40, y: 10 } };
  const arcs = cubicToArcs(from, seg, 0.01);
  expect(arcs.length).toBeLessThan(40);
  const exact = flattenCurve({ start: from, segs: [{ type: 'C', ...seg }] }, false, 0.001);
  const approx = flattenCurve({ start: from, segs: arcs }, false, 0.001);
  for (const p of exact) expect(dist(p, approx)).toBeLessThan(0.011);
});
test('a traced cubic contour exports to DXF as arcs that import back onto the curve', () => {
  const curve = { start: { x: 10, y: 50 }, segs: [{ type: 'C' as const, c1: { x: 10, y: 10 }, c2: { x: 90, y: 10 }, to: { x: 90, y: 50 } }, { type: 'C' as const, c1: { x: 90, y: 90 }, c2: { x: 10, y: 90 }, to: { x: 10, y: 50 } }] };
  const d = { width: 100, height: 100, shapes: [{ id: 'c', name: 'c', contours: [{ closed: true, points: flattenCurve(curve, true, 0.05), curve }] }] };
  const dxf = toDxf(d);
  expect(dxf).toContain('\n42\n');
  const exact = flattenCurve(curve, true, 0.002);
  const back = parseDxf(dxf).shapes[0].contours[0].points;
  // The import normalises to the drawing's bounds; shift back by the curve's minimum.
  const minX = Math.min(...exact.map(p => p.x)), minY = Math.min(...exact.map(p => p.y));
  const moved = back.map(p => ({ x: p.x + minX, y: p.y + minY }));
  for (const p of exact) expect(dist(p, [...moved, moved[0]])).toBeLessThan(0.1);
});
test('a DXF CIRCLE and ARC import and export as arcs', () => {
  const src = [0,'SECTION',2,'HEADER',9,'$INSUNITS',70,4,0,'ENDSEC',0,'SECTION',2,'ENTITIES',0,'CIRCLE',8,'0',10,50,20,50,40,20,0,'ARC',8,'0',10,150,20,50,40,20,50,0,51,90,0,'ENDSEC',0,'EOF'].join('\n');
  const out = toDxf(parseDxf(src));
  // Two semicircles for the circle, one arc for the quarter arc.
  expect((out.match(/\n42\n/g) || []).length).toBe(3);
  expect((out.match(/VERTEX/g) || []).length).toBe(4);
});
