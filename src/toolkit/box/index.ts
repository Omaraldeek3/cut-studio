import { bounds, moveShape } from '../geometry';
import type { Drawing, Shape } from '../types';
import { Ownership, type Slab } from './model';
import { partShape } from './panels';
import { buildModel, type BoxOptions, type Size } from './types';

export { defaultBoxOptions, hasLid, type BoxOptions, type BoxType } from './types';
export type BoxPart = { name: string; label: string; shape: Shape; slab: Slab; labelled: boolean };
export type BoxResult = { parts: BoxPart[]; drawing: Drawing; outside: Size; inside: Size; counts: Size; thickness: number; unlabelled: string[] };

const oddCount = (length: number, finger: number) => Math.max(3, 2 * Math.round((length / finger - 1) / 2) + 1);

export function buildBox(o: BoxOptions): BoxResult {
  const { model, outside, inside } = buildModel(o);
  const own = new Ownership(model);
  let narrowest = Infinity;
  for (const part of model.parts) for (const other of own.neighbours.get(part.name)!) {
    const rule = own.rule(part.name, other.name);
    if (rule.kind === 'fingers') { const joint = own.fingerJoint(part.name, other.name); if (joint.count > 1) narrowest = Math.min(narrowest, joint.width); }
    if (rule.kind === 'tenon') { const zone = own.tenonZone(part.name, other.name); narrowest = Math.min(narrowest, zone.to - zone.from); }
  }
  if (o.kerf >= narrowest / 2) throw new Error('Kerf compensation must be smaller than half a finger. Reduce kerf or use wider fingers.');
  const finish = { kerf: o.kerf, dogbone: o.dogbone, cornerRadius: o.cornerRadius, labels: o.labels };
  const parts = model.parts.map(part => ({ name: part.name, label: part.label, slab: part.slab, ...partShape(own, part, finish) }));
  const t = o.thickness;
  return {
    parts, drawing: layout(parts.map(p => p.shape), o.spacing), outside, inside, thickness: t,
    counts: { width: oddCount(outside.width - 2 * t, o.finger), depth: oddCount(outside.depth - 2 * t, o.finger), height: oddCount(outside.height - 2 * t, o.finger) },
    unlabelled: o.labels ? parts.filter(p => !p.labelled).map(p => p.name) : [],
  };
}

/** Shelf layout in part order with `spacing` between every pair of parts. */
export function layout(shapes: Shape[], spacing: number): Drawing {
  const boxes = shapes.map(bounds);
  const area = boxes.reduce((sum, b) => sum + (b.width + spacing) * (b.height + spacing), 0);
  const limit = Math.max(...boxes.map(b => b.width), Math.sqrt(area) * 1.5);
  const placed: Shape[] = [];
  let x = 0, y = 0, row = 0, width = 0;
  shapes.forEach((shape, i) => {
    const b = boxes[i];
    if (x > 0 && x + b.width > limit) { y += row + spacing; x = 0; row = 0; }
    placed.push(moveShape(shape, x - b.x, y - b.y));
    x += b.width + spacing; row = Math.max(row, b.height); width = Math.max(width, x - spacing);
  });
  return { width, height: y + row, shapes: placed };
}
