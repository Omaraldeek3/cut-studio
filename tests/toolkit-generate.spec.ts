import { test, expect } from "@playwright/test";
import { composePrompt, estimate, purposes, recraftModels } from "../src/toolkit/recraft";

/* Recraft is never called for real: every request to its API is answered
   here, so the tests cost nothing and check exactly what is sent. */

const SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 100"><rect width="200" height="100" fill="#fff"/><circle cx="100" cy="50" r="40" fill="#111"/></svg>';

test("a purpose steers the description and the cost follows the model", () => {
  const cut = purposes.find(p => p.id === "cut")!, free = purposes.find(p => p.id === "free")!;
  expect(composePrompt("  a falcon\n with open wings ", cut)).toMatch(/^a falcon with open wings\. Style: .*one piece/);
  expect(composePrompt("a falcon", free)).toBe("a falcon");
  expect(composePrompt("x".repeat(900), free)).toHaveLength(600);
  expect(estimate(recraftModels[0], 3)).toBeCloseTo(0.24);
});

test("design from text sends the key to Recraft only and hands a design to the tracer", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  const sent: { url: string; auth: string | null; body: unknown }[] = [];
  await page.route("https://external.api.recraft.ai/**", async route => {
    const request = route.request();
    if (request.method() === "OPTIONS") return route.fulfill({ status: 204, headers: { "access-control-allow-origin": "*", "access-control-allow-headers": "Authorization, Content-Type", "access-control-allow-methods": "GET, POST" } });
    sent.push({ url: request.url(), auth: request.headers()["authorization"] ?? null, body: request.postDataJSON?.() ?? null });
    const cors = { "access-control-allow-origin": "*", "content-type": "application/json" };
    if (request.url().endsWith("/users/me")) return route.fulfill({ status: 200, headers: cors, body: JSON.stringify({ name: "Workshop", credits: 1200 }) });
    const n = (request.postDataJSON() as { n: number }).n;
    return route.fulfill({ status: 200, headers: cors, body: JSON.stringify({ data: Array.from({ length: n }, () => ({ b64_json: Buffer.from(SVG).toString("base64") })) }) });
  });

  await page.goto("/en/ai-design");
  await expect(page.getByRole("heading", { name: "Draw a design from words" })).toBeVisible();
  const draw = page.getByRole("button", { name: /Draw 2 designs/ });
  await expect(draw).toBeDisabled();

  await page.getByLabel("API key").fill("test-key-123");
  await page.getByRole("button", { name: "Check the key and balance" }).click();
  await expect(page.getByText(/Key accepted · Workshop · balance 1200 units/)).toBeVisible();

  await page.getByRole("button", { name: "A falcon with open wings" }).click();
  await page.getByRole("radio", { name: /Line art to engrave/ }).click();
  await draw.click();
  await expect(page.locator(".gen-card")).toHaveCount(2);

  const generation = sent.find(s => s.url.endsWith("/images/generations"))!;
  expect(generation.auth).toBe("Bearer test-key-123");
  expect(generation.body).toMatchObject({ model: "recraftv4_1_vector", size: "1:1", n: 2, response_format: "b64_json" });
  expect((generation.body as { prompt: string }).prompt).toMatch(/^A falcon with open wings\. Style: black line art/);
  // The key was not remembered, so nothing about it is stored.
  expect(await page.evaluate(() => localStorage.getItem("cut-studio:recraft-key"))).toBeNull();

  const download = page.waitForEvent("download");
  await page.locator(".gen-card").first().getByRole("button", { name: "SVG" }).click();
  expect((await download).suggestedFilename()).toMatch(/^design-\d+\.svg$/);

  await page.locator(".gen-card").first().getByRole("button", { name: /Prepare for cutting/ }).click();
  await expect(page).toHaveURL(/\/en\/image-to-vector$/);
  await expect(page.getByText(/design-\d+/).first()).toBeVisible();
  // Line art arrives with the engraving preset: outline mode.
  await expect(page.getByRole("radio", { name: /Outline/ })).toHaveAttribute("aria-checked", "true");
  expect(errors).toEqual([]);
});

test("a key Recraft refuses gets a clear message, in Arabic too", async ({ page }) => {
  await page.route("https://external.api.recraft.ai/**", route => route.fulfill({ status: 401, headers: { "access-control-allow-origin": "*", "content-type": "application/json" }, body: JSON.stringify({ code: "invalid_token" }) }));
  await page.goto("/ar/ai-design");
  await page.getByLabel("مفتاح API").fill("wrong");
  await page.getByText("تذكّره على هذا الجهاز", { exact: true }).click();
  expect(await page.evaluate(() => localStorage.getItem("cut-studio:recraft-key"))).toBe("wrong");
  await page.getByRole("button", { name: "افحص المفتاح والرصيد" }).click();
  await expect(page.locator(".error-note")).toHaveText("لم يقبل Recraft هذا المفتاح. انسخه مرة أخرى من ملفك في Recraft.");
  await page.getByRole("button", { name: "انسَ المفتاح" }).click();
  expect(await page.evaluate(() => localStorage.getItem("cut-studio:recraft-key"))).toBeNull();
});

test("image to vector lets a traced colour be swapped for another", async ({ page }) => {
  await page.goto("/en/image-to-vector");
  const pick = page.getByLabel("Change colour 1");
  await expect(pick).toBeVisible({ timeout: 30_000 });
  await pick.fill("#ff0000");
  await expect(page.locator(".vz-art path[fill='#ff0000']").first()).toBeAttached();
  await page.getByRole("button", { name: "Original colours" }).click();
  await expect(page.locator(".vz-art path[fill='#ff0000']")).toHaveCount(0);
});
