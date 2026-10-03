import { expect, test, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import type { Drawing } from '../src/toolkit/types';
import { toSvg } from '../src/toolkit/export';

const file = 'src/toolkit/svg-import.ts';
test.beforeEach(async ({ page }) => {
  await page.goto('about:blank');
  const source = readFileSync(file, 'utf8');
  const code = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS } }).outputText;
  await page.addScriptTag({ content: `window.exports = {}; ${code}; window.parseSvg = exports.parseSvg;` });
});
async function parse(page: Page, source: string, width?: number): Promise<Drawing> {
  return page.evaluate(async ({ source, width }) => {
    const api = window as unknown as { parseSvg: (s: string, w?: number) => Promise<Drawing> };
    return api.parseSvg(source, width);
  }, { source, width });
}
const svg = (body: string, attrs = 'width="100mm" height="50mm" viewBox="0 0 100 50"') => `<svg xmlns="http://www.w3.org/2000/svg" ${attrs}>${body}</svg>`;

test('physical units, viewBox origin, and nested transforms remain millimetres', async ({ page }) => {
  const drawing = await parse(page, svg('<g transform="translate(10 5)"><g transform="scale(2)"><rect x="5" y="10" width="10" height="5"/></g></g>', 'width="10cm" height="5cm" viewBox="10 5 100 50"'));
  expect(drawing).toMatchObject({ width: 100, height: 50 });
  expect(drawing.shapes[0].contours[0]).toEqual({ closed: true, points: [{ x: 10, y: 20 }, { x: 30, y: 20 }, { x: 30, y: 30 }, { x: 10, y: 30 }] });
});
test('compound paths preserve holes and relative moves after close', async ({ page }) => {
  const drawing = await parse(page, svg('<path d="M0 0H40V40H0Z m10 10v20h20v-20z"/>'));
  expect(drawing.shapes).toHaveLength(1);
  expect(drawing.shapes[0].contours).toHaveLength(2);
  expect(drawing.shapes[0].contours[1]).toEqual({ closed: true, points: [{ x: 10, y: 10 }, { x: 10, y: 30 }, { x: 30, y: 30 }, { x: 30, y: 10 }] });
});
test('open path, line, and polyline never acquire closing edges', async ({ page }) => {
  const drawing = await parse(page, svg('<path d="M0 0L10 10 20 0"/><line x2="30" y2="20"/><polyline points="1,1 4,5 9,1"/>'));
  expect(drawing.shapes.map(s => s.contours[0].closed)).toEqual([false, false, false]);
});
test('curves, ellipse and rounded rectangle approximate at physical scale', async ({ page }) => {
  const drawing = await parse(page, svg('<path d="M0 0 C0 10 10 10 10 0 S20 -10 20 0 Q25 10 30 0 T40 0 A5 5 0 0 1 50 0"/><circle cx="70" cy="20" r="10"/><ellipse cx="50" cy="30" rx="8" ry="4"/><rect x="1" y="20" width="10" height="10" rx="2"/>'));
  expect(drawing.shapes).toHaveLength(4);
  expect(drawing.shapes[0].contours[0].points.at(-1)).toEqual({ x: 50, y: 0 });
  const circle = drawing.shapes[1].contours[0];
  expect(circle.closed).toBe(true);
  for (const p of circle.points) expect(Math.abs(Math.hypot(p.x - 70, p.y - 20) - 10)).toBeLessThan(0.01);
  for (let i = 0; i < circle.points.length; i++) {
    const a = circle.points[i], b = circle.points[(i + 1) % circle.points.length];
    expect(10 - Math.hypot((a.x + b.x) / 2 - 70, (a.y + b.y) / 2 - 20)).toBeLessThan(0.1);
  }
});
test('viewport aspect fit and width override preserve physical scale', async ({ page }) => {
  const fit = await parse(page, svg('<rect width="10" height="10"/>', 'width="2in" height="1in" viewBox="0 0 10 10"'));
  expect(fit.shapes[0].contours[0].points[0].x).toBeCloseTo(12.7);
  const override = await parse(page, svg('<rect width="10" height="10"/>', 'width="100%" viewBox="0 0 10 20"'), 50);
  expect(override).toMatchObject({ width: 50, height: 100 });
  expect(override.shapes[0].contours[0].points[2]).toEqual({ x: 50, y: 50 });
});
test('live text is ignored and counted without failing the artwork', async ({ page }) => {
  const drawing = await parse(page, svg('<rect width="10" height="10"/><text x="1" y="20">Hello <tspan>world</tspan><textPath href="#p">x</textPath></text><g transform="translate(5 5)"><text>Two</text></g>'));
  expect(drawing.shapes).toHaveLength(1); expect(drawing.skippedText).toBe(2);
  expect((await parse(page, svg('<rect width="10" height="10"/>'))).skippedText).toBeUndefined();
});
test('ambiguous sizing and unconverted text explain how to fix the export', async ({ page }) => {
  await expect(parse(page, svg('<rect width="10" height="10"/>', 'viewBox="0 0 100 50"'))).rejects.toThrow(/physical width/i);
  await expect(parse(page, svg('<text>Hello</text>'))).rejects.toThrow(/curves/i);
});
test('rejects active content, references, CSS transforms, and clipping without DOM insertion', async ({ page }) => {
  for (const body of ['<script>alert(1)</script>', '<rect width="10" height="10" onclick="alert(1)"/>', '<use href="#x"/>', '<image href="https://example.com/x"/>', '<foreignObject/>', '<g style="transform:translate(5px)"><rect width="1" height="1"/></g>', '<rect width="10" height="10" clip-path="url(#c)"/>', '<style>rect{display:none}</style>']) {
    await expect(parse(page, svg(body))).rejects.toThrow();
  }
  expect(await page.locator('svg').count()).toBe(0);
});
test('invalid path data and excessive shape counts fail clearly', async ({ page }) => {
  await expect(parse(page, svg('<path d="M0 0 C2 3"/>'))).rejects.toThrow(/path/i);
  await expect(parse(page, svg('<rect width="1" height="1"/>'.repeat(20001)))).rejects.toThrow(/20,000 shapes/);
});
test('unitless pixels without a viewBox and physical override remain proportional', async ({ page }) => {
  const native = await parse(page, svg('<rect width="96" height="48"/>', 'width="72pt" height="48px"'));
  expect(native.width).toBeCloseTo(25.4);
  expect(native.height).toBeCloseTo(12.7);
  expect(native.shapes[0].contours[0].points[2].x).toBeCloseTo(25.4);
  const overridden = await parse(page, svg('<rect width="96" height="48"/>', 'width="96" height="48"'), 100);
  expect(overridden).toMatchObject({ width: 100, height: 50 });
  expect(overridden.shapes[0].contours[0].points[2]).toEqual({ x: 100, y: 50 });
});
test('rotation about a center and matrix transforms compose in SVG order', async ({ page }) => {
  const drawing = await parse(page, svg('<g transform="matrix(1 0 0 1 10 0)"><line x1="1" y1="1" x2="3" y2="1" transform="rotate(90 1 1)"/></g>'));
  const points = drawing.shapes[0].contours[0].points;
  expect(points[0].x).toBeCloseTo(11);
  expect(points[0].y).toBeCloseTo(1);
  expect(points[1].x).toBeCloseTo(11);
  expect(points[1].y).toBeCloseTo(3);
});
test('unreferenced definitions stay non-rendering and supported paint CSS is harmless', async ({ page }) => {
  const drawing = await parse(page, svg('<defs><path d="M0 0L50 50"/></defs><path id="cut" style="fill:none;stroke:#000;stroke-width:1" d="M1 2L3 4"/>'));
  expect(drawing.shapes).toHaveLength(1);
  expect(drawing.shapes[0]).toMatchObject({ id: 'part-1', name: 'cut' });
  expect(drawing.shapes[0].contours[0].points).toEqual([{ x: 1, y: 2 }, { x: 3, y: 4 }]);
});
test('source and vertex budgets reject expensive geometry before sampling', async ({ page }) => {
  await expect(parse(page, svg(' '.repeat(32 * 1024 * 1024)))).rejects.toThrow(/32 MB/);
  await expect(parse(page, svg('<circle cx="10" cy="10" r="100000"/>'))).rejects.toThrow(/vertices/);
  await expect(parse(page, svg('<rect width="10" height="10"/>', 'width="10mm" height="10mm" viewBox="0 0 10 10" preserveAspectRatio="none"'))).rejects.toThrow(/preserveAspectRatio/);
});

