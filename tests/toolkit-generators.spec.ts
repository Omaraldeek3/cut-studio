import { test, expect } from "@playwright/test";
import {
  defaultGear, defaultHinge, defaultPattern, defaultPuzzle, defaultRuler, defaultTag, defaultTestCard,
  centreDistance, gearDrawing, gearGeometry, gearPairDrawing, hingeDrawing, jobEstimate, patternDrawing, printSize, puzzleDrawing, resolution,
  rulerDrawing, steps, tagBatch, tagDrawing, testCardDrawing, trophyDrawing, defaultTrophy, defaultJob,
} from "../src/toolkit/generators";
import { toDxf, toSvg } from "../src/toolkit/export";
import type { Drawing } from "../src/toolkit/types";

const inside = (d: Drawing) =>
  d.shapes.every(s => s.contours.every(c => c.points.every(p =>
    p.x >= -1e-6 && p.y >= -1e-6 && p.x <= d.width + 1e-6 && p.y <= d.height + 1e-6)));

const engraved = (d: Drawing) => d.shapes.flatMap(s => s.contours).filter(c => c.layer === "engrave");

test("every generator draws inside its own artboard and exports", () => {
  const drawings = [
    hingeDrawing(defaultHinge), gearDrawing(defaultGear), puzzleDrawing(defaultPuzzle), tagDrawing(defaultTag),
    patternDrawing(defaultPattern), testCardDrawing(defaultTestCard), rulerDrawing(defaultRuler),
  ];
  for (const d of drawings) {
    expect(inside(d), d.shapes[0].name).toBe(true);
    expect(toSvg(d)).toContain("<svg");
    expect(toDxf(d)).toContain("EOF");
  }
});

test("the hinge alternates its slits and keeps them off the edges", () => {
  const d = hingeDrawing({ ...defaultHinge, zone: 10, spacing: 2 });
  const slits = d.shapes[0].contours.slice(1);
  const columns = new Set(slits.map(c => c.points[0].x.toFixed(3)));
  expect(columns.size).toBe(6);
  for (const c of slits) {
    expect(c.closed).toBe(false);
    expect(Math.min(...c.points.map(p => p.y))).toBeGreaterThanOrEqual(defaultHinge.margin - 1e-9);
  }
});

test("the gear's outline reaches the outside diameter and not beyond", () => {
  const d = gearDrawing(defaultGear);
  const g = gearGeometry(defaultGear);
  const centre = d.width / 2;
  const radii = d.shapes[0].contours[0].points.map(p => Math.hypot(p.x - centre, p.y - centre));
  expect(Math.max(...radii)).toBeCloseTo(g.outer, 3);
  expect(Math.min(...radii)).toBeCloseTo(g.root, 3);
  expect(g.pitch * 2).toBeCloseTo(defaultGear.module * defaultGear.teeth, 6);
});

test("a gear with many teeth, whose root lies above the base circle, still closes cleanly", () => {
  const d = gearDrawing({ ...defaultGear, teeth: 80, module: 1 });
  const points = d.shapes[0].contours[0].points;
  for (let i = 1; i < points.length; i++)
    expect(Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y)).toBeLessThan(2);
});

test("a puzzle has one edge per shared side, and the same seed gives the same puzzle", () => {
  const o = { ...defaultPuzzle, columns: 4, rows: 3 };
  const d = puzzleDrawing(o);
  expect(d.shapes[0].contours.length - 1).toBe((3 - 1) * 4 + (4 - 1) * 3);
  expect(JSON.stringify(puzzleDrawing(o))).toBe(JSON.stringify(d));
  expect(JSON.stringify(puzzleDrawing({ ...o, seed: o.seed + 1 }))).not.toBe(JSON.stringify(d));
});

