import { test, expect, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { PngStream } from "../src/toolkit/upscale-core";

/** A small gradient picture with a dark disc, as PNG bytes. */
async function picture(width: number, height: number, alpha = false) {
  const png = new PngStream(width, height, alpha ? 4 : 3);
  const channels = alpha ? 4 : 3;
  const data = new Uint8Array(width * height * channels);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const i = (y * width + x) * channels, disc = Math.hypot(x - width / 2, y - height / 2) < Math.min(width, height) / 3;
    data[i] = disc ? 30 : (x * 255) / width; data[i + 1] = disc ? 30 : (y * 255) / height; data[i + 2] = disc ? 40 : 180;
    if (alpha) data[i + 3] = disc ? 255 : 0;
  }
  await png.addRows(data);
  return Buffer.from(await (await png.finish()).arrayBuffer());
}

async function openTool(page: Page, name: string) {
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.goto("/en/nesting");
  await page.getByRole("link", { name, exact: true }).click();
  return errors;
}

test("the AI upscaler enlarges a picture and saves a JPEG with its size", async ({ page }) => {
  test.setTimeout(240_000);
  const errors = await openTool(page, "AI upscaler");
  await page.getByLabel("Import image").setInputFiles({ name: "small.png", mimeType: "image/png", buffer: await picture(96, 64) });
  await page.getByRole("radio", { name: /Graphics/ }).click();
  await page.getByRole("button", { name: "2×", exact: true }).click();
  await page.getByRole("button", { name: /Enlarge and save/ }).click();
  await expect(page.getByText("Saved file ready", { exact: true })).toBeVisible({ timeout: 200_000 });
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Save the file", exact: true }).click();
  const bytes = await readFile((await (await download).path())!);
  expect([bytes[0], bytes[1]]).toEqual([0xff, 0xd8]);
  // Walk to the frame header for the picture's size.
  let at = 2;
  while (at < bytes.length && bytes[at + 1] !== 0xc0) at += 2 + bytes.readUInt16BE(at + 2);
  expect(bytes.readUInt16BE(at + 5)).toBe(128);
  expect(bytes.readUInt16BE(at + 7)).toBe(192);
  expect(errors).toEqual([]);
});

test("a small picture is cleaned up by the AI before it is traced", async ({ page }) => {
  test.setTimeout(240_000);
  const errors = await openTool(page, "Image to vector");
  await page.getByLabel("Import image").setInputFiles({ name: "small.png", mimeType: "image/png", buffer: await picture(120, 90) });
  await expect(page.getByText(/^AI clean-up \d+%$/)).toBeVisible();
  await expect(page.getByText("Vector ready", { exact: true })).toBeVisible({ timeout: 200_000 });
  // Traced from the AI enlargement, four times the pixels on each side.
  await expect(page.locator(".preview-bottom")).toContainText("480 × 360 px traced");
  await page.getByText("AI clean-up before tracing", { exact: true }).click();
  await expect(page.locator(".preview-bottom")).toContainText("120 × 90 px traced", { timeout: 30_000 });
  expect(errors).toEqual([]);
});

test("poster tiling splits a print into panels and saves one", async ({ page }) => {
  const errors = await openTool(page, "Poster tiling");
  await page.getByLabel("Import image").setInputFiles({ name: "front.png", mimeType: "image/png", buffer: await picture(600, 300) });
  await page.getByLabel("Or exact width").fill("160");
  await expect(page.locator(".tl-list li")).toHaveCount(4);
  const download = page.waitForEvent("download");
  await page.locator(".tl-list li").first().getByRole("button").click();
  expect((await download).suggestedFilename()).toBe("front-panel-01-of-04.jpg");
  expect(errors).toEqual([]);
});

test("a sticker gets a cut line and a print-and-cut PDF", async ({ page }) => {
  const errors = await openTool(page, "Contour & offset");
  await page.getByRole("radio", { name: /Sticker/ }).click();
  await page.getByLabel("Import image").setInputFiles({ name: "badge.png", mimeType: "image/png", buffer: await picture(200, 200, true) });
  await expect(page.getByText("Outline ready", { exact: true })).toBeVisible();
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Print & cut PDF", exact: true }).click();
  const pdf = (await readFile((await (await download).path())!)).toString("latin1");
  expect(pdf).toContain("/Separation /CutContour");
  expect(pdf).toContain("/Subtype /Image");
  expect(errors).toEqual([]);
});

test("Arabic lettering loads its font and exports joined outlines", async ({ page }) => {
  const errors = await openTool(page, "Arabic lettering");
  await expect(page.getByText("Ready to cut", { exact: true })).toBeVisible({ timeout: 30_000 });
  await page.locator(".lt-text").fill("مطعم الريّان");
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export DXF", exact: true }).click();
  const dxf = (await readFile((await (await download).path())!)).toString();
  expect(dxf).toContain("POLYLINE");
  expect(errors).toEqual([]);
});

