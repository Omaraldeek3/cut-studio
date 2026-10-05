import { test, expect, type Page } from "@playwright/test";
import { toolIds } from "../src/toolkit/copy";

// Each tool has an address in each language; the address alone sets the
// language and direction, with no hydration mismatch.

function watchHydration(page: Page) {
  const messages: string[] = [];
  page.on("console", message => { if (/hydrat/i.test(message.text())) messages.push(message.text()); });
  page.on("pageerror", error => { if (/hydrat/i.test(error.message)) messages.push(error.message); });
  return messages;
}

test("an English address is English and reports no hydration warning", async ({ page }) => {
  const warnings = watchHydration(page);
  await page.goto("/en/box-maker");
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await expect(page.locator("html")).toHaveAttribute("dir", "ltr");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Box maker");
  expect(warnings).toEqual([]);
});

test("an Arabic address is Arabic, right to left", async ({ page }) => {
  const warnings = watchHydration(page);
  await page.goto("/ar/box-maker");
  await expect(page.locator("html")).toHaveAttribute("lang", "ar");
  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("صانع الصناديق");
  expect(warnings).toEqual([]);
});

test("the language switch keeps the tool", async ({ page }) => {
  await page.goto("/ar/gear-maker");
  await page.getByRole("link", { name: "English" }).click();
  await expect(page).toHaveURL(/\/en\/gear-maker$/);
  await expect(page.locator("html")).toHaveAttribute("dir", "ltr");
});

test("a bare address picks a language and opens the first tool", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveURL(/\/(ar|en)\/image-to-vector$/);
});

test("every tool page has its own title, description and language alternates", async ({ request }) => {
  const html = await (await request.get("/ar/laser-test-card")).text();
  expect(html).toContain("<title>بطاقة اختبار القوة والسرعة لليزر · Cut Studio</title>");
  expect(html.toLowerCase()).toContain('hreflang="en" href="https://cutstudio.omardeek.tech/en/laser-test-card"');
  const sitemap = await (await request.get("/sitemap.xml")).text();
  // Every tool, in both languages.
  expect(sitemap.match(/<loc>/g)).toHaveLength(toolIds.length * 2);
});

test("an unknown tool is not found", async ({ request }) => {
  expect((await request.get("/en/no-such-tool")).status()).toBe(404);
});
