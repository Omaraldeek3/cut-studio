import { finite } from '../geometry';
import { slab, type BoxModel, type CutVolume, type Joint, type ModelPart, type Vec3 } from './model';

export type BoxType = 'closed' | 'open' | 'liftoff' | 'sliding' | 'drawer';
export type BoxOptions = {
  type: BoxType; width: number; depth: number; height: number; sizing: 'inside' | 'outside';
  thickness: number; finger: number; kerf: number; clearance: number; spacing: number;
  rows: number; columns: number; labels: boolean;
  handHoles: { enabled: boolean; width: number; height: number; fromTop: number };
  pull: 'none' | 'thumb' | 'slot'; pullSize: number; cornerRadius: number; dogbone: number;
};
export type Size = { width: number; depth: number; height: number };

export const defaultBoxOptions: BoxOptions = {
  type: 'closed', width: 120, depth: 80, height: 60, sizing: 'outside', thickness: 3, finger: 10, kerf: 0, clearance: 0.3, spacing: 5,
  rows: 0, columns: 0, labels: true, handHoles: { enabled: false, width: 50, height: 18, fromTop: 12 }, pull: 'thumb', pullSize: 20, cornerRadius: 0, dogbone: 0,
};
export const hasLid = (type: BoxType) => type === 'liftoff' || type === 'sliding' || type === 'drawer';

/** Outside minus usable inside, per dimension. The outside size is the assembled object. */
function allowance(o: BoxOptions): Size {
  const t = o.thickness, c = o.clearance;
  switch (o.type) {
    case 'open': return { width: 2 * t, depth: 2 * t, height: t };
    case 'liftoff': return { width: 2 * t, depth: 2 * t, height: 3 * t };
    case 'sliding': return { width: 2 * t, depth: 2 * t, height: 3 * t };
    case 'drawer': return { width: 4 * t + 2 * c, depth: 4 * t + c, height: 3 * t + c };
    default: return { width: 2 * t, depth: 2 * t, height: 2 * t };
  }
}

export function validateOptions(o: BoxOptions) {
  finite(o.thickness, 0.5, 30, 'Material thickness');
  finite(o.finger, 1, 1000, 'Finger width');
  finite(o.kerf, 0, 0.5, 'Kerf compensation');
  finite(o.clearance, 0, 2, 'Clearance');
  finite(o.spacing, 0, 100, 'Panel spacing');
  finite(o.cornerRadius, 0, 100, 'Corner radius');
  finite(o.dogbone, 0, 5, 'Dogbone radius');
  for (const [value, name] of [[o.rows, 'Divider rows'], [o.columns, 'Divider columns']] as const) {
    finite(value, 0, 20, name);
    if (!Number.isInteger(value)) throw new Error(`${name}: use a whole number.`);
  }
  if (o.handHoles.enabled) { finite(o.handHoles.width, 5, 1000, 'Hand hole width'); finite(o.handHoles.height, 5, 500, 'Hand hole height'); finite(o.handHoles.fromTop, 0, 1000, 'Hand hole distance from top'); }
  if (o.pull !== 'none') finite(o.pullSize, 5, 200, 'Pull size');
}

type Compartment = { x0: number; x1: number; y0: number; y1: number; bottom: number; height: number; left: string; right: string; front: string; back: string };

