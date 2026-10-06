import { test, expect } from '@playwright/test';
import { assembleTemplate, buildTemplate, TEMPLATES } from '../src/toolkit/templates';
import { lyingFlat, polyBoxPieces, trophyPieces, type Piece } from '../src/toolkit/assembly';
import { defaultTrophy, trophyDrawing, tagDrawing, defaultTag } from '../src/toolkit/generators';
import { defaultPolyBox, polyBoxDrawing } from '../src/toolkit/polybox';

/** The world box a set of pieces fills, from every outline point at both faces. */
function extent(pieces: Piece[]) {
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  for (const p of pieces) for (const c of p.shape.contours) for (const q of c.points) for (const z of [0, p.depth]) {
    for (let k = 0; k < 3; k++) { const w = p.origin[k] + q.x * p.u[k] + q.y * p.v[k] + z * p.n[k]; min[k] = Math.min(min[k], w); max[k] = Math.max(max[k], w); }
  }
  return { min, max, size: max.map((m, k) => m - min[k]) };
}

for (const t of TEMPLATES) test(`${t.en} goes together in 3D from every one of its cut parts`, () => {
  const d = buildTemplate(t.id, t.defaults), pieces = assembleTemplate(t.id, t.defaults, d);
  expect(pieces).not.toBeNull();
  expect(pieces!.length).toBe(d.shapes.length);
  for (const p of pieces!) expect(p.depth).toBeGreaterThan(0);
});

test('the assembled QR stand is as tall as its plate, and its leg crosses the plate in the middle', () => {
  const v = { width: 100, height: 150, qr: 70, thickness: 3, clearance: 0.2 };
  const [plate, leg] = assembleTemplate('qr', v, buildTemplate('qr', v))!;
  const all = extent([plate, leg]), l = extent([leg]);
  expect(all.min[1]).toBeCloseTo(0, 6);
  expect(all.size[1]).toBeCloseTo(150, 6);
  expect(l.min[0]).toBeLessThan(0); expect(l.max[0]).toBeGreaterThan(0);
  expect(l.min[2]).toBeLessThan(0); expect(l.max[2]).toBeGreaterThan(0);
});

test('a lean stand stands on the floor with its sides the set width apart', () => {
  const t = TEMPLATES.find(x => x.id === 'easel')!, pieces = assembleTemplate('easel', t.defaults, buildTemplate('easel', t.defaults))!;
  const [s1, s2] = pieces.map(p => extent([p]));
  expect(Math.min(s1.min[1], s2.min[1])).toBeCloseTo(0, 6);
  expect(s2.min[0] - s1.max[0]).toBeCloseTo(t.defaults.width, 6);
  // Each bar spans the gap between the sides.
  for (const bar of pieces.slice(2).map(p => extent([p]))) { expect(bar.min[0]).toBeLessThanOrEqual(s1.max[0]); expect(bar.max[0]).toBeGreaterThanOrEqual(s2.min[0]); }
});

test('the trophy plate stands in its slot, down to the first solid layer', () => {
  const o = defaultTrophy, d = trophyDrawing(o), pieces = trophyPieces(d, o), plate = extent([pieces[pieces.length - 1]]);
  expect(pieces.length).toBe(d.shapes.length);
  expect(plate.min[1]).toBeCloseTo((o.layers - o.slotLayers) * o.thickness, 6);
  expect(extent(pieces.slice(0, -1)).size[1]).toBeCloseTo(o.layers * o.thickness, 6);
});

test('the polygon box closes: base, wall, lid lip and lid stack to its height', () => {
  const o = defaultPolyBox, pieces = polyBoxPieces(polyBoxDrawing(o), o), all = extent(pieces);
  expect(pieces.length).toBe(4);
  expect(all.size[1]).toBeCloseTo(o.height + 2 * o.thickness, 6);
  const [base, wall, lid, lip] = pieces.map(p => extent([p]));
  // The lid sits square over the wall, and the lip just inside it.
  for (const k of [0, 2]) { expect(lid.min[k] + lid.max[k]).toBeCloseTo(wall.min[k] + wall.max[k], 6); expect(base.min[k]).toBeCloseTo(lid.min[k], 6); }
  expect(lip.size[0]).toBeLessThan(wall.size[0] - 2 * o.thickness);
});

test('a flat product lies on the floor as thick as one sheet', () => {
  const pieces = lyingFlat(tagDrawing({ ...defaultTag, text: 'A' }, null)), e = extent(pieces);
  expect(e.min[1]).toBe(0);
  expect(e.size[1]).toBe(3);
});

test('every ready-made maker shows its product in 3D', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  for (const slug of ['product-templates', 'polygon-box', 'keychains-tags', 'trophy-base', 'gear-maker', 'jigsaw-puzzle', 'ruler-maker']) {
    await page.goto(`/en/${slug}`);
    await page.getByRole('tab', { name: '3D view' }).click();
    await expect(page.locator('canvas[data-testid$="3d-canvas"]')).toBeVisible();
  }
  await page.goto('/ar/product-templates');
  await page.getByRole('tab', { name: 'عرض ثلاثي الأبعاد' }).click();
  await expect(page.getByRole('img', { name: /معاينة ثلاثية الأبعاد/ })).toBeVisible();
  expect(errors).toEqual([]);
});
