import { test, expect } from '@playwright/test';
import { defaultPolyBox, polyBoxDrawing, roundedPolygon } from '../src/toolkit/polybox';
import { bounds } from '../src/toolkit/geometry';
import { audit } from './helpers/geometry-audit';

test('a rounded polygon is as wide across its flats as asked', () => {
  const b = (pts: { x: number; y: number }[]) => ({ w: Math.max(...pts.map(p => p.x)) - Math.min(...pts.map(p => p.x)), h: Math.max(...pts.map(p => p.y)) - Math.min(...pts.map(p => p.y)) });
  // A hexagon with its first side on top: flat top and bottom, 100 apart.
  expect(b(roundedPolygon(6, 50, 10)).h).toBeCloseTo(100, 6);
  expect(b(roundedPolygon(8, 50, 10)).w).toBeCloseTo(100, 6);
});

test('the wall strip is as long as the wall goes round, with a slot for every tab', () => {
  const o = { ...defaultPolyBox, sides: 6, width: 160, thickness: 3, radius: 12 };
  const d = polyBoxDrawing(o);
  const side = 2 * (80 - 12) * Math.tan(Math.PI / 6), rMid = 12 - 1.5;
  expect(d.side).toBeCloseTo(side, 9);
  expect(d.stripLength).toBeCloseTo(6 * side + 2 * Math.PI * rMid, 9);
  const byId = Object.fromEntries(d.shapes.map(s => [s.id, s]));
  // Five slots: none on the side where the dovetails meet.
  expect(byId.base.contours).toHaveLength(6);
  expect(byId.lip.contours).toHaveLength(2);
  const wall = byId.wall;
  expect(wall.contours.filter(c => c.closed)).toHaveLength(1);
  expect(wall.contours.filter(c => !c.closed).length).toBeGreaterThan(50);
  // The strip is the box's height, plus its tabs below.
  expect(bounds({ ...wall, contours: [wall.contours[0]] }).height).toBeCloseTo(o.height + o.thickness, 9);
  const a = audit(d);
  expect([a.duplicateMm, a.crossings, a.selfCrossings]).toEqual([0, 0, 0]);
  expect(() => polyBoxDrawing({ ...o, radius: 4 })).toThrow(/Corner radius/);
  expect(() => polyBoxDrawing({ ...o, sides: 4 })).toThrow(/5 to 12 sides/);
});

test('the polygon box page draws a box', async ({ page }) => {
  await page.goto('/en/polygon-box');
  await expect(page.locator('.stat').filter({ hasText: 'Wall strip' }).first()).not.toContainText('—');
  await page.getByRole('combobox', { name: 'Sides', exact: true }).selectOption('8');
  await expect(page.locator('.stat').filter({ hasText: 'Each side' }).first()).toContainText('56.3');
  await expect(page.getByRole('button', { name: 'Export DXF', exact: true })).toBeEnabled();
});
