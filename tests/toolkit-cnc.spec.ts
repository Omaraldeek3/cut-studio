import { test, expect } from '@playwright/test';
import { prepareForCnc, tabbedLoop, defaultCnc } from '../src/toolkit/cnc';
import type { Contour, Drawing } from '../src/toolkit/types';

const loop = (pts: number[][], extra: Partial<Contour> = {}): Contour => ({ closed: true, points: pts.map(([x, y]) => ({ x, y })), ...extra });
const one = (...contours: Contour[]): Drawing => ({ width: 200, height: 200, shapes: [{ id: 'p', name: 'p', contours }] });
const square = (x: number, y: number, s: number, reverse = false) => { const p = [[x, y], [x + s, y], [x + s, y + s], [x, y + s]]; return loop(reverse ? p.reverse() : p); };

test('dogbones go in the corners the bit cannot reach: inside a hole, and in an L', () => {
  // A plate with a square hole: the plate's own corners are outside corners, the hole's are inside ones.
  for (const reverse of [false, true]) {
    const r = prepareForCnc(one(square(0, 0, 100), square(40, 40, 20, reverse)), { ...defaultCnc, bit: 6 });
    expect(r.dogbones).toBe(4);
    // Each relief circle passes through its corner, centred 3 mm into the hole along the diagonal.
    const hole = r.drawing.shapes[0].contours[1].points, c = 40 + 3 * Math.SQRT1_2;
    expect(hole.filter(p => Math.abs(Math.hypot(p.x - c, p.y - c) - 3) < 1e-6).length).toBeGreaterThanOrEqual(12);
  }
  const L = loop([[0, 0], [60, 0], [60, 20], [20, 20], [20, 60], [0, 60]]);
  // The L's inside corner at (20, 20): the relief goes into the notch, where the bit runs.
  const notch = 20 + 3 * Math.SQRT1_2;
  for (const c of [L, { ...L, points: [...L.points].reverse() }]) {
    const r = prepareForCnc(one(c), defaultCnc);
    expect(r.dogbones).toBe(1);
    expect(r.drawing.shapes[0].contours[0].points.filter(p => Math.abs(Math.hypot(p.x - notch, p.y - notch) - 3) < 1e-6).length).toBeGreaterThanOrEqual(12);
  }
  expect(prepareForCnc(one(L), { ...defaultCnc, dogbones: false }).dogbones).toBe(0);
});

test('holes narrower than the bit are reported, and engraving is left alone', () => {
  const r = prepareForCnc(one(square(0, 0, 100), square(10, 10, 4), square(30, 30, 10), loop([[50, 50], [52, 50], [52, 52]], { layer: 'engrave' })), { ...defaultCnc, bit: 6 });
  expect(r.tooNarrow).toBe(1);
  expect(r.tooNarrowAt).toEqual([{ x: 10, y: 10 }]);
  expect(r.drawing.shapes[0].contours[3].points).toHaveLength(3);
});

test('holding tabs leave evenly spaced gaps in part outlines, not in holes', () => {
  const runs = tabbedLoop(square(0, 0, 100).points, 4, 10);
  expect(runs).toHaveLength(4);
  const length = (run: { x: number; y: number }[]) => run.slice(1).reduce((s, p, i) => s + Math.hypot(p.x - run[i].x, p.y - run[i].y), 0);
  for (const run of runs) expect(length(run)).toBeCloseTo(90, 6);
  const r = prepareForCnc(one(square(0, 0, 100), square(40, 40, 20)), { ...defaultCnc, dogbones: false, tabs: 4, tabWidth: 4, bit: 6 });
  expect(r.tabs).toBe(4);
  const cs = r.drawing.shapes[0].contours;
  expect(cs.filter(c => !c.closed)).toHaveLength(4);
  expect(cs.filter(c => c.closed)).toHaveLength(1);
});

test('the CNC prep page readies the sample for the router', async ({ page }) => {
  await page.goto('/en/cnc-prep');
  await expect(page.getByText('Ready for the router', { exact: true })).toBeVisible();
  const stat = (label: string) => page.locator('.stat').filter({ hasText: label }).locator('strong');
  await page.getByLabel('Tabs per part').fill('3');
  await expect(stat('Tabs')).not.toHaveText('0');
  await page.getByLabel('Bit diameter').fill('60');
  await expect(page.locator('.error-note')).toContainText('Bit diameter must be between 0 and 50 mm.');
  await page.goto('/ar/cnc-prep');
  await expect(page.getByRole('heading', { name: 'تجهيز CNC' }).first()).toBeVisible();
});