test("a tag shrinks text to fit every shape, refuses text that cannot be read, and places the hole inside", () => {
  for (const [shape, text] of [["rounded", "LONG LABEL"], ["circle", "LONG LABEL"], ["hexagon", "LONG LABEL"], ["star", "STAR"], ["shield", "LONG LABEL"]] as const) {
    const d = tagDrawing({ ...defaultTag, shape, text, textHeight: 8 });
    const b = d.shapes[0].contours.filter(c => c.layer === "engrave").flatMap(c => c.points);
    expect(Math.min(...b.map(p => p.x))).toBeGreaterThan(0); expect(Math.max(...b.map(p => p.x))).toBeLessThan(d.width);
  }
  expect(() => tagDrawing({ ...defaultTag, width: 20, text: "A MUCH TOO LONG LABEL FOR THIS" })).toThrow(/too long/);
  const font = { loops: [[{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 20 }, { x: 0, y: 20 }]], width: 100, height: 20 };
  const withFont = tagDrawing(defaultTag, font).shapes[0].contours.filter(c => c.layer === "engrave" && c.curve);
  expect(withFont).toHaveLength(1);
  const d = tagDrawing(defaultTag);
  expect(engraved(d).length).toBeGreaterThan(1);
  for (const shape of ["circle", "hexagon", "star", "shield"] as const)
    expect(inside(tagDrawing({ ...defaultTag, shape, text: "" }))).toBe(true);
});

test("grille holes all sit inside the margin", () => {
  for (const kind of ["hex", "circle", "slot", "diamond"] as const) {
    const o = { ...defaultPattern, kind };
    const d = patternDrawing(o);
    const holes = d.shapes[0].contours.slice(1);
    expect(holes.length, kind).toBeGreaterThan(10);
    for (const c of holes) for (const p of c.points) {
      expect(p.x).toBeGreaterThanOrEqual(o.margin - 1e-6);
      expect(p.x).toBeLessThanOrEqual(o.width - o.margin + 1e-6);
    }
  }
});

test("the test card engraves one square per power and speed pair", () => {
  const d = testCardDrawing({ ...defaultTestCard, columns: 4, rows: 3 });
  const squares = engraved(d).filter(c => c.closed);
  expect(squares).toHaveLength(12);
  expect(steps(100, 500, 5)).toEqual([100, 200, 300, 400, 500]);
});

test("a millimetre ruler has one tick per millimetre", () => {
  const d = rulerDrawing({ ...defaultRuler, length: 100 });
  const ticks = engraved(d).filter(c => c.points.length === 2 && Math.abs(c.points[0].x - c.points[1].x) < 1e-9 && c.points[0].y < 0.01);
  expect(ticks).toHaveLength(101);
  const first = Math.min(...ticks.map(c => c.points[0].x)), last = Math.max(...ticks.map(c => c.points[0].x));
  expect(last - first).toBeCloseTo(100, 9);
});


test("the job estimate adds cutting, piercing and travel", () => {
  const square: Drawing = { width: 100, height: 100, shapes: [{ id: "a", name: "a", contours: [{ closed: true, points: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 }] }] }] };
  const r = jobEstimate(square, { ...defaultJob, cutSpeed: 10, pierce: 1, travel: 0, copies: 2, rate: 36 });
  expect(r.cut).toBe(400);
  expect(r.each).toBeCloseTo(41, 9);
  expect(r.seconds).toBeCloseTo(82, 9);
  expect(r.cost).toBeCloseTo(0.82, 9);
});

test("resolution converts both ways", () => {
  const r = resolution(254, 100, 50);
  expect(r.width).toBe(1000);
  expect(r.height).toBe(500);
  expect(r.interval).toBeCloseTo(0.1, 9);
  const back = printSize(254, 1000, 500);
  expect(back.width).toBeCloseTo(100, 9);
});

