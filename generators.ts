import type { Contour, Drawing, Pen, Point, Shape } from './types';
import { strokeText, textWidth } from './box/font';
import { unionContours } from './vector-ops';

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

/** A gear's outline around (0, 0), with tooth 0 pointing along +x, turned by `rotation`. */
export function gearProfile(o: GearOptions, rotation = 0): Point[] {
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
  const at = (r: number, a: number): Point => ({ x: r * Math.cos(a + rotation), y: r * Math.sin(a + rotation) });
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
  return profile;
}

/** One gear's cut outline, bore and engraved pitch circle, centred on (cx, cy). */
function gearContours(o: GearOptions, cx: number, cy: number, rotation = 0): Contour[] {
  const { pitch } = gearGeometry({ ...o, teeth: Math.round(o.teeth) });
  const contours = [closed(gearProfile(o, rotation).map(p => ({ x: p.x + cx, y: p.y + cy })))];
  if (o.bore > 0) contours.push(closed(circle(cx, cy, o.bore / 2)));
  contours.push(closed(circle(cx, cy, pitch), 'engrave'));
  return contours;
}

export function gearDrawing(o: GearOptions): Drawing {
  const n = Math.round(o.teeth);
  const { outer } = gearGeometry({ ...o, teeth: n });
  const c = outer + 2;
  const contours = gearContours(o, c, c);
  return { width: c * 2, height: c * 2, shapes: [shape('gear', `Gear ${n}T`, contours)] };
}

/** How far apart two meshing gears' centres sit: the sum of their pitch radii. */
export function centreDistance(module: number, teeth1: number, teeth2: number) {
  return (module * (Math.round(teeth1) + Math.round(teeth2))) / 2;
}

/** Two gears of the same module and pressure angle, placed in mesh: the
 *  second is turned so a gap faces the first gear's tooth. */
