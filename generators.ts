import type { Contour, Drawing, Point, Shape } from './types';
import { strokeText, textWidth } from './box/font';

/* Pure generators for the parametric tools. Every function returns a Drawing
   in millimetres with y pointing down, the same shape every other tool reads
   and exports, and throws a plain message when a setting cannot work. */

const TAU = Math.PI * 2;

function check(value: number, min: number, max: number, name: string) {
  if (!Number.isFinite(value) || value < min || value > max) throw new Error(`${name} must be between ${min} and ${max}.`);
  return value;
}

/** Enough segments that a chord never strays more than 0.05 mm from the arc. */
export function arcSegments(radius: number, sweep = TAU) {
  if (radius <= 0.05) return 8;
  const step = 2 * Math.acos(1 - 0.05 / radius);
  return Math.max(8, Math.min(720, Math.ceil(Math.abs(sweep) / step)));
}

export function circle(cx: number, cy: number, r: number): Point[] {
  const n = arcSegments(r);
  return Array.from({ length: n }, (_, i) => ({ x: cx + r * Math.cos((i / n) * TAU), y: cy + r * Math.sin((i / n) * TAU) }));
}

export function roundedRect(x: number, y: number, w: number, h: number, r: number): Point[] {
  const radius = Math.max(0, Math.min(r, w / 2, h / 2));
  if (radius < 0.01) return [{ x, y }, { x: x + w, y }, { x: x + w, y: y + h }, { x, y: y + h }];
  const points: Point[] = [];
  const corner = (cx: number, cy: number, start: number) => {
    const n = Math.max(2, Math.ceil(arcSegments(radius) / 4));
    for (let i = 0; i <= n; i++) {
      const a = start + (i / n) * (Math.PI / 2);
      points.push({ x: cx + radius * Math.cos(a), y: cy + radius * Math.sin(a) });
    }
  };
  corner(x + w - radius, y + radius, -Math.PI / 2);
  corner(x + w - radius, y + h - radius, 0);
  corner(x + radius, y + h - radius, Math.PI / 2);
  corner(x + radius, y + radius, Math.PI);
  return points;
}

export function polygon(cx: number, cy: number, r: number, sides: number, rotation = -Math.PI / 2): Point[] {
  return Array.from({ length: sides }, (_, i) => ({ x: cx + r * Math.cos(rotation + (i / sides) * TAU), y: cy + r * Math.sin(rotation + (i / sides) * TAU) }));
}

export function star(cx: number, cy: number, outer: number, inner: number, points = 5): Point[] {
  return Array.from({ length: points * 2 }, (_, i) => {
    const r = i % 2 ? inner : outer;
    const a = -Math.PI / 2 + (i / (points * 2)) * TAU;
    return { x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) };
  });
}

const closed = (points: Point[], layer?: 'engrave'): Contour => (layer ? { points, closed: true, layer } : { points, closed: true });
const open = (points: Point[], layer?: 'engrave'): Contour => (layer ? { points, closed: false, layer } : { points, closed: false });
const shape = (id: string, name: string, contours: Contour[]): Shape => ({ id, name, contours });

/** Engraved single-stroke text, as open contours on the engrave layer. */
export function engraveText(text: string, height: number, x: number, y: number): Contour[] {
  return strokeText(text, height, x, y).map(stroke => open(stroke, 'engrave'));
}

export function contourLength(c: Contour) {
  let total = 0;
  for (let i = 1; i < c.points.length; i++) total += Math.hypot(c.points[i].x - c.points[i - 1].x, c.points[i].y - c.points[i - 1].y);
  if (c.closed && c.points.length > 2) {
    const a = c.points[c.points.length - 1], b = c.points[0];
    total += Math.hypot(a.x - b.x, a.y - b.y);
  }
  return total;
}

/** Cut and engrave path lengths in mm, and how many separate paths each has. */
export function pathStats(d: Drawing) {
  let cut = 0, engrave = 0, cutPaths = 0, engravePaths = 0;
  for (const s of d.shapes) for (const c of s.contours) {
    if (c.layer === 'engrave') { engrave += contourLength(c); engravePaths++; }
    else { cut += contourLength(c); cutPaths++; }
  }
  return { cut, engrave, cutPaths, engravePaths };
}

