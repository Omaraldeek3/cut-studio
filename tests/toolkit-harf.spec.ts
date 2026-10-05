import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { harfFileFor, harfFileUrl, startWeight, type HarfFont } from "../src/toolkit/harf";

const font = (over: Partial<HarfFont>): HarfFont => ({
  id: "one", family: "Harf One", category: "عصري", latin: false, weights: [400, 700], weightRange: null,
  files: [{ path: "fonts/one/One-Regular.woff", weight: 400, variable: false }, { path: "fonts/one/One-Bold.woff", weight: 700, variable: false }],
  designers: ["A Designer"], licence: "OFL-1.1", licenceFile: "fonts/one/OFL.txt", ...over,
});

test("a Harf font starts bold where it can, and each weight finds its file", () => {
  expect(startWeight(font({}))).toBe(700);
  expect(startWeight(font({ weights: [300, 400, 500] }))).toBe(500);
  expect(harfFileFor(font({}), 400).file.path).toBe("fonts/one/One-Regular.woff");
  expect(harfFileFor(font({}), 900)).toEqual({ file: font({}).files[1], wght: null });
  // A variable file draws every weight; the axis is kept inside the font's range.
  const variable = font({ weights: [200, 400, 1000], weightRange: [200, 1000], files: [{ path: "fonts/cairo/Cairo[slnt,wght].ttf", weight: 400, variable: true }] });
  expect(harfFileFor(variable, 700).wght).toBe(700);
  expect(harfFileFor(variable, 1200).wght).toBe(1000);
  expect(harfFileUrl("fonts/cairo/Cairo[slnt,wght].ttf")).toBe("https://harf.omardeek.tech/fonts/cairo/Cairo%5Bslnt,wght%5D.ttf");
});

test("Arabic lettering offers Harf's fonts, searchable, and sets the text in the chosen one", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  const woff = await readFile("node_modules/@fontsource/tajawal/files/tajawal-arabic-400-normal.woff");
  const fonts = [font({}), font({ id: "two", family: "Harf Two", category: "نسخي", latin: true, weights: [400], files: [{ path: "fonts/two/Two.woff", weight: 400, variable: false }], designers: [], licence: "Open", licenceFile: "fonts/two/LICENSE" })];
  await page.route("https://harf.omardeek.tech/catalog/arabic.json", route => route.fulfill({ json: { count: 2, fonts }, headers: { "access-control-allow-origin": "*" } }));
  await page.route("https://harf.omardeek.tech/fonts/**", route => route.fulfill({ body: woff, contentType: "font/woff", headers: { "access-control-allow-origin": "*" } }));
  await page.goto("/en/arabic-lettering");
  await expect(page.getByText("2 free Arabic fonts")).toBeVisible();
  const options = page.getByRole("listbox", { name: "Harf fonts" }).getByRole("option");
  await expect(options).toHaveCount(2);
  await page.getByLabel("Search Harf fonts").fill("two");
  await expect(options).toHaveCount(1);
  await page.getByLabel("Search Harf fonts").fill("");
  const styles = page.getByRole("group", { name: "Font style" });
  await styles.getByRole("button", { name: "Naskh" }).click();
  await expect(options).toHaveCount(1);
  await styles.getByRole("button", { name: "All" }).click();
  await options.filter({ hasText: "Harf One" }).click();
  await expect(page.getByText("In use:")).toContainText("Harf One Bold");
  await expect(page.getByText("Ready to cut", { exact: true })).toBeVisible();
  await page.getByRole("group", { name: "Weight" }).getByRole("button", { name: "Regular" }).click();
  await expect(page.getByText("In use:")).toContainText("Harf One Regular");
  await expect(page.getByRole("link", { name: "OFL-1.1" })).toHaveAttribute("href", "https://harf.omardeek.tech/fonts/one/OFL.txt");
  // Back to the built-in font, which needs no internet.
  await page.getByRole("button", { name: "Tajawal Bold" }).click();
  await expect(page.getByText("In use:")).toContainText("Tajawal Bold");
  await expect(options.filter({ hasText: "Harf One" })).toHaveAttribute("aria-selected", "false");
  expect(errors).toEqual([]);
});

test("without Harf the lettering still works, and says how to carry on", async ({ page }) => {
  await page.route("https://harf.omardeek.tech/**", route => route.abort());
  await page.goto("/ar/arabic-lettering");
  await expect(page.getByText(/تعذّر الوصول إلى مكتبة خطوط حرف/)).toBeVisible();
  await expect(page.getByRole("button", { name: "حاول مرة أخرى" })).toBeVisible();
  await expect(page.getByText("جاهز للقص", { exact: true })).toBeVisible();
});