test("the print sheet lays out copies and saves a PDF", async ({ page }) => {
  const errors = await openTool(page, "Print sheet");
  await page.getByLabel("Import image").setInputFiles({ name: "label.png", mimeType: "image/png", buffer: await picture(100, 100, true) });
  await expect(page.locator(".status-pill")).toContainText("on the sheet");
  await page.getByRole("button", { name: "Shape", exact: true }).click();
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: /Save the sheet/ }).click();
  const pdf = (await readFile((await (await download).path())!)).toString("latin1");
  expect(pdf.match(/\/Im0 Do/g)!.length).toBeGreaterThan(4);
  expect(pdf).toContain("/Separation /CutContour");
  expect(errors).toEqual([]);
});

test("every workshop tool opens without an error", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.goto("/ar/nesting");
  const buttons = page.locator(".sidebar nav button");
  const count = await buttons.count();
  for (let i = 0; i < count; i++) {
    await buttons.nth(i).click();
    await expect(page.locator("h1")).toBeVisible();
  }
  expect(errors).toEqual([]);
});

test("Arabic lettering cuts a stencil plate with bridges", async ({ page }) => {
  const errors = await openTool(page, "Arabic lettering");
  await expect(page.getByText("Ready to cut", { exact: true })).toBeVisible({ timeout: 30_000 });
  await page.locator(".lt-text").fill("هو");
  await page.getByRole("button", { name: "Rectangle", exact: true }).click();
  await page.locator("label.field").filter({ hasText: /^The text/ }).locator("select").selectOption("stencil");
  await expect(page.getByText(/\d+ bridges\./)).toBeVisible();
  await expect(page.locator(".stats-row")).toContainText("1");
  expect(errors).toEqual([]);
});

test("the tag maker makes a batch of numbered tags", async ({ page }) => {
  const errors = await openTool(page, "Tags & keychains");
  await page.getByText("Batch from a list", { exact: true }).click();
  await page.getByLabel("From", { exact: true }).fill("1");
  await page.getByLabel("To", { exact: true }).fill("12");
  await page.getByRole("button", { name: "Fill in numbers from–to", exact: true }).click();
  await expect(page.getByText(/^12 tags, up to/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Export SVG", exact: true })).toBeEnabled({ timeout: 30_000 });
  expect(errors).toEqual([]);
});

test("image to vector offers job presets and warns about details too small to cut", async ({ page }) => {
  const errors = await openTool(page, "Image to vector");
  await page.getByRole("button", { name: "Laser cut", exact: true }).click();
  await expect(page.getByRole("radio", { name: /Outline/ })).toHaveAttribute("aria-checked", "true");
  await expect(page.getByText("Vector ready", { exact: true })).toBeVisible({ timeout: 30_000 });
  // At 10 mm wide no shape of the sample reaches 15 mm.
  await page.getByRole("spinbutton", { name: /^Width/ }).fill("10");
  await page.getByLabel("Smallest detail your machine makes").fill("15");
  await expect(page.getByText(/shapes or holes are smaller than 15 mm/)).toBeVisible();
  await page.getByRole("button", { name: "Logo for print", exact: true }).click();
  await expect(page.getByRole("radio", { name: /Colour/ })).toHaveAttribute("aria-checked", "true");
  await expect(page.getByText(/shapes or holes are smaller than/)).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("the trophy base maker draws its layers and plate", async ({ page }) => {
  const errors = await openTool(page, "Trophy base");
  await expect(page.locator(".stat").filter({ hasText: "Slot" }).first()).toContainText("130.2 × 5.2");
  await page.getByLabel("Plate thickness").fill("3");
  await expect(page.locator(".stat").filter({ hasText: "Slot" }).first()).toContainText("130.2 × 3.2");
  await expect(page.getByRole("button", { name: "Export DXF", exact: true })).toBeEnabled();
  expect(errors).toEqual([]);
});

test("Arabic lettering makes a cake topper with spikes and second-colour letters", async ({ page }) => {
  const errors = await openTool(page, "Arabic lettering");
  await expect(page.getByText("Ready to cut", { exact: true })).toBeVisible({ timeout: 30_000 });
  await page.locator(".lt-text").fill("عيد ميلاد سعيد");
  await page.getByRole("button", { name: "Cake topper", exact: true }).click();
  await expect(page.locator(".error-note")).toHaveCount(0);
  const parts = page.locator(".stat").filter({ hasText: "Parts" }).first().locator("strong");
  await expect(parts).not.toHaveText("1");
  await page.locator("label.field").filter({ hasText: /^The text on it/ }).locator("select").selectOption("engrave");
  await expect(parts).toHaveText("1");
  await expect(page.getByRole("button", { name: "Export SVG", exact: true })).toBeEnabled();
  expect(errors).toEqual([]);
});
