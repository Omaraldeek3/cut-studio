import { test, expect } from '@playwright/test';
import { defaultPolyBox, polyBoxDrawing } from '../src/toolkit/polybox';
import { audit } from './helpers/geometry-audit';
import * as g from '../src/toolkit/generators';
import { buildBox } from '../src/toolkit/box';
import { defaultBoxOptions } from '../src/toolkit/box/types';
import { kerfDrawing } from '../src/toolkit/geometry';
import type { Drawing } from '../src/toolkit/types';

const drawings: [string, () => Drawing][] = [
  ['hinge', () => g.hingeDrawing(g.defaultHinge)],
  ['gear', () => g.gearDrawing(g.defaultGear)],
  ['puzzle', () => g.puzzleDrawing(g.defaultPuzzle)],
  ['tag', () => g.tagDrawing(g.defaultTag)],
  ...(['turn', 'bolt'] as const).map((kind): [string, () => Drawing] => [`latch ${kind}`, () => ({ width: 200, height: 40, shapes: g.latchParts(kind, 3) })]),
  ...[5, 6, 8, 12].map((sides): [string, () => Drawing] => [`polygon box ${sides}`, () => polyBoxDrawing({ ...defaultPolyBox, sides })]),
  ...(['arch', 'rounded', 'square'] as const).map((plateTop): [string, () => Drawing] => [`trophy ${plateTop}`, () => g.trophyDrawing({ ...g.defaultTrophy, plateTop })]),
  ...(['hex', 'circle', 'slot', 'diamond'] as const).map((kind): [string, () => Drawing] => [`pattern-${kind}`, () => g.patternDrawing({ ...g.defaultPattern, kind })]),
  ['test card', () => g.testCardDrawing(g.defaultTestCard)],
  ['ruler', () => g.rulerDrawing(g.defaultRuler)],
  ['fit test', () => kerfDrawing(3, 0.05, 5)],
  ...(['closed', 'open', 'liftoff', 'sliding', 'drawer'] as const).map((type): [string, () => Drawing] => [`box ${type}`, () => buildBox({ ...defaultBoxOptions, type }).drawing]),
];

for (const [name, make] of drawings) test(`${name} has no duplicated or crossing cut lines`, () => {
  const a = audit(make());
  expect(a.duplicateMm).toBe(0);
  expect(a.crossings).toBe(0);
  expect(a.selfCrossings).toBe(0);
});
