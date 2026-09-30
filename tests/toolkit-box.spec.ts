import { test, expect } from '@playwright/test';
import { buildBox, defaultBoxOptions, type BoxOptions, type BoxPart } from '../src/toolkit/box';
import { strokeText, textWidth } from '../src/toolkit/box/font';
import { contains, Ownership, type Vec3 } from '../src/toolkit/box/model';
import { partGrid } from '../src/toolkit/box/panels';
import { buildModel } from '../src/toolkit/box/types';
import { bounds, signedArea } from '../src/toolkit/geometry';
import { toDxf, toSvg } from '../src/toolkit/export';
import type { Point, Shape } from '../src/toolkit/types';

const plain: BoxOptions = { ...defaultBoxOptions, labels: false, pull: 'none' };
const types = ['closed', 'open', 'liftoff', 'sliding', 'drawer'] as const;

function inside(points: Point[], x: number, y: number) {
  let yes = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const a = points[i], b = points[j];
    if ((a.y > y) !== (b.y > y) && x < (b.x - a.x) * (y - a.y) / (b.y - a.y) + a.x) yes = !yes;
  }
  return yes;
}
/** Material test on a traced part: inside the outline, outside every hole. */
function material(shape: Shape, x: number, y: number) {
  return shape.contours.filter(c => c.closed && c.layer !== 'engrave').reduce((hit, c) => hit !== inside(c.points, x, y), false);
}
function local(part: BoxPart, p: Vec3) {
  const s = part.slab;
  return { x: p[s.u] - s.min[s.u], y: s.flipV ? s.max[s.v] - p[s.v] : p[s.v] - s.min[s.v] };
}
const part = (result: { parts: BoxPart[] }, name: string) => result.parts.find(p => p.name === name)!;

test('closed box keeps v1 dimensions: six rectilinear single-outline panels', () => {
  const box = buildBox(plain);
  expect(box.parts.map(p => p.name)).toEqual(['Bottom', 'Top', 'Front', 'Back', 'Left', 'Right']);
  const size = (name: string) => { const b = bounds(part(box, name).shape); return [b.width, b.height]; };
  expect(size('Bottom')).toEqual([120, 80]); expect(size('Front')).toEqual([120, 60]); expect(size('Left')).toEqual([80, 60]);
  for (const { shape } of box.parts) {
    expect(shape.contours).toHaveLength(1);
    const points = shape.contours[0].points;
    for (let i = 0; i < points.length; i++) { const a = points[i], b = points[(i + 1) % points.length]; expect(a.x === b.x || a.y === b.y).toBe(true); }
  }
  expect(Object.values(box.counts).every(n => n >= 3 && n % 2 === 1)).toBe(true);
  expect(buildBox({ ...plain, sizing: 'inside' }).outside).toEqual({ width: 126, depth: 86, height: 66 });
});

const allFlat = { corners: true, bottom: true, top: true };
for (const type of types) for (const dividers of [{ rows: 0, columns: 0 }, { rows: 2, columns: 1 }, { rows: 2, columns: 1, flat: allFlat }]) {
  test(`${type} box with ${dividers.rows}x${dividers.columns} dividers${'flat' in dividers ? ' and flat edges' : ''}: every point of material belongs to exactly one part`, () => {
    const options = { ...plain, type, ...dividers, width: 150, depth: 110, height: 90 };
    const box = buildBox(options), { model } = buildModel(options), own = new Ownership(model);
    let checked = 0;
    for (const modelPart of model.parts) {
      const grid = partGrid(own, modelPart), s = modelPart.slab;
      for (let j = 0; j < grid.ys.length - 1; j++) for (let i = 0; i < grid.xs.length - 1; i++) {
        const x = (grid.xs[i] + grid.xs[i + 1]) / 2, y = (grid.ys[j] + grid.ys[j + 1]) / 2;
        const p: Vec3 = [0, 0, 0];
        p[s.u] = s.min[s.u] + x; p[s.v] = s.flipV ? s.max[s.v] - y : s.min[s.v] + y; p[s.normal] = (s.min[s.normal] + s.max[s.normal]) / 2;
        const holders = box.parts.filter(q => contains(q.slab, p) && material(q.shape, local(q, p).x, local(q, p).y)).map(q => q.name);
        const owner = own.ownerAt(p);
        expect(holders, `${modelPart.name} at ${p.map(v => v.toFixed(2))}`).toEqual(owner ? [owner] : []);
        checked++;
      }
    }
    expect(checked).toBeGreaterThan('flat' in dividers ? 50 : 500);
    for (const { shape } of box.parts) expect(shape.contours.filter(c => c.closed && signedArea(c.points) > 0)).toHaveLength(1);
  });
}

