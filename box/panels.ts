import type { Contour, Point, Shape } from '../types';
import { strokeText, textWidth } from './font';
import { intersect, localCoordinate, Ownership, slabSize, toLocal, toWorld, type CutVolume, type ModelPart } from './model';

export type PartFinish = { kerf: number; dogbone: number; cornerRadius: number; labels: boolean };
export type PartGrid = { xs: number[]; ys: number[]; filled: boolean[][] };
type Rect = { x0: number; x1: number; y0: number; y1: number };

const unique = (values: number[], limit: number) => {
  const sorted = values.map(v => Math.min(limit, Math.max(0, Math.round(v * 1e6) / 1e6))).sort((a, b) => a - b);
  return sorted.filter((v, i) => i === 0 || v - sorted[i - 1] > 1e-6);
};

/** Every coordinate where ownership can change inside the part: slab edges, overlaps, finger steps, cuts. */
export function partGrid(own: Ownership, part: ModelPart): PartGrid {
  const size = slabSize(part.slab), xs = [0, size.width], ys = [0, size.height];
  const addRect = (r: Rect) => { xs.push(r.x0, r.x1); ys.push(r.y0, r.y1); };
  const addAxis = (axis: 0 | 1 | 2, value: number) => { const local = localCoordinate(part.slab, axis, value); if (local) (local.along === 'x' ? xs : ys).push(local.value); };
  for (const other of own.neighbours.get(part.name)!) {
    addRect(toLocal(part.slab, intersect(part.slab, other.slab)!));
    const rule = own.rule(part.name, other.name);
    if (rule.kind === 'fingers') {
      const joint = own.fingerJoint(part.name, other.name);
      for (let k = 0; k <= joint.count; k++) addAxis(joint.axis, joint.start + k * joint.width);
    } else if (rule.kind === 'tenon') {
      const zone = own.tenonZone(part.name, other.name);
      addAxis(zone.axis, zone.from); addAxis(zone.axis, zone.to);
    } else if (rule.kind === 'halflap') addAxis(2, own.halflapMiddle(part.name, other.name));
  }
  // A cut in a neighbour hands its share of a joint to this part, so every box cut adds breakpoints.
  for (const cut of own.model.cuts) if (cut.shape === 'box') { const r = intersect(cut, part.slab); if (r) addRect(toLocal(part.slab, r)); }
  const ux = unique(xs, size.width), uy = unique(ys, size.height);
  const filled = uy.slice(1).map((y1, j) => ux.slice(1).map((x1, i) => own.ownerAt(toWorld(part.slab, (ux[i] + x1) / 2, (uy[j] + y1) / 2), part.name) === part.name));
  return { xs: ux, ys: uy, filled };
}

/**
 * Traces filled cells into loops with material on the right of travel (screen
 * coordinates, y down): outer loops have positive signed area, holes negative.
 */