// ——— Living hinge ———

export type HingeOptions = { width: number; height: number; zone: number; slit: number; gap: number; spacing: number; margin: number; radius: number };
export const defaultHinge: HingeOptions = { width: 160, height: 80, zone: 50, slit: 18, gap: 3, spacing: 1.6, margin: 3, radius: 3 };

export function hingeDrawing(o: HingeOptions): Drawing {
  check(o.width, 10, 1500, 'Width'); check(o.height, 10, 1500, 'Height');
  check(o.zone, 2, o.width, 'Hinge zone'); check(o.slit, 2, o.height, 'Slit length');
  check(o.gap, 0.5, 50, 'Bridge'); check(o.spacing, 0.4, 20, 'Line spacing'); check(o.margin, 0, o.height / 3, 'Edge margin');
  const columns = Math.floor(o.zone / o.spacing) + 1;
  if (columns > 800) throw new Error('Too many hinge lines. Widen the spacing or narrow the zone.');
  const start = (o.width - (columns - 1) * o.spacing) / 2;
  const period = o.slit + o.gap, top = o.margin, bottom = o.height - o.margin;
  const slits: Contour[] = [];
  for (let i = 0; i < columns; i++) {
    const x = start + i * o.spacing;
    // Odd columns shift by half a period, so their bridges sit mid-slit.
    for (let y = top - (i % 2) * (period / 2); y < bottom; y += period) {
      const a = Math.max(top, y), b = Math.min(bottom, y + o.slit);
      if (b - a >= Math.min(o.gap, o.slit / 2)) slits.push(open([{ x, y: a }, { x, y: b }]));
    }
  }
  return { width: o.width, height: o.height, shapes: [shape('panel', 'Hinge panel', [closed(roundedRect(0, 0, o.width, o.height, o.radius)), ...slits])] };
}

// ——— Spur gear ———

export type GearOptions = { teeth: number; module: number; pressure: number; bore: number; clearance: number };
export const defaultGear: GearOptions = { teeth: 24, module: 2, pressure: 20, bore: 6, clearance: 0.25 };

export function gearGeometry(o: GearOptions) {
  const pitch = (o.module * o.teeth) / 2;
  return { pitch, outer: pitch + o.module, root: pitch - (1 + o.clearance) * o.module, base: pitch * Math.cos((o.pressure * Math.PI) / 180) };
}

export function gearDrawing(o: GearOptions): Drawing {
  check(Math.round(o.teeth), 6, 200, 'Teeth'); check(o.module, 0.3, 20, 'Module');
  check(o.pressure, 14.5, 30, 'Pressure angle'); check(o.clearance, 0, 0.5, 'Clearance');
  const n = Math.round(o.teeth);
  const { pitch, outer, root, base } = gearGeometry({ ...o, teeth: n });
  check(o.bore, 0, root * 1.6, 'Bore');
  const inv = (t: number) => t - Math.atan(t);
  const tAt = (r: number) => Math.sqrt(Math.max(0, (r / base) ** 2 - 1));
  const phiPitch = inv(tAt(pitch));
  const half = Math.PI / (2 * n);
  const startR = Math.max(base, root), steps = 10;
  // Where the flank meets the root: zero when the root lies below the base
  // circle, otherwise the involute's own angle at the root radius.
  const rootAngle = inv(tAt(startR));
  const at = (r: number, a: number): Point => ({ x: r * Math.cos(a), y: r * Math.sin(a) });
  const profile: Point[] = [];
  for (let k = 0; k < n; k++) {
    const centre = (k / n) * TAU;
    const right: Point[] = [], left: Point[] = [];
    if (root < base) {
      right.push(at(root, centre - half - phiPitch));
      left.push(at(root, centre + half + phiPitch));
    }
    for (let i = 0; i <= steps; i++) {
      const r = startR + ((outer - startR) * i) / steps;
      const a = inv(tAt(r));
      right.push(at(r, centre - half - phiPitch + a));
      left.push(at(r, centre + half + phiPitch - a));
    }
    profile.push(...right, ...left.reverse());
    // The root arc to the next tooth.
    const from = centre + half + phiPitch - rootAngle, to = ((k + 1) / n) * TAU - half - phiPitch + rootAngle;
    const arcSteps = Math.max(2, Math.ceil(arcSegments(root, to - from)));
    for (let i = 1; i < arcSteps; i++) profile.push(at(root, from + ((to - from) * i) / arcSteps));
  }
  const pad = 2, c = outer + pad;
  const moved = profile.map(p => ({ x: p.x + c, y: p.y + c }));
  const contours = [closed(moved)];
  if (o.bore > 0) contours.push(closed(circle(c, c, o.bore / 2)));
  contours.push(closed(circle(c, c, pitch), 'engrave'));
  return { width: c * 2, height: c * 2, shapes: [shape('gear', `Gear ${n}T`, contours)] };
}

