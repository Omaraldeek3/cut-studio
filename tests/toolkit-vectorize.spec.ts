import { test, expect } from "@playwright/test";
import {
  defaultVectorize, despeckle, fitLoop, flatten, isolines, otsu, pathData, polygonArea, traceMask, vectorize,
  type VectorizeOptions,
} from "../src/toolkit/vectorize";
import { colorPdf, colorSvg, cutDrawing, outlineSvg, resultToDrawing } from "../src/toolkit/vector-export";
import { audit } from "./helpers/geometry-audit";
import type { Raster } from "../src/toolkit/image";
import type { Contour } from "../src/toolkit/types";
import { logoRaster } from "./fixtures/logo";
import { flattenCurve } from "../src/toolkit/path";

/** An RGBA raster painted by a function of (x, y). */
function paint(width: number, height: number, colour: (x: number, y: number) => [number, number, number, number?]): Raster {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const [r, g, b, a = 255] = colour(x, y);
    data.set([r, g, b, a], (y * width + x) * 4);
  }
  return { width, height, data };
}

const options = (extra: Partial<VectorizeOptions> = {}): VectorizeOptions => ({ ...defaultVectorize, denoise: false, ...extra });

test("an iso-line around a filled square encloses the square's area", () => {
  const w = 20, h = 20, field = new Float32Array(w * h);
  for (let y = 5; y < 15; y++) for (let x = 5; x < 15; x++) field[y * w + x] = 1;
  const loops = isolines(field, w, h, 0.5);
  expect(loops).toHaveLength(1);
  // Cut at half height between pixel centres, the square keeps its full area
  // but loses its corners by half a pixel's triangle each.
  expect(Math.abs(polygonArea(loops[0]))).toBeGreaterThan(98);
  expect(Math.abs(polygonArea(loops[0]))).toBeLessThanOrEqual(100);
});

test("a hole comes out as its own loop", () => {
  const w = 30, h = 30, mask = new Uint8Array(w * h);
  for (let y = 3; y < 27; y++) for (let x = 3; x < 27; x++) mask[y * w + x] = x < 10 || x >= 20 || y < 10 || y >= 20 ? 1 : 0;
  expect(traceMask(mask, w, h, 2, 0.5)).toHaveLength(2);
});

test("a one-pixel line survives the softening", () => {
  const w = 40, h = 20, mask = new Uint8Array(w * h);
  for (let x = 4; x < 36; x++) mask[10 * w + x] = 1;
  const loops = traceMask(mask, w, h, 2, 0.57);
  expect(loops).toHaveLength(1);
  const xs = loops[0].map(p => p.x);
  expect(Math.max(...xs) - Math.min(...xs)).toBeGreaterThan(28);
});

test("a shape touching the image edge keeps a straight edge there", () => {
  const w = 20, h = 20, mask = new Uint8Array(w * h).fill(1);
  const loops = traceMask(mask, w, h, 1, 0.8);
  expect(loops).toHaveLength(1);
  expect(Math.abs(polygonArea(loops[0]))).toBeGreaterThan(399);
});

test("a fitted circle stays within the error and needs few curves", () => {
  const points = Array.from({ length: 120 }, (_, i) => ({ x: 50 + 30 * Math.cos((i / 120) * Math.PI * 2), y: 50 + 30 * Math.sin((i / 120) * Math.PI * 2) }));
  const path = fitLoop(points, 0.5, 70);
  expect(path.curves.length).toBeLessThanOrEqual(8);
  for (const p of flatten(path, 0.05)) expect(Math.abs(Math.hypot(p.x - 50, p.y - 50) - 30)).toBeLessThan(0.6);
});

test("a square keeps four sharp corners", () => {
  const points: { x: number; y: number }[] = [];
  for (let i = 0; i < 40; i++) points.push({ x: 10 + i, y: 10 });
  for (let i = 0; i < 40; i++) points.push({ x: 50, y: 10 + i });
  for (let i = 0; i < 40; i++) points.push({ x: 50 - i, y: 50 });
  for (let i = 0; i < 40; i++) points.push({ x: 10, y: 50 - i });
  const flat = flatten(fitLoop(points, 0.4, 70), 0.02);
  for (const corner of [[10, 10], [50, 10], [50, 50], [10, 50]])
    expect(Math.min(...flat.map(p => Math.hypot(p.x - corner[0], p.y - corner[1])))).toBeLessThan(0.5);
});

test("specks below the minimum area join their surroundings", () => {
  const w = 10, h = 10, labels = new Uint8Array(w * h);
  labels[44] = labels[45] = 1;
  labels[0] = 2;
  despeckle(labels, w, h, 3);
  expect([...labels].every(l => l === 0)).toBe(true);
});