export function traceGrid({ xs, ys, filled }: PartGrid): Point[][] {
  const nx = xs.length - 1, ny = ys.length - 1, W = nx + 1;
  const outgoing = new Map<number, number[]>();
  const edges: { from: number; to: number; dx: number; dy: number; used: boolean }[] = [];
  const add = (i0: number, j0: number, i1: number, j1: number) => {
    const edge = { from: j0 * W + i0, to: j1 * W + i1, dx: i1 - i0, dy: j1 - j0, used: false };
    edges.push(edge);
    const list = outgoing.get(edge.from); if (list) list.push(edges.length - 1); else outgoing.set(edge.from, [edges.length - 1]);
  };
  const at = (i: number, j: number) => i >= 0 && j >= 0 && i < nx && j < ny && filled[j][i];
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    if (!filled[j][i]) continue;
    if (!at(i, j - 1)) add(i, j, i + 1, j);
    if (!at(i + 1, j)) add(i + 1, j, i + 1, j + 1);
    if (!at(i, j + 1)) add(i + 1, j + 1, i, j + 1);
    if (!at(i - 1, j)) add(i, j + 1, i, j);
  }
  const loops: Point[][] = [];
  for (const first of edges) {
    if (first.used) continue;
    const vertices: number[] = [];
    let edge = first;
    for (;;) {
      edge.used = true; vertices.push(edge.from);
      if (edge.to === first.from) break;
      const options = (outgoing.get(edge.to) || []).map(index => edges[index]).filter(e => !e.used);
      // Prefer turning right (towards the material) so diagonal-only contacts stay separate loops.
      const score = (e: typeof edge) => { const cross = edge.dx * e.dy - edge.dy * e.dx; return cross > 0 ? 0 : cross === 0 ? 1 : 2; };
      options.sort((a, b) => score(a) - score(b));
      if (!options.length) throw new Error('Box outline tracing failed.');
      edge = options[0];
    }
    const points = vertices.map(v => ({ i: v % W, j: Math.floor(v / W) }));
    const kept = points.filter((p, k) => {
      const a = points[(k + points.length - 1) % points.length], b = points[(k + 1) % points.length];
      return !((a.i === p.i && p.i === b.i) || (a.j === p.j && p.j === b.j));
    });
    loops.push(kept.map(p => ({ x: xs[p.i], y: ys[p.j] })));
  }
  return loops;
}

export function loopArea(points: Point[]) { let sum = 0; for (let i = 0; i < points.length; i++) { const a = points[i], b = points[(i + 1) % points.length]; sum += a.x * b.y - b.x * a.y; } return sum / 2; }

/** Moves every edge of a rectilinear loop away from the material by `distance`. */
function offset(points: Point[], distance: number): Point[] {
  if (!distance) return points;
  const normal = (p: Point, q: Point) => { const length = Math.hypot(q.x - p.x, q.y - p.y); return { x: (q.y - p.y) / length, y: -(q.x - p.x) / length }; };
  return points.map((p, i) => {
    const a = normal(points[(i + points.length - 1) % points.length], p), b = normal(p, points[(i + 1) % points.length]);
    return { x: p.x + distance * (a.x + b.x), y: p.y + distance * (a.y + b.y) };
  });
}
const arcStep = (radius: number) => Math.max(Math.PI / 32, 2 * Math.acos(Math.max(-1, 1 - 0.05 / radius)));

/** Rounds a convex corner vertex with a tangent arc. */
function fillet(points: Point[], index: number, radius: number): Point[] {
  const n = points.length, prev = points[(index + n - 1) % n], v = points[index], next = points[(index + 1) % n];
  const din = unit(prev, v), dout = unit(v, next);
  const r = Math.min(radius, Math.hypot(v.x - prev.x, v.y - prev.y) / 2, Math.hypot(next.x - v.x, next.y - v.y) / 2);
  if (r <= 0) return points;
  const centre = { x: v.x - r * din.x + r * dout.x, y: v.y - r * din.y + r * dout.y };
  const start = Math.atan2(-dout.y, -dout.x), sweep = Math.atan2(din.y, din.x) - start;
  const turn = ((sweep + 3 * Math.PI) % (2 * Math.PI)) - Math.PI;
  const steps = Math.max(2, Math.ceil(Math.abs(turn) / arcStep(r)));
  const arc = Array.from({ length: steps + 1 }, (_, k) => { const angle = start + turn * k / steps; return { x: centre.x + r * Math.cos(angle), y: centre.y + r * Math.sin(angle) }; });
  return [...points.slice(0, index), ...arc, ...points.slice(index + 1)];
}
function unit(a: Point, b: Point) { const l = Math.hypot(b.x - a.x, b.y - a.y); return { x: (b.x - a.x) / l, y: (b.y - a.y) / l }; }

