import { test, expect } from '@playwright/test';
import { buildTemplate, TEMPLATES } from '../src/toolkit/templates';
import { bounds } from '../src/toolkit/geometry';
import { audit } from './helpers/geometry-audit';

for (const t of TEMPLATES) test(`${t.en} builds with its defaults, with no crossing or doubled cut lines`, () => {
  const d = buildTemplate(t.id, t.defaults);
  expect(d.shapes.length).toBeGreaterThan(0);
  const a = audit(d);
  expect([a.duplicateMm, a.crossings, a.selfCrossings]).toEqual([0, 0, 0]);
  // Parts lie apart inside the drawing, none overlapping another.
  const boxes = d.shapes.map(bounds);
  for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
    const a = boxes[i], b = boxes[j];
    expect(a.x + a.width < b.x || b.x + b.width < a.x || a.y + a.height < b.y || b.y + b.height < a.y).toBe(true);
  }
  for (const b of boxes) expect(b.x + b.width).toBeLessThanOrEqual(d.width + 1e-6);
});

test('the QR stand\'s two slots together span the leg, so plate and leg cross flush', () => {
  const d = buildTemplate('qr', { width: 100, height: 160, qr: 70, thickness: 3, clearance: 0.2 });
  const [plate, leg] = d.shapes, legBox = bounds(leg);
  const pb = bounds(plate);
  const plateSlot = pb.y + pb.height - Math.min(...plate.contours[0].points.filter(p => p.y > pb.y + 1e-9 && p.y < pb.y + pb.height - 1e-9).map(p => p.y));
  const legSlot = Math.max(...leg.contours[0].points.filter(p => p.y > legBox.y + 1e-9 && p.y < legBox.y + legBox.height - 1e-9).map(p => p.y)) - legBox.y;
  expect(plateSlot + legSlot).toBeCloseTo(legBox.height, 6);
});

test('the gift box lid carries an engraved name area clear of its thumb hole', () => {
  const d = buildTemplate('gift', { width: 160, depth: 110, height: 70, thickness: 3, clearance: 0.3 });
  const lid = d.shapes.find(s => s.name === 'Lid')!, area = lid.contours.find(c => c.layer === 'engrave')!;
  const pull = bounds({ ...lid, contours: lid.contours.slice(1, -1) }), a = bounds({ ...lid, contours: [area] });
  expect(a.y > pull.y + pull.height || a.y + a.height < pull.y).toBe(true);
  expect(a.height).toBeGreaterThan(30);
});

test('the desk organizer has one divider between each two compartments', () => {
  const d = buildTemplate('organizer', { width: 240, depth: 120, height: 80, across: 4, back: 2, thickness: 3 });
  expect(d.shapes.filter(s => s.name.startsWith('Divider')).length).toBe(4);
  expect(() => buildTemplate('organizer', { width: 240, depth: 120, height: 80, across: 2.5, back: 1, thickness: 3 })).toThrow(/Compartments across: use a whole number/);
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
