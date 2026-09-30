import { test, expect } from "@playwright/test";
import { eyelets, planTiles, zip } from "../src/toolkit/tiling";

const base = { width: 600, height: 300, media: 160, overlap: 2, margin: 3, direction: "columns" as const };

test("strips fit the roll, overlap by the set amount and cover the whole print", () => {
  const plan = planTiles(6000, 3000, base);
  expect(plan.panels).toHaveLength(4);
  for (const p of plan.panels) expect(p.sheetWidth).toBeLessThanOrEqual(160 + 1e-9);
  for (let i = 1; i < plan.panels.length; i++) {
    const a = plan.panels[i - 1], b = plan.panels[i];
    expect(a.x + a.width - b.x).toBeCloseTo(2, 9);
  }
  const last = plan.panels[plan.panels.length - 1];
  expect(last.x + last.width).toBeCloseTo(600, 9);
  expect(plan.dpi).toBeCloseTo(6000 / (600 / 2.54), 6);
});

test("pixel crops tile the image without gaps", () => {
  const plan = planTiles(6001, 3000, base);
  const first = plan.panels[0], last = plan.panels[plan.panels.length - 1];
  expect(first.px.x).toBe(0);
  expect(last.px.x + last.px.width).toBe(6001);
  for (let i = 1; i < plan.panels.length; i++) expect(plan.panels[i].px.x).toBeLessThan(plan.panels[i - 1].px.x + plan.panels[i - 1].px.width);
});

test("a print narrower than the roll is one panel", () => {
  const plan = planTiles(1000, 500, { ...base, width: 100, height: 50 });
  expect(plan.panels).toHaveLength(1);
  expect(plan.panels[0].sheetWidth).toBe(106);
});

test("horizontal strips run across the print and use the roll's length", () => {
  const plan = planTiles(6000, 3000, { ...base, direction: "rows" });
  expect(plan.panels).toHaveLength(2);
  for (const p of plan.panels) expect(p.width).toBe(600);
  expect(plan.rollLength).toBeCloseTo((2 * 606) / 100, 9);
});

test("impossible settings are refused plainly", () => {
  expect(() => planTiles(100, 100, { ...base, media: 5 })).toThrow(/roll/);
  expect(() => planTiles(100, 100, { ...base, width: 0 })).toThrow(/width/);
});

test("eyelets are spread evenly along a side", () => {
  const marks = eyelets(106, 50);
  expect(marks[0]).toBe(3);
  expect(marks[marks.length - 1]).toBe(103);
  expect(eyelets(106, 0)).toEqual([]);
});

test("the ZIP lists its files and their sizes", async () => {
  const archive = new Uint8Array(await (await zip([
    { name: "a.txt", blob: new Blob(["hello"]) },
    { name: "لوح-2.jpg", blob: new Blob([new Uint8Array([1, 2, 3])]) },
  ])).arrayBuffer());
  const view = new DataView(archive.buffer);
  const end = archive.length - 22;
  expect(view.getUint32(end, true)).toBe(0x06054b50);
  expect(view.getUint16(end + 10, true)).toBe(2);
  const central = view.getUint32(end + 16, true);
  expect(view.getUint32(central, true)).toBe(0x02014b50);
  expect(view.getUint32(central + 24, true)).toBe(5);
  expect(view.getUint32(0, true)).toBe(0x04034b50);
  expect(new TextDecoder().decode(archive.slice(30, 35))).toBe("a.txt");
  expect(new TextDecoder().decode(archive.slice(35, 40))).toBe("hello");
});