/** Adds a router relief circle through every concave right-angle corner (material on the right). */
function dogbones(points: Point[], radius: number): Point[] {
  if (!radius) return points;
  const result: Point[] = [];
  for (let i = 0; i < points.length; i++) {
    const prev = points[(i + points.length - 1) % points.length], v = points[i], next = points[(i + 1) % points.length];
    result.push(v);
    const din = unit(prev, v), dout = unit(v, next);
    if (Math.abs(din.x * dout.x + din.y * dout.y) > 1e-9 || din.x * dout.y - din.y * dout.x >= 0) continue;
    const s = Math.SQRT1_2, centre = { x: v.x + radius * s * (din.x - dout.x), y: v.y + radius * s * (din.y - dout.y) };
    const start = Math.atan2(v.y - centre.y, v.x - centre.x), tangent = { x: -s * (din.x + dout.x), y: -s * (din.y + dout.y) };
    const direction = Math.sign(-Math.sin(start) * tangent.x + Math.cos(start) * tangent.y) || 1;
    const steps = Math.max(8, Math.ceil(2 * Math.PI / arcStep(radius)));
    for (let k = 1; k < steps; k++) { const angle = start + direction * 2 * Math.PI * k / steps; result.push({ x: centre.x + radius * Math.cos(angle), y: centre.y + radius * Math.sin(angle) }); }
    result.push({ ...v });
  }
  return result;
}

function roundHole(cut: CutVolume, part: ModelPart, kerf: number): { loop: Point[]; rect: Rect } | null {
  const range = intersect(cut, part.slab);
  if (!range || cut.max[part.slab.normal] - cut.min[part.slab.normal] < part.slab.max[part.slab.normal] - part.slab.min[part.slab.normal] - 1e-9) return null;
  const rect = toLocal(part.slab, { min: cut.min, max: cut.max });
  const w = rect.x1 - rect.x0, h = rect.y1 - rect.y0, cx = (rect.x0 + rect.x1) / 2, cy = (rect.y0 + rect.y1) / 2;
  const r = Math.min(w, h) / 2 - kerf / 2, straight = cut.shape === 'circle' ? 0 : Math.abs(w - h) / 2, horizontal = w >= h;
  if (r <= 0) return null;
  // Even step count keeps the extreme points (0°, 90°) on the outline, so hole sizes are exact.
  const steps = 2 * Math.max(6, Math.ceil(Math.PI / arcStep(r) / 2));
  // Two half circles joined by straight runs (a circle when they coincide).
  const caps = horizontal
    ? [{ x: cx + straight, y: cy, from: -Math.PI / 2 }, { x: cx - straight, y: cy, from: Math.PI / 2 }]
    : [{ x: cx, y: cy + straight, from: 0 }, { x: cx, y: cy - straight, from: Math.PI }];
  const loop = caps.flatMap(cap => Array.from({ length: steps + 1 }, (_, k) => { const a = cap.from + Math.PI * k / steps; return { x: cap.x + r * Math.cos(a), y: cap.y + r * Math.sin(a) }; }))
    .filter((p, i, all) => { const q = all[(i + all.length - 1) % all.length]; return Math.hypot(p.x - q.x, p.y - q.y) > 1e-9; });
  // Holes run with material on the right: negative signed area.
  if (loopArea(loop) > 0) loop.reverse();
  return { loop, rect };
}