test("Otsu splits two clusters between them", () => {
  const histogram = new Array(256).fill(0);
  histogram[40] = 500;
  histogram[210] = 500;
  const t = otsu(histogram);
  expect(t).toBeGreaterThan(40);
  expect(t).toBeLessThanOrEqual(210);
});

test("colour mode finds each flat colour and stacks them without gaps", () => {
  const image = paint(80, 60, (x, y) => (Math.hypot(x - 40, y - 30) < 18 ? [220, 40, 40] : x < 20 ? [30, 60, 200] : [250, 250, 250]));
  const result = vectorize(image, options({ colors: 4 }));
  const colours = result.layers.map(l => l.color);
  expect(colours).toHaveLength(3);
  expect(colours[0]).toBe("#fafafa");
  // Stacked: every point of the picture lies inside some colour's shape, and
  // each colour reaches under the ones drawn above it.
  const inside = (layer: typeof result.layers[number], x: number, y: number) => {
    let hits = 0;
    for (const path of layer.paths) {
      const ring = flatten(path, 0.05);
      for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        const a = ring[i], b = ring[j];
        if ((a.y > y) !== (b.y > y) && x < ((b.x - a.x) * (y - a.y)) / (b.y - a.y) + a.x) hits++;
      }
    }
    return hits % 2 === 1;
  };
  // Also when the heaviest smoothing moves the edges about.
  const smoothest = vectorize(image, options({ colors: 4, smoothing: 100 }));
  for (const traced of [result, smoothest]) for (let y = 0.25; y < 60; y += 0.5) for (let x = 0.25; x < 80; x += 0.5) {
    expect(traced.layers.some(layer => inside(layer, x, y)), `${x},${y}`).toBe(true);
  }
  expect(inside(result.layers[0], 40, 12.6)).toBe(true);
  expect(inside(result.layers[0], 40, 30)).toBe(false);
});

test("cut-out mode gives every colour only its own area", () => {
  const image = paint(80, 60, (x) => (x < 40 ? [20, 20, 20] : [240, 240, 240]));
  const result = vectorize(image, options({ colors: 2, layering: "cutout" }));
  for (const layer of result.layers) {
    const area = layer.paths.reduce((sum, p) => sum + Math.abs(polygonArea(flatten(p, 0.05))), 0);
    expect(area).toBeGreaterThan(40 * 60 - 40);
    expect(area).toBeLessThan(40 * 60 + 40);
  }
});

test("a pale one-pixel line on white keeps its own colour in a small picture", () => {
  const image = paint(90, 60, (x, y) => (x === 45 && y > 5 && y < 55 ? [205, 200, 198] : x > 70 && y > 40 ? [30, 30, 30] : [255, 255, 255]));
  const result = vectorize(image, options({ colors: 3, detail: 100 }));
  const line = result.layers.find(l => l.color === "#cdc8c6");
  expect(line).toBeDefined();
  expect(line!.paths.length).toBe(1);
});

test("short flecks barely differing from their band are absorbed", () => {
  // Two bands of a stepped gradient, with a broken seam of an in-between grey.
  const image = paint(120, 80, (x, y) => (x === 60 && y % 12 < 3 ? [92, 92, 92] : x < 60 ? [80, 80, 80] : [104, 104, 104]));
  const result = vectorize(image, options({ colors: 3, detail: 100 }));
  expect(result.layers.map(l => l.color).sort()).toEqual(["#505050", "#686868"]);
});

test("a hidden colour is left out and can be listed again", () => {
  const image = paint(60, 40, (x) => (x < 30 ? [200, 30, 30] : [255, 255, 255]));
  const all = vectorize(image, options({ colors: 2 }));
  const white = all.palette.find(p => p.color === "#ffffff")!;
  const without = vectorize(image, options({ colors: 2, hidden: [white.color] }));
  expect(without.layers.map(l => l.color)).toEqual(["#c81e1e"]);
  expect(without.palette.find(p => p.color === "#ffffff")?.hidden).toBe(true);
});

test("transparent pixels stay empty", () => {
  const image = paint(40, 40, (x, y) => (Math.hypot(x - 20, y - 20) < 12 ? [0, 0, 0, 255] : [0, 0, 0, 0]));
  const result = vectorize(image, options({ colors: 3 }));
  expect(result.layers).toHaveLength(1);
  expect(result.layers[0].color).toBe("#000000");
});

