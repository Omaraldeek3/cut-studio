import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { anchorMarks, isMark } from "../src/toolkit/anchor";
import { commandLoops, groupLoops, layoutText } from "../src/toolkit/lettering";
import { unionContours } from "../src/toolkit/vector-ops";
import { woffToSfnt } from "../src/toolkit/woff";
import type { Contour, Point } from "../src/toolkit/types";

const rect = (x: number, y: number, w: number, h: number): Point[] => [{ x, y }, { x: x + w, y }, { x: x + w, y: y + h }, { x, y: y + h }];
const pieces = (contours: Contour[]) => groupLoops(contours.map(c => c.points)).length;
const top = (contours: Contour[]) => Math.min(...contours.flatMap(c => c.points.map(p => p.y)));
// An em of 100 mm: a 20 × 60 stroke is a letter, a 10 × 10 square is a dot.
const em = 100, stroke = rect(0, 40, 20, 60);

test("a dot above its letter moves down until it sinks in, and they weld into one piece", () => {
  const out = anchorMarks([stroke, rect(5, 20, 10, 10)], { mode: "move", depth: 0.2, em });
  expect(out).toMatchObject({ marks: 1, anchored: 1 });
  expect(pieces(out.contours)).toBe(1);
  // 10 mm down to touch, then 2 mm (a fifth of its height) into the stroke.
  expect(top(out.contours)).toBeCloseTo(32, 1);
});

test("a dot below its letter moves up, and one beside nothing in reach is left alone", () => {
  const below = anchorMarks([stroke, rect(5, 110, 10, 10)], { mode: "move", depth: 0.2, em });
  expect(pieces(below.contours)).toBe(1);
  expect(Math.max(...below.contours.flatMap(c => c.points.map(p => p.y)))).toBeCloseTo(108, 1);
  const far = anchorMarks([stroke, rect(400, 20, 10, 10)], { mode: "move", depth: 0.2, em });
  expect(far.anchored).toBe(0);
  expect(pieces(far.contours)).toBe(2);
});

test("a bridge keeps the dot where the font put it", () => {
  const out = anchorMarks([stroke, rect(5, 20, 10, 10)], { mode: "bridge", depth: 0.2, bridge: 3, em });
  expect(pieces(out.contours)).toBe(1);
  expect(top(out.contours)).toBeCloseTo(20, 1);
});

test("automatic moves a dot sitting close to its letter and bridges one further off", () => {
  const near = anchorMarks([stroke, rect(5, 20, 10, 10)], { mode: "auto", depth: 0.2, em });
  expect(top(near.contours)).toBeCloseTo(32, 1);
  const far = anchorMarks([stroke, rect(5, 5, 10, 10)], { mode: "auto", depth: 0.2, em });
  expect(pieces(far.contours)).toBe(1);
  expect(top(far.contours)).toBeCloseTo(5, 1);
});

test("the top dot of three lands on the two below it, as on ث", () => {
  const out = anchorMarks([rect(0, 40, 40, 60), rect(4, 26, 10, 10), rect(26, 26, 10, 10), rect(15, 8, 10, 10)], { mode: "move", depth: 0.2, em });
  expect(out.anchored).toBe(3);
  expect(pieces(out.contours)).toBe(1);
});

test("a tall alef is a letter, not a mark, even when it is slim", () => {
  expect(isMark({ area: 0.05 * em * em, width: 0.1 * em, height: 0.7 * em }, em, 0.3 * em * em)).toBe(false);
  expect(isMark({ area: 0.012 * em * em, width: 0.13 * em, height: 0.11 * em }, em, 0.3 * em * em)).toBe(true);
});

test("Arabic in Tajawal comes out as one piece per word, every dot on its letter", async () => {
  const hb = await import("harfbuzzjs");
  const bytes = await woffToSfnt(await readFile("node_modules/@fontsource/tajawal/files/tajawal-arabic-700-normal.woff"));
  const face = new hb.Face(new hb.Blob(bytes), 0);
  const shaper = { font: new hb.Font(face), upem: face.upem };
  const layout = layoutText(hb, { arabic: shaper, latin: shaper }, "بيت ثقة", { lineHeight: 1.1, wordSpacing: 0, letterSpacing: 0, align: "center" });
  // A tenth of a millimetre per layout unit: an em of 100 mm.
  const loops = commandLoops(layout.glyphs, 0.5).map(loop => loop.map(p => ({ x: p.x / 10, y: p.y / 10 })));
  expect(pieces(unionContours(loops))).toBe(14);
  for (const mode of ["auto", "move", "bridge"] as const) {
    const out = anchorMarks(loops, { mode, depth: 0.15, em: 100 });
    expect(out.marks, mode).toBe(12);
    expect(pieces(out.contours), mode).toBe(2);
  }
});

test("Arabic lettering keeps the dots on by default, and explains the stencil instead when asked", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.route("https://harf.omardeek.tech/**", route => route.abort());
  await page.goto("/en/arabic-lettering");
  const parts = page.locator(".stat").filter({ hasText: "Parts" }).locator("strong");
  await expect(page.getByText("Ready to cut", { exact: true })).toBeVisible();
  // افتتاح قريباً: 17 pieces with every dot loose, 5 letters and words with them on.
  await expect(parts).toHaveText("5");
  await expect(page.locator(".lt-anchored")).toHaveText("12 marks joined to their letters.");
  await page.getByText("Keep the dots on their letters", { exact: true }).click();
  await expect(parts).toHaveText("17");
  await page.getByText("Keep the dots on their letters", { exact: true }).click();
  await page.getByRole("radio", { name: "Keep in place, bridge" }).click();
  await expect(parts).toHaveText("5");
  await expect(page.getByText(/stays where the font put it/)).toBeVisible();
  await page.getByRole("radio", { name: /Cut out of a sheet/ }).click();
  await expect(page.getByText("Keep the dots on their letters", { exact: true })).toHaveCount(0);
  await expect(page.getByText(/In a stencil the letters are cut out and the sheet is kept/)).toBeVisible();
  await page.goto("/ar/arabic-lettering");
  await expect(page.getByText("ثبّت النقاط على حروفها", { exact: true })).toBeVisible();
  expect(errors).toEqual([]);
});
