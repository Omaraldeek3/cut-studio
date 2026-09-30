/**
 * 3D slab model of a laser-cut box. Every part is an axis-aligned cuboid (a slab)
 * one material thickness thin. Where slabs overlap, joint rules decide which part
 * keeps each piece of material, so mating parts are consistent by construction.
 * Axes: x = width, y = depth (y = 0 is the front), z = height (z = 0 is the bottom).
 */
export type Vec3 = [number, number, number];
export type Axis = 0 | 1 | 2;
export type Slab = { min: Vec3; max: Vec3; normal: Axis; u: Axis; v: Axis; flipV: boolean };
export type JointRule = { kind: 'fingers'; primary?: string } | { kind: 'owner'; part: string } | { kind: 'tenon'; tenon: string } | { kind: 'halflap'; lower: string };
export type Joint = { a: string; b: string; rule: JointRule };
/** `box` cuts are removed from the listed parts before joints apply; round cuts become holes after tracing. */
export type CutVolume = { name: string; parts: string[]; shape: 'box' | 'circle' | 'stadium'; min: Vec3; max: Vec3 };
export type ModelPart = { name: string; label: string; slab: Slab; priority: number };
export type BoxModel = { parts: ModelPart[]; joints: Joint[]; cuts: CutVolume[]; thickness: number; finger: number };
export type Range3 = { min: Vec3; max: Vec3 };

const EPS = 1e-7;

/** A slab from its corners. Walls map height to drawing y with the top edge first. */
export function slab(min: Vec3, max: Vec3): Slab {
  const extent = [0, 1, 2].map(i => max[i] - min[i]);
  const normal = extent.indexOf(Math.min(...extent)) as Axis;
  if (normal === 2) return { min, max, normal, u: 0, v: 1, flipV: false };
  if (normal === 1) return { min, max, normal, u: 0, v: 2, flipV: true };
  return { min, max, normal, u: 1, v: 2, flipV: true };
}
export function slabSize(s: Slab) { return { width: s.max[s.u] - s.min[s.u], height: s.max[s.v] - s.min[s.v] }; }
export function toWorld(s: Slab, x: number, y: number, depth = 0.5): Vec3 {
  const p: Vec3 = [0, 0, 0];
  p[s.u] = s.min[s.u] + x;
  p[s.v] = s.flipV ? s.max[s.v] - y : s.min[s.v] + y;
  p[s.normal] = s.min[s.normal] + depth * (s.max[s.normal] - s.min[s.normal]);
  return p;
}
/** Drawing-coordinate rectangle of a 3D range projected onto the slab's plane. */
export function toLocal(s: Slab, r: Range3) {
  const x0 = r.min[s.u] - s.min[s.u], x1 = r.max[s.u] - s.min[s.u];
  const y0 = s.flipV ? s.max[s.v] - r.max[s.v] : r.min[s.v] - s.min[s.v];
  const y1 = s.flipV ? s.max[s.v] - r.min[s.v] : r.max[s.v] - s.min[s.v];
  return { x0, x1, y0, y1 };
}
/** Maps a coordinate along a 3D axis to the drawing axis it lies on, or null for the normal. */
export function localCoordinate(s: Slab, axis: Axis, value: number): { along: 'x' | 'y'; value: number } | null {
  if (axis === s.u) return { along: 'x', value: value - s.min[s.u] };
  if (axis === s.v) return { along: 'y', value: s.flipV ? s.max[s.v] - value : value - s.min[s.v] };
  return null;
}
export function contains(r: Range3, p: Vec3) {
  return p[0] > r.min[0] + EPS && p[0] < r.max[0] - EPS && p[1] > r.min[1] + EPS && p[1] < r.max[1] - EPS && p[2] > r.min[2] + EPS && p[2] < r.max[2] - EPS;
}
export function intersect(a: Range3, b: Range3): Range3 | null {
  const min: Vec3 = [Math.max(a.min[0], b.min[0]), Math.max(a.min[1], b.min[1]), Math.max(a.min[2], b.min[2])];
  const max: Vec3 = [Math.min(a.max[0], b.max[0]), Math.min(a.max[1], b.max[1]), Math.min(a.max[2], b.max[2])];
  return max[0] - min[0] > EPS && max[1] - min[1] > EPS && max[2] - min[2] > EPS ? { min, max } : null;
}
const longAxis = (r: Range3) => { const e = [0, 1, 2].map(i => r.max[i] - r.min[i]); return e.indexOf(Math.max(...e)) as Axis; };

export type FingerJoint = { axis: Axis; start: number; end: number; count: number; width: number; primary: string; secondary: string };

