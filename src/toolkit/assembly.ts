import type { Contour, Drawing, Point, Shape } from './types';
import type { BoxPart } from './box';
import { bounds, moveShape } from './geometry';
import { roundedPolygon, type PolyBoxOptions } from './polybox';
import type { TrophyOptions } from './generators';

/* How the flat parts of a ready-made product go together, for the 3D view.
   Each piece is one cut part, extruded by its material thickness and placed
   in the world: a point (x, y) of the part lands at origin + x·u + y·v, and
   the thickness runs along n. The world is three.js's: y up, z towards the
   viewer, millimetres. Pieces use the exported outlines, so the 3D view shows
   exactly what will be cut. */

export type Vec = [number, number, number];
export type Piece = { shape: Shape; depth: number; origin: Vec; u: Vec; v: Vec; n: Vec; material?: 'wood' | 'acrylic' };

export const X: Vec = [1, 0, 0], Y: Vec = [0, 1, 0], Z: Vec = [0, 0, 1];
const neg = (a: Vec): Vec => [-a[0], -a[1], -a[2]];
/** Sheet thickness for products whose tool has no thickness setting. */
export const SHEET = 3;

/** The part moved so its top-left corner is (0, 0). */
export function local(shape: Shape): Shape { const b = bounds(shape); return moveShape(shape, -b.x, -b.y); }
const size = (shape: Shape) => bounds(shape);

/** Lying flat, its top face up: the part's x runs along x, its y towards the viewer. `at` is its far-left corner, underside. */
export const flat = (shape: Shape, depth: number, at: Vec, material?: Piece['material']): Piece => ({ shape: local(shape), depth, origin: at, u: X, v: Z, n: Y, material });
/** Standing up and facing the viewer. `top` is its top-left corner on the back face. */
export const front = (shape: Shape, depth: number, top: Vec, material?: Piece['material']): Piece => ({ shape: local(shape), depth, origin: top, u: X, v: neg(Y), n: Z, material });
/** Standing up side-on: the part's x runs away from the viewer when `away` (else towards), thickness along x. */
export const side = (shape: Shape, depth: number, top: Vec, away = false, material?: Piece['material']): Piece => ({ shape: local(shape), depth, origin: top, u: away ? neg(Z) : Z, v: neg(Y), n: X, material });

/** The closed cut contours inside a part's outline: its slots and holes, in part coordinates. */
export function openings(shape: Shape): { x: number; y: number; width: number; height: number }[] {
  const s = local(shape), cut = s.contours.filter(c => c.closed && c.layer !== 'engrave');
  const area = (c: Contour) => { const b = bounds({ id: '', name: '', contours: [c] }); return b.width * b.height; };
  const outer = cut.reduce((a, b) => (area(b) > area(a) ? b : a));
  return cut.filter(c => c !== outer).map(c => bounds({ id: '', name: '', contours: [c] }));
}

/** The box maker's parts, from their slabs (box space: x right, y deep, z up) into the world, centred. */
export function boxPieces(parts: BoxPart[], outside: { width: number; depth: number; height: number }): Piece[] {
  const c = [outside.width / 2, outside.depth / 2, outside.height / 2];
  const world = (v: number[]): Vec => [v[0], v[2], -v[1]];
  return parts.map(part => {
    const s = part.slab, unit = (axis: number, sign = 1) => { const v = [0, 0, 0]; v[axis] = sign; return world(v); };
    const o = [0, 0, 0];
    o[s.u] = s.min[s.u]; o[s.v] = s.flipV ? s.max[s.v] : s.min[s.v]; o[s.normal] = s.min[s.normal];
    return { shape: part.shape, depth: s.max[s.normal] - s.min[s.normal], origin: world([o[0] - c[0], o[1] - c[1], o[2] - c[2]]), u: unit(s.u), v: unit(s.v, s.flipV ? -1 : 1), n: unit(s.normal) };
  });
}

/** One part lying flat, centred: tags, rulers, puzzles. */
export function lyingFlat(drawing: Drawing, depth = SHEET): Piece[] {
  let x = 0;
  const total = drawing.shapes.reduce((sum, s) => sum + size(s).width + 6, -6);
  return drawing.shapes.map(s => { const b = size(s), p = flat(s, depth, [x - total / 2, 0, -b.height / 2]); x += b.width + 6; return p; });
}

export function trophyPieces(d: Drawing, o: TrophyOptions): Piece[] {
  const t = o.thickness, layers = d.shapes.slice(0, o.layers), plate = d.shapes[o.layers];
  // The drawing lists the layers top first.
  const out = layers.map((s, i) => flat(s, t, [-o.width / 2, (o.layers - 1 - i) * t, -o.depth / 2]));
  const bottom = (o.layers - o.slotLayers) * t, p = size(plate);
  out.push(front(plate, o.plateThickness, [-p.width / 2, bottom + p.height, o.slotFromBack - o.depth / 2 - o.plateThickness / 2], 'acrylic'));
  return out;
}

export function polyBoxPieces(d: Drawing, o: PolyBoxOptions): Piece[] {
  const n = o.sides, t = o.thickness, c = o.clearance, aOut = o.width / 2, aIn = aOut - t;
  const byId = (id: string) => d.shapes.find(s => s.id === id);
  // A plate moved back so the polygon's own centre is (0, 0), as it was drawn.
  const centred = (s: Shape, drawn: Point[]) => { const b0 = bounds({ id: '', name: '', contours: [{ closed: true, points: drawn }] }), b = bounds(s); return moveShape(s, b0.x - b.x, b0.y - b.y); };
  const place = (s: Shape, depth: number, y: number): Piece => ({ shape: s, depth, origin: [0, y, 0], u: X, v: Z, n: Y });
  const plate = roundedPolygon(n, aOut + o.rim, o.radius + o.rim);
  const out: Piece[] = [place(centred(byId('base')!, plate), t, 0)];
  // The strip, bent round the base: drawn here as the ring it becomes.
  const wall: Shape = { id: 'wall', name: 'Wall strip', contours: [{ closed: true, points: roundedPolygon(n, aOut, o.radius) }, { closed: true, points: roundedPolygon(n, aIn, o.radius - t).reverse() }] };
  out.push(place(wall, o.height, t));
  const lid = byId('lid'), lip = byId('lip');
  if (lid) out.push(place(centred(lid, plate), t, t + o.height));
  if (lip) out.push(place(centred(lip, roundedPolygon(n, aIn - c, Math.max(0.5, o.radius - t - c))), t, o.height));
  return out;
}
