import { test, expect } from "@playwright/test";
import {
  crc32, exifResolution, JpegStream, planPrint, PngStream, recommendedDpi, RowResampler, RowUpsampler, setJpegDpi,
  tileInput, tilePlan,
} from "../src/toolkit/upscale-core";

test("the planner asks for fewer pixels the further away a print is seen", () => {
  expect(recommendedDpi(0.3)).toBe(300);
  expect(recommendedDpi(5)).toBeGreaterThanOrEqual(25);
  expect(recommendedDpi(5)).toBeLessThanOrEqual(40);
  expect(recommendedDpi(12)).toBeLessThan(recommendedDpi(5));
  expect(() => recommendedDpi(0)).toThrow();
});

test("a 6 m shop front from 5 m needs a few thousand pixels, not tens of thousands", () => {
  const plan = planPrint(1400, 1068, 600, 5);
  expect(plan.neededWidth).toBeGreaterThan(5000);
  expect(plan.neededWidth).toBeLessThan(10000);
  expect(plan.neededHeight / plan.neededWidth).toBeCloseTo(1068 / 1400, 3);
  expect(plan.scale).toBeCloseTo(plan.neededWidth / 1400, 6);
  expect(planPrint(20000, 10000, 600, 5).scale).toBe(1);
});

test("tiles cover the image exactly once", () => {
  const rows = tilePlan(500, 300, 192);
  const covered = new Uint8Array(500 * 300);
  for (const row of rows) for (const t of row) for (let y = t.y; y < t.y + t.height; y++) for (let x = t.x; x < t.x + t.width; x++) covered[y * 500 + x]++;
  expect(covered.every(v => v === 1)).toBe(true);
});

test("a tile's input repeats the edge and composites transparency on white", () => {
  const rgba = new Uint8ClampedArray([10, 20, 30, 255, 0, 0, 0, 0]);
  const input = tileInput(rgba, 2, 1, { x: 0, y: 0, width: 2, height: 1 }, 2, 1);
  const side = 4, plane = side * side;
  // Row 1 (the image row), column 0 is padding: it repeats pixel (0, 0).
  expect(input[1 * side + 0]).toBeCloseTo(10 / 255, 6);
  expect(input[plane + 1 * side + 1]).toBeCloseTo(20 / 255, 6);
  // The transparent pixel reads as white.
  expect(input[1 * side + 2]).toBe(1);
});

test("the area resampler preserves a flat colour and the mean", () => {
  const rows: Uint8Array[] = [];
  const shrink = new RowResampler(40, 30, 17, 13, 3, row => rows.push(row));
  for (let y = 0; y < 30; y++) shrink.push(new Uint8Array(40 * 3).map((_, i) => (i % 3 === 0 ? 200 : y * 8)));
  shrink.finish();
  expect(rows).toHaveLength(13);
  for (const row of rows) for (let x = 0; x < 17; x++) expect(row[x * 3]).toBe(200);
  const mean = rows.reduce((sum, row) => sum + row[1], 0) / rows.length;
  expect(mean).toBeCloseTo(29 * 4, 0);
});

test("the upsampler emits every row once and keeps flat colour flat", () => {
  const rows: number[] = [];
  const grow = new RowUpsampler(10, 8, 23, 19, 1, (row, i) => { rows.push(i); expect([...row].every(v => v === 77)).toBe(true); });
  for (let y = 0; y < 8; y++) grow.push(new Uint8Array(10).fill(77));
  grow.finish();
  expect(rows).toEqual(Array.from({ length: 19 }, (_, i) => i));
});

test("the JPEG stream writes a complete file with its resolution", async () => {
  const width = 21, height = 13, stream = new JpegStream(width, height, 90, 31.5);
  for (let y = 0; y < height; y++) stream.addRows(new Uint8Array(width * 3).map((_, i) => (i * 7 + y * 13) % 256));
  const bytes = new Uint8Array(await stream.finish().arrayBuffer());
  expect([bytes[0], bytes[1]]).toEqual([0xff, 0xd8]);
  expect([bytes[bytes.length - 2], bytes[bytes.length - 1]]).toEqual([0xff, 0xd9]);
  expect(bytes[13]).toBe(1);
  expect(bytes[14] * 256 + bytes[15]).toBe(32);
  expect(new TextDecoder().decode(bytes.slice(24, 28))).toBe("Exif");
  expect(() => stream.addRows(new Uint8Array(width * 3))).toThrow();
});

test("the EXIF block states the exact resolution", () => {
  const block = exifResolution(31.37);
  const view = new DataView(new Uint8Array(block).buffer);
  const tiff = 10;
  expect(view.getUint16(tiff + 8 + 2, true)).toBe(0x011a);
  const offset = view.getUint32(tiff + 8 + 2 + 8, true);
  expect(view.getUint32(tiff + offset, true) / view.getUint32(tiff + offset + 4, true)).toBeCloseTo(31.37, 4);
});

test("a browser JPEG gets its resolution in JFIF and, exactly, in EXIF", () => {
  const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 16, 0x4a, 0x46, 0x49, 0x46, 0, 1, 1, 0, 0, 1, 0, 1, 0, 0, 0xff, 0xd9]);
  const out = setJpegDpi(jpeg, 31.4);
  expect([out[13], out[14] * 256 + out[15], out[16] * 256 + out[17]]).toEqual([1, 31, 31]);
  expect([out[20], out[21]]).toEqual([0xff, 0xe1]);
  expect(new TextDecoder().decode(out.slice(24, 28))).toBe("Exif");
  expect([out[out.length - 2], out[out.length - 1]]).toEqual([0xff, 0xd9]);
  const bare = setJpegDpi(new Uint8Array([0xff, 0xd8, 0xff, 0xd9]), 72);
  expect([bare[2], bare[3], bare[13]]).toEqual([0xff, 0xe0, 1]);
  // A second pass leaves the EXIF block as it is.
  expect(setJpegDpi(out, 31.4).length).toBe(out.length);
});

test("the PNG stream writes valid chunks with pHYs", async () => {
  const png = new PngStream(3, 2, 4, 254);
  await png.addRows(new Uint8Array(3 * 2 * 4).fill(128));
  const bytes = new Uint8Array(await (await png.finish()).arrayBuffer());
  expect([...bytes.slice(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
  // Walk the chunks and check every CRC.
  let at = 8;
  const types: string[] = [];
  while (at < bytes.length) {
    const view = new DataView(bytes.buffer, at);
    const length = view.getUint32(0);
    const type = new TextDecoder().decode(bytes.slice(at + 4, at + 8));
    const crc = view.getUint32(8 + length);
    expect((crc32(bytes.subarray(at + 4, at + 8 + length)) ^ 0xffffffff) >>> 0).toBe(crc);
    if (type === "pHYs") expect(new DataView(bytes.buffer, at + 8).getUint32(0)).toBe(10000);
    types.push(type);
    at += length + 12;
  }
  expect(types[0]).toBe("IHDR");
  expect(types).toContain("pHYs");
  expect(types).toContain("IDAT");
  expect(types[types.length - 1]).toBe("IEND");
});
