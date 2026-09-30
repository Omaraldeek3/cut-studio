import { test, expect } from "@playwright/test";
import { bidiRuns, commandLoops, groupLoops } from "../src/toolkit/lettering";

test("an Arabic line with a Latin brand and a number keeps each run's own direction", () => {
  const { rtl, runs } = bidiRuns("مطعم ABC 2026");
  expect(rtl).toBe(true);
  expect(runs).toEqual([{ text: "مطعم ", rtl: true }, { text: "ABC 2026", rtl: false }]);
});

test("a Latin line reads left to right, with Arabic inside it as its own run", () => {
  const { rtl, runs } = bidiRuns("Cafe بيت");
  expect(rtl).toBe(false);
  expect(runs.map(r => r.rtl)).toEqual([false, true]);
});

test("brackets in an Arabic line stay right-to-left, around a number that reads left to right", () => {
  // Both brackets resolve with the line, so HarfBuzz mirrors them and the
  // sign reads (2026) افتتاح, the way Arabic typesetting shows it.
  expect(bidiRuns("افتتاح (2026)").runs).toEqual([{ text: "افتتاح (", rtl: true }, { text: "2026", rtl: false }, { text: ")", rtl: true }]);
  // In a Latin line the pair travels with the Latin text around it.
  expect(bidiRuns("Open (2026) مطعم").runs[0]).toEqual({ text: "Open (2026) ", rtl: false });
});

test("glyph commands flatten into closed loops, curves included", () => {
  const square = [{ type: "M", values: [0, 0] }, { type: "L", values: [10, 0] }, { type: "Q", values: [20, 5, 10, 10] }, { type: "L", values: [0, 10] }, { type: "Z", values: [] }];
  const loops = commandLoops([square], 0.1);
  expect(loops).toHaveLength(1);
  expect(loops[0].length).toBeGreaterThan(5);
  expect(Math.max(...loops[0].map(p => p.x))).toBeGreaterThan(14);
});

test("a letter's counter is grouped with the letter, not as a part of its own", () => {
  const ring = (r: number) => Array.from({ length: 24 }, (_, i) => ({ x: 50 + r * Math.cos((i / 24) * Math.PI * 2), y: 50 + r * Math.sin((i / 24) * Math.PI * 2) }));
  const dot = Array.from({ length: 12 }, (_, i) => ({ x: 150 + 3 * Math.cos((i / 12) * Math.PI * 2), y: 50 + 3 * Math.sin((i / 12) * Math.PI * 2) }));
  const groups = groupLoops([ring(20), ring(10), dot]);
  expect(groups).toHaveLength(2);
  expect(groups.find(g => g.length === 2)).toBeDefined();
});