export function buildModel(o: BoxOptions): { model: BoxModel; outside: Size; inside: Size } {
  validateOptions(o);
  const t = o.thickness, c = o.clearance, extra = allowance(o), inputSize = o.sizing === 'inside';
  const entered: Size = { width: finite(o.width, 1, 3000, 'Width'), depth: finite(o.depth, 1, 3000, 'Depth'), height: finite(o.height, 1, 3000, 'Height') };
  const outside: Size = inputSize ? { width: entered.width + extra.width, depth: entered.depth + extra.depth, height: entered.height + extra.height } : entered;
  const inside: Size = { width: outside.width - extra.width, depth: outside.depth - extra.depth, height: outside.height - extra.height };
  for (const key of ['width', 'depth', 'height'] as const) {
    if (inside[key] < 3 * t) throw new Error(`Box ${key} is too small for ${t} mm material. Use at least ${+(3 * t + extra[key]).toFixed(2)} mm outside.`);
  }
  const W = outside.width, D = outside.depth, H = outside.height;
  const parts: ModelPart[] = [], joints: Joint[] = [], cuts: CutVolume[] = [];
  const part = (name: string, min: Vec3, max: Vec3, priority: number) => parts.push({ name, label: name.toUpperCase(), slab: slab(min, max), priority });
  const walls = (prefix: string, x0: number, x1: number, y0: number, y1: number, z0: number, z1: number, top: boolean, frontTop = z1) => {
    part(`${prefix}Bottom`, [x0, y0, z0], [x1, y1, z0 + t], 1);
    if (top) part(`${prefix}Top`, [x0, y0, z1 - t], [x1, y1, z1], 1);
    if (frontTop > z0) part(`${prefix}Front`, [x0, y0, z0], [x1, y0 + t, frontTop], 3);
    part(`${prefix}Back`, [x0, y1 - t, z0], [x1, y1, z1], 3);
    part(`${prefix}Left`, [x0, y0, z0], [x0 + t, y1, z1], 2);
    part(`${prefix}Right`, [x1 - t, y0, z0], [x1, y1, z1], 2);
  };
  let compartment: Compartment;
  const main = { left: 'Left', right: 'Right', front: 'Front', back: 'Back' };
  switch (o.type) {
    case 'open':
      walls('', 0, W, 0, D, 0, H, false);
      compartment = { x0: 0, x1: W, y0: 0, y1: D, bottom: t, height: H - t, ...main };
      break;
    case 'liftoff': {
      const wall = H - t;
      walls('', 0, W, 0, D, 0, wall, false);
      part('Lid', [0, 0, wall], [W, D, H], 1);
      part('Lid locator', [t + c, t + c, wall - t], [W - t - c, D - t - c, wall], 1);
      compartment = { x0: 0, x1: W, y0: 0, y1: D, bottom: t, height: wall - 2 * t - c, ...main };
      break;
    }
    case 'sliding': {
      const front = H - 2 * t - c;
      // The lid slides through open-front slots in the side walls and stops at the back wall.
      walls('', 0, W, 0, D, 0, H, false, front);
      part('Lid', [0, 0, H - 2 * t], [W, D - t, H - t], 1);
      joints.push({ a: 'Lid', b: 'Left', rule: { kind: 'owner', part: 'Lid' } }, { a: 'Lid', b: 'Right', rule: { kind: 'owner', part: 'Lid' } });
      // Side walls keep the end fingers at the back corners so the strip above the slot stays attached.
      joints.push({ a: 'Back', b: 'Left', rule: { kind: 'fingers', primary: 'Left' } }, { a: 'Back', b: 'Right', rule: { kind: 'fingers', primary: 'Right' } });
      cuts.push({ name: 'Lid slot', parts: ['Left', 'Right'], shape: 'box', min: [-1, -1, H - 2 * t - c / 2], max: [W + 1, D - t, H - t + c / 2] });
      compartment = { x0: 0, x1: W, y0: 0, y1: D, bottom: t, height: front - t, ...main };
      break;
    }
    case 'drawer': {
      // Face plate at the front, sleeve behind it, drawer tray inside the sleeve with clearance.
      walls('Sleeve ', 0, W, t, D, 0, H, true, 0);
      part('Drawer face', [0, 0, 0], [W, t, H], 1);
      const x0 = t + c, x1 = W - t - c, y0 = t, y1 = D - t - c, z0 = t, z1 = H - t - c;
      walls('Drawer ', x0, x1, y0, y1, z0, z1, false);
      compartment = { x0, x1, y0, y1, bottom: z0 + t, height: z1 - z0 - t, left: 'Drawer Left', right: 'Drawer Right', front: 'Drawer Front', back: 'Drawer Back' };
      break;
    }
    default:
      walls('', 0, W, 0, D, 0, H, true);
      compartment = { x0: 0, x1: W, y0: 0, y1: D, bottom: t, height: H - 2 * t - c, ...main };
  }
  // Rename drawer parts to readable labels ("Sleeve Bottom" → "Sleeve bottom").
  for (const p of parts) { p.name = p.name.replace(/ (Bottom|Top|Front|Back|Left|Right)$/, (_, w: string) => ` ${w.toLowerCase()}`); p.label = p.name.toUpperCase(); }
  const named = (name: string) => name.replace(/ (Bottom|Top|Front|Back|Left|Right)$/, (_, w: string) => ` ${w.toLowerCase()}`);
  compartment = { ...compartment, left: named(compartment.left), right: named(compartment.right), front: named(compartment.front), back: named(compartment.back) };
  addDividers(o, compartment, parts, joints);
  addHoles(o, W, D, H, parts, cuts);
  return { model: { parts, joints, cuts, thickness: t, finger: o.finger }, outside, inside };
}

