import { unionD, areaD, pointInPolygonD, FillRule, PointInPolygonResult } from '@countertype/clipper2-ts';
import type { Contour, Point } from './types';
import { toContours } from './vector-ops';

/* Keeping the dots on. Cut out of acrylic or wood, Arabic lettering falls
   apart into its letters and every dot, hamza and vowel mark beside them: the
   small pieces drop through the bed and have to be found and glued back. A
   sign maker moves each mark onto its letter before cutting, so letter and
   dot come out as one piece. This does the same: it finds the marks, moves
   each one straight down or up (the way the dot sits over its letter) until
   it sinks into the letter, and welds them. Or, keeping every mark where the
   font put it, it joins each to its letter with a short bridge. */

const PRECISION = 4;
/** In auto mode, how far (in em) a mark may travel to touch its letter; one
 *  further away keeps its place and gets a bridge. A dot over a tooth sits
 *  about 0.1 em above it; the dots of a final ت in some fonts sit 0.35 em up. */
const AUTO_MOVE = 0.15;

type Box = { x0: number; y0: number; x1: number; y1: number };
type Piece = { contours: Point[][]; box: Box; area: number; width: number; height: number };

export type AnchorOptions = {
  /** Move each mark onto its letter, leave it in place and add a bridge, or
   *  (auto) move the marks that sit close to their letter and bridge the rest,
   *  so no dot travels far from where a reader expects it. */
  mode: 'auto' | 'move' | 'bridge';
  /** How far a moved mark sinks into its letter, as a share of the mark's height. */
  depth: number;
  /** Bridge width in mm; left out, a bridge is a little under half the mark's size. */
  bridge?: number;
  /** The font's em in mm at this size, which tells a dot from a letter. */
  em: number;
};
export type AnchorResult = { contours: Contour[]; marks: number; anchored: number };

const boxOf = (points: Point[]): Box => {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const p of points) { x0 = Math.min(x0, p.x); x1 = Math.max(x1, p.x); y0 = Math.min(y0, p.y); y1 = Math.max(y1, p.y); }
  return { x0, y0, x1, y1 };
};

/** The welded outlines as pieces: each outer outline with the holes inside it. */
function piecesOf(paths: Point[][]): { pieces: Piece[]; sign: number } {
  const sign = Math.sign(paths.reduce((a, p) => (Math.abs(areaD(p)) > Math.abs(a) ? areaD(p) : a), 0)) || 1;
  const pieces: Piece[] = paths.filter(p => Math.sign(areaD(p)) === sign).map(p => {
    const box = boxOf(p);
    return { contours: [p], box, area: Math.abs(areaD(p)), width: box.x1 - box.x0, height: box.y1 - box.y0 };
  });
  for (const hole of paths.filter(p => Math.sign(areaD(p)) !== sign)) {
    const b = boxOf(hole);
    const owner = pieces.filter(o => o.box.x0 <= b.x0 && o.box.x1 >= b.x1 && o.box.y0 <= b.y0 && o.box.y1 >= b.y1 && pointInPolygonD(hole[0], o.contours[0]) !== PointInPolygonResult.IsOutside).sort((a, c) => a.area - c.area)[0];
    owner?.contours.push(hole);
  }
  return { pieces, sign };
}

/** Where the vertical line at `x` crosses the piece, top to bottom. Between
 *  the first and second crossing is material, then a gap, and so on. */
function crossings(piece: Piece, x: number): number[] {
  const ys: number[] = [];
  for (const poly of piece.contours) {
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const a = poly[j], b = poly[i];
      if ((a.x <= x) !== (b.x <= x)) ys.push(a.y + ((x - a.x) * (b.y - a.y)) / (b.x - a.x));
    }
  }
  return ys.sort((p, q) => p - q);
}

type Landing = { gap: number; dx: number; dy: number; thickness: number; x: number; from: number; to: number };

/** The nearest letter straight below or above the mark, sampled across its
 *  middle: how far away it is, and how thick the letter is where it lands. */
function verticalLanding(mark: Piece, targets: Piece[], reach: number): Landing | null {
  let best: Landing | null = null;
  const samples = mark.width < 1e-6 ? [mark.box.x0] : [0.5, 0.35, 0.65, 0.2, 0.8].map(t => mark.box.x0 + t * mark.width);
  for (const x of samples) {
    const own = crossings(mark, x);
    if (own.length < 2) continue;
    const top = own[0], bottom = own[own.length - 1];
    for (const target of targets) {
      if (target.box.x0 > x || target.box.x1 < x || target.box.y0 > bottom + reach || target.box.y1 < top - reach) continue;
      const ys = crossings(target, x);
      for (let i = 0; i + 1 < ys.length; i += 2) {
        const start = ys[i], end = ys[i + 1];
        if (start >= bottom && start - bottom <= reach && (!best || start - bottom < best.gap)) best = { gap: start - bottom, dx: 0, dy: 1, thickness: end - start, x, from: bottom, to: start };
        if (end <= top && top - end <= reach && (!best || top - end < best.gap)) best = { gap: top - end, dx: 0, dy: -1, thickness: end - start, x, from: top, to: end };
      }
    }
  }
  return best;
}

/** The closest point of any letter, in whatever direction, for a mark with
 *  nothing straight above or below it (a hamza standing on the line). */