test("outline mode traces the dark shape with an automatic threshold, or the light one inverted", () => {
  const image = paint(60, 60, (x, y) => (Math.hypot(x - 30, y - 30) < 15 ? [15, 15, 15] : [245, 245, 245]));
  const dark = vectorize(image, options({ mode: "outline" }));
  expect(dark.threshold).toBeGreaterThan(15);
  expect(dark.threshold).toBeLessThan(245);
  const area = Math.abs(polygonArea(flatten(dark.layers[0].paths[0], 0.05)));
  expect(area).toBeGreaterThan(Math.PI * 15 * 15 * 0.9);
  expect(area).toBeLessThan(Math.PI * 15 * 15 * 1.1);
  const light = vectorize(image, options({ mode: "outline", invert: true }));
  expect(light.layers[0].paths).toHaveLength(2);
});

test("exports carry the physical size and real curves", () => {
  const image = paint(50, 25, (x, y) => (Math.hypot(x - 25, y - 12) < 9 ? [0, 120, 200] : [255, 255, 255]));
  const result = vectorize(image, options({ colors: 2 }));
  const svg = colorSvg(result, 200);
  expect(svg).toContain('width="200mm"');
  expect(svg).toContain('height="100mm"');
  expect(svg).toMatch(/C[\d.]+ [\d.]+/);
  expect(outlineSvg(result, 200)).toContain('fill="none"');
  const drawing = resultToDrawing(result, 200);
  expect(drawing.width).toBe(200);
  expect(drawing.height).toBe(100);
  expect(pathData(result.layers[1].paths[0])).toMatch(/^M.*Z$/);
});

test("the PDF's cross-reference table points at its objects", () => {
  const image = paint(30, 30, (x, y) => (x + y < 30 ? [10, 10, 10] : [255, 255, 255]));
  const pdf = colorPdf(vectorize(image, options({ colors: 2 })), 100);
  const text = new TextDecoder("latin1").decode(pdf);
  expect(text.startsWith("%PDF-1.4")).toBe(true);
  const xref = Number(/startxref\n(\d+)/.exec(text)![1]);
  expect(text.slice(xref, xref + 4)).toBe("xref");
  const offsets = [...text.slice(xref).matchAll(/^(\d{10}) 00000 n $/gm)].map(m => Number(m[1]));
  offsets.forEach((offset, i) => expect(text.slice(offset, offset + 12)).toMatch(new RegExp(`^${i + 1} 0 obj\\n`)));
});

test("bad input is refused plainly", () => {
  expect(() => vectorize({ width: 0, height: 1, data: new Uint8ClampedArray() }, options())).toThrow(/dimensions/);
  expect(() => vectorize(paint(2, 2, () => [0, 0, 0]), options({ colors: 1 }))).toThrow(/Colours/);
});

test("a gradient background is filled with gradients that meet without steps", () => {
  // A left-to-right ramp with a dark disc in front of it.
  const image = paint(160, 100, (x, y) => (Math.hypot(x - 80, y - 50) < 20 ? [20, 20, 20] : [60 + x, 60 + x, 60 + x]));
  const flat = vectorize(image, options({ colors: 6 }));
  expect(flat.layers.some(l => l.shades)).toBe(false);
  const result = vectorize(image, options({ colors: 6, gradients: true }));
  const shades = result.layers.flatMap(l => (l.shades ?? []).map(s => s.shade));
  expect(shades.length).toBeGreaterThan(1);
  for (const shade of shades) expect(Math.abs(shade.x2 - shade.x1)).toBeGreaterThan(Math.abs(shade.y2 - shade.y1));
  // Each band's gradient ends near where the next one begins.
  const ends = shades.map(s => ({ x: Math.max(s.x1, s.x2), grey: parseInt((s.x2 > s.x1 ? s.to : s.from).slice(1, 3), 16) })).sort((a, b) => a.x - b.x);
  for (const end of ends.slice(0, -1)) expect(Math.abs(end.grey - (60 + end.x))).toBeLessThan(14);
  const svg = colorSvg(result, 100);
  expect(svg).toContain("<linearGradient");
  expect(svg).toContain('fill="url(#shade-');
  const pdf = new TextDecoder().decode(colorPdf(result, 100));
  expect(pdf).toContain("/ShadingType 2");
  expect(pdf).toMatch(/W\* n \/Sh0 sh Q/);
});