test('dense straight exports preserve exact corners and reversals without redundant collinear nodes', async ({ page }) => {
  const commands = Array.from({ length: 35_000 }, (_, i) => `L${i + 1} 0`).join(' ');
  const drawing = await parse(page, svg(`<path d="M0 0 ${commands} L35000 10 L34999 10 L35000 10 Z"/>`));
  expect(drawing.shapes[0].contours[0]).toEqual({ closed: true, points: [
    { x: 0, y: 0 }, { x: 35000, y: 0 }, { x: 35000, y: 10 }, { x: 34999, y: 10 }, { x: 35000, y: 10 },
  ] });
});

test('long transformed Bezier curves stay within 0.1 mm without length-proportional samples', async ({ page }) => {
  const drawing = await parse(page, svg('<path transform="matrix(10 2 3 1 0 0)" d="M0 0 C0 1000 1000 -1000 1000 0"/>'));
  const points = drawing.shapes[0].contours[0].points;
  expect(points.length).toBeLessThan(1500);
  let maximumError = 0;
  for (let i = 0; i <= 2000; i++) {
    const t = i / 2000, u = 1 - t;
    const x = 3000 * u * t * t + 1000 * t * t * t;
    const y = 3000 * u * u * t - 3000 * u * t * t;
    const p = { x: 10 * x + 3 * y, y: 2 * x + y };
    let nearest = Infinity;
    for (let j = 1; j < points.length; j++) {
      const a = points[j - 1], b = points[j], dx = b.x - a.x, dy = b.y - a.y;
      const fraction = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy)));
      nearest = Math.min(nearest, Math.hypot(p.x - a.x - fraction * dx, p.y - a.y - fraction * dy));
    }
    maximumError = Math.max(maximumError, nearest);
  }
  expect(maximumError).toBeLessThanOrEqual(0.1);
  expect(points.at(-1)).toEqual({ x: 10000, y: 2000 });
});