test('flat edge groups become butt joints while other edges keep fingers', () => {
  const t = 3, rectangle = (shape: Shape) => shape.contours[0].points.length === 4;
  const flatBottom = buildBox({ ...plain, flat: { corners: false, bottom: true, top: false } });
  expect(bounds(part(flatBottom, 'Bottom').shape)).toMatchObject({ width: 120 - 2 * t, height: 80 - 2 * t });
  expect(rectangle(part(flatBottom, 'Bottom').shape)).toBe(true);
  expect(rectangle(part(flatBottom, 'Top').shape)).toBe(false);
  expect(bounds(part(flatBottom, 'Front').shape)).toMatchObject({ width: 120, height: 60 });
  const flatCorners = buildBox({ ...plain, flat: { corners: true, bottom: false, top: false } });
  expect(bounds(part(flatCorners, 'Left').shape).width).toBeCloseTo(80 - 2 * t);
  expect(bounds(part(flatCorners, 'Front').shape).width).toBeCloseTo(120);
  expect(rectangle(part(flatCorners, 'Left').shape)).toBe(false);
  const glued = buildBox({ ...plain, flat: { corners: true, bottom: true, top: true } });
  for (const { name, shape } of glued.parts) expect(rectangle(shape), name).toBe(true);
  expect(bounds(part(glued, 'Top').shape)).toMatchObject({ width: 120 - 2 * t, height: 80 - 2 * t });
  expect(bounds(part(glued, 'Left').shape)).toMatchObject({ width: 80 - 2 * t, height: 60 });
  // Sliding lid side walls keep the back corner so the strip above the slot stays attached.
  const sliding = buildBox({ ...plain, type: 'sliding', flat: { corners: true, bottom: true, top: true } });
  expect(bounds(part(sliding, 'Left').shape).width).toBeCloseTo(80);
  expect(bounds(part(sliding, 'Back').shape).width).toBeCloseTo(120 - 2 * t);
  expect(material(part(sliding, 'Left').shape, 78.5, t / 2)).toBe(true);
  const drawer = buildBox({ ...plain, type: 'drawer', flat: { corners: true, bottom: true, top: true } });
  for (const name of ['Sleeve top', 'Sleeve bottom', 'Drawer bottom']) expect(rectangle(part(drawer, name).shape), name).toBe(true);
});

test('box types produce their parts and fit together with clearance', () => {
  const names = (type: BoxOptions['type']) => buildBox({ ...plain, type }).parts.map(p => p.name);
  expect(names('open')).toEqual(['Bottom', 'Front', 'Back', 'Left', 'Right']);
  expect(names('liftoff')).toEqual(['Bottom', 'Front', 'Back', 'Left', 'Right', 'Lid', 'Lid locator']);
  expect(names('sliding')).toEqual(['Bottom', 'Front', 'Back', 'Left', 'Right', 'Lid']);
  expect(names('drawer')).toEqual(['Sleeve bottom', 'Sleeve top', 'Sleeve back', 'Sleeve left', 'Sleeve right', 'Drawer face', 'Drawer bottom', 'Drawer front', 'Drawer back', 'Drawer left', 'Drawer right']);
  const t = 3, c = 0.3;
  const sliding = buildBox({ ...plain, type: 'sliding' });
  const left = part(sliding, 'Left').shape;
  // Slot open at the front, top strip kept above it.
  expect(material(left, 40, 1.5 * t)).toBe(false);
  expect(material(left, 1, 1.5 * t)).toBe(false);
  expect(material(left, 40, t / 2)).toBe(true);
  expect(bounds(part(sliding, 'Lid').shape)).toMatchObject({ width: 120, height: 80 - t });
  expect(bounds(part(sliding, 'Front').shape).height).toBeCloseTo(60 - 2 * t - c);
  const lift = buildBox({ ...plain, type: 'liftoff' });
  expect(bounds(part(lift, 'Lid locator').shape)).toMatchObject({ width: expect.closeTo(120 - 2 * t - 2 * c, 6), height: expect.closeTo(80 - 2 * t - 2 * c, 6) });
  expect(bounds(part(lift, 'Front').shape).height).toBeCloseTo(60 - t);
  const drawer = buildBox({ ...plain, type: 'drawer' });
  expect(bounds(part(drawer, 'Drawer bottom').shape)).toMatchObject({ width: expect.closeTo(120 - 2 * t - 2 * c, 6), height: expect.closeTo(80 - 2 * t - c, 6) });
  expect(bounds(part(drawer, 'Drawer front').shape).height).toBeCloseTo(60 - 2 * t - c);
  expect(drawer.inside).toEqual({ width: expect.closeTo(120 - 4 * t - 2 * c, 6), depth: expect.closeTo(80 - 4 * t - c, 6), height: expect.closeTo(60 - 3 * t - c, 6) });
});

