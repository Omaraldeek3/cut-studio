import { test, expect } from '@playwright/test';
import { clashes, quarterTurn } from '../src/toolkit/sheet-editor';
import { bounds } from '../src/toolkit/geometry';
import type { Shape } from '../src/toolkit/types';

const rect = (id: string, x: number, y: number, w: number, h: number): Shape => ({ id, name: id, contours: [{ closed: true, points: [{ x, y }, { x: x + w, y }, { x: x + w, y: y + h }, { x, y: y + h }] }] });

test('parts too close to each other or past the margin are flagged', () => {
  const parts = [rect('a', 10, 10, 20, 20), rect('b', 32, 10, 20, 20), rect('c', 70, 10, 20, 20), rect('d', 95, 10, 10, 10)];
  // b is 2 mm from a with 3 mm spacing; d runs past the 5 mm margin of a 100 mm sheet.
  expect([...clashes(parts, 100, 100, 5, 3)].sort()).toEqual([0, 1, 3]);
  expect([...clashes(parts.slice(0, 3), 100, 100, 5, 2)]).toEqual([]);
});

test('a quarter turn keeps a part centred where it was', () => {
  const b = bounds(quarterTurn(rect('a', 10, 20, 40, 10)));
  expect(b.width).toBeCloseTo(10); expect(b.height).toBeCloseTo(40);
  expect(b.x + b.width / 2).toBeCloseTo(30); expect(b.y + b.height / 2).toBeCloseTo(25);
});

test('nested parts can be moved by hand, and the move can be undone', async ({ page }) => {
  await page.goto('/en/nesting');
  await page.getByRole('button', { name: 'Arrange parts', exact: true }).click();
  await expect(page.getByText('Layout ready', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Move parts by hand', exact: true }).click();
  const parts = page.locator('.sheet-part');
  await expect(parts.first()).toBeVisible();
  await expect(page.locator('.sheet-part.clash')).toHaveCount(0);
  const a = (await parts.nth(0).boundingBox())!, b = (await parts.nth(1).boundingBox())!;
  await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
  await page.mouse.down();
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 5 });
  await page.mouse.up();
  await expect(page.locator('.sheet-part.clash').first()).toBeVisible();
  await page.keyboard.press('r');
  await page.getByRole('button', { name: 'Undo hand moves', exact: true }).click();
  await expect(page.locator('.sheet-part.clash')).toHaveCount(0);
});
