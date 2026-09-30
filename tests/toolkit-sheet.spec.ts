import { test, expect } from "@playwright/test";
import { impose } from "../src/toolkit/sheet";

const a4 = { sheetWidth: 210, sheetHeight: 297, margin: 8, gap: 4, bleed: 0, rotate: false };

test("items fill the printable area in a centred grid", () => {
  const plan = impose({ ...a4, itemWidth: 50, itemHeight: 50 });
  expect(plan.columns).toBe(3);
  expect(plan.rows).toBe(5);
  const xs = plan.placements.map(p => p.x), right = Math.max(...plan.placements.map(p => p.x + p.width));
  expect(Math.min(...xs)).toBeCloseTo(210 - right, 9);
  for (const p of plan.placements) {
    expect(p.x).toBeGreaterThanOrEqual(8);
    expect(p.y + p.height).toBeLessThanOrEqual(297 - 8);
  }
});

test("turning the items is kept only when more of them fit", () => {
  const straight = impose({ ...a4, itemWidth: 90, itemHeight: 50 });
  const free = impose({ ...a4, itemWidth: 90, itemHeight: 50, rotate: true });
  expect(free.placements.length).toBeGreaterThanOrEqual(straight.placements.length);
  if (free.rotated) expect(free.placements[0].width).toBe(50);
});

test("bleed takes room between items", () => {
  const without = impose({ ...a4, itemWidth: 60, itemHeight: 60 });
  const withBleed = impose({ ...a4, itemWidth: 60, itemHeight: 60, bleed: 10 });
  expect(withBleed.placements.length).toBeLessThan(without.placements.length);
});

test("an item larger than the sheet gives an empty sheet, bad sizes an error", () => {
  expect(impose({ ...a4, itemWidth: 400, itemHeight: 400 }).placements).toHaveLength(0);
  expect(() => impose({ ...a4, itemWidth: 0, itemHeight: 10 })).toThrow();
});

test("two 11 oz mug wraps fit on an A4 turned sideways", () => {
  const plan = impose({ ...a4, margin: 5, gap: 5, itemWidth: 200, itemHeight: 95, rotate: true });
  expect(plan.placements).toHaveLength(2);
});