// ——— Jigsaw puzzle ———

export type PuzzleOptions = { columns: number; rows: number; piece: number; tab: number; radius: number; seed: number };
export const defaultPuzzle: PuzzleOptions = { columns: 5, rows: 4, piece: 30, tab: 20, radius: 3, seed: 7 };

function random(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** One edge from (0,0) to (1,0) with a round tab of relative size `size`. */
function tabEdge(size: number): Point[] {
  const r = 0.11 * size / 0.2, cy = 0.21 * size / 0.2, neck = 0.08 * size / 0.2;
  const points: Point[] = [{ x: 0, y: 0 }, { x: 0.5 - neck, y: 0 }];
  const steps = 22;
  for (let i = 0; i <= steps; i++) {
    const a = ((215 - (250 * i) / steps) * Math.PI) / 180;
    points.push({ x: 0.5 + r * Math.cos(a), y: cy + r * Math.sin(a) });
  }
  points.push({ x: 0.5 + neck, y: 0 }, { x: 1, y: 0 });
  return points;
}

export function puzzleDrawing(o: PuzzleOptions): Drawing {
  const columns = Math.round(check(o.columns, 2, 40, 'Columns'));
  const rows = Math.round(check(o.rows, 2, 40, 'Rows'));
  check(o.piece, 8, 200, 'Piece size'); check(o.tab, 10, 30, 'Tab size');
  const next = random(Math.round(o.seed));
  const edge = tabEdge(o.tab / 100);
  const s = o.piece, w = columns * s, h = rows * s;
  const lines: Contour[] = [];
  for (let r = 1; r < rows; r++) for (let c = 0; c < columns; c++) {
    const flip = next() < 0.5 ? 1 : -1;
    lines.push(open(edge.map(p => ({ x: (c + p.x) * s, y: r * s + p.y * s * flip }))));
  }
  for (let c = 1; c < columns; c++) for (let r = 0; r < rows; r++) {
    const flip = next() < 0.5 ? 1 : -1;
    lines.push(open(edge.map(p => ({ x: c * s + p.y * s * flip, y: (r + p.x) * s }))));
  }
  return { width: w, height: h, shapes: [shape('puzzle', `Puzzle ${columns}×${rows}`, [closed(roundedRect(0, 0, w, h, o.radius)), ...lines])] };
}

// ——— Tags and keychains ———

export type TagShape = 'rounded' | 'circle' | 'hexagon' | 'star' | 'shield';
export type TagOptions = { shape: TagShape; width: number; height: number; radius: number; hole: number; holeOffset: number; border: number; text: string; textHeight: number };
export const defaultTag: TagOptions = { shape: 'rounded', width: 60, height: 30, radius: 6, hole: 5, holeOffset: 6, border: 2.5, text: 'CUT STUDIO', textHeight: 5 };

function tagOutline(kind: TagShape, w: number, h: number, r: number, inset = 0): Point[] {
  const cx = w / 2, cy = h / 2;
  switch (kind) {
    case 'circle': return circle(cx, cy, Math.min(w, h) / 2 - inset);
    case 'hexagon': return polygon(cx, cy, Math.min(w, h) / 2 - inset, 6, 0);
    case 'star': return star(cx, cy, Math.min(w, h) / 2 - inset, (Math.min(w, h) / 2 - inset) * 0.5);
    case 'shield': {
      const x0 = inset, x1 = w - inset, y0 = inset, y1 = h - inset, mid = y0 + (y1 - y0) * 0.55;
      const points: Point[] = [{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: mid }];
      for (let i = 1; i < 16; i++) {
        const t = i / 16;
        points.push({ x: x1 - (x1 - cx) * t, y: mid + (y1 - mid) * Math.sin((t * Math.PI) / 2) });
      }
      points.push({ x: cx, y: y1 });
      for (let i = 1; i < 16; i++) {
        const t = 1 - i / 16;
        points.push({ x: x0 + (cx - x0) * t, y: mid + (y1 - mid) * Math.sin((t * Math.PI) / 2) });
      }
      points.push({ x: x0, y: mid });
      return points;
    }
    default: return roundedRect(inset, inset, w - inset * 2, h - inset * 2, Math.max(0, r - inset));
  }
}

export function tagDrawing(o: TagOptions): Drawing {
  check(o.width, 8, 600, 'Width'); check(o.height, 8, 600, 'Height');
  check(o.hole, 0, Math.min(o.width, o.height) / 2, 'Hole'); check(o.border, 0, Math.min(o.width, o.height) / 4, 'Border inset');
  const square = o.shape === 'circle' || o.shape === 'hexagon' || o.shape === 'star';
  const w = square ? Math.min(o.width, o.height) : o.width, h = square ? w : o.height;
  const contours: Contour[] = [closed(tagOutline(o.shape, w, h, o.radius))];
  const holeY = o.shape === 'star' ? h * 0.3 : o.holeOffset;
  if (o.hole > 0) {
    if (holeY - o.hole / 2 < 1) throw new Error('Move the hole further from the edge.');
    contours.push(closed(circle(w / 2, holeY, o.hole / 2)));
  }
  if (o.border > 0 && o.shape !== 'star') contours.push(closed(tagOutline(o.shape, w, h, o.radius, o.border), 'engrave'));
  const text = o.text.trim().toUpperCase();
  if (text) {
    check(o.textHeight, 1.5, 60, 'Text height');
    const tw = textWidth(text, o.textHeight);
    if (tw > w - o.border * 2 - 4) throw new Error('The text is wider than the tag. Shorten it or lower the text height.');
    const top = o.hole > 0 && o.shape !== 'star' ? Math.max(h / 2 - o.textHeight / 2, holeY + o.hole / 2 + 2) : h / 2 - o.textHeight / 2;
    if (top + o.textHeight > h - o.border - 1) throw new Error('The text does not fit below the hole. Make the tag taller.');
    contours.push(...engraveText(text, o.textHeight, (w - tw) / 2, top));
  }
  return { width: w, height: h, shapes: [shape('tag', 'Tag', contours)] };
}

// ——— Grille patterns ———

export type PatternKind = 'hex' | 'circle' | 'slot' | 'diamond';
export type PatternOptions = { kind: PatternKind; width: number; height: number; cell: number; wall: number; margin: number; radius: number };
export const defaultPattern: PatternOptions = { kind: 'hex', width: 150, height: 100, cell: 8, wall: 2, margin: 8, radius: 4 };

export function patternDrawing(o: PatternOptions): Drawing {
  check(o.width, 20, 1500, 'Width'); check(o.height, 20, 1500, 'Height');
  check(o.cell, 1, 100, 'Hole size'); check(o.wall, 0.4, 50, 'Wall'); check(o.margin, 0, Math.min(o.width, o.height) / 3, 'Margin');
  const holes: Contour[] = [];
  const x0 = o.margin, y0 = o.margin, x1 = o.width - o.margin, y1 = o.height - o.margin;
  const fits = (cx: number, cy: number, rx: number, ry: number) => cx - rx >= x0 && cx + rx <= x1 && cy - ry >= y0 && cy + ry <= y1;
  const r = o.cell / 2;
  let pitchX: number, pitchY: number, rx: number, ry: number, make: (cx: number, cy: number) => Point[];
  if (o.kind === 'hex') {
    pitchX = Math.sqrt(3) * r + o.wall; pitchY = pitchX * Math.sqrt(3) / 2; rx = Math.sqrt(3) * r / 2; ry = r;
    make = (cx, cy) => polygon(cx, cy, r, 6);
  } else if (o.kind === 'circle') {
    pitchX = o.cell + o.wall; pitchY = pitchX * Math.sqrt(3) / 2; rx = ry = r;
    make = (cx, cy) => circle(cx, cy, r);
  } else if (o.kind === 'diamond') {
    pitchX = o.cell + o.wall * Math.SQRT2; pitchY = pitchX / 2; rx = ry = r;
    make = (cx, cy) => polygon(cx, cy, r, 4);
  } else {
    const length = o.cell * 3;
    pitchX = length + o.wall; pitchY = o.cell + o.wall; rx = length / 2; ry = r;
    make = (cx, cy) => roundedRect(cx - length / 2, cy - r, length, o.cell, r);
  }
  const rowsCount = Math.floor((y1 - y0 - ry * 2) / pitchY) + 1;
  const colsCount = Math.floor((x1 - x0 - rx * 2) / pitchX) + 2;
  if (rowsCount * colsCount > 6000) throw new Error('That is more than 6,000 holes. Make the holes larger.');
  const usedH = (rowsCount - 1) * pitchY + ry * 2;
  const startY = y0 + (y1 - y0 - usedH) / 2 + ry;
  for (let row = 0; row < rowsCount; row++) {
    const cy = startY + row * pitchY, shift = row % 2 ? pitchX / 2 : 0;
    const usedW = (colsCount - 1) * pitchX;
    const startX = o.width / 2 - usedW / 2 + shift - pitchX / 4;
    for (let col = 0; col < colsCount; col++) {
      const cx = startX + col * pitchX;
      if (fits(cx, cy, rx, ry)) holes.push(closed(make(cx, cy)));
    }
  }
  if (!holes.length) throw new Error('No hole fits. Reduce the margin or the hole size.');
  return { width: o.width, height: o.height, shapes: [shape('grille', `${o.kind} grille`, [closed(roundedRect(0, 0, o.width, o.height, o.radius)), ...holes])] };
}

// ——— Power and speed test card ———

export type TestCardOptions = { columns: number; rows: number; cell: number; gap: number; speedMin: number; speedMax: number; powerMin: number; powerMax: number };
export const defaultTestCard: TestCardOptions = { columns: 5, rows: 5, cell: 10, gap: 3, speedMin: 100, speedMax: 500, powerMin: 10, powerMax: 50 };

export function steps(min: number, max: number, count: number) {
  if (count === 1) return [min];
  return Array.from({ length: count }, (_, i) => Math.round(min + ((max - min) * i) / (count - 1)));
}

export function testCardDrawing(o: TestCardOptions): Drawing {
  const columns = Math.round(check(o.columns, 1, 12, 'Columns'));
  const rows = Math.round(check(o.rows, 1, 12, 'Rows'));
  check(o.cell, 4, 40, 'Square size'); check(o.gap, 1, 20, 'Gap');
  check(o.speedMin, 1, 99999, 'Minimum speed'); check(o.speedMax, o.speedMin, 99999, 'Maximum speed');
  check(o.powerMin, 1, 100, 'Minimum power'); check(o.powerMax, o.powerMin, 100, 'Maximum power');
  const label = 3, left = 20, top = 22, pitch = o.cell + o.gap;
  const width = left + columns * pitch + 4, height = top + rows * pitch + 4;
  const contours: Contour[] = [closed(roundedRect(0, 0, width, height, 2))];
  contours.push(...engraveText('SPEED', label, left, 4), ...engraveText('PWR', label, 3, top - 7));
  steps(o.speedMin, o.speedMax, columns).forEach((speed, i) => {
    const text = String(speed), x = left + i * pitch + (o.cell - textWidth(text, label * 0.8)) / 2;
    contours.push(...engraveText(text, label * 0.8, x, top - 7));
  });
  steps(o.powerMin, o.powerMax, rows).forEach((power, j) => {
    const text = String(power), y = top + j * pitch + (o.cell - label * 0.8) / 2;
    contours.push(...engraveText(text, label * 0.8, left - 4 - textWidth(text, label * 0.8), y));
    for (let i = 0; i < columns; i++) contours.push(closed(roundedRect(left + i * pitch, top + j * pitch, o.cell, o.cell, 0), 'engrave'));
  });
  return { width, height, shapes: [shape('test-card', 'Material test card', contours)] };
}

// ——— Ruler ———

export type RulerOptions = { length: number; width: number; unit: 'mm' | 'in'; hole: number; margin: number };
export const defaultRuler: RulerOptions = { length: 150, width: 30, unit: 'mm', hole: 6, margin: 6 };

export function rulerDrawing(o: RulerOptions): Drawing {
  check(o.length, 20, 1000, 'Length'); check(o.width, 12, 100, 'Width'); check(o.hole, 0, o.width / 2, 'Hole'); check(o.margin, 2, 50, 'End margin');
  const holeSpace = o.hole > 0 ? o.hole + 6 : 0;
  const total = o.margin * 2 + o.length + holeSpace;
  const contours: Contour[] = [closed(roundedRect(0, 0, total, o.width, 3))];
  if (o.hole > 0) contours.push(closed(circle(total - o.margin / 2 - o.hole / 2 - 2, o.width / 2, o.hole / 2)));
  const tick = (x: number, len: number) => contours.push(open([{ x, y: 0.001 }, { x, y: len }], 'engrave'));
  const label = Math.min(3.2, o.width / 7);
  if (o.unit === 'mm') {
    for (let mm = 0; mm <= o.length + 1e-9; mm++) {
      const x = o.margin + mm, long = mm % 10 === 0, mid = mm % 5 === 0;
      tick(x, long ? o.width * 0.32 : mid ? o.width * 0.22 : o.width * 0.14);
      if (long) {
        const text = String(mm / 10);
        contours.push(...engraveText(text, label, x - textWidth(text, label) / 2, o.width * 0.32 + 1.5));
      }
    }
    contours.push(...engraveText('CM', label * 0.8, o.margin + 1, o.width - label - 2));
  } else {
    const sixteenths = Math.floor((o.length / 25.4) * 16 + 1e-9);
    for (let s = 0; s <= sixteenths; s++) {
      const x = o.margin + (s * 25.4) / 16;
      const len = s % 16 === 0 ? 0.34 : s % 8 === 0 ? 0.26 : s % 4 === 0 ? 0.2 : s % 2 === 0 ? 0.15 : 0.1;
      tick(x, o.width * len);
      if (s % 16 === 0) {
        const text = String(s / 16);
        contours.push(...engraveText(text, label, x - textWidth(text, label) / 2, o.width * 0.34 + 1.5));
      }
    }
    contours.push(...engraveText('IN', label * 0.8, o.margin + 1, o.width - label - 2));
  }
  return { width: total, height: o.width, shapes: [shape('ruler', 'Ruler', contours)] };
}

// ——— Sign and name plate ———

export type SignOptions = { line1: string; line2: string; height: number; padding: number; radius: number; holes: boolean; border: boolean };
export const defaultSign: SignOptions = { line1: 'WORKSHOP', line2: 'OPEN 9-5', height: 12, padding: 10, radius: 5, holes: true, border: true };

export const signAlphabet = /^[A-Z0-9 \-]*$/;

export function signDrawing(o: SignOptions): Drawing {
  const lines = [o.line1, o.line2].map(line => line.trim().toUpperCase()).filter(Boolean);
  if (!lines.length) throw new Error('Type the text for the sign.');
  for (const line of lines) if (!signAlphabet.test(line)) throw new Error('The engraving font has A–Z, 0–9, space and hyphen only.');
  check(o.height, 3, 120, 'Letter height'); check(o.padding, 2, 100, 'Padding'); check(o.radius, 0, 100, 'Corner radius');
  const small = o.height * 0.6;
  const heights = lines.map((_, i) => (i === 0 ? o.height : small));
  const widths = lines.map((line, i) => textWidth(line, heights[i]));
  const holeSpace = o.holes ? o.height * 0.9 : 0;
  const inner = Math.max(...widths);
  const lineGap = o.height * 0.5;
  const textBlock = heights.reduce((a, b) => a + b, 0) + lineGap * (lines.length - 1);
  const w = inner + o.padding * 2 + holeSpace * 2, h = textBlock + o.padding * 2;
  const contours: Contour[] = [closed(roundedRect(0, 0, w, h, o.radius))];
  if (o.border) {
    const inset = Math.min(o.padding / 2, 4);
    contours.push(closed(roundedRect(inset, inset, w - inset * 2, h - inset * 2, Math.max(0, o.radius - inset)), 'engrave'));
  }
  if (o.holes) {
    const r = Math.max(1.5, o.height * 0.18);
    contours.push(closed(circle(o.padding / 2 + holeSpace / 2 + 1, h / 2, r)), closed(circle(w - o.padding / 2 - holeSpace / 2 - 1, h / 2, r)));
  }
  let y = o.padding;
  lines.forEach((line, i) => {
    contours.push(...engraveText(line, heights[i], (w - widths[i]) / 2, y));
    y += heights[i] + lineGap;
  });
  return { width: w, height: h, shapes: [shape('sign', 'Sign', contours)] };
}

// ——— Job time ———

export type JobOptions = { cutSpeed: number; engraveSpeed: number; pierce: number; travel: number; copies: number; rate: number };
export const defaultJob: JobOptions = { cutSpeed: 15, engraveSpeed: 120, pierce: 0.3, travel: 15, copies: 1, rate: 30 };

export function jobEstimate(d: Drawing, o: JobOptions) {
  check(o.cutSpeed, 0.1, 2000, 'Cut speed'); check(o.engraveSpeed, 0.1, 5000, 'Engrave speed');
  check(o.pierce, 0, 30, 'Pierce time'); check(o.travel, 0, 300, 'Travel allowance'); check(o.copies, 1, 100000, 'Copies'); check(o.rate, 0, 100000, 'Machine rate');
  const stats = pathStats(d);
  const cutting = stats.cut / o.cutSpeed, engraving = stats.engrave / o.engraveSpeed;
  const piercing = (stats.cutPaths + stats.engravePaths) * o.pierce;
  const each = (cutting + engraving + piercing) * (1 + o.travel / 100);
  const seconds = each * Math.round(o.copies);
  return { ...stats, cutting, engraving, piercing, each, seconds, cost: (seconds / 3600) * o.rate };
}

export function duration(seconds: number) {
  const s = Math.round(seconds), h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = s % 60;
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}` : `${m}:${String(r).padStart(2, '0')}`;
}

// ——— Resolution ———

export function resolution(dpi: number, widthMm: number, heightMm: number) {
  check(dpi, 25, 2400, 'DPI'); check(widthMm, 1, 5000, 'Width'); check(heightMm, 1, 5000, 'Height');
  const px = (mm: number) => Math.round((mm / 25.4) * dpi);
  return { width: px(widthMm), height: px(heightMm), interval: 25.4 / dpi, linesPerMm: dpi / 25.4, megapixels: (px(widthMm) * px(heightMm)) / 1e6 };
}

export function printSize(dpi: number, widthPx: number, heightPx: number) {
  check(dpi, 25, 2400, 'DPI'); check(widthPx, 1, 100000, 'Pixel width'); check(heightPx, 1, 100000, 'Pixel height');
  return { width: (widthPx / dpi) * 25.4, height: (heightPx / dpi) * 25.4 };
}
