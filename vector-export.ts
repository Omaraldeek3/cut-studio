import type { Drawing, Shape } from './types';
import type { Curve, Seg } from './path';
import { flatten, pathData, type Shade, type VectorEdge, type VectorLayer, type VectorPath, type VectorResult } from './vectorize';
import { buildPdf, mmToPt, pdfNumber, pdfPath } from './pdf';

/* Turning a traced result into the files the workshop opens: a colour SVG or
   PDF for printing and enlarging, a cut-line SVG for the plotter, and the
   workshop's own Drawing for the laser tools, nesting and DXF. Sizes are set
   in millimetres; the trace itself stays in pixel units until here. */

const fmt = (v: number) => String(Math.round(v * 1000) / 1000);

export function outputHeight(result: VectorResult, widthMm: number) {
  return (result.height / result.width) * widthMm;
}

/** A layer split into the paths drawn in its flat colour and the shapes
 *  drawn with a gradient of their own. */
export function layerParts(layer: VectorLayer): { flat: VectorPath[]; shaded: { paths: VectorPath[]; shade: Shade }[] } {
  const shaded = (layer.shades ?? []).map(s => ({ paths: s.paths.map(i => layer.paths[i]), shade: s.shade }));
  const taken = new Set((layer.shades ?? []).flatMap(s => s.paths));
  return { flat: layer.paths.filter((_, i) => !taken.has(i)), shaded };
}

/** SVG attributes of a linear gradient running along a shade. */
export function shadeAttributes(shade: Shade) {
  return `x1="${fmt(shade.x1)}" y1="${fmt(shade.y1)}" x2="${fmt(shade.x2)}" y2="${fmt(shade.y2)}" gradientUnits="userSpaceOnUse"`;
}

/** Filled colour artwork, one group per colour, sized in millimetres. */
export function colorSvg(result: VectorResult, widthMm: number) {
  const heightMm = outputHeight(result, widthMm);
  const defs: string[] = [];
  const groups = result.layers.map((layer, i) => {
    const { flat, shaded } = layerParts(layer);
    const lines = flat.length ? [`    <path fill-rule="evenodd" d="${flat.map(p => pathData(p)).join('')}"/>`] : [];
    shaded.forEach(({ paths, shade }, j) => {
      const id = `shade-${i + 1}-${j + 1}`;
      defs.push(`    <linearGradient id="${id}" ${shadeAttributes(shade)}><stop offset="0" stop-color="${shade.from}"/><stop offset="1" stop-color="${shade.to}"/></linearGradient>`);
      lines.push(`    <path fill="url(#${id})" fill-rule="evenodd" d="${paths.map(p => pathData(p)).join('')}"/>`);
    });
    return `  <g id="colour-${i + 1}" fill="${layer.color}">\n${lines.join('\n')}\n  </g>`;
  });
  const head = defs.length ? `  <defs>\n${defs.join('\n')}\n  </defs>\n` : '';
  return `<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" width="${fmt(widthMm)}mm" height="${fmt(heightMm)}mm" viewBox="0 0 ${result.width} ${result.height}">\n${head}${groups.join('\n')}\n</svg>\n`;
}

/** SVG path data of a traced border, closed or open. */
function edgeData(e: VectorEdge) {
  const d = pathData(e);
  return e.closed ? d : d.slice(0, -1);
}

const strokeOf = (color: string) => (color === '#ffffff' || color === '#fffefe' ? '#ff0000' : color);

/** Hairline outlines only, one group per colour, for a vinyl plotter or a
 *  laser: every shape becomes a cut path in the colour it came from. In
 *  cut-out mode each border between two colours is written once, in the
 *  colour of one of its sides, so nothing is cut twice. */
export function outlineSvg(result: VectorResult, widthMm: number) {
  const heightMm = outputHeight(result, widthMm);
  const hairline = (0.1 * result.width) / widthMm;
  const byColour = new Map<string, VectorEdge[]>();
  for (const e of result.edges ?? []) { const c = e.colors[0] ?? '#000000'; byColour.set(c, [...(byColour.get(c) ?? []), e]); }
  const group = (i: number, color: string, d: string) =>
    `  <g id="cut-${i + 1}" fill="none" stroke="${strokeOf(color)}" stroke-width="${fmt(hairline)}">\n    <path d="${d}"/>\n  </g>`;
  const groups = result.edges
    ? [...byColour].map(([color, edges], i) => group(i, color, edges.map(edgeData).join('')))
    : result.layers.map((layer, i) => group(i, layer.color, layer.paths.map(p => pathData(p)).join('')));
  return `<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" width="${fmt(widthMm)}mm" height="${fmt(heightMm)}mm" viewBox="0 0 ${result.width} ${result.height}">\n${groups.join('\n')}\n</svg>\n`;
}

