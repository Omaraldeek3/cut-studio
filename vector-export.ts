import type { Drawing, Shape } from './types';
import { flatten, pathData, type VectorResult } from './vectorize';
import { buildPdf, mmToPt, pdfNumber, pdfPath } from './pdf';

/* Turning a traced result into the files the workshop opens: a colour SVG or
   PDF for printing and enlarging, a cut-line SVG for the plotter, and the
   workshop's own Drawing for the laser tools, nesting and DXF. Sizes are set
   in millimetres; the trace itself stays in pixel units until here. */

const fmt = (v: number) => String(Math.round(v * 1000) / 1000);

export function outputHeight(result: VectorResult, widthMm: number) {
  return (result.height / result.width) * widthMm;
}

/** Filled colour artwork, one group per colour, sized in millimetres. */
export function colorSvg(result: VectorResult, widthMm: number) {
  const heightMm = outputHeight(result, widthMm);
  const groups = result.layers.map((layer, i) =>
    `  <g id="colour-${i + 1}" fill="${layer.color}">\n    <path fill-rule="evenodd" d="${layer.paths.map(p => pathData(p)).join('')}"/>\n  </g>`,
  );
  return `<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" width="${fmt(widthMm)}mm" height="${fmt(heightMm)}mm" viewBox="0 0 ${result.width} ${result.height}">\n${groups.join('\n')}\n</svg>\n`;
}

/** Hairline outlines only, one group per colour, for a vinyl plotter or a
 *  laser: every shape becomes a cut path in the colour it came from. */
export function outlineSvg(result: VectorResult, widthMm: number) {
  const heightMm = outputHeight(result, widthMm);
  const hairline = (0.1 * result.width) / widthMm;
  const groups = result.layers.map((layer, i) =>
    `  <g id="cut-${i + 1}" fill="none" stroke="${layer.color === '#ffffff' || layer.color === '#fffefe' ? '#ff0000' : layer.color}" stroke-width="${fmt(hairline)}">\n    <path d="${layer.paths.map(p => pathData(p)).join('')}"/>\n  </g>`,
  );
  return `<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" width="${fmt(widthMm)}mm" height="${fmt(heightMm)}mm" viewBox="0 0 ${result.width} ${result.height}">\n${groups.join('\n')}\n</svg>\n`;
}

/** Vector PDF of the colour artwork, the format most RIP software prefers. */
export function colorPdf(result: VectorResult, widthMm: number) {
  const width = mmToPt(widthMm), height = mmToPt(outputHeight(result, widthMm));
  const k = width / result.width;
  let content = `q ${pdfNumber(k)} 0 0 ${pdfNumber(-k)} 0 ${pdfNumber(height)} cm\n`;
  for (const layer of result.layers) {
    const r = parseInt(layer.color.slice(1, 3), 16) / 255, g = parseInt(layer.color.slice(3, 5), 16) / 255, b = parseInt(layer.color.slice(5, 7), 16) / 255;
    content += `${pdfNumber(r)} ${pdfNumber(g)} ${pdfNumber(b)} rg\n`;
    for (const path of layer.paths) content += pdfPath(path, path.curves);
    content += 'f*\n';
  }
  content += 'Q\n';
  return buildPdf({ width, height, content, title: 'Cut Studio vector' });
}

/** The traced shapes as the workshop's Drawing: one shape per colour, curves
 *  flattened to within 0.02 mm, ready for nesting and DXF. */
export function resultToDrawing(result: VectorResult, widthMm: number): Drawing {
  const k = widthMm / result.width;
  const tolerance = 0.02 / k;
  const shapes: Shape[] = result.layers.map((layer, i) => ({
    id: `trace-${i + 1}`,
    name: `Colour ${i + 1} ${layer.color}`,
    contours: layer.paths.map(path => ({
      closed: true,
      points: flatten(path, tolerance).map(p => ({ x: p.x * k, y: p.y * k })),
    })),
  }));
  return { width: widthMm, height: outputHeight(result, widthMm), shapes };
}