/** Answers which part keeps the material at a 3D point, with per-pair joint data cached. */
export class Ownership {
  readonly byName = new Map<string, ModelPart>();
  readonly neighbours = new Map<string, ModelPart[]>();
  private readonly rules = new Map<string, JointRule>();
  private readonly fingers = new Map<string, FingerJoint>();
  constructor(readonly model: BoxModel) {
    for (const part of model.parts) {
      if (this.byName.has(part.name)) throw new Error(`Duplicate box part ${part.name}.`);
      this.byName.set(part.name, part);
    }
    for (const part of model.parts) this.neighbours.set(part.name, model.parts.filter(q => q !== part && intersect(q.slab, part.slab)));
    for (const joint of model.joints) this.rules.set(pairKey(joint.a, joint.b), joint.rule);
  }
  rule(a: string, b: string): JointRule { return this.rules.get(pairKey(a, b)) || { kind: 'fingers' }; }
  private ranks(a: ModelPart, b: ModelPart) { return a.priority > b.priority || (a.priority === b.priority && a.name < b.name) ? [a, b] : [b, a]; }
  fingerJoint(a: string, b: string): FingerJoint {
    const key = pairKey(a, b), cached = this.fingers.get(key);
    if (cached) return cached;
    const pa = this.byName.get(a)!, pb = this.byName.get(b)!, overlap = intersect(pa.slab, pb.slab)!;
    const axis = longAxis(overlap), t = this.model.thickness;
    // A finger run stops one thickness short of an end only where a third part meets that end (the corner cube).
    const meets = (from: number, to: number) => {
      const min: Vec3 = [...overlap.min], max: Vec3 = [...overlap.max];
      min[axis] = from; max[axis] = to;
      return this.model.parts.some(q => q !== pa && q !== pb && intersect(q.slab, { min, max }));
    };
    const start = overlap.min[axis] + (meets(overlap.min[axis], overlap.min[axis] + t) ? t : 0);
    const end = overlap.max[axis] - (meets(overlap.max[axis] - t, overlap.max[axis]) ? t : 0);
    const length = Math.max(0, end - start), raw = length / this.model.finger;
    const count = length >= 3 * Math.min(t, this.model.finger) ? Math.max(3, 2 * Math.round((raw - 1) / 2) + 1) : 1;
    const rule = this.rule(a, b), [ranked] = this.ranks(pa, pb);
    const primary = rule.kind === 'fingers' && rule.primary ? this.byName.get(rule.primary)! : ranked, secondary = primary === pa ? pb : pa;
    const joint = { axis, start, end, count, width: length / count, primary: primary.name, secondary: secondary.name };
    this.fingers.set(key, joint);
    return joint;
  }
  tenonZone(a: string, b: string) {
    const overlap = intersect(this.byName.get(a)!.slab, this.byName.get(b)!.slab)!;
    const axis = longAxis(overlap), length = overlap.max[axis] - overlap.min[axis], middle = (overlap.min[axis] + overlap.max[axis]) / 2;
    const half = Math.min(this.model.finger, length / 2) / 2;
    return { axis, from: middle - half, to: middle + half };
  }
  halflapMiddle(a: string, b: string) {
    const overlap = intersect(this.byName.get(a)!.slab, this.byName.get(b)!.slab)!;
    return (overlap.min[2] + overlap.max[2]) / 2;
  }
  /** Owner of the material at `p`; `near` limits the search to that part and its neighbours. */
  ownerAt(p: Vec3, near?: string): string | null {
    const pool = near ? [this.byName.get(near)!, ...this.neighbours.get(near)!] : this.model.parts;
    const inside = pool.filter(part => contains(part.slab, p) && !this.model.cuts.some(cut => cut.shape === 'box' && cut.parts.includes(part.name) && contains(cut, p)));
    if (!inside.length) return null;
    if (inside.length === 1) return inside[0].name;
    if (inside.length > 2) {
      // A corner cube goes to the part that wins every pairing there: butt joints (owner rules)
      // decide their pair, everything else falls back to priority.
      const beats = (a: ModelPart, b: ModelPart) => { const rule = this.rule(a.name, b.name); return rule.kind === 'owner' ? rule.part === a.name : this.ranks(a, b)[0] === a; };
      const winner = inside.find(a => inside.every(b => b === a || beats(a, b)));
      return (winner || inside.reduce((best, part) => this.ranks(best, part)[0])).name;
    }
    const [a, b] = inside, rule = this.rule(a.name, b.name);
    switch (rule.kind) {
      case 'owner': return rule.part;
      case 'halflap': return p[2] < this.halflapMiddle(a.name, b.name) ? rule.lower : (rule.lower === a.name ? b.name : a.name);
      case 'tenon': {
        const zone = this.tenonZone(a.name, b.name), other = rule.tenon === a.name ? b.name : a.name;
        return p[zone.axis] > zone.from && p[zone.axis] < zone.to ? rule.tenon : other;
      }
      default: {
        const joint = this.fingerJoint(a.name, b.name), at = p[joint.axis];
        if (at < joint.start || at > joint.end) return joint.primary;
        const segment = Math.min(joint.count - 1, Math.floor((at - joint.start) / joint.width));
        return segment % 2 === 0 ? joint.primary : joint.secondary;
      }
    }
  }
}
function pairKey(a: string, b: string) { return a < b ? `${a} ${b}` : `${b} ${a}`; }
