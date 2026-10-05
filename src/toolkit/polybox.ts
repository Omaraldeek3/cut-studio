import type { Contour, Drawing, Point, Shape } from './types';
import { arcSegments } from './generators';
import { bounds, moveShape } from './geometry';

/* A polygon box (hexagon, octagon, any 5 to 12 sides) from flat sheet. Its
   wall is one strip that wraps round the base: straight between the corners,
   cut with a living hinge across each rounded corner so it bends there, and
   locked where its two ends meet by dovetails. Tabs along the strip's bottom
   go through slots in the base. A lift-off lid has a lip ring glued under it
   that sits just inside the wall. Sizes in mm; the wall is described by its
   outside face. */

export type PolyBoxOptions = {
  sides: number;
  /** Outside of the wall, measured across two opposite flat sides. */
  width: number;
  height: number; thickness: number;
  /** Outside radius of the wall's rounded corners; the hinge bends there. */
  radius: number;
  /** How far the base and lid reach past the wall. */
  rim: number;
  /** Living hinge: distance between slit lines. */
  slitSpacing: number;
  clearance: number;
  lid: boolean;
};
export const defaultPolyBox: PolyBoxOptions = { sides: 6, width: 160, height: 80, thickness: 3, radius: 12, rim: 4, slitSpacing: 1.5, clearance: 0.2, lid: true };

const TAU = Math.PI * 2;
function check(value: number, min: number, max: number, name: string) {
  if (!Number.isFinite(value) || value < min || value > max) throw new Error(`${name} must be between ${min} and ${max}.`);
}

/** A regular polygon with rounded corners: sides at `apothem` from the centre, corners of `radius`, first side on top. */
export function roundedPolygon(sides: number, apothem: number, radius: number, cx = 0, cy = 0): Point[] {
  const half = Math.PI / sides, out: Point[] = [];
  for (let k = 0; k < sides; k++) {
    // Corner k sits between side k (normal at angle -90° + k·360°/n) and side k+1.
    const corner = -Math.PI / 2 + (2 * k + 1) * half, centre = (apothem - radius) / Math.cos(half);
    const ox = cx + centre * Math.cos(corner), oy = cy + centre * Math.sin(corner);
    const from = corner - half, n = Math.max(2, Math.ceil(arcSegments(Math.max(radius, 0.01), 2 * half)));
    for (let i = 0; i <= n; i++) { const a = from + (2 * half * i) / n; out.push({ x: ox + radius * Math.cos(a), y: oy + radius * Math.sin(a) }); }
  }
  return out;
}

export type PolyBoxResult = Drawing & { stripLength: number; side: number; bend: number };