test('adaptive curves preserve collinear overshoot and reject malformed dense geometry', async ({ page }) => {
  const drawing = await parse(page, svg('<path d="M0 0 C1000 0 -1000 0 10 0"/>'));
  const xs = drawing.shapes[0].contours[0].points.map(p => p.x);
  expect(Math.max(...xs)).toBeGreaterThan(288);
  expect(Math.min(...xs)).toBeLessThan(-283);
  for (const data of ['M0 0 C2 3 4 5 L9 9', 'M0 0 Q1 NaN 2 2', 'M0 0 A1 1 0 2 1 2 2', 'M0 0 L1e999 1']) {
    await expect(parse(page, svg(`<path d="${data}"/>`))).rejects.toThrow(/path/i);
  }
});

test('quadratic subdivision measures physical error after scaling and preserves small straight details', async ({ page }) => {
  const drawing = await parse(page, svg('<path d="M0 0 Q500 1000 1000 0"/><path d="M0 0 L1 0 L1 .00001 L2 .00001"/>', 'width="1000mm" height="500mm" viewBox="0 0 100 50"'));
  const points = drawing.shapes[0].contours[0].points;
  expect(points.length).toBeLessThan(1500);
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1], b = points[i];
    const t = (a.x + b.x) / 20000;
    const exactY = 20000 * t * (1 - t);
    expect(Math.abs(exactY - (a.y + b.y) / 2)).toBeLessThan(0.1);
  }
  expect(drawing.shapes[1].contours[0].points).toEqual([
    { x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 0.0001 }, { x: 20, y: 0.0001 },
  ]);
});

