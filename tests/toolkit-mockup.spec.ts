import { test, expect } from '@playwright/test';

test('a design shows on every product, and the mockup saves as a picture', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/en/product-mockup');
  await expect(page.getByRole('heading', { name: 'Show the customer before you cut' })).toBeVisible();
  await page.getByRole('button', { name: 'Use a sample logo' }).click();
  await expect(page.getByText('Mockup ready', { exact: true })).toBeVisible();
  const scenes = page.locator('.mk-scenes button');
  await expect(scenes).toHaveCount(9);
  const looks: string[] = [];
  for (let i = 0; i < 9; i++) {
    await scenes.nth(i).click();
    await expect(scenes.nth(i)).toHaveAttribute('aria-checked', 'true');
    // Each scene draws something of its own: a fingerprint of its pixels.
    await expect.poll(async () => {
      const print = await page.evaluate(() => {
        const c = document.querySelector('.mk-surface canvas') as HTMLCanvasElement, d = c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data;
        let sum = 0; for (let k = 0; k < d.length; k += 4097) sum = (sum * 31 + d[k]) % 1e9;
        return `${c.width}x${c.height}:${sum}`;
      });
      return looks.includes(print) ? '' : print;
    }).not.toBe('');
    looks.push(await page.evaluate(() => { const c = document.querySelector('.mk-surface canvas') as HTMLCanvasElement, d = c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data; let sum = 0; for (let k = 0; k < d.length; k += 4097) sum = (sum * 31 + d[k]) % 1e9; return `${c.width}x${c.height}:${sum}`; }));
  }
  await scenes.nth(3).click();
  await page.getByText('At night, lit', { exact: true }).click();
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: /Save for WhatsApp/ }).click();
  expect((await download).suggestedFilename()).toBe('sample-logo-shop-mockup.jpg');
  await page.goto('/ar/product-mockup');
  await expect(page.getByRole('heading', { name: 'أرِ الزبون قبل أن تقص' })).toBeVisible();
  expect(errors).toEqual([]);
});
