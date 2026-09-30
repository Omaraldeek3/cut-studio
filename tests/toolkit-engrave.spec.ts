import { test, expect } from "@playwright/test";
import { adjust, defaultEngrave, materials, toBmp, toDots, toGray, type Dither } from "../src/toolkit/engrave";

const ramp = (width: number, height: number) => Float32Array.from({ length: width * height }, (_, i) => ((i % width) / (width - 1)) * 255);

test("every dithering method keeps the tone of the picture", () => {
  const width = 64, height = 64, gray = new Float32Array(width * height).fill(96);
  for (const dither of ["floyd", "jarvis", "stucki", "atkinson", "sierra", "bayer", "halftone"] as Dither[]) {
    const dots = toDots(gray, width, height, { ...defaultEngrave, dither });
    const white = dots.reduce((n, v) => n + (v === 255 ? 1 : 0), 0) / dots.length;
    expect(white, dither).toBeGreaterThan(96 / 255 - 0.08);
    expect(white, dither).toBeLessThan(96 / 255 + 0.08);
    expect(dots.every(v => v === 0 || v === 255), dither).toBe(true);
  }
});

test("greyscale output keeps every level, threshold keeps two", () => {
  const gray = ramp(32, 4);
  expect(new Set(toDots(gray, 32, 4, { ...defaultEngrave, dither: "grayscale" })).size).toBeGreaterThan(20);
  expect(new Set(toDots(gray, 32, 4, { ...defaultEngrave, dither: "threshold" }))).toEqual(new Set([0, 255]));
});

test("mirroring flips each row", () => {
  const gray = ramp(16, 2);
  const plain = toDots(gray, 16, 2, { ...defaultEngrave, dither: "threshold" });
  const mirrored = toDots(gray, 16, 2, { ...defaultEngrave, dither: "threshold", mirror: true });
  expect([...mirrored.subarray(0, 16)]).toEqual([...plain.subarray(0, 16)].reverse());
});

test("inverting and gamma move the tones the right way", () => {
  const gray = new Float32Array([64, 192]);
  const inverted = adjust(gray, 2, 1, { ...defaultEngrave, sharpen: 0, invert: true });
  expect(inverted[0]).toBeGreaterThan(inverted[1]);
  const opened = adjust(gray, 2, 1, { ...defaultEngrave, sharpen: 0, gamma: 2 });
  expect(opened[0]).toBeGreaterThan(64);
});

test("transparent pixels read as white", () => {
  expect([...toGray(new Uint8ClampedArray([0, 0, 0, 0, 0, 0, 0, 255]), 2, 1)]).toEqual([255, 0]);
});

test("a black-and-white BMP is 1-bit with its resolution", () => {
  const dots = new Uint8Array([0, 255, 255, 0, 255, 0, 0, 0, 255, 255]);
  const bmp = toBmp(dots, 5, 2, 254);
  const view = new DataView(bmp.buffer);
  expect(String.fromCharCode(bmp[0], bmp[1])).toBe("BM");
  expect(view.getUint16(28, true)).toBe(1);
  expect(view.getInt32(38, true)).toBe(10000);
  expect(view.getUint32(2, true)).toBe(bmp.length);
  // Bottom-up rows: the first row stored is the image's last row.
  const offset = view.getUint32(10, true);
  expect(bmp[offset] >> 3).toBe(0b00011);
  expect(toBmp(new Uint8Array([10, 200]), 2, 1, 300)[28]).toBe(8);
});

test("material presets are complete", () => {
  for (const m of materials) {
    expect(m.dpi).toBeGreaterThan(100);
    expect(m.options.dither).toBeDefined();
  }
});
