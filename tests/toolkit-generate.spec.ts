import { test, expect } from "@playwright/test";
import sharp from "sharp";
import { composePrompt, estimate, nearest, pixels, provider, purposes } from "../src/toolkit/image-ai";

/* No AI service is ever called for real: every request is answered here,
   so the tests cost nothing and check exactly what is sent. */

const SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 100"><rect width="200" height="100" fill="#fff"/><circle cx="100" cy="50" r="40" fill="#111"/></svg>';

test("a purpose steers the description and the cost follows the model", () => {
  const cut = purposes.find(p => p.id === "cut")!, free = purposes.find(p => p.id === "free")!;
  expect(composePrompt("  a falcon\n with open wings ", cut)).toMatch(/^a falcon with open wings\. Style: .*one piece/);
  expect(composePrompt("a falcon", free)).toBe("a falcon");
  expect(composePrompt("x".repeat(900), free)).toHaveLength(600);
  expect(estimate(provider("recraft").models[0], 3)).toBeCloseTo(0.24);
  // Only Recraft's prices are known; other services bill at their own.
  expect(estimate(provider("fal").models[0], 3)).toBeUndefined();
});

test("each service gets the nearest size it offers", () => {
  expect(pixels("16:9")).toEqual({ width: 1024, height: 576 });
  expect(pixels("1:2")).toEqual({ width: 512, height: 1024 });
  expect(nearest("2:1", ["1:1", "4:3", "16:9"])).toBe("16:9");
  expect(nearest("3:4", ["1:1", "3:4", "9:16"])).toBe("3:4");
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
  await expect(page.locator(".error-note")).toHaveText("لم يقبل Recraft هذا المفتاح. انسخه مرة أخرى من حسابك في Recraft.");
  await page.getByRole("button", { name: "انسَ المفتاح" }).click();
  expect(await page.evaluate(() => localStorage.getItem("cut-studio:recraft-key"))).toBeNull();
});

test("FLUX through fal.ai: any model typed in, the key sent to fal only, the picture handed to the tracer", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  const png = (await sharp(Buffer.from(SVG)).png().toBuffer()).toString("base64");
  const sent: { url: string; auth: string | null; body: Record<string, unknown> }[] = [];
  await page.route("https://fal.run/**", async route => {
    const request = route.request();
    if (request.method() === "OPTIONS") return route.fulfill({ status: 204, headers: { "access-control-allow-origin": "*", "access-control-allow-headers": "Authorization, Content-Type", "access-control-allow-methods": "POST" } });
    sent.push({ url: request.url(), auth: request.headers()["authorization"] ?? null, body: request.postDataJSON() });
    const n = (request.postDataJSON() as { num_images: number }).num_images;
    return route.fulfill({ status: 200, headers: { "access-control-allow-origin": "*", "content-type": "application/json" }, body: JSON.stringify({ images: Array.from({ length: n }, () => ({ url: `data:image/png;base64,${png}`, content_type: "image/png" })) }) });
  });
  await page.route("https://external.api.recraft.ai/**", route => route.abort());

  await page.goto("/en/ai-design");
  await page.getByLabel("AI service").selectOption("fal");
  await page.getByLabel("Model", { exact: true }).selectOption({ label: "Another model…" });
  await page.getByLabel("Model name, as the service writes it").fill("fal-ai/flux/dev");
  await page.getByLabel("API key").fill("fal-key-1");
  await page.getByLabel("Shape (width:height)").selectOption("16:9");
  await page.getByRole("button", { name: "A camel walking past two palm trees" }).click();
  await page.getByRole("button", { name: /Draw 2 designs/ }).click();
  await expect(page.locator(".gen-card")).toHaveCount(2);
  expect(sent).toHaveLength(1);
  expect(sent[0].url).toBe("https://fal.run/fal-ai/flux/dev");
  expect(sent[0].auth).toBe("Key fal-key-1");
  expect(sent[0].body).toMatchObject({ num_images: 2, image_size: { width: 1024, height: 576 }, sync_mode: true });
  // A picture, not a vector: no SVG button, and the price is the service's own.
  await expect(page.locator(".gen-card").first().getByRole("button", { name: "SVG" })).toHaveCount(0);
  await expect(page.getByText(/fal\.ai bills your account at its own prices/)).toBeVisible();
  const download = page.waitForEvent("download");
  await page.locator(".gen-card").first().getByRole("button", { name: "PNG" }).click();
  expect((await download).suggestedFilename()).toMatch(/^design-\d+\.png$/);
  // The choice of service is remembered; the key is not.
  expect(await page.evaluate(() => [localStorage.getItem("cut-studio:ai-provider"), localStorage.getItem("cut-studio:fal-key")])).toEqual(["fal", null]);
  await page.locator(".gen-card").first().getByRole("button", { name: /Prepare for cutting/ }).click();
  await expect(page).toHaveURL(/\/en\/image-to-vector$/);
  await expect(page.getByText(/design-\d+/).first()).toBeVisible();
  expect(errors).toEqual([]);
});

test("Google's Imagen gets its own request shape, and an unknown model is named in Arabic", async ({ page }) => {
  const png = (await sharp(Buffer.from(SVG)).png().toBuffer()).toString("base64");
  const sent: { url: string; key: string | null; body: Record<string, unknown> }[] = [];
  await page.route("https://generativelanguage.googleapis.com/**", async route => {
    const request = route.request();
    if (request.method() === "OPTIONS") return route.fulfill({ status: 204, headers: { "access-control-allow-origin": "*", "access-control-allow-headers": "x-goog-api-key, Content-Type", "access-control-allow-methods": "POST" } });
    sent.push({ url: request.url(), key: request.headers()["x-goog-api-key"] ?? null, body: request.postDataJSON() });
    const cors = { "access-control-allow-origin": "*", "content-type": "application/json" };
    if (request.url().includes("imagen-9")) return route.fulfill({ status: 404, headers: cors, body: JSON.stringify({ error: { code: 404, message: "models/imagen-9 is not found" } }) });
    return route.fulfill({ status: 200, headers: cors, body: JSON.stringify({ predictions: [{ bytesBase64Encoded: png, mimeType: "image/png" }] }) });
  });
  await page.goto("/ar/ai-design");
  await page.getByLabel("خدمة الذكاء الاصطناعي").selectOption("google");
  await page.getByLabel("النموذج", { exact: true }).selectOption("imagen-4.0-generate-001");
  await page.getByLabel("مفتاح API").fill("g-key");
  await page.getByLabel("الشكل (العرض:الارتفاع)").selectOption("2:1");
  await page.getByRole("button", { name: "صقر بجناحين مفتوحين" }).click();
  await page.getByRole("button", { name: /ارسم تصميمين|ارسم 2 تصاميم/ }).click();
  await expect(page.locator(".gen-card")).toHaveCount(1);
  expect(sent[0].url).toBe("https://generativelanguage.googleapis.com/v1beta/models/imagen-4.0-generate-001:predict");
  expect(sent[0].key).toBe("g-key");
  expect(sent[0].body).toMatchObject({ parameters: { sampleCount: 2, aspectRatio: "16:9" } });
  await page.getByLabel("النموذج", { exact: true }).selectOption({ label: "نموذج آخر…" });
  await page.getByLabel("اسم النموذج كما تكتبه الخدمة").fill("imagen-9");
  await page.getByRole("button", { name: /ارسم/ }).click();
  await expect(page.locator(".error-note")).toHaveText("لا يعرف Google AI النموذج «imagen-9». تحقق من اسمه في Google AI.");
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