/** Full-detail 2D shape of one part: outline, holes, reliefs, rounding and label. */
export function partShape(own: Ownership, part: ModelPart, finish: PartFinish): { shape: Shape; labelled: boolean } {
  const grid = partGrid(own, part), loops = traceGrid(grid);
  const outers = loops.filter(l => loopArea(l) > 0), holes = loops.filter(l => loopArea(l) < 0);
  if (outers.length !== 1) throw new Error(`${part.label} would ${outers.length ? `fall apart into ${outers.length} pieces` : 'have no material'}. Change the size, finger width or extras.`);
  const size = slabSize(part.slab), k = finish.kerf / 2;
  let outer = offset(outers[0], k);
  if (finish.cornerRadius > 0) {
    // Only corners whose two sides touch no other part (lids, fronts) can be rounded.
    const touches = own.neighbours.get(part.name)!.map(o => toLocal(part.slab, intersect(part.slab, o.slab)!));
    for (const cut of own.model.cuts) if (cut.shape === 'box' && cut.parts.includes(part.name)) { const r = intersect(cut, part.slab); if (r) touches.push(toLocal(part.slab, r)); }
    const free = { top: !touches.some(r => r.y0 < 1e-6), bottom: !touches.some(r => r.y1 > size.height - 1e-6), left: !touches.some(r => r.x0 < 1e-6), right: !touches.some(r => r.x1 > size.width - 1e-6) };
    const corners = [
      { x: -k, y: -k, ok: free.top && free.left }, { x: size.width + k, y: -k, ok: free.top && free.right },
      { x: size.width + k, y: size.height + k, ok: free.bottom && free.right }, { x: -k, y: size.height + k, ok: free.bottom && free.left },
    ];
    for (const corner of corners) {
      if (!corner.ok) continue;
      const index = outer.findIndex(p => Math.abs(p.x - corner.x) < 1e-6 && Math.abs(p.y - corner.y) < 1e-6);
      if (index >= 0) outer = fillet(outer, index, Math.min(finish.cornerRadius, size.width / 2, size.height / 2));
    }
  }
  const contours: Contour[] = [{ closed: true, points: dogbones(outer, finish.dogbone) }, ...holes.map(h => ({ closed: true, points: dogbones(offset(h, k), finish.dogbone) }))];
  const cellFilled = (r: Rect) => {
    for (let j = 0; j < grid.ys.length - 1; j++) for (let i = 0; i < grid.xs.length - 1; i++) {
      if (grid.xs[i + 1] <= r.x0 || grid.xs[i] >= r.x1 || grid.ys[j + 1] <= r.y0 || grid.ys[j] >= r.y1) continue;
      if (!grid.filled[j][i]) return false;
    }
    return r.x0 >= 0 && r.y0 >= 0 && r.x1 <= size.width && r.y1 <= size.height;
  };
  const roundRects: Rect[] = [];
  for (const cut of own.model.cuts) {
    if (cut.shape === 'box' || !cut.parts.includes(part.name)) continue;
    const hole = roundHole(cut, part, finish.kerf);
    if (!hole) continue;
    const margin = { x0: hole.rect.x0 - 1, x1: hole.rect.x1 + 1, y0: hole.rect.y0 - 1, y1: hole.rect.y1 + 1 };
    if (!cellFilled(margin)) throw new Error(`${cut.name} does not fit on ${part.label}. Make it smaller or move it away from edges and joints.`);
    roundRects.push(margin);
    contours.push({ closed: true, points: hole.loop });
  }
  let labelled = false;
  if (finish.labels) {
    const t = own.model.thickness;
    for (let height = Math.min(10, Math.max(3, Math.min(size.width, size.height) * 0.12)); height >= 3 && !labelled; height -= 1) {
      const width = textWidth(part.label, height);
      for (const fraction of [0.5, 0.3, 0.7]) {
        const x0 = (size.width - width) / 2, y0 = size.height * fraction - height / 2;
        const box = { x0: x0 - 1, x1: x0 + width + 1, y0: y0 - 1, y1: y0 + height + 1 };
        const clear = box.x0 >= t && box.y0 >= t && box.x1 <= size.width - t && box.y1 <= size.height - t && cellFilled(box)
          && roundRects.every(r => r.x1 <= box.x0 || r.x0 >= box.x1 || r.y1 <= box.y0 || r.y0 >= box.y1);
        if (!clear) continue;
        for (const stroke of strokeText(part.label, height, x0, y0)) contours.push({ closed: false, layer: 'engrave', points: stroke });
        labelled = true; break;
      }
    }
  }
  return { shape: { id: `box-${part.name.toLowerCase().replace(/\s+/g, '-')}`, name: part.name, contours }, labelled };
}