test('dividers lock into walls with mortises and cross with half laps', () => {
  const box = buildBox({ ...plain, type: 'open', rows: 2, columns: 3, width: 160, depth: 120 });
  expect(box.parts.filter(p => p.name.startsWith('Divider')).map(p => p.name)).toEqual(['Divider X1', 'Divider X2', 'Divider Y1', 'Divider Y2', 'Divider Y3']);
  expect(part(box, 'Left').shape.contours).toHaveLength(3);
  expect(part(box, 'Front').shape.contours).toHaveLength(4);
  const x1 = bounds(part(box, 'Divider X1').shape);
  expect(x1.width).toBeCloseTo(160); expect(x1.height).toBeCloseTo(60 - 3);
  expect(() => buildBox({ ...plain, rows: 20, depth: 60 })).toThrow(/Too many divider rows/);
  const sliding = buildBox({ ...plain, type: 'sliding', rows: 1 });
  expect(bounds(part(sliding, 'Divider X1').shape).height).toBeCloseTo(60 - 3 * 3 - 0.3);
});

test('kerf compensation grows every outline by half the kerf per side', () => {
  const loose = buildBox(plain), tight = buildBox({ ...plain, kerf: 0.2 });
  for (let i = 0; i < loose.parts.length; i++) {
    const a = bounds(loose.parts[i].shape), b = bounds(tight.parts[i].shape);
    expect(b.width).toBeCloseTo(a.width + 0.2); expect(b.height).toBeCloseTo(a.height + 0.2);
  }
  expect(() => buildBox({ ...plain, kerf: 0.5, finger: 1 })).toThrow(/kerf/i);
});

test('layout keeps spacing and invalid boxes explain the limit', () => {
  const box = buildBox({ ...plain, type: 'drawer', rows: 1 });
  const boxes = box.drawing.shapes.map(bounds);
  for (const b of boxes) { expect(b.x).toBeGreaterThanOrEqual(-1e-9); expect(b.y).toBeGreaterThanOrEqual(-1e-9); expect(b.x + b.width).toBeLessThanOrEqual(box.drawing.width + 1e-9); expect(b.y + b.height).toBeLessThanOrEqual(box.drawing.height + 1e-9); }
  for (let i = 0; i < boxes.length; i++) for (let j = 0; j < i; j++) {
    const a = boxes[i], b = boxes[j];
    expect(a.x + a.width + 5 <= b.x + 1e-9 || b.x + b.width + 5 <= a.x + 1e-9 || a.y + a.height + 5 <= b.y + 1e-9 || b.y + b.height + 5 <= a.y + 1e-9).toBe(true);
  }
  expect(() => buildBox({ ...plain, height: 15, thickness: 6 })).toThrow(/too small/i);
  expect(() => buildBox({ ...plain, thickness: 0 })).toThrow(/thickness/i);
  expect(() => buildBox({ ...plain, finger: NaN })).toThrow(/finger/i);
  expect(() => buildBox({ ...plain, rows: 1.5 })).toThrow(/whole number/);
});