test("every test-card square has its own colour layer named by its power and speed", () => {
  const d = testCardDrawing(defaultTestCard);
  const pens = d.shapes.flatMap(s => s.contours).flatMap(c => (c.pen ? [c.pen] : []));
  expect(pens).toHaveLength(25);
  expect(new Set(pens.map(p => p.aci)).size).toBe(25);
  expect(new Set(pens.map(p => p.name)).size).toBe(25);
  expect(pens.every(p => p.aci !== 1 && p.aci !== 5)).toBe(true);
  expect(pens[0].name).toBe("01-P10-S100");
  const dxf = toDxf(d);
  for (const p of pens) expect(dxf).toContain(`\n2\n${p.name}\n70\n0\n62\n${p.aci}\n`);
  expect(toSvg(d).match(/<path id="\d\d-P/g)).toHaveLength(25);
  expect(() => testCardDrawing({ ...defaultTestCard, columns: 6, rows: 6 })).toThrow(/at most 30/);
});

test("a gear pair is laid out in mesh: centres a pitch-radius sum apart, teeth never overlapping", () => {
  for (const [a, b] of [[24, 36], [24, 12], [13, 31], [20, 20]]) {
    const d = gearPairDrawing({ ...defaultGear, teeth: a }, b);
    expect(d.shapes).toHaveLength(2);
    const centre = (i: number) => { const c = d.shapes[i].contours.find(x => x.layer === "engrave")!.points; const xs = c.map(p => p.x); return (Math.min(...xs) + Math.max(...xs)) / 2; };
    expect(centre(1) - centre(0)).toBeCloseTo(centreDistance(defaultGear.module, a, b), 1);
    const g1 = d.shapes[0].contours[0].points, g2 = d.shapes[1].contours[0].points;
    const inside = (p: { x: number; y: number }, poly: { x: number; y: number }[]) => { let h = false; for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) { const A = poly[i], B = poly[j]; if ((A.y > p.y) !== (B.y > p.y) && p.x < ((B.x - A.x) * (p.y - A.y)) / (B.y - A.y) + A.x) h = !h; } return h; };
    expect(g1.filter(p => inside(p, g2)).length + g2.filter(p => inside(p, g1)).length).toBe(0);
    let gap = Infinity; for (const p of g1) for (const q of g2) gap = Math.min(gap, Math.hypot(p.x - q.x, p.y - q.y));
    expect(gap).toBeLessThan(defaultGear.module * 0.2);
  }
});

test("a tag batch makes one tag per line, each its own part, in a grid", () => {
  const d = tagBatch({ ...defaultTag, width: 60, height: 30 }, ["ANNA", " ", "BO", "CARL", "DEE"]);
  expect(d.shapes.map(s => s.name)).toEqual(["ANNA", "BO", "CARL", "DEE"]);
  expect(new Set(d.shapes.map(s => s.id)).size).toBe(4);
  // Two columns of two, 3 mm apart.
  expect(d.width).toBe(123); expect(d.height).toBe(63);
  expect(() => tagBatch(defaultTag, ["OK", "THIS NAME IS FAR TOO LONG FOR A SIXTY MILLIMETRE TAG"])).toThrow(/do not fit the tag: THIS NAME/);
  expect(() => tagBatch(defaultTag, ["", "  "])).toThrow(/at least one name/);
});

test("a trophy base has slotted layers on top, solid ones beneath, and a plate that fits the slot", () => {
  const d = trophyDrawing({ ...defaultTrophy, layers: 3, slotLayers: 2, thickness: 6, plateWidth: 130, plateThickness: 5, clearance: 0.2 });
  expect(d.shapes.map(s => s.contours.length)).toEqual([2, 2, 1, 1]);
  expect(d.slot).toEqual({ length: 130.2, width: 5.2, depth: 12 });
  const slot = d.shapes[0].contours[1].points, xs = slot.map(p => p.x), ys = slot.map(p => p.y);
  expect(Math.max(...xs) - Math.min(...xs)).toBeCloseTo(130.2, 6);
  expect(Math.max(...ys) - Math.min(...ys)).toBeCloseTo(5.2, 6);
  const plate = d.shapes[3].contours[0].points;
  expect(Math.max(...plate.map(p => p.x)) - Math.min(...plate.map(p => p.x))).toBeCloseTo(130, 6);
  expect(Math.max(...plate.map(p => p.y)) - Math.min(...plate.map(p => p.y))).toBeCloseTo(defaultTrophy.plateHeight, 6);
  expect(() => trophyDrawing({ ...defaultTrophy, slotLayers: 4, layers: 3 })).toThrow(/1 to 10 layers/);
  expect(() => trophyDrawing({ ...defaultTrophy, plateWidth: 158 })).toThrow(/Plate width/);
});