test("more smoothing gives fewer curves and keeps thin lines", () => {
  // A wobbly edge and a thin line.
  const image = paint(200, 120, (x, y) => (y > 60 + 3 * Math.sin(x / 2) ? [30, 30, 30] : x > 99 && x < 102 && y < 50 ? [30, 30, 30] : [250, 250, 250]));
  const rough = vectorize(image, options({ colors: 2, smoothing: 0, detail: 100 }));
  const smooth = vectorize(image, options({ colors: 2, smoothing: 100, detail: 100 }));
  expect(smooth.nodes).toBeLessThan(rough.nodes * 0.7);
  const dark = smooth.layers.find(l => l.color === "#1e1e1e")!;
  expect(dark.paths.length).toBe(2);
});

// ——— True geometry from tracing ————————————————————————————————————————

const ringOf = (contours: Contour[], R: number) =>
  contours.find(c => c.points.every(p => Math.abs(Math.hypot(p.x - 220, p.y - 250) - R) < 3));

test("outline tracing draws the ring as true circles and the square with straight sides", async () => {
  const r = vectorize(await logoRaster(), { ...defaultVectorize, mode: "outline" });
  const contours = resultToDrawing(r, 800).shapes.flatMap(s => s.contours); // 1 mm per pixel
  for (const R of [170, 110]) {
    const ring = ringOf(contours, R);
    expect(ring?.curve).toBeTruthy();
    const dense = flattenCurve(ring!.curve!, true, 0.01);
    expect(Math.max(...dense.map(p => Math.abs(Math.hypot(p.x - 220, p.y - 250) - R)))).toBeLessThan(0.4);
  }
  const square = contours.find(c => c.points.every(p => p.x > 140 && p.x < 300 && p.y > 170 && p.y < 330));
  expect(square?.curve?.segs.filter(s => s.type === "L")).toHaveLength(4);
});

test("smooth traced outlines have no kinks where no corner was found", async () => {
  const r = vectorize(await logoRaster(), { ...defaultVectorize, mode: "outline" });
  const ring = ringOf(resultToDrawing(r, 800).shapes.flatMap(s => s.contours), 170)!;
  const segs = ring.curve!.segs;
  for (let i = 0; i < segs.length; i++) {
    const a = segs[i], b = segs[(i + 1) % segs.length];
    if (a.type !== "C" || b.type !== "C") continue;
    const t1 = Math.atan2(a.to.y - a.c2.y, a.to.x - a.c2.x), t2 = Math.atan2(b.c1.y - a.to.y, b.c1.x - a.to.x);
    let diff = Math.abs(t1 - t2); if (diff > Math.PI) diff = 2 * Math.PI - diff;
    expect(diff).toBeLessThan((2 * Math.PI) / 180);
  }
});

// ——— Cut-out tracing on shared borders ———————————————————————————————————

test("cut-out tracing shares every border between colours and drops the background", async () => {
  const r = vectorize(await logoRaster(), { ...defaultVectorize, mode: "color", layering: "cutout", colors: 4 });
  expect(r.edges?.length).toBeGreaterThan(0);
  const d = cutDrawing(r, 800);
  const a = audit(d);
  expect(a.duplicateMm).toBe(0);
  expect(a.crossings).toBe(0);
  // Nothing runs round the page: every border has a point well inside it.
  for (const c of d.shapes.flatMap(s => s.contours)) expect(c.points.some(p => p.x > 2 && p.x < 798 && p.y > 2 && p.y < 498)).toBe(true);
  expect(r.layers.some(l => parseInt(l.color.slice(1, 3), 16) > 240 && parseInt(l.color.slice(3, 5), 16) > 240 && parseInt(l.color.slice(5, 7), 16) > 240)).toBe(false);
  // Each colour's own outlines still close, for nesting colour by colour.
  for (const layer of r.layers) expect(layer.paths.length).toBeGreaterThan(0);
});

test("the cut-out cut-line SVG writes each border once", async () => {
  const r = vectorize(await logoRaster(), { ...defaultVectorize, mode: "color", layering: "cutout", colors: 4 });
  const svg = outlineSvg(r, 300);
  const starts = (svg.match(/M/g) || []).length;
  expect(starts).toBe(r.edges!.length);
});

test("cut-out tracing of a photo stays under 15 seconds", async () => {
  test.setTimeout(120000);
  const sharp = (await import("sharp")).default;
  const { data, info } = await sharp("public/images/coffee.jpg").resize(700).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const t = Date.now();
  const r = vectorize({ width: info.width, height: info.height, data: new Uint8ClampedArray(data) }, { ...defaultVectorize, mode: "color", layering: "cutout", colors: 4 });
  expect(Date.now() - t).toBeLessThan(15000);
  expect(audit(cutDrawing(r, 300)).duplicateMm).toBe(0);
});
