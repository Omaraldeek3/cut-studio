import { test, expect } from '@playwright/test';
import { coverage, largestOnly, refine, defaultMask } from '../src/toolkit/cutout';

/** A square mask with a big subject on the left and a small speck on the right, both with a soft edge. */
function mask(side = 64) {
  const m = new Uint8Array(side * side);
  for (let y = 0; y < side; y++) for (let x = 0; x < side; x++) {
    const big = 14 - Math.hypot(x - 20, y - 32), speck = 3 - Math.hypot(x - 52, y - 10);
    const v = Math.max(big, speck);
    m[y * side + x] = v >= 1 ? 255 : v <= -1 ? 0 : Math.round(((v + 1) / 2) * 255);
  }
  return m;
}

test('a soft edge is kept as it is, a crisp one is a clean line', () => {
  const m = mask();
  expect(refine(m, 64, defaultMask)).toEqual(m);
  const crisp = refine(m, 64, { ...defaultMask, edge: 'crisp' });
  const soft = [...crisp].filter(v => v > 0 && v < 255).length, before = [...m].filter(v => v > 0 && v < 255).length;
  expect(soft).toBeLessThan(before / 2);
});

test('moving the edge in shrinks the subject, out grows it', () => {
  const m = mask(), at = (shift: number) => coverage(refine(m, 64, { ...defaultMask, shift }));
  expect(at(40)).toBeLessThan(at(0));
  expect(at(-40)).toBeGreaterThan(at(0));
});

test('keeping the main subject drops the stray speck and keeps the subject whole', () => {
  const m = mask(), kept = largestOnly(m, 64);
  expect(kept[10 * 64 + 52]).toBe(0);
  expect(kept[32 * 64 + 20]).toBe(255);
  expect(coverage(kept)).toBeLessThan(coverage(m));
  // The fringe round the subject stays soft.
  expect(kept[32 * 64 + 34]).toBe(m[32 * 64 + 34]);
});

test('a photo loses its background on this computer, and the subject goes on to be cut round', async ({ page }) => {
  test.setTimeout(240_000);
  const errors: string[] = [], outside: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => { const url = new URL(request.url()); if (!['127.0.0.1', 'localhost'].includes(url.hostname)) outside.push(url.hostname); });
  await page.goto('/en/remove-background');
  await expect(page.getByRole('heading', { name: 'Take the background off a photo' })).toBeVisible();
  await page.getByRole('button', { name: 'Use a sample photo' }).click();
  await expect(page.getByText('Background removed', { exact: true })).toBeVisible({ timeout: 200_000 });
  // The mug fills a fair part of the photo, not all of it and not nothing.
  const subject = Number(await page.locator('.stat').filter({ hasText: 'Subject' }).locator('strong').innerText().then(t => t.replace(/\D/g, '')));
  expect(subject).toBeGreaterThan(10);
  expect(subject).toBeLessThan(60);
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: /^PNG/ }).click();
  expect((await download).suggestedFilename()).toBe('sample-mug-cutout.png');
  await page.getByRole('button', { name: /Cut round it/ }).click();
  await expect(page).toHaveURL(/\/en\/image-to-vector$/);
  await expect(page.getByText('sample-mug-silhouette', { exact: false }).first()).toBeVisible();
  // Nothing was sent anywhere: the model and the photo stayed on this machine.
  expect(outside).toEqual([]);
  expect(errors).toEqual([]);
});
