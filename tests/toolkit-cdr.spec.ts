import { test, expect } from '@playwright/test';
import { existsSync, readFileSync } from 'node:fs';
import { runCdr2xhtml } from '../src/toolkit/cdr-wasm';

// A vector sample that ships with CorelDRAW. CorelDRAW files are usually
// someone's artwork, so none is committed; these tests skip without one.
const fixture = 'C:/Program Files/Corel/CorelDRAW Technical Suite/27/Draw/CustomMediaStrokes/Mosaic/spray_16.cdr';
const converter = () => new WebAssembly.Module(readFileSync('public/wasm/cdr2xhtml.wasm'));

test('the CorelDRAW reader refuses a file that is not CorelDRAW', () => {
  const run = runCdr2xhtml(converter(), new TextEncoder().encode('not a CorelDRAW document'));
  expect(run.code).not.toBe(0);
  expect(run.stdout).toBe('');
  expect(run.stderr).toMatch(/Unsupported/);
});

test('a real CorelDRAW file converts to pages of vector paths at its page size', () => {
  test.skip(!existsSync(fixture), 'Local CorelDRAW sample is not installed.');
  const run = runCdr2xhtml(converter(), readFileSync(fixture));
  expect(run.code).toBe(0);
  expect(run.stdout).toContain('svg:path');
  expect(run.stdout).toContain('width="11.0000in"');
});

test('a CorelDRAW file imports in the browser, with no server involved', async ({ page }) => {
  test.skip(!existsSync(fixture), 'Local CorelDRAW sample is not installed.');
  const posted: string[] = [];
  page.on('request', r => { if (r.method() === 'POST') posted.push(r.url()); });
  await page.goto('/en/nesting');
  await page.getByLabel('Import vector file').setInputFiles(fixture);
  await expect(page.getByText(/\d+ parts loaded/)).toBeVisible({ timeout: 40000 });
  await expect(page.getByText('spray_16.cdr')).toBeVisible();
  await expect(page.getByText('279.4 × 215.9 mm', { exact: true })).toBeVisible();
  expect(posted).toEqual([]);
});
