import type { Drawing, Shape, Contour, Point } from './types';

const NS = 'http://www.w3.org/2000/svg';
export const MAX_SVG_BYTES = 32 * 1024 * 1024;
const MAX_VERTICES = 1_000_000;
const CURVE_TOLERANCE_MM = 0.09;
const MAX_GEOMETRY_WORK = 20_000_000;
const MAX_ELEMENTS = 50_000;
const MAX_SHAPES = 5_000;
const NUMBER = /[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/g;
const presentation = new Set(['fill', 'fill-rule', 'fill-opacity', 'stroke', 'stroke-width', 'stroke-opacity', 'stroke-linecap', 'stroke-linejoin', 'stroke-miterlimit', 'opacity', 'vector-effect', 'paint-order', 'color']);
// Style properties that never change cutting geometry. Design programs (CorelDRAW,
// Illustrator, Inkscape) write these routinely: dash styles, rendering hints, font
// settings for text that is skipped anyway, and gradient stop colours.
const harmlessCss = new Set([...presentation, 'stroke-dasharray', 'stroke-dashoffset', 'clip-rule', 'shape-rendering', 'text-rendering', 'image-rendering', 'color-rendering', 'color-interpolation', 'color-interpolation-filters', 'stop-color', 'stop-opacity', 'font-family', 'font-size', 'font-weight', 'font-style', 'font-variant', 'font-stretch', 'letter-spacing', 'word-spacing', 'text-anchor', 'text-decoration', 'dominant-baseline', 'alignment-baseline', 'baseline-shift', 'writing-mode', 'direction', 'unicode-bidi', 'enable-background', 'isolation', 'mix-blend-mode', 'solid-color', 'solid-opacity']);
// fill/stroke may point at a gradient or pattern in the same file: paint only.
const LOCAL_PAINT = /^url\(\s*(['"]?)#[\w.:-]+\1\s*\)(?:\s+[#\w.%(),\s-]*)?$/i;
const geometry = new Set(['path', 'rect', 'circle', 'ellipse', 'polygon', 'polyline', 'line']);
// Never rendered: their contents are not cutting geometry and are not validated as such.
const nonRendering = new Set(['defs', 'metadata', 'title', 'desc', 'style']);
const textTags = new Set(['text', 'tspan', 'textPath']);
function fail(message: string): never { throw new Error(message); }
function checkDeclarations(text: string) {
  for (const entry of text.split(';').filter(s => s.trim())) {
    const separator = entry.indexOf(':');
    const property = entry.slice(0, separator).trim().toLowerCase(), value = entry.slice(separator + 1).trim();
    if (separator < 0 || !harmlessCss.has(property) || /[\\@!]|var\s*\(|expression\s*\(/i.test(entry)) fail(`Unsupported SVG CSS: ${property || 'style'}. Export plain paths.`);
    if (/url\s*\(/i.test(value) && !((property === 'fill' || property === 'stroke') && LOCAL_PAINT.test(value))) fail(`Unsafe or referenced SVG content: ${property}. Expand references to paths first.`);
  }
}
/** Accepts only simple class/tag/id rules with harmless properties, plus @font-face blocks for skipped text. */
function checkStylesheet(source: string) {
  const css = source.replace(/<!\[CDATA\[|\]\]>/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
  const rule = /([^{}]*)\{([^{}]*)\}/g;
  if (css.replace(rule, '').trim()) fail('Unsupported SVG CSS: stylesheet. Export plain paths.');
  for (const [, selector, body] of css.matchAll(rule)) {
    const name = selector.trim();
    if (name.toLowerCase() === '@font-face') continue;
    if (!/^[\w\s.#,*>+~-]+$/.test(name)) fail(`Unsupported SVG CSS selector: ${name.slice(0, 40)}. Export plain paths.`);
    checkDeclarations(body);
  }
}
function numbers(value: string, context: string): number[] {
  if (value.replace(NUMBER, '').replace(/[\s,]/g, '')) fail(`Invalid ${context} numbers.`);
  const result = (value.match(NUMBER) || []).map(Number);
  if (result.some(n => !Number.isFinite(n) || Math.abs(n) > 1e9)) fail(`${context} exceeds supported coordinates.`);
  return result;
}
function lengthMm(value: string | null): number | null {
  if (!value || value.includes('%')) return null;
  const match = value.trim().match(/^([+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?)(mm|cm|in|pt|pc|px)?$/i);
  if (!match) fail('Unsupported SVG dimension unit. Use mm, cm, in, pt, pc or px.');
  const factors: Record<string, number> = { mm: 1, cm: 10, in: 25.4, pt: 25.4 / 72, pc: 25.4 / 6, px: 25.4 / 96 };
  const result = Number(match[1]) * factors[(match[2] || 'px').toLowerCase()];
  if (!(result > 0) || !Number.isFinite(result)) fail('SVG dimensions must be positive.');
  return result;
}
function localTransform(value: string | null): DOMMatrix {
  let result = new DOMMatrix();
  if (!value) return result;
  const expression = /([a-zA-Z]+)\s*\(([^)]*)\)/g;
  if (value.replace(expression, '').replace(/[\s,]/g, '')) fail('Invalid SVG transform.');
  for (const match of value.matchAll(expression)) {
    const n = numbers(match[2], 'transform');
    let next: DOMMatrix;
    switch (match[1]) {
      case 'matrix': if (n.length !== 6) fail('Invalid matrix transform.'); next = new DOMMatrix(n); break;
      case 'translate': if (n.length < 1 || n.length > 2) fail('Invalid translate transform.'); next = new DOMMatrix().translate(n[0], n[1] || 0); break;
      case 'scale': if (n.length < 1 || n.length > 2) fail('Invalid scale transform.'); next = new DOMMatrix().scale(n[0], n[1] ?? n[0]); break;
      case 'rotate': if (n.length !== 1 && n.length !== 3) fail('Invalid rotate transform.'); next = new DOMMatrix().translate(n[1] || 0, n[2] || 0).rotate(n[0]).translate(-(n[1] || 0), -(n[2] || 0)); break;
      case 'skewX': if (n.length !== 1) fail('Invalid skew transform.'); next = new DOMMatrix().skewX(n[0]); break;
      case 'skewY': if (n.length !== 1) fail('Invalid skew transform.'); next = new DOMMatrix().skewY(n[0]); break;
      default: return fail(`Unsupported SVG transform: ${match[1]}.`);
    }
    result = result.multiply(next);
  }
  return result;
}

/** Each geometric element becomes a part. Compound path subpaths remain together
 * (including holes); SVG groups only contribute transforms. Strokes are centerlines.
 * Beziers subdivide in transformed millimetres until every control point is
 * within 0.09 mm of the finite chord. The convex-hull property bounds the entire
 * segment's error, including loops and overshoot. Arcs retain <=0.18 mm arc-length
 * steps (<=0.09 mm to a sample, apart from browser floating-point precision).
 * Only exact forward-collinear vertices are removed; straight edges stay exact.
 */
export async function parseSvg(source: string, physicalWidthMm?: number): Promise<Drawing> {
  if (source.length > MAX_SVG_BYTES || new TextEncoder().encode(source).length > MAX_SVG_BYTES) fail('SVG exceeds the 32 MB limit.');
  // The public DOCTYPE line written by CorelDRAW/Illustrator is inert; internal subsets and entities are not.
  if (/<!DOCTYPE[^>]*\[|<!ENTITY|<\?xml-stylesheet/i.test(source)) fail('SVG document types, entities and external stylesheets are unsupported.');
  const doc = new DOMParser().parseFromString(source, 'image/svg+xml');
  const root = doc.documentElement;
  if (doc.querySelector('parsererror') || root.localName !== 'svg' || root.namespaceURI !== NS) fail('Invalid SVG document.');
  // Live text is not a cutting outline: remove it (and everything inside it) and report how much was skipped.
  const textRoots = Array.from(root.querySelectorAll('*')).filter(el => textTags.has(el.localName) && !(el.parentElement && el.parentElement.closest('text, tspan, textPath')));
  for (const el of textRoots) el.remove();
  const skippedText = textRoots.length;
  const all = Array.from(root.querySelectorAll('*'));
  if (all.length > MAX_ELEMENTS) fail('SVG is too complex: at most 50,000 elements.');
  // Validate the entire document before creating even detached measurement geometry.
  const hidden = (el: Element) => { for (let p = el.parentElement; p && p !== root; p = p.parentElement) if (p.namespaceURI !== NS || nonRendering.has(p.localName)) return true; return false; };
  for (const el of [root, ...all]) {
    const tag = el.localName, svgElement = el.namespaceURI === NS;
    if (['script', 'foreignObject', 'iframe', 'handler', 'listener'].includes(tag)) fail(`Unsupported SVG element: ${tag}. Export plain paths without effects or embedded content.`);
    // Editor data in other namespaces (Inkscape, Illustrator, CorelDRAW) and definitions are never drawn.
    if (el !== root && (!svgElement || hidden(el))) {
      for (const attr of Array.from(el.attributes)) {
        const key = attr.localName.toLowerCase(), value = attr.value.trim();
        if (key.startsWith('on') || (['href', 'src'].includes(key) && !/^(#|data:image\/)/i.test(value))) fail(`Unsafe or referenced SVG content: ${attr.name}. Expand references to paths first.`);
      }
      if (svgElement && tag === 'style') checkStylesheet(el.textContent || '');
      continue;
    }
    if (!geometry.has(tag) && !['svg', 'g', 'linearGradient', 'radialGradient', 'stop', ...nonRendering].includes(tag)) fail(`Unsupported SVG element: ${tag}. Export plain paths without effects or embedded content.`);
    if (tag === 'svg' && el !== root) fail('Nested SVG viewports are unsupported. Flatten the export first.');
    if (tag === 'style') checkStylesheet(el.textContent || '');
    for (const attr of Array.from(el.attributes)) {
      const key = attr.localName.toLowerCase(), value = attr.value.trim();
      if (key === 'style') { checkDeclarations(attr.value); continue; }
      if (key.startsWith('on') || ['href', 'src'].includes(key) || (/url\s*\(/i.test(value) && !((key === 'fill' || key === 'stroke') && LOCAL_PAINT.test(value)))) fail(`Unsafe or referenced SVG content: ${attr.name}. Expand references to paths first.`);
      if (['clip-path', 'mask', 'filter', 'marker-start', 'marker-mid', 'marker-end', 'display', 'visibility', 'transform-origin', 'transform-box'].includes(key)) fail(`Unsupported SVG effect: ${attr.name}. Flatten effects before importing.`);
    }
  }
  const vb = root.hasAttribute('viewBox') ? numbers(root.getAttribute('viewBox')!, 'viewBox') : null;
  if (vb && (vb.length !== 4 || vb[2] <= 0 || vb[3] <= 0)) fail('Invalid SVG viewBox.');
  const preserve = root.getAttribute('preserveAspectRatio')?.trim();
  if (preserve && preserve !== 'xMidYMid' && preserve !== 'xMidYMid meet') fail('Only default xMidYMid meet preserveAspectRatio is supported.');
  let width = lengthMm(root.getAttribute('width'));
  let height = lengthMm(root.getAttribute('height'));
  if (physicalWidthMm !== undefined) {
    if (!(physicalWidthMm > 0) || !Number.isFinite(physicalWidthMm)) fail('Physical width must be a positive number in mm.');
    const ratio = width && height ? height / width : vb ? vb[3] / vb[2] : null;
    if (!ratio) fail('SVG needs a viewBox or both dimensions to determine its aspect ratio.');
    width = physicalWidthMm; height = width * ratio;
  } else if (!width || !height) fail('Enter a physical width in mm: SVG dimensions are missing or percentage based.');
  const w = width!, h = height!;
  if (Math.max(w, h) > 100_000) fail('SVG physical dimensions exceed 100,000 mm.');
  const viewport = vb || [0, 0, lengthMm(root.getAttribute('width'))! * 96 / 25.4, lengthMm(root.getAttribute('height'))! * 96 / 25.4];
  const scale = Math.min(w / viewport[2], h / viewport[3]);
  const base = new DOMMatrix([scale, 0, 0, scale, (w - viewport[2] * scale) / 2 - viewport[0] * scale, (h - viewport[3] * scale) / 2 - viewport[1] * scale]);
  let vertexCount = 0;
  let geometryWork = 0;
  const shapes: Shape[] = [];
  function pathContours(data: string, matrix: DOMMatrix): Contour[] {
    const tokenPattern = /[a-zA-Z]|[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/g;
    if (data.replace(tokenPattern, '').replace(/[\s,]/g, '')) fail('Invalid SVG path data.');
    const tokens = data.match(tokenPattern) || [];
    if (tokens.length > 8_000_000) fail('SVG path is too complex.');
    const contours: Contour[] = [];
    let contour: Contour | undefined;
    let current: Point = { x: 0, y: 0 }, start = current;
    let cubicControl: Point | undefined, quadControl: Point | undefined;
    let index = 0, command = '', previous = '';
    const arity: Record<string, number> = { M: 2, L: 2, H: 1, V: 1, C: 6, S: 4, Q: 4, T: 2, A: 7 };
    const norm = Math.hypot(matrix.a, matrix.b, matrix.c, matrix.d); // Frobenius upper bound on stretch.
    const measure = document.createElementNS(NS, 'path');
    function transform(p: Point): Point {
      const transformed = matrix.transformPoint(p);
      if (!Number.isFinite(transformed.x) || !Number.isFinite(transformed.y) || Math.max(Math.abs(transformed.x), Math.abs(transformed.y)) > 1e7) fail('Transformed SVG coordinates exceed supported limits.');
      return { x: transformed.x, y: transformed.y };
    }
    function work() {
      if (++geometryWork > MAX_GEOMETRY_WORK) fail('SVG exceeds the geometry processing limit. Simplify the export.');
    }
    function append(result: Point) {
      work();
      const points = contour!.points, last = points.at(-1), before = points.at(-2);
      if (last && last.x === result.x && last.y === result.y) return;
      if (before && last) {
        const ax = last.x - before.x, ay = last.y - before.y;
        const bx = result.x - last.x, by = result.y - last.y;
        if (ax * by - ay * bx === 0 && ax * bx + ay * by >= 0) {
          points[points.length - 1] = result;
          return;
        }
      }
      if (++vertexCount > MAX_VERTICES) fail('SVG exceeds 1,000,000 vertices. Simplify curves or reduce physical size.');
      points.push(result);
    }
    function add(p: Point) { append(transform(p)); }
    function bezier(controls: Point[], depth = 0) {
      work();
      const a = controls[0], b = controls[controls.length - 1];
      const dx = b.x - a.x, dy = b.y - a.y, lengthSquared = dx * dx + dy * dy;
      const flat = controls.slice(1, -1).every(p => {
        const t = lengthSquared ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / lengthSquared)) : 0;
        return Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy) <= CURVE_TOLERANCE_MM;
      });
      if (flat) { append(b); return; }
      if (depth >= 32) fail('SVG curve exceeds subdivision limit. Simplify the export.');
      const left = [a], right = [b];
      let row = controls;
      while (row.length > 1) {
        row = row.slice(1).map((p, i) => ({ x: (row[i].x + p.x) / 2, y: (row[i].y + p.y) / 2 }));
        left.push(row[0]); right.push(row[row.length - 1]);
      }
      bezier(left, depth + 1);
      bezier(right.reverse(), depth + 1);
    }
    function curve(segment: string, end: Point) {
      measure.setAttribute('d', `M${current.x} ${current.y} ${segment}`);
      const length = measure.getTotalLength();
      const steps = Math.max(1, Math.ceil(length * norm / 0.18));
      if (!Number.isFinite(steps) || steps + vertexCount > MAX_VERTICES) fail('SVG exceeds 1,000,000 vertices. Simplify curves or reduce physical size.');
      for (let step = 1; step < steps; step++) add(measure.getPointAtLength(length * step / steps));
      add(end);
    }
    while (index < tokens.length) {
      work();
      if (/^[a-zA-Z]$/.test(tokens[index])) command = tokens[index++];
      else if (!command) fail('Invalid SVG path: command expected.');
      const upper = command.toUpperCase(), relative = command !== upper;
      if (upper === 'Z') {
        if (!contour) fail('Invalid SVG path close command.');
        contour.closed = true;
        const first = contour.points[0], last = contour.points.at(-1);
        if (first && last && contour.points.length > 1 && first.x === last.x && first.y === last.y) { contour.points.pop(); vertexCount--; }
        current = start; previous = 'Z'; command = ''; cubicControl = quadControl = undefined; continue;
      }
      const count = arity[upper];
      if (!count || index + count > tokens.length) fail('Invalid or incomplete SVG path command.');
      const n = tokens.slice(index, index + count).map(Number); index += count;
      if (n.some(value => !Number.isFinite(value) || Math.abs(value) > 1e9)) fail('Invalid SVG path coordinates.');
      const point = (offset: number): Point => ({ x: n[offset] + (relative ? current.x : 0), y: n[offset + 1] + (relative ? current.y : 0) });
      let end: Point;
      if (upper === 'M') {
        current = point(0); start = current;
        contour = { points: [], closed: false }; contours.push(contour); add(current);
        command = relative ? 'l' : 'L';
      } else {
        if (!contour) fail('SVG paths must begin with a move command.');
        // Drawing after Z starts a new contour at the closed subpath's start.
        if (contour.closed) { contour = { points: [], closed: false }; contours.push(contour); add(current); }
        switch (upper) {
          case 'L': end = point(0); add(end); break;
          case 'H': end = { x: n[0] + (relative ? current.x : 0), y: current.y }; add(end); break;
          case 'V': end = { x: current.x, y: n[0] + (relative ? current.y : 0) }; add(end); break;
          case 'C': { const a = point(0), b = point(2); end = point(4); bezier([current, a, b, end].map(transform)); cubicControl = b; break; }
          case 'S': { const a = /[CS]/.test(previous) && cubicControl ? { x: 2 * current.x - cubicControl.x, y: 2 * current.y - cubicControl.y } : current; const b = point(0); end = point(2); bezier([current, a, b, end].map(transform)); cubicControl = b; break; }
          case 'Q': { const a = point(0); end = point(2); bezier([current, a, end].map(transform)); quadControl = a; break; }
          case 'T': { const a: Point = /[QT]/.test(previous) && quadControl ? { x: 2 * current.x - quadControl.x, y: 2 * current.y - quadControl.y } : current; end = point(0); bezier([current, a, end].map(transform)); quadControl = a; break; }
          case 'A': end = point(5); if (n[0] < 0 || n[1] < 0 || ![0, 1].includes(n[3]) || ![0, 1].includes(n[4])) fail('Invalid SVG path arc.'); curve(`A${n[0]} ${n[1]} ${n[2]} ${n[3]} ${n[4]} ${end.x} ${end.y}`, end); break;
          default: return fail('Unsupported SVG path command.');
        }
        current = end;
      }
      if (!['C', 'S'].includes(upper)) cubicControl = undefined;
      if (!['Q', 'T'].includes(upper)) quadControl = undefined;
      previous = upper;
    }
    return contours.filter(c => c.points.length >= 2);
  }
  function visit(el: Element, inherited: DOMMatrix, depth: number) {
    if (depth > 32) fail('SVG groups exceed 32 nesting levels.');
    if (el.namespaceURI !== NS || nonRendering.has(el.localName)) return;
    const matrix = inherited.multiply(localTransform(el.getAttribute('transform')));
    if (el.localName === 'g' || el === root) { for (const child of Array.from(el.children)) visit(child, matrix, depth + 1); return; }
    if (!geometry.has(el.localName)) fail('Gradient definitions must be inside defs.');
    if (shapes.length >= MAX_SHAPES) fail('SVG exceeds 5,000 shapes.');
    const scalar = (name: string, fallback = 0) => {
      const raw = el.getAttribute(name);
      if (raw === null) return fallback;
      const values = numbers(raw, `${el.localName} ${name}`);
      if (values.length !== 1) fail(`Invalid ${name} value. Use unitless geometry coordinates.`);
      return values[0];
    };
    let data = '';
    switch (el.localName) {
      case 'path': data = el.getAttribute('d') || ''; break;
      case 'line': data = `M${scalar('x1')} ${scalar('y1')} L${scalar('x2')} ${scalar('y2')}`; break;
      case 'polyline': case 'polygon': {
        const points = numbers(el.getAttribute('points') || '', 'polygon points');
        if (points.length < 4 || points.length % 2) fail('Invalid polygon/polyline points.');
        data = `M${points[0]} ${points[1]} L${points.slice(2).join(' ')}${el.localName === 'polygon' ? ' Z' : ''}`; break;
      }
      case 'circle': case 'ellipse': {
        const cx = scalar('cx'), cy = scalar('cy'), rx = scalar(el.localName === 'circle' ? 'r' : 'rx'), ry = el.localName === 'circle' ? rx : scalar('ry');
        if (rx <= 0 || ry <= 0) fail('Circle and ellipse radii must be positive.');
        data = `M${cx + rx} ${cy} A${rx} ${ry} 0 1 0 ${cx - rx} ${cy} A${rx} ${ry} 0 1 0 ${cx + rx} ${cy} Z`; break;
      }
      case 'rect': {
        const x = scalar('x'), y = scalar('y'), rw = scalar('width'), rh = scalar('height');
        if (rw <= 0 || rh <= 0) fail('Rectangle dimensions must be positive.');
        const rx = Math.min(scalar('rx', scalar('ry')), rw / 2), ry = Math.min(scalar('ry', scalar('rx')), rh / 2);
        if (rx < 0 || ry < 0) fail('Rectangle corner radii must be nonnegative.');
        data = rx && ry ? `M${x + rx} ${y} H${x + rw - rx} A${rx} ${ry} 0 0 1 ${x + rw} ${y + ry} V${y + rh - ry} A${rx} ${ry} 0 0 1 ${x + rw - rx} ${y + rh} H${x + rx} A${rx} ${ry} 0 0 1 ${x} ${y + rh - ry} V${y + ry} A${rx} ${ry} 0 0 1 ${x + rx} ${y} Z` : `M${x} ${y} H${x + rw} V${y + rh} H${x} Z`; break;
      }
    }
    const contours = pathContours(data, matrix);
    if (contours.length) shapes.push({ id: `part-${shapes.length + 1}`, name: el.getAttribute('id') || `${el.localName} ${shapes.length + 1}`, contours });
  }
  visit(root, base, 0);
  if (!shapes.length) fail(skippedText ? 'This SVG contains only text. Convert text to curves in CorelDRAW or Illustrator before importing.' : 'SVG contains no usable paths. Convert artwork to curves before exporting.');
  return { width: w, height: h, shapes, ...(skippedText ? { skippedText } : {}) };
}
