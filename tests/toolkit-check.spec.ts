import { test, expect } from '@playwright/test';
import { checkDrawing } from '../src/toolkit/check';
import type { Contour, Drawing } from '../src/toolkit/types';

const box = (x: number, y: number, w: number, h: number, extra: Partial<Contour> = {}): Contour => ({ closed: true, points: [{ x, y }, { x: x + w, y }, { x: x + w, y: y + h }, { x, y: y + h }], ...extra });
const drawing = (...contours: Contour[]): Drawing => ({ width: 100, height: 100, shapes: contours.map((c, i) => ({ id: `s${i}`, name: `s${i}`, contours: [c] })) });
const kinds = (d: Drawing) => Object.fromEntries(checkDrawing(d).map(c => [c.kind, c.count]));

test('a clean drawing has nothing to report', () => {
  expect(checkDrawing(drawing(box(10, 10, 20, 20), box(40, 10, 20, 20), box(15, 15, 5, 5)))).toEqual([]);
});

test('each kind of problem is found, with where it is', () => {
  const found = checkDrawing(drawing(
    box(10, 10, 20, 20), box(20, 20, 20, 20), // two outlines crossing twice
    box(50, 10, 10, 10), box(50, 10, 10, 10), // one drawn twice
    { closed: false, points: [{ x: 70, y: 70 }, { x: 80, y: 70 }] }, // open
    box(90, 90, 0.5, 0.5), // tiny
    box(95, 50, 10, 10), // past the edge
  ));
  const by = Object.fromEntries(found.map(c => [c.kind, c]));
  expect(by.crossing.count).toBe(2);
  expect(by.crossing.at).toEqual(expect.arrayContaining([{ x: 30, y: 20 }, { x: 20, y: 30 }]));
  expect(by.overlap.count).toBe(4);
  expect(by.open.at).toEqual([{ x: 70, y: 70 }]);
  expect(by.tiny.at).toEqual([{ x: 90.25, y: 90.25 }]);
  expect(by.outside.count).toBe(1);
  expect(found.map(c => c.kind)).toEqual(['outside', 'crossing', 'overlap', 'open', 'tiny']);
});

test('engraving may cross cut lines and be open; a figure-eight outline crosses itself', () => {
  expect(kinds(drawing(box(10, 10, 30, 30), { closed: false, layer: 'engrave', points: [{ x: 0, y: 25 }, { x: 50, y: 25 }] }))).toEqual({});
  const eight: Contour = { closed: true, points: [{ x: 10, y: 10 }, { x: 30, y: 30 }, { x: 30, y: 10 }, { x: 10, y: 30 }] };
  expect(kinds(drawing(eight))).toEqual({ crossing: 1 });
});