export function polyBoxDrawing(o: PolyBoxOptions): PolyBoxResult {
  if (!Number.isInteger(o.sides) || o.sides < 5 || o.sides > 12) throw new Error('Use 5 to 12 sides.');
  check(o.thickness, 1, 12, 'Material thickness'); check(o.width, 40, 1000, 'Width'); check(o.height, 15, 600, 'Height');
  check(o.radius, 2 * o.thickness, o.width / 4, 'Corner radius'); check(o.rim, 0, 30, 'Rim'); check(o.slitSpacing, 0.6, 5, 'Line spacing'); check(o.clearance, 0, 1, 'Clearance');
  const n = o.sides, t = o.thickness, c = o.clearance, tan = Math.tan(Math.PI / n);
  const aOut = o.width / 2, aMid = aOut - t / 2, aIn = aOut - t, rMid = o.radius - t / 2;
  // Every offset of the outline has the same straight sides; the corners grow with it.
  const side = 2 * (aOut - o.radius) * tan;
  if (side < 4 * t) throw new Error('The corners are too round for this size: lower the corner radius or widen the box.');
  const bend = (TAU / n) * rMid, length = n * side + TAU * rMid;
  const shapes: Shape[] = [];

  // Base: the outline past the wall by the rim, with a slot under each tab.
  const tab = Math.min(side * 0.5, 40), base: Contour[] = [{ closed: true, points: roundedPolygon(n, aOut + o.rim, o.radius + o.rim) }];
  for (let k = 1; k < n; k++) {
    // Side k's middle, on the wall's mid-plane; the slot runs along the side, across the wall.
    const a = -Math.PI / 2 + (k * TAU) / n, ux = Math.cos(a), uy = Math.sin(a), vx = -uy, vy = ux;
    const cx = aMid * ux, cy = aMid * uy, hl = (tab + c) / 2, hw = (t + c) / 2;
    base.push({ closed: true, points: [[-hl, -hw], [hl, -hw], [hl, hw], [-hl, hw]].map(([s, d]) => ({ x: cx + s * vx + d * ux, y: cy + s * vy + d * uy })) });
  }
  const plates: Shape[] = [{ id: 'base', name: 'Base', contours: base }];
  if (o.lid) {
    plates.push({ id: 'lid', name: 'Lid', contours: [{ closed: true, points: roundedPolygon(n, aOut + o.rim, o.radius + o.rim) }] });
    // The lip ring sits just inside the wall, under the lid.
    const lipOut = aIn - c, ring = 8;
    if (lipOut - ring < 5) throw new Error('The box is too small for a lid lip. Widen it.');
    plates.push({ id: 'lip', name: 'Lid lip', contours: [{ closed: true, points: roundedPolygon(n, lipOut, Math.max(0.5, o.radius - t - c)) }, { closed: true, points: roundedPolygon(n, lipOut - ring, Math.max(0.5, o.radius - t - c - ring)).reverse() }] });
  }
  // Side by side, 6 mm apart, by their real extent: across the corners is wider than across the flats.
  let x = 0, platesHeight = 0;
  for (const p of plates) { const b = bounds(p); shapes.push(moveShape(p, x - b.x, -b.y)); x += b.width + 6; platesHeight = Math.max(platesHeight, b.height); }

  // The wall strip, laid flat: the seam is at the middle of side 0, the other sides follow in order.
  const H = o.height, y0 = platesHeight + 10, d = Math.min(10, side / 4), w1 = H / 6, w2 = w1 * 1.4;
  const outline: Point[] = [{ x: 0, y: 0 }, { x: length, y: 0 }];
  // Dovetail tails on the far end, into sockets cut in the near end.
  for (const centre of [H / 4, (3 * H) / 4]) outline.push({ x: length, y: centre - w1 / 2 }, { x: length + d, y: centre - w2 / 2 }, { x: length + d, y: centre + w2 / 2 }, { x: length, y: centre + w1 / 2 });
  outline.push({ x: length, y: H });
  // Tabs along the bottom, at the middle of every full side, walking back.
  const sideStart = (k: number) => side / 2 + bend + (k - 1) * (side + bend);
  for (let k = n - 1; k >= 1; k--) { const mid = sideStart(k) + side / 2; outline.push({ x: mid + tab / 2, y: H }, { x: mid + tab / 2, y: H + t }, { x: mid - tab / 2, y: H + t }, { x: mid - tab / 2, y: H }); }
  outline.push({ x: 0, y: H });
  for (const centre of [(3 * H) / 4, H / 4]) outline.push({ x: 0, y: centre + w1 / 2 }, { x: d, y: centre + w2 / 2 }, { x: d, y: centre - w2 / 2 }, { x: 0, y: centre - w1 / 2 });
  const strip: Contour[] = [{ closed: true, points: outline }];
  // A living hinge across each corner: staggered slits, a little wider than the bend.
  const margin = 3, slit = Math.max(4, (H - 2 * margin) / 3), gap = 3, period = slit + gap;
  for (let k = 0; k < n; k++) {
    const from = side / 2 + k * (side + bend) - 1, to = from + bend + 2;
    for (let x = from, col = 0; x <= to; x += o.slitSpacing, col++) {
      for (let y = margin - (col % 2) * (period / 2); y < H - margin; y += period) {
        const a = Math.max(margin, y), b = Math.min(H - margin, y + slit);
        if (b - a >= gap) strip.push({ closed: false, points: [{ x, y: a }, { x, y: b }] });
      }
    }
  }
  shapes.push(moveShape({ id: 'wall', name: 'Wall strip', contours: strip }, 0, y0));
  return { width: Math.max(length + d, x - 6), height: y0 + H + t, shapes, stripLength: length, side, bend };
}