test('vertex budget applies across shapes and never truncates oversized geometry', async ({ page }) => {
  const zigzag = Array.from({ length: 600_000 }, (_, i) => `L${i % 2} ${i % 2}`).join(' ');
  await expect(parse(page, svg(`<path d="M2 0 ${zigzag}"/><path d="M2 0 ${zigzag}"/>`))).rejects.toThrow(/1,000,000 vertices/);
});
test('SVG transform origin cannot silently shift the imported cutting geometry', async ({ page }) => {
  await expect(parse(page, svg('<rect transform-origin="center" transform="rotate(90)" width="10" height="10"/>'))).rejects.toThrow(/transform-origin/);
});
test('multi-megabyte CorelDRAW-scale exports import within the raised budgets', async ({ page }) => {
  // About 2.5 MB of path data, like a converted A1 laser layout, which the old 2 MB limit rejected.
  const body = Array.from({ length: 1500 }, (_, i) => `<path d="${Array.from({ length: 60 }, (_, j) => `${j ? 'L' : 'M'}${(i % 50) * 16 + 8 + 6 * Math.cos(j / 10)},${Math.floor(i / 50) * 16 + 8 + 6 * Math.sin(j / 10)}`).join('\n')} Z"\nstyle="stroke-width: 0.5000; stroke: #000000; stroke-linecap: round; fill: none; "/>`).join('\n');
  const source = svg(body, 'width="800mm" height="480mm" viewBox="0 0 800 480"');
  expect(source.length).toBeGreaterThan(2 * 1024 * 1024);
  const drawing = await parse(page, source);
  expect(drawing.shapes).toHaveLength(1500);
});
test('CorelDRAW, Illustrator and Inkscape export boilerplate imports as plain geometry', async ({ page }) => {
  const corel = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1//EN" "http://www.w3.org/Graphics/SVG/1.1/DTD/svg11.dtd">
<!-- Creator: CorelDRAW -->
<svg xmlns="http://www.w3.org/2000/svg" xml:space="preserve" width="100mm" height="50mm" version="1.1" style="shape-rendering:geometricPrecision; text-rendering:geometricPrecision; image-rendering:optimizeQuality; fill-rule:evenodd; clip-rule:evenodd"
viewBox="0 0 10000 5000" xmlns:xlink="http://www.w3.org/1999/xlink" xmlns:xodm="http://www.corel.com/coreldraw/odm/2003">
 <defs>
  <font id="FontID0" horiz-adv-x="556" font-variant="normal" style="fill-rule:nonzero" font-weight="400">
   <font-face font-family="Arial"><font-face-src><font-face-name name="Arial"/></font-face-src></font-face>
   <missing-glyph><path d="M0 0z"/></missing-glyph>
   <glyph unicode="A" horiz-adv-x="667" d="M0 0l300 700 300 -700z"/>
  </font>
  <style type="text/css">
   <![CDATA[
    @font-face { font-family:"Arial";font-variant:normal;font-weight:normal;src:url("#FontID0") format(svg)}
    .str0 {stroke:#2B2A29;stroke-width:7.62;stroke-miterlimit:22.9256}
    .str1 {stroke:#2B2A29;stroke-width:7.62;stroke-miterlimit:22.9256;stroke-dasharray:22.86 22.86}
    .fil0 {fill:none}
    .fil1 {fill:url(#id0)}
    .fnt0 {font-weight:normal;font-size:1128.89px;font-family:'Arial'}
   ]]>
  </style>
  <linearGradient id="id0" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="100" y2="0"><stop offset="0" style="stop-opacity:1; stop-color:#FEFEFE"/></linearGradient>
 </defs>
 <g id="Layer_x0020_1">
  <metadata id="CorelCorpID_0Corel-Layer"/>
  <rect class="fil0 str0" x="1000" y="1000" width="3000" height="2000"/>
  <path class="fil1 str1" d="M5000 1000l2000 0 0 2000z"/>
  <text x="1000" y="4500" class="fil0 fnt0">Hello</text>
 </g>
</svg>`;
  const drawing = await parse(page, corel);
  expect(drawing.shapes).toHaveLength(2); expect(drawing.skippedText).toBe(1);
  expect(drawing.shapes[0].contours[0].points[0]).toEqual({ x: 10, y: 10 });
  const inkscape = svg('<metadata><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"><cc:Work xmlns:cc="http://creativecommons.org/ns#"/></rdf:RDF></metadata><sodipodi:namedview xmlns:sodipodi="http://sodipodi.sourceforge.net/DTD/sodipodi-0.dtd" pagecolor="#fff"/><path fill="url(#g)" style="stroke-dasharray:2,1" d="M0 0H10V10Z"/>');
  expect((await parse(page, inkscape)).shapes).toHaveLength(1);
});
test('design-program allowances keep rejecting geometry-changing or external content', async ({ page }) => {
  for (const body of ['<style>.a{transform:scale(2)}</style><rect class="a" width="1" height="1"/>', '<style>@import url(x.css);</style><rect width="1" height="1"/>', '<style>rect[class]{fill:none}</style><rect width="1" height="1"/>', '<rect width="1" height="1" fill="url(https://example.com/p)"/>', '<rect width="1" height="1" style="stroke:url(https://example.com/p)"/>', '<defs><image href="https://example.com/x.png"/></defs><rect width="1" height="1"/>', '<defs><script>alert(1)</script></defs><rect width="1" height="1"/>', '<rect width="1" height="1" style="clip-path:url(#c)"/>']) {
    await expect(parse(page, svg(body)), body).rejects.toThrow();
  }
  await expect(parse(page, `<!DOCTYPE svg [<!ENTITY x "y">]>${svg('<rect width="1" height="1"/>')}`)).rejects.toThrow(/entities/);
});
test('imported circles, rounded rectangles and Béziers export as arcs and lines, not polylines', async ({ page }) => {
  const drawing = await parse(page, svg('<circle cx="25" cy="25" r="20"/><rect x="55" y="10" width="30" height="20" rx="4"/><path d="M50 45 C60 35 80 35 90 45"/>'));
  const [circle, rect, wave] = drawing.shapes.map(s => toSvg({ ...drawing, shapes: [s] }));
  expect(circle.match(/ [LAC]/g)).toEqual([' A', ' A']);
  expect((rect.match(/ A/g) || []).length).toBe(4);
  expect((rect.match(/ L/g) || []).length).toBe(4);
  expect((wave.match(/ [LAC]/g) || []).length).toBeLessThan(drawing.shapes[2].contours[0].points.length / 3);
});
test('Bezier paths keep their exact curves, so cleanup and export do not multiply nodes', async ({ page }) => {
  const drawing = await parse(page, svg('<g transform="scale(2)"><path d="M0 0 C0 10 10 10 10 0 Q15 -10 20 0 L20 10 Z"/></g><path d="M40 40 A5 5 0 0 1 50 40"/>'));
  const [bezier, arc] = drawing.shapes.map(s => s.contours[0]);
  const round = (v: unknown) => JSON.parse(JSON.stringify(v, (_, x) => (typeof x === 'number' ? Math.round(x * 1e9) / 1e9 : x)));
  expect(round(bezier.curve)).toEqual(round({ start: { x: 0, y: 0 }, segs: [
    { type: 'C', c1: { x: 0, y: 20 }, c2: { x: 20, y: 20 }, to: { x: 20, y: 0 } },
    { type: 'C', c1: { x: 20 + 20 / 3, y: -40 / 3 }, c2: { x: 40 - 20 / 3, y: -40 / 3 }, to: { x: 40, y: 0 } },
    { type: 'L', to: { x: 40, y: 20 } },
  ] }));
  expect(bezier.points.length).toBeGreaterThan(10);
  // Elliptical arcs are not stored exactly; their polyline is refitted on export as before.
  expect(arc.curve).toBeUndefined();
  const svgOut = toSvg(drawing);
  expect(svgOut).toContain('C0 20 20 20 20 0');
});