export function gearPairDrawing(o: GearOptions, teeth2: number, bore2 = o.bore): Drawing {
  const n1 = Math.round(o.teeth), n2 = Math.round(teeth2);
  check(n2, 6, 200, 'Second gear teeth');
  const second = { ...o, teeth: n2, bore: bore2 };
  const g1 = gearGeometry({ ...o, teeth: n1 }), g2 = gearGeometry(second);
  const pad = 2, a = centreDistance(o.module, n1, n2);
  const c1 = { x: g1.outer + pad, y: Math.max(g1.outer, g2.outer) + pad };
  const c2 = { x: c1.x + a, y: c1.y };
  const shapes = [
    shape('gear-1', `Gear ${n1}T`, gearContours(o, c1.x, c1.y)),
    shape('gear-2', `Gear ${n2}T`, gearContours(second, c2.x, c2.y, Math.PI - Math.PI / n2)),
  ];
  return { width: c2.x + g2.outer + pad, height: c1.y * 2, shapes };
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

/** Text set in a font, as closed loops whose bounds start at (0, 0), in any unit. */
export type TagText = { loops: Point[][]; width: number; height: number };

/** A tag or keychain. Text in a font (any script, filled, engraved by scan)
 *  comes in as `font`; without it the text uses the single-stroke A–Z font.
 *  Either way the text shrinks to fit the space below the hole rather than
 *  refusing, so any shape takes any text. */
export function tagDrawing(o: TagOptions, font?: TagText | null): Drawing {
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
  const text = font ? '' : o.text.trim().toUpperCase();
  if (font || text) {
    check(o.textHeight, 1.5, 60, 'Text height');
    // The box the text may use: inside the border, below the hole, and for
    // round shapes inside the inscribed square so the corners stay clear.
    const inner = square ? (Math.min(w, h) / 2 - o.border) * (o.shape === 'star' ? 0.9 : Math.SQRT2) : w - o.border * 2 - 4;
    const top = o.hole > 0 && o.shape !== 'star' ? holeY + o.hole / 2 + 2 : (h - (square ? inner : h - 2 * o.border - 2)) / 2;
    const bottom = square ? h / 2 + inner / 2 : h - o.border - 1;
    const room = bottom - top;
    if (room < 1.5 || inner < 3) throw new Error('There is no room for text below the hole. Make the tag larger or the hole smaller.');
    if (font) {
      const k = Math.min(o.textHeight / font.height, inner / font.width, room / font.height);
      const tw = font.width * k, th = font.height * k;
      const x = (w - tw) / 2, y = top + (room - th) / 2;
      const loops = font.loops.map(loop => loop.map(p => ({ x: x + p.x * k, y: y + p.y * k })));
      // Letters that touch are welded, so a scan fill never leaves a gap in a join.
      contours.push(...unionContours(loops).map(c => ({ ...c, layer: 'engrave' as const })));
    } else {
      const fit = Math.min(o.textHeight, room, (o.textHeight * inner) / textWidth(text, o.textHeight));
      if (fit < 1.5) throw new Error('The text is too long for this tag. Shorten it or make the tag wider.');
      const tw = textWidth(text, fit);
      contours.push(...engraveText(text, fit, (w - tw) / 2, top + (room - fit) / 2));
    }
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

/** LightBurn has 30 layers; RDWorks makes one per colour. */
export const MAX_TEST_SQUARES = 30;

/** The RGB of an AutoCAD colour index, the way CAD and cutting programs show it. */
export function aciRgb(i: number) {
  const base: Record<number, string> = { 1: '#ff0000', 2: '#ffff00', 3: '#00ff00', 4: '#00ffff', 5: '#0000ff', 6: '#ff00ff', 7: '#000000', 8: '#808080', 9: '#c0c0c0' };
  if (i < 10) return base[i] ?? '#000000';
  if (i >= 250) { const v = Math.round(51 + ((i - 250) * 204) / 5); return `#${v.toString(16).padStart(2, '0').repeat(3)}`; }
  const hue = Math.floor((i - 10) / 10) * 15, step = (i - 10) % 10;
  const value = [1, 1, 0.8, 0.8, 0.6, 0.6, 0.5, 0.5, 0.3, 0.3][step], saturation = step % 2 ? 0.5 : 1;
  const f = (n: number) => { const k = (n + hue / 60) % 6; return Math.round(255 * value * (1 - saturation * Math.max(0, Math.min(k, 4 - k, 1)))); };
  return `#${[f(5), f(3), f(1)].map(v => v.toString(16).padStart(2, '0')).join('')}`;
}

/** Colour indices for the test squares: clearly different hues and shades,
 *  never red (cut) or blue (engraved labels). */
const TEST_ACI = [2, 3, 4, 6, 30, 50, 70, 90, 110, 130, 150, 170, 190, 210, 230, 14, 34, 54, 74, 94, 114, 134, 154, 174, 194, 214, 234, 8, 9, 40];

function testPen(index: number, power: number, speed: number): Pen {
  const aci = TEST_ACI[index % TEST_ACI.length];
  return { name: `${String(index + 1).padStart(2, '0')}-P${power}-S${speed}`, aci, rgb: aciRgb(aci) };
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
  const speeds = steps(o.speedMin, o.speedMax, columns), powers = steps(o.powerMin, o.powerMax, rows);
  if (columns * rows > MAX_TEST_SQUARES) throw new Error(`Use at most ${MAX_TEST_SQUARES} squares: cutting software gives each colour its own layer, and LightBurn has 30.`);
  powers.forEach((power, j) => {
    const text = String(power), y = top + j * pitch + (o.cell - label * 0.8) / 2;
    contours.push(...engraveText(text, label * 0.8, left - 4 - textWidth(text, label * 0.8), y));
    for (let i = 0; i < columns; i++) {
      // Each square has its own colour, so the cutting software gives it its own layer.
      const pen = testPen(j * columns + i, powers[j], speeds[i]);
      contours.push({ ...closed(roundedRect(left + i * pitch, top + j * pitch, o.cell, o.cell, 0), 'engrave'), pen });
    }
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
