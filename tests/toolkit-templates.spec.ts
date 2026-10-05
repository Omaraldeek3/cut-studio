import { test, expect } from '@playwright/test';
import { buildTemplate, TEMPLATES } from '../src/toolkit/templates';
import { bounds } from '../src/toolkit/geometry';
import { audit } from './helpers/geometry-audit';

for (const t of TEMPLATES) test(`${t.en} builds with its defaults, with no crossing or doubled cut lines`, () => {
  const d = buildTemplate(t.id, t.defaults);
  expect(d.shapes.length).toBeGreaterThan(0);
  const a = audit(d);
  expect([a.duplicateMm, a.crossings, a.selfCrossings]).toEqual([0, 0, 0]);
  // Parts lie side by side inside the drawing, none overlapping another.
  const boxes = d.shapes.map(bounds);
  for (let i = 1; i < boxes.length; i++) expect(boxes[i].x).toBeGreaterThan(boxes[i - 1].x + boxes[i - 1].width);
});

test('the QR stand\'s two slots together span the leg, so plate and leg cross flush', () => {
  const d = buildTemplate('qr', { width: 100, height: 160, qr: 70, thickness: 3, clearance: 0.2 });
  const [plate, leg] = d.shapes, legBox = bounds(leg);
  const pb = bounds(plate);
  const plateSlot = pb.y + pb.height - Math.min(...plate.contours[0].points.filter(p => p.y > pb.y + 1e-9 && p.y < pb.y + pb.height - 1e-9).map(p => p.y));
  const legSlot = Math.max(...leg.contours[0].points.filter(p => p.y > legBox.y + 1e-9 && p.y < legBox.y + legBox.height - 1e-9).map(p => p.y)) - legBox.y;
  expect(plateSlot + legSlot).toBeCloseTo(legBox.height, 6);
});

test('settings out of range, or that cannot work, say so', () => {
  expect(() => buildTemplate('door', { width: 200, height: 80, radius: 8, holes: 3, spacers: 0 })).toThrow(/0, 2 or 4/);
  expect(() => buildTemplate('qr', { width: 100, height: 150, qr: 95, thickness: 3, clearance: 0.2 })).toThrow(/QR square/);
  expect(() => buildTemplate('card', { width: 10, stack: 20, thickness: 3, clearance: 0.2 })).toThrow(/Width must be between 60 and 300/);
});

test('the product templates page builds every template', async ({ page }) => {
  await page.goto('/en/product-templates');
  for (const t of TEMPLATES) {
    await page.getByRole('button', { name: t.en, exact: true }).click();
    await expect(page.locator('.error-note')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Export DXF', exact: true })).toBeEnabled();
  }
});