/** Vector PDF of the colour artwork, the format most RIP software prefers. */
export function colorPdf(result: VectorResult, widthMm: number) {
  const width = mmToPt(widthMm), height = mmToPt(outputHeight(result, widthMm));
  const k = width / result.width;
  let content = `q ${pdfNumber(k)} 0 0 ${pdfNumber(-k)} 0 ${pdfNumber(height)} cm\n`;
  const rgb = (color: string) => [1, 3, 5].map(i => pdfNumber(parseInt(color.slice(i, i + 2), 16) / 255)).join(' ');
  const shadings: string[] = [];
  for (const layer of result.layers) {
    const { flat, shaded } = layerParts(layer);
    if (flat.length) {
      content += `${rgb(layer.color)} rg\n`;
      for (const path of flat) content += pdfPath(path, path.curves);
      content += 'f*\n';
    }
    // A gradient is painted as an axial shading clipped to its shape.
    for (const { paths, shade } of shaded) {
      const name = `Sh${shadings.length}`;
      shadings.push(`/${name} << /ShadingType 2 /ColorSpace /DeviceRGB /Coords [${[shade.x1, shade.y1, shade.x2, shade.y2].map(pdfNumber).join(' ')}] /Function << /FunctionType 2 /Domain [0 1] /C0 [${rgb(shade.from)}] /C1 [${rgb(shade.to)}] /N 1 >> /Extend [true true] >>`);
      content += 'q\n';
      for (const path of paths) content += pdfPath(path, path.curves);
      content += `W* n /${name} sh Q\n`;
    }
  }
  content += 'Q\n';
  return buildPdf({ width, height, content, shadings, title: 'Cut Studio vector' });
}

/** A traced path as an exact Curve in millimetres, `k` mm per pixel. A cubic
 *  whose controls sit on its chord is written as the line it is. */
export function pathCurve(path: VectorPath, k: number): Curve {
  const P = (x: number, y: number) => ({ x: x * k, y: y * k });
  const segs: Seg[] = [];
  let at = P(path.x, path.y);
  for (const c of path.curves) {
    const c1 = P(c[0], c[1]), c2 = P(c[2], c[3]), to = P(c[4], c[5]);
    const l = Math.hypot(to.x - at.x, to.y - at.y) || 1;
    const off = (q: { x: number; y: number }) => Math.abs((to.x - at.x) * (q.y - at.y) - (to.y - at.y) * (q.x - at.x)) / l;
    segs.push(off(c1) < 1e-6 * l && off(c2) < 1e-6 * l ? { type: 'L', to } : { type: 'C', c1, c2, to });
    at = to;
  }
  return { start: P(path.x, path.y), segs };
}

/** The traced shapes as the workshop's Drawing: one shape per colour, with
 *  the exact curves for files and a 0.02 mm polyline for nesting. */
export function resultToDrawing(result: VectorResult, widthMm: number): Drawing {
  const k = widthMm / result.width;
  const tolerance = 0.02 / k;
  const shapes: Shape[] = result.layers.map((layer, i) => ({
    id: `trace-${i + 1}`,
    name: `Colour ${i + 1} ${layer.color}`,
    contours: layer.paths.map(path => ({
      closed: true,
      points: flatten(path, tolerance).map(p => ({ x: p.x * k, y: p.y * k })),
      curve: pathCurve(path, k),
    })),
  }));
  return { width: widthMm, height: outputHeight(result, widthMm), shapes };
}

/** Cut-out mode's cut lines as one Drawing, each border once: the file for
 *  cutting the whole picture from one sheet, and its DXF. A border that
 *  leaves a junction and comes back to it is a closed loop. */
export function cutDrawing(result: VectorResult, widthMm: number): Drawing {
  if (!result.edges) return resultToDrawing(result, widthMm);
  const k = widthMm / result.width;
  const contours = result.edges.map(e => {
    const end = e.curves.length ? e.curves[e.curves.length - 1] : null;
    const closed = e.closed || (!!end && Math.hypot(end[4] - e.x, end[5] - e.y) < 1e-9);
    return { closed, points: flatten(e, 0.02 / k).map(p => ({ x: p.x * k, y: p.y * k })), curve: pathCurve(e, k) };
  }).filter(c => c.points.length > 1);
  return { width: widthMm, height: outputHeight(result, widthMm), shapes: [{ id: 'cut-lines', name: 'Cut lines', contours }] };
}
