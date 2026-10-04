import { test, expect } from '@playwright/test';
import { repairDrawing } from '../src/toolkit/geometry';
import { audit } from './helpers/geometry-audit';
import type { Drawing } from '../src/toolkit/types';

const off = { overlaps: false, join: 0, minArea: 0, reduce: false };
const rect = (x: number, y: number, w: number, h: number) => ({ closed: true, points: [{ x, y }, { x: x + w, y }, { x: x + w, y: y + h }, { x, y: y + h }] });
const drawing = (...contours: { closed: boolean; points: { x: number; y: number }[] }[][]): Drawing =>
  ({ width: 100, height: 100, shapes: contours.map((c, i) => ({ id: `s${i}`, name: `s${i}`, contours: c })) });

test('two rectangles sharing an edge are cut along it once', () => {
  const d = drawing([rect(0, 0, 20, 20)], [rect(20, 0, 20, 20)]);
  expect(audit(d).duplicateMm).toBeCloseTo(20);
  const r = repairDrawing(d, { ...off, overlaps: true });
  expect(audit(r.drawing).duplicateMm).toBe(0);
  expect(r.overlapsRemovedMm).toBeCloseTo(20);
  expect(audit(r.drawing).cutMm).toBeCloseTo(140, 0);
});
test('a partial overlap removes only the shared stretch', () => {
  const d = drawing([{ closed: false, points: [{ x: 0, y: 0 }, { x: 30, y: 0 }] }], [{ closed: false, points: [{ x: 10, y: 0 }, { x: 50, y: 0 }] }]);
  const r = repairDrawing(d, { ...off, overlaps: true });
  expect(r.overlapsRemovedMm).toBeCloseTo(20);
  expect(audit(r.drawing).cutMm).toBeCloseTo(50);
});
test('an exact duplicate contour is removed entirely', () => {
  const r = repairDrawing(drawing([rect(0, 0, 10, 10)], [rect(0, 0, 10, 10)]), { ...off, overlaps: true });
  expect(r.overlapsRemovedMm).toBeCloseTo(40);
  expect(r.drawing.shapes.flatMap(s => s.contours)).toHaveLength(1);
  expect(r.drawing.shapes.flatMap(s => s.contours)[0].closed).toBe(true);
});
test('an open path with a small gap is closed', () => {
  const d = drawing([{ closed: false, points: [{ x: 0, y: 0.05 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }, { x: 0, y: 0 }] }]);
  const r = repairDrawing(d, { ...off, join: 0.1 });
  expect(r.joined).toBe(1);
  expect(r.drawing.shapes[0].contours[0].closed).toBe(true);
});
test('two open halves are joined into one closed outline', () => {
  const d = drawing([{ closed: false, points: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }] }], [{ closed: false, points: [{ x: 10.05, y: 10 }, { x: 0, y: 10 }, { x: 0, y: 0.05 }] }]);
  const r = repairDrawing(d, { ...off, join: 0.1 });
  const contours = r.drawing.shapes.flatMap(s => s.contours);
  expect(contours).toHaveLength(1);
  expect(contours[0].closed).toBe(true);
  expect(r.joined).toBe(2);
});
test('gaps wider than the limit are left open', () => {
  const d = drawing([{ closed: false, points: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }, { x: 0, y: 1 }] }]);
  expect(repairDrawing(d, { ...off, join: 0.1 }).joined).toBe(0);
});
test('reduce nodes turns a polygon circle into arcs', () => {
  const pts = Array.from({ length: 360 }, (_, i) => ({ x: 10 + 5 * Math.cos((i * Math.PI) / 180), y: 10 + 5 * Math.sin((i * Math.PI) / 180) }));
  const r = repairDrawing(drawing([{ closed: true, points: pts }]), { ...off, reduce: true });
  expect(r.nodesBefore).toBe(360); expect(r.nodesAfter).toBe(2);
});
test('tiny closed contours are removed and counted', () => {
  const r = repairDrawing(drawing([rect(0, 0, 10, 10), rect(20, 20, 0.5, 0.5)]), { ...off, minArea: 1 });
  expect(r.tiny).toBe(1);
  expect(r.drawing.shapes[0].contours).toHaveLength(1);
});
test('engraved lines are never touched', () => {
  const d: Drawing = { width: 20, height: 20, shapes: [{ id: 'a', name: 'a', contours: [{ ...rect(0, 0, 10, 10), layer: 'engrave' }, { ...rect(0, 0, 10, 10), layer: 'engrave' }] }] };
  expect(repairDrawing(d, { overlaps: true, join: 0.1, minArea: 1, reduce: true }).drawing.shapes[0].contours).toHaveLength(2);
});

test('reducing nodes turns a dense nearly straight edge into one line', () => {
  // 200 points along the top edge of a 100 × 20 rectangle, every other one off by 0.05 mm.
  const top = Array.from({ length: 200 }, (_, i) => ({ x: i / 2, y: i % 2 ? 0.05 : 0 }));
  const d = drawing([{ closed: true, points: [...top, { x: 100, y: 0 }, { x: 100, y: 20 }, { x: 0, y: 20 }] }]);
  const r = repairDrawing(d, { ...off, reduce: true, simplify: 0.1 });
  expect(r.nodesBefore).toBe(203);
  expect(r.nodesAfter).toBe(4);
  expect(repairDrawing(d, { ...off, reduce: true, simplify: 0.01 }).nodesAfter).toBeGreaterThan(100);
});