test('labels engrave single-stroke text inside each part, clear of holes', () => {
  expect(textWidth('FRONT', 6)).toBeCloseTo(28);
  const strokes = strokeText('AB1', 6, 10, 20);
  for (const stroke of strokes) for (const p of stroke) { expect(p.y).toBeGreaterThanOrEqual(20); expect(p.y).toBeLessThanOrEqual(26); expect(p.x).toBeGreaterThanOrEqual(10); }
  const box = buildBox({ ...defaultBoxOptions, type: 'liftoff', pull: 'thumb', handHoles: { ...defaultBoxOptions.handHoles, enabled: true } });
  expect(box.unlabelled).toEqual([]);
  for (const p of box.parts) {
    const engrave = p.shape.contours.filter(c => c.layer === 'engrave');
    expect(engrave.length, p.name).toBeGreaterThan(0);
    for (const c of engrave) { expect(c.closed).toBe(false); for (const point of c.points) expect(material(p.shape, point.x, point.y), p.name).toBe(true); }
  }
  expect(() => strokeText('É', 5)).toThrow(/glyph/);
});

test('hand holes, pulls, rounded free corners and dogbones', () => {
  const holes = buildBox({ ...plain, handHoles: { enabled: true, width: 50, height: 18, fromTop: 12 } });
  const left = part(holes, 'Left').shape;
  expect(left.contours).toHaveLength(2);
  const hole = bounds({ ...left, contours: [left.contours[1]] });
  expect(hole.width).toBeCloseTo(50, 1); expect(hole.height).toBeCloseTo(18, 1); expect(hole.x).toBeCloseTo(15, 1); expect(hole.y).toBeCloseTo(12, 1);
  expect(() => buildBox({ ...plain, handHoles: { enabled: true, width: 50, height: 60, fromTop: 2 } })).toThrow(/Hand hole does not fit/);
  const lift = buildBox({ ...plain, type: 'liftoff', pull: 'thumb', pullSize: 20, cornerRadius: 8 });
  for (const name of ['Lid', 'Lid locator']) {
    const shape = part(lift, name).shape;
    expect(shape.contours).toHaveLength(2);
    const b = bounds({ ...shape, contours: [shape.contours[1]] });
    expect(b.width).toBeCloseTo(20, 1); expect(b.height).toBeCloseTo(20, 1);
  }
  const lid = part(lift, 'Lid').shape.contours[0].points;
  // Arcs are flattened within 0.05 mm, so the area sits just under the exact fillet area.
  expect(Math.abs(Math.abs(signedArea(lid)) - (120 * 80 - 4 * (64 - Math.PI * 16)))).toBeLessThan(3);
  expect(lid.some(p => p.x === 0 && p.y === 0)).toBe(false);
  const front = part(lift, 'Front').shape.contours[0].points, frontPlain = part(buildBox({ ...plain, type: 'liftoff' }), 'Front').shape.contours[0].points;
  expect(front).toEqual(frontPlain);
  const bottom = part(buildBox(plain), 'Bottom').shape.contours[0].points;
  const bone = part(buildBox({ ...plain, dogbone: 1.5 }), 'Bottom').shape.contours[0].points;
  expect(bone.length).toBeGreaterThan(bottom.length * 3);
  for (const p of bottom) expect(bone.some(q => Math.abs(q.x - p.x) < 1e-9 && Math.abs(q.y - p.y) < 1e-9)).toBe(true);
  expect(Math.abs(signedArea(bone))).toBeLessThan(Math.abs(signedArea(bottom)));
});

test('SVG and DXF exports put engraving on its own layer', () => {
  const drawing = buildBox({ ...defaultBoxOptions, pull: 'none' }).drawing;
  const svg = toSvg(drawing), dxf = toDxf(drawing);
  expect(svg).toContain('stroke="#0000ff"'); expect(svg).toContain('stroke="#ff0000"');
  expect(dxf).toMatch(/POLYLINE\n8\nENGRAVE/); expect(dxf).toMatch(/POLYLINE\n8\nCUT/);
  expect((svg.match(/stroke="#ff0000"/g) || []).length).toBe(6);
});
