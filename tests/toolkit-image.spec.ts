import { expect, test } from "@playwright/test";
import { processImage, traceImage, type ImageOptions, type Raster } from "../src/toolkit/image";

const options: ImageOptions = { threshold: 128, invert: false, brightness: 0, contrast: 0, noise: 0, simplify: 0 };
function raster(rows: number[][]): Raster {
  return { width: rows[0].length, height: rows.length, data: new Uint8ClampedArray(rows.flatMap(row => row.flatMap(value => [value, value, value, 255]))) };
}
function area(points: { x: number; y: number }[]) {
  return points.reduce((sum, point, i) => {
    const next = points[(i + 1) % points.length];
    return sum + point.x * next.y - next.x * point.y;
  }, 0) / 2;
}
function red(result: Raster) { return Array.from(result.data).filter((_, i) => i % 4 === 0); }

test("traces actual pixel bounds and removes collinear edge points", () => {
  const result = traceImage(raster([[0, 0, 255], [0, 0, 255]]), options);
  expect(result).toEqual({ width: 3, height: 2, contours: [{ closed: true, points: [{ x: 0, y: 0 }, { x: 2, y: 0 }, { x: 2, y: 2 }, { x: 0, y: 2 }] }] });
});

test("preserves a hole as an oppositely wound closed contour", () => {
  const result = traceImage(raster([[0, 0, 0], [0, 255, 0], [0, 0, 0]]), options);
  expect(result.contours).toHaveLength(2);
  expect(result.contours.map(contour => area(contour.points)).sort((a, b) => a - b)).toEqual([-1, 9]);
  expect(result.contours.every(contour => contour.closed)).toBe(true);
});

test("keeps diagonally touching black pixels as separate shapes", () => {
  const result = traceImage(raster([[0, 255], [255, 0]]), options);
  expect(result.contours).toHaveLength(2);
  expect(result.contours.map(contour => area(contour.points))).toEqual([1, 1]);
});

test("composites transparency against white before tracing or engraving", () => {
  const input = { width: 2, height: 1, data: new Uint8ClampedArray([0, 0, 0, 0, 0, 0, 0, 100]) };
  expect(traceImage(input, options).contours).toEqual([]);
  expect(red(processImage(input, options, false))).toEqual([255, 255]);
});

test("filters tiny disconnected components by pixel area", () => {
  const input = raster([[0, 255, 0, 0], [255, 255, 0, 0]]);
  const result = traceImage(input, { ...options, noise: 1 });
  expect(result.contours).toHaveLength(1);
  expect(area(result.contours[0].points)).toBe(4);
  expect(red(processImage(input, { ...options, noise: 1 }, false))).toEqual([255, 255, 0, 0, 255, 255, 0, 0]);
});

test("applies threshold, brightness, contrast and inversion without changing the source", () => {
  const input = raster([[80, 127, 128, 180]]);
  const source = [...input.data];
  expect(red(processImage(input, options, false))).toEqual([0, 0, 255, 255]);
  expect(red(processImage(input, { ...options, invert: true }, false))).toEqual([255, 255, 0, 0]);
  expect(red(processImage(input, { ...options, brightness: 100 }, false))).toEqual([255, 255, 255, 255]);
  expect(red(processImage(input, { ...options, contrast: -100, threshold: 129 }, false))).toEqual([0, 0, 0, 0]);
  expect([...input.data]).toEqual(source);
});

test("diffuses grayscale quantization error to produce engraving dots", () => {
  const input = raster([[128, 128, 128, 128], [128, 128, 128, 128]]);
  const result = processImage(input, options, true);
  expect(red(result)).toEqual([255, 0, 255, 0, 0, 255, 0, 255]);
  expect(Array.from(result.data).filter((_, i) => i % 4 === 3)).toEqual(Array(8).fill(255));
});

test("simplifies a stepped boundary but retains small holes", () => {
  const input = raster([[0, 255, 255], [0, 0, 255], [0, 0, 0]]);
  const original = traceImage(input, options);
  const simplified = traceImage(input, { ...options, simplify: 0.8 });
  expect(simplified.contours[0].points.length).toBeLessThan(original.contours[0].points.length);
  expect(simplified.contours[0].points.length).toBeGreaterThanOrEqual(3);
  const ring = traceImage(raster([[0, 0, 0], [0, 255, 0], [0, 0, 0]]), { ...options, simplify: 100 });
  expect(ring.contours).toHaveLength(2);
  expect(ring.contours.every(contour => contour.points.length >= 3)).toBe(true);
});

test("rejects invalid rasters and non-finite or out-of-range adjustments", () => {
  expect(() => traceImage({ width: 0, height: 1, data: new Uint8ClampedArray() }, options)).toThrow(/dimensions/i);
  expect(() => traceImage({ width: 1001, height: 1000, data: new Uint8ClampedArray() }, options)).toThrow(/1,000,000/);
  expect(() => processImage({ width: 1, height: 1, data: new Uint8ClampedArray(3) }, options, false)).toThrow(/RGBA/i);
  expect(() => traceImage(raster([[0]]), { ...options, threshold: NaN })).toThrow(/threshold/i);
  expect(() => traceImage(raster([[0]]), { ...options, brightness: 101 })).toThrow(/brightness/i);
  expect(() => traceImage(raster([[0]]), { ...options, noise: -1 })).toThrow(/noise/i);
});

test("stops highly fragmented images with an actionable complexity error", () => {
  const input = raster(Array.from({ length: 300 }, (_, y) => Array.from({ length: 300 }, (_, x) => (x + y) % 2 ? 255 : 0)));
  expect(() => traceImage(input, options)).toThrow(/complex|contours|simpler|resize/i);
});

test("all 3 by 3 pixel patterns close with exactly the foreground area", () => {
  for (let pattern = 0; pattern < 512; pattern++) {
    const rows = Array.from({ length: 3 }, (_, y) => Array.from({ length: 3 }, (_, x) => pattern & (1 << (y * 3 + x)) ? 0 : 255));
    const expectedArea = rows.flat().filter(pixel => pixel === 0).length;
    const result = traceImage(raster(rows), options);
    expect(result.contours.reduce((total, contour) => total + area(contour.points), 0), `pattern ${pattern}`).toBe(expectedArea);
    for (const contour of result.contours) {
      expect(contour.closed).toBe(true);
      expect(contour.points.length).toBeGreaterThanOrEqual(4);
      expect(contour.points.every(point => point.x >= 0 && point.y >= 0 && point.x <= 3 && point.y <= 3)).toBe(true);
    }
  }
});