/** Egg-crate dividers with through-tenons into the compartment walls. */
function addDividers(o: BoxOptions, room: Compartment, parts: ModelPart[], joints: Joint[]) {
  const t = o.thickness;
  if (!o.rows && !o.columns) return;
  if (room.height < 2 * t) throw new Error('Dividers need more inside height. Increase the box height.');
  const place = (from: number, to: number, count: number, name: string) => {
    const gap = (to - from - count * t) / (count + 1);
    if (gap < 2 * t) throw new Error(`Too many ${name} for this box. Each compartment needs at least ${2 * t} mm.`);
    return Array.from({ length: count }, (_, i) => from + gap * (i + 1) + t * i);
  };
  const z0 = room.bottom, z1 = room.bottom + room.height;
  const xNames = place(room.y0 + t, room.y1 - t, o.rows, 'divider rows').map((y, i) => {
    const name = `Divider X${i + 1}`;
    parts.push({ name, label: `DIVIDER X${i + 1}`, slab: slab([room.x0, y, z0], [room.x1, y + t, z1]), priority: 0 });
    joints.push({ a: name, b: room.left, rule: { kind: 'tenon', tenon: name } }, { a: name, b: room.right, rule: { kind: 'tenon', tenon: name } });
    return name;
  });
  place(room.x0 + t, room.x1 - t, o.columns, 'divider columns').forEach((x, i) => {
    const name = `Divider Y${i + 1}`;
    parts.push({ name, label: `DIVIDER Y${i + 1}`, slab: slab([x, room.y0, z0], [x + t, room.y1, z1]), priority: 0 });
    joints.push({ a: name, b: room.front, rule: { kind: 'tenon', tenon: name } }, { a: name, b: room.back, rule: { kind: 'tenon', tenon: name } });
    for (const cross of xNames) joints.push({ a: name, b: cross, rule: { kind: 'halflap', lower: cross } });
  });
}

function addHoles(o: BoxOptions, W: number, D: number, H: number, parts: ModelPart[], cuts: CutVolume[]) {
  const t = o.thickness, has = (name: string) => parts.some(p => p.name === name);
  if (o.handHoles.enabled && o.type !== 'drawer') {
    const top = o.type === 'liftoff' ? H - t : H, { width: w, height: h, fromTop } = o.handHoles;
    cuts.push({ name: 'Hand hole', parts: ['Left', 'Right'], shape: 'stadium', min: [-1, D / 2 - w / 2, top - fromTop - h], max: [W + 1, D / 2 + w / 2, top - fromTop] });
  }
  if (o.pull === 'none' || !hasLid(o.type)) return;
  const across = o.pull === 'slot' ? o.pullSize * 2.5 : o.pullSize, along = o.pullSize, shape = o.pull === 'slot' ? 'stadium' : 'circle';
  if (o.type === 'liftoff' && has('Lid')) cuts.push({ name: 'Lid pull', parts: ['Lid', 'Lid locator'], shape, min: [W / 2 - across / 2, D / 2 - along / 2, H - 2 * t - 1], max: [W / 2 + across / 2, D / 2 + along / 2, H + 1] });
  if (o.type === 'sliding') cuts.push({ name: 'Lid pull', parts: ['Lid'], shape, min: [W / 2 - across / 2, 2 * t, H - 2 * t - 1], max: [W / 2 + across / 2, 2 * t + along, H - t + 1] });
  if (o.type === 'drawer') {
    const middle = (t + H - t - o.clearance) / 2;
    cuts.push({ name: 'Drawer pull', parts: ['Drawer face', 'Drawer front'], shape, min: [W / 2 - across / 2, -1, middle - along / 2], max: [W / 2 + across / 2, 2 * t + 1, middle + along / 2] });
  }
}