function nearestLanding(mark: Piece, targets: Piece[], reach: number): Landing | null {
  let best: { d: number; from: Point; to: Point } | null = null;
  const outer = mark.contours[0];
  const step = Math.max(1, Math.floor(outer.length / 48));
  for (const target of targets) {
    if (target.box.x0 > mark.box.x1 + reach || target.box.x1 < mark.box.x0 - reach || target.box.y0 > mark.box.y1 + reach || target.box.y1 < mark.box.y0 - reach) continue;
    const poly = target.contours[0];
    for (let m = 0; m < outer.length; m += step) {
      const p = outer[m];
      for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
        const a = poly[j], b = poly[i], ex = b.x - a.x, ey = b.y - a.y, len = ex * ex + ey * ey;
        const t = len ? Math.max(0, Math.min(1, ((p.x - a.x) * ex + (p.y - a.y) * ey) / len)) : 0;
        const q = { x: a.x + t * ex, y: a.y + t * ey }, d = Math.hypot(q.x - p.x, q.y - p.y);
        if (d <= reach && (!best || d < best.d)) best = { d, from: p, to: q };
      }
    }
  }
  if (!best || best.d < 1e-9) return null;
  return { gap: best.d, dx: (best.to.x - best.from.x) / best.d, dy: (best.to.y - best.from.y) / best.d, thickness: Infinity, x: best.from.x, from: best.from.y, to: best.to.y };
}

const moved = (piece: Piece, dx: number, dy: number): Piece => ({
  ...piece,
  contours: piece.contours.map(c => c.map(p => ({ x: p.x + dx, y: p.y + dy }))),
  box: { x0: piece.box.x0 + dx, y0: piece.box.y0 + dy, x1: piece.box.x1 + dx, y1: piece.box.y1 + dy },
});

/** A four-cornered strip wound like the outer outlines, so welding adds it. */
function strip(points: Point[], sign: number): Point[] {
  return Math.sign(areaD(points)) === sign ? points : [...points].reverse();
}

/** Tells the small separate marks (dots, hamza, vowel marks) from the letters.
 *  Measured on twelve Arabic fonts: a mark is under 0.06 em² and under 0.4 em
 *  tall; the slimmest letter, an alef, is taller than that in every one. */
export function isMark(piece: { area: number; width: number; height: number }, em: number, largest: number) {
  return piece.area <= 0.06 * em * em && piece.height <= 0.4 * em && piece.width <= 0.6 * em && piece.area <= 0.5 * largest;
}

/** Welds the outlines, then puts every mark onto its letter. */
export function anchorMarks(loops: Point[][], o: AnchorOptions, tolerance = 0.01): AnchorResult {
  if (!loops.length) return { contours: [], marks: 0, anchored: 0 };
  if (!(o.em > 0)) throw new Error('Size must be above zero.');
  const merged = unionD(loops.map(l => l.map(p => ({ x: p.x, y: p.y }))), [], FillRule.NonZero, PRECISION);
  if (!merged.length) throw new Error('Could not weld these outlines.');
  const { pieces, sign } = piecesOf(merged);
  const largest = Math.max(...pieces.map(p => p.area));
  const marks = pieces.filter(p => isMark(p, o.em, largest)), bodies = pieces.filter(p => !marks.includes(p));
  if (!marks.length || !bodies.length) return { contours: toContours(merged, tolerance), marks: 0, anchored: 0 };
  const reach = 1.0 * o.em;
  const landing = (mark: Piece, on: Piece[]) => verticalLanding(mark, on, reach) ?? nearestLanding(mark, on, reach);
  // Marks nearest a letter go first, so the top dot of ث lands on the two below it.
  const order = marks.map(mark => ({ mark, first: landing(mark, bodies)?.gap ?? Infinity })).sort((a, b) => a.first - b.first);
  const placed: Piece[] = [...bodies], extra: Point[][] = [];
  let anchored = 0;
  for (const { mark } of order) {
    const land = landing(mark, placed);
    if (!land) { placed.push(mark); continue; }
    anchored++;
    if (o.mode === 'move' || (o.mode === 'auto' && land.gap <= AUTO_MOVE * o.em)) {
      // Sink into the letter by a share of the mark's height, never through a thin stroke.
      const sink = Math.min(o.depth * (land.dx ? Math.min(mark.width, mark.height) : mark.height), 0.6 * land.thickness);
      placed.push(moved(mark, land.dx * (land.gap + sink), land.dy * (land.gap + sink)));
    } else {
      // A bridge from inside the mark to inside the letter, as wide as asked but narrower than the mark.
      const side = Math.min(mark.width, mark.height), asked = o.bridge !== undefined && o.bridge > 0 ? o.bridge : 0.45 * side;
      const half = Math.min(asked, 0.8 * side) / 2;
      const into = Math.min(half * 2, Number.isFinite(land.thickness) ? 0.6 * land.thickness : half * 2);
      const back = Math.min(mark.height, mark.width) * 0.4;
      const ax = land.x - land.dx * back, ay = land.from - land.dy * back, bx = land.x + land.dx * (land.gap + into), by = land.to + land.dy * into;
      const nx = -land.dy * half, ny = land.dx * half;
      extra.push(strip([{ x: ax + nx, y: ay + ny }, { x: bx + nx, y: by + ny }, { x: bx - nx, y: by - ny }, { x: ax - nx, y: ay - ny }], sign));
      placed.push(mark);
    }
  }
  const out = unionD([...placed.flatMap(p => p.contours), ...extra], [], FillRule.NonZero, PRECISION);
  return { contours: toContours(out, tolerance), marks: marks.length, anchored };
}
