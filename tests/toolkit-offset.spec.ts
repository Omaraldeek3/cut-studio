import { test, expect } from "@playwright/test";
import { distanceField, fillHoles, offsetLoops } from "../src/toolkit/offset";
import { polygonArea } from "../src/toolkit/vectorize";

function square(w: number, h: number, x0: number, y0: number, size: number) {
  const mask = new Uint8Array(w * h);
  for (let y = y0; y < y0 + size; y++) for (let x = x0; x < x0 + size; x++) mask[y * w + x] = 1;
  return mask;
}

test("the distance field is exact Euclidean distance to the nearest target", () => {
  const w = 20, h = 20;
  const d = distanceField(w, h, i => i === 5 * w + 5);
  expect(d[5 * w + 5]).toBe(0);
  expect(d[5 * w + 8]).toBe(3);
  expect(d[9 * w + 8]).toBeCloseTo(5, 6);
});

test("an outward offset grows a square by the distance on every side, with round corners", () => {
  const w = 120, h = 120, mask = square(w, h, 40, 40, 40);
  const loops = offsetLoops(mask, w, h, 10);
  expect(loops).toHaveLength(1);
  const area = Math.abs(polygonArea(loops[0]));
  // 40x40 square offset by 10: 60x60 minus the four corners' squares plus quarter circles.
  const expected = 60 * 60 - 4 * 100 + Math.PI * 100;
  expect(Math.abs(area - expected) / expected).toBeLessThan(0.02);
});

test("an inward offset shrinks a square", () => {
  const w = 80, h = 80, mask = square(w, h, 20, 20, 40);
  const area = Math.abs(polygonArea(offsetLoops(mask, w, h, -5)[0]));
  expect(Math.abs(area - 30 * 30) / 900).toBeLessThan(0.03);
});

test("an offset larger than the gap welds two shapes into one outline", () => {
  const w = 120, h = 60, mask = new Uint8Array(w * h);
  for (let y = 20; y < 40; y++) for (let x = 20; x < 50; x++) mask[y * w + x] = 1;
  for (let y = 20; y < 40; y++) for (let x = 56; x < 90; x++) mask[y * w + x] = 1;
  expect(offsetLoops(mask, w, h, 1)).toHaveLength(2);
  expect(offsetLoops(mask, w, h, 4)).toHaveLength(1);
});

test("filling holes leaves only the outer outline", () => {
  const w = 60, h = 60, mask = square(w, h, 10, 10, 40);
  for (let y = 25; y < 35; y++) for (let x = 25; x < 35; x++) mask[y * w + x] = 0;
  expect(offsetLoops(mask, w, h, 0)).toHaveLength(2);
  expect(offsetLoops(fillHoles(mask, w, h), w, h, 0)).toHaveLength(1);
});
