import { test, expect } from '@playwright/test';
import { chartChipLoad, defaultFeeds, feedsAndSpeeds, MATERIALS } from '../src/toolkit/feeds';

test('feed is speed × flutes × chip load, at the material\'s speed when the machine allows', () => {
  const r = feedsAndSpeeds({ ...defaultFeeds, material: 'aluminium', diameter: 3, flutes: 1, maxFeed: 5000 });
  expect(r.rpm).toBe(14000);
  expect(r.feed).toBe(Math.round(14000 * 1 * MATERIALS.aluminium.chip[0]));
  expect(r.plunge).toBe(Math.round(r.feed / 4));
  expect(r.notes).toEqual([]);
});

test('a machine that cannot feed fast enough gets a slower spindle, not a thinner chip', () => {
  // Plywood, 6 mm, 2 flutes: 18,000 rpm would need 10,440 mm/min.
  const r = feedsAndSpeeds({ ...defaultFeeds, material: 'plywood', diameter: 6, flutes: 2, maxFeed: 5000 });
  expect(r.notes).toEqual(['feed-limited']);
  expect(r.feed).toBe(5000);
  expect(r.chipLoad).toBeCloseTo(0.29, 3);
  expect(r.rpm).toBe(Math.round(5000 / (2 * 0.29)));
  // Light machine: half of 0.75 × diameter per pass.
  expect(r.depth).toBe(2.25);
  const slow = feedsAndSpeeds({ ...defaultFeeds, material: 'mdf', diameter: 12, flutes: 3, maxFeed: 3000, minRpm: 10000 });
  expect(slow.notes).toEqual(['feed-limited', 'below-min-rpm']);
  expect(slow.rpm).toBe(10000);
});

test('the chart is followed between sizes, and a chip load can be set by hand', () => {
  const [a, b] = MATERIALS.hardwood.chip;
  expect(chartChipLoad('hardwood', 4.5)).toBeCloseTo((a + b) / 2, 6);
  const r = feedsAndSpeeds({ ...defaultFeeds, chipLoad: 0.1, maxFeed: 50000 });
  expect(r.notes).toEqual(['chip-overridden']);
  expect(r.feed).toBe(18000 * 2 * 0.1);
  expect(() => feedsAndSpeeds({ ...defaultFeeds, flutes: 2.5 })).toThrow(/whole number/);
});

test('the feeds and speeds page answers for the chosen material', async ({ page }) => {
  await page.goto('/en/cnc-feeds-speeds');
  const stat = (label: string) => page.locator('.stat').filter({ hasText: label }).first().locator('strong');
  await expect(stat('Feed rate')).toContainText('5000');
  await page.getByRole('combobox', { name: 'Material', exact: true }).selectOption('aluminium');
  await expect(stat('Spindle speed')).toContainText('14000');
  await page.goto('/ar/cnc-feeds-speeds');
  await expect(page.getByText('سرعة التغذية', { exact: true }).first()).toBeVisible();
});
