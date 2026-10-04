import { test, expect } from '@playwright/test';
import { bounds, shapesCollide, nest, repeatDrawing, kerfDrawing, cleanDrawing, contourKey, partsForNesting, snugAngle, normalize, artworkBounds } from '../src/toolkit/geometry';
import { toSvg, toDxf } from '../src/toolkit/export';
import type { Shape } from '../src/toolkit/types';
import { sampleDrawing } from '../src/toolkit/samples';

const rect = (id: string, x: number, y: number, w: number, h: number): Shape => ({ id, name: id, contours: [{ closed: true, points: [{x,y},{x:x+w,y},{x:x+w,y:y+h},{x,y:y+h}] }] });
test('clearance detects touching, intersection, containment and separated parts', () => {
  expect(shapesCollide(rect('a',0,0,10,10),rect('b',5,5,1,1),1)).toBe(true);
  expect(shapesCollide(rect('a',0,0,10,10),rect('b',10,0,10,10),0)).toBe(true);
  expect(shapesCollide(rect('a',0,0,10,10),rect('b',11,0,10,10),2)).toBe(true);
  expect(shapesCollide(rect('a',0,0,10,10),rect('b',13,0,10,10),2)).toBe(false);
});
test('concave outlines can interlock despite overlapping bounding boxes', () => {
  const l: Shape={id:'l',name:'l',contours:[{closed:true,points:[{x:0,y:0},{x:30,y:0},{x:30,y:10},{x:10,y:10},{x:10,y:30},{x:0,y:30}]}]};
  expect(shapesCollide(l,rect('in',13,13,10,10),2)).toBe(false);
});
test('nesting preserves every copy, sheet edges, rotation limits and spacing', () => {
  const result=nest([rect('a',0,0,20,15),rect('b',0,0,12,12)],{width:70,height:55,margin:3,gap:2,copies:3,rotate:false});
  expect(result.total).toBe(6); expect(result.unplaced).toEqual([]);
  expect(result.sheets.flat()).toHaveLength(6);
  for(const sheet of result.sheets) for(let i=0;i<sheet.length;i++){
    const b=bounds(sheet[i]); expect(b.x).toBeGreaterThanOrEqual(3);expect(b.y).toBeGreaterThanOrEqual(3);
    expect(b.x+b.width).toBeLessThanOrEqual(67.00001);expect(b.y+b.height).toBeLessThanOrEqual(52.00001);
    expect(b.width).toBeCloseTo(sheet[i].name==='a'?20:12);
    for(let j=0;j<i;j++) expect(shapesCollide(sheet[i],sheet[j],1.999)).toBe(false);
  }
});
test('rotation makes a tall part fit and oversize parts are reported',()=>{
  const opts={width:60,height:30,margin:2,gap:2,copies:1,rotate:false};
  expect(nest([rect('tall',0,0,20,45)],opts).unplaced).toHaveLength(1);
  expect(nest([rect('tall',0,0,20,45)],{...opts,rotate:true}).sheets.flat()).toHaveLength(1);
  expect(()=>nest([rect('a',0,0,2,2)],{...opts,copies:NaN})).toThrow();
});
test('physical SVG and DXF export preserve closure and vertical orientation',()=>{
  const drawing={width:100,height:50,shapes:[rect('a',10,5,20,10)]};
  const svg=toSvg(drawing);expect(svg).toContain('width="100mm"');expect(svg).toContain('height="50mm"');expect(svg).toContain('Z');
  const dxf=toDxf(drawing);expect(dxf).toContain('$INSUNITS\n70\n4');expect(dxf).toContain('POLYLINE');expect(dxf).toContain('20\n45');expect(dxf).toContain('70\n1');expect(dxf.trim()).toMatch(/EOF$/);
});
test('repeat dimensions, coupons and cost are computed from supplied values',()=>{
  const repeated=repeatDrawing({width:20,height:10,shapes:[rect('a',0,0,20,10)]},40,20,3,2,5);
  expect(repeated.width).toBe(130);expect(repeated.height).toBe(45);expect(repeated.shapes).toHaveLength(6);
  const coupon=kerfDrawing(3,0.1,5);expect(coupon.shapes).toHaveLength(1);
  expect(coupon.labels.map(l=>l.value)).toEqual(['2.80','2.90','3.00','3.10','3.20']);
  
});
test('cleanup distinguishes open and closed paths and canonicalizes rotations',()=>{
 const base=rect('r',0,0,20,10).contours[0];
 const rotated={...base,points:[...base.points.slice(2),...base.points.slice(0,2)].reverse()};
 expect(contourKey(base)).toBe(contourKey(rotated));
 const open={closed:false,points:[base.points[0],...base.points.slice(1).reverse()]};
 const result=cleanDrawing({width:30,height:30,shapes:[{id:'s',name:'s',contours:[base,rotated,open]}]},true,0);
 expect(result.duplicates).toBe(1);expect(result.drawing.shapes[0].contours).toHaveLength(2);
});
test('cleanup supports the full import vertex budget with bounded memory',()=>{
 const points=Array.from({length:20000},(_,i)=>({x:100+100*Math.cos(i*Math.PI/10000),y:100+100*Math.sin(i*Math.PI/10000)}));
 const key=contourKey({closed:true,points});expect(key.length).toBeGreaterThan(100000);expect(key.length).toBeLessThan(600000);
});
test('candidate placements accept the exact required clearance and fill available rows',()=>{
 expect(shapesCollide(rect('a',0,0,10,10),rect('b',12,0,10,10),2)).toBe(false);
 const result=nest(sampleDrawing().shapes,{width:600,height:400,margin:5,gap:3,copies:3,rotate:true});
 expect(result.sheets).toHaveLength(1);expect(result.sheets[0]).toHaveLength(18);expect(result.unplaced).toEqual([]);
});
test('dense compound parts nest by simplified outer outline and export every original detail',()=>{
 // A 4,000-node circle with a hole and an open engraving line inside: far above the old 6,000-node job limit once copied.
 const ring=(cx:number,cy:number,r:number,n:number)=>Array.from({length:n},(_,i)=>({x:cx+r*Math.cos(2*Math.PI*i/n),y:cy+r*Math.sin(2*Math.PI*i/n)}));
 const part:Shape={id:'disc',name:'disc',contours:[{closed:true,points:ring(40,40,40,4000)},{closed:true,points:ring(40,40,10,400)},{closed:false,points:[{x:20,y:40},{x:60,y:40}]}]};
 const opts={width:400,height:300,margin:5,gap:3,copies:12,rotate:true};
 const result=nest(Array.from({length:3},(_,i)=>({...part,id:`disc${i}`,name:`disc${i}`})),opts);
 expect(result.unplaced).toEqual([]);expect(result.total).toBe(36);expect(result.outlineTolerance).toBeGreaterThan(0);
 const placed=result.sheets.flat();expect(placed).toHaveLength(36);
 for(const shape of placed){expect(shape.contours.map(c=>c.points.length)).toEqual([4000,400,2]);expect(shape.contours[2].closed).toBe(false);}
 for(const sheet of result.sheets)for(let i=0;i<sheet.length;i++){
  const b=bounds(sheet[i]);expect(b.x).toBeGreaterThanOrEqual(5);expect(b.y).toBeGreaterThanOrEqual(5);expect(b.x+b.width).toBeLessThanOrEqual(395.00001);expect(b.y+b.height).toBeLessThanOrEqual(295.00001);
  for(let j=0;j<i;j++)expect(shapesCollide(sheet[i],sheet[j],2.999)).toBe(false);
 }
});
test('open paths outside every closed outline make the part nest by its convex hull',()=>{
 const part:Shape={id:'tag',name:'tag',contours:[{closed:true,points:[{x:0,y:0},{x:10,y:0},{x:10,y:10},{x:0,y:10}]},{closed:false,points:[{x:10,y:5},{x:30,y:5}]}]};
 const result=nest([part],{width:100,height:40,margin:0,gap:1,copies:3,rotate:false});
 expect(result.unplaced).toEqual([]);
 const sheet=result.sheets[0];for(let i=0;i<sheet.length;i++)for(let j=0;j<i;j++)expect(shapesCollide(sheet[i],sheet[j],0.999)).toBe(false);
 expect(()=>nest([{id:'line',name:'line',contours:[{closed:false,points:[{x:0,y:0},{x:5,y:5}]}]}],{width:100,height:40,margin:0,gap:1,copies:1,rotate:false})).toThrow(/closed/);
});
test('each part can have its own quantity, and 0 leaves it out',()=>{
 const opts={width:200,height:200,margin:2,gap:2,copies:1,rotate:false};
 const result=nest([rect('a',0,0,20,15),rect('b',0,0,12,12),rect('c',0,0,10,10)],{...opts,counts:[2,0,3]});
 expect(result.total).toBe(5);expect(result.unplaced).toEqual([]);
 const names=result.sheets.flat().map(s=>s.name).sort();
 expect(names).toEqual(['a','a','c','c','c']);
 expect(nest([rect('a',0,0,20,15)],opts).total).toBe(1);
 expect(()=>nest([rect('a',0,0,20,15)],{...opts,counts:[0]})).toThrow();
 expect(()=>nest([rect('a',0,0,20,15)],{...opts,counts:[1.5]})).toThrow();
 expect(()=>nest([rect('a',0,0,20,15),rect('b',0,0,5,5)],{...opts,counts:[1]})).toThrow();
});
test('engravings and holes drawn as their own shapes travel with the part they lie on', () => {
  const circle = (id: string, cx: number, cy: number, r: number, layer?: 'engrave'): Shape => ({ id, name: id, contours: [{ closed: true, ...(layer ? { layer } : {}), points: Array.from({ length: 24 }, (_, i) => ({ x: cx + r * Math.cos(i * Math.PI / 12), y: cy + r * Math.sin(i * Math.PI / 12) })) }] });
  const plate: Shape = { id: 'plate', name: 'plate', contours: [rect('o', 0, 0, 100, 60).contours[0], rect('h', 60, 10, 30, 30).contours[0]] };
  const shapes = [
    circle('logo', 25, 30, 10, 'engrave'), plate, circle('hole', 25, 30, 3),
    { id: 'text', name: 'text', contours: [{ closed: false, layer: 'engrave' as const, points: [{ x: 5, y: 50 }, { x: 40, y: 50 }] }] },
    rect('in-cutout', 65, 15, 10, 10), rect('other', 120, 0, 20, 20),
    { id: 'stray', name: 'stray', contours: [{ closed: false, points: [{ x: 150, y: 5 }, { x: 190, y: 5 }] }] },
  ];
  const { drawing, loose } = partsForNesting({ width: 200, height: 100, shapes });
  expect(drawing.shapes.map(s => s.id)).toEqual(['plate', 'in-cutout', 'other']);
  expect(drawing.shapes[0].contours).toHaveLength(5);
  expect(loose).toBe(1);
  const result = nest(drawing.shapes, { width: 300, height: 200, margin: 2, gap: 2, copies: 1, rotate: false });
  const placed = result.sheets[0].find(s => s.id.startsWith('plate'))!;
  const box = bounds(placed), logo = placed.contours.find(c => c.layer === 'engrave' && c.closed)!;
  for (const p of logo.points) { expect(p.x).toBeGreaterThan(box.x); expect(p.x).toBeLessThan(box.x + box.width); }
});
test('a compound path of many separate pieces nests as separate parts, holes and marks kept', () => {
  const sq = (x: number, y: number, w: number) => ({ closed: true, points: [{ x, y }, { x: x + w, y }, { x: x + w, y: y + w }, { x, y: y + w }] });
  const layer: Shape = { id: 'layer', name: 'buildings', contours: [
    sq(0, 0, 30), sq(10, 10, 10), sq(13, 13, 4), // a piece, its hole, and an island in the hole
    sq(50, 0, 20), sq(80, 0, 20),
    { closed: false, layer: 'engrave', points: [{ x: 52, y: 5 }, { x: 60, y: 5 }] },
  ] };
  const { drawing } = partsForNesting({ width: 120, height: 40, shapes: [layer] });
  expect(drawing.shapes).toHaveLength(4);
  const sizes = drawing.shapes.map(s => s.contours.length).sort();
  expect(sizes).toEqual([1, 1, 2, 2]);
  const marked = drawing.shapes.find(s => s.contours.some(c => c.layer === 'engrave'))!;
  expect(bounds(marked).x).toBe(50);
});

test('a big job of hundreds of parts packs quickly, without overlaps, inside the margins', () => {
  // 900 pieces from one compound layer, of random sizes: too many to fit outline by outline.
  let seed = 7; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const contours = Array.from({ length: 900 }, (_, i) => { const x = (i % 30) * 40, y = Math.floor(i / 30) * 40, w = 3 + rnd() * 25, h = 3 + rnd() * 25; return { closed: true, points: [{ x, y }, { x: x + w, y }, { x: x + w, y: y + h }, { x, y: y + h }] }; });
  const { drawing } = partsForNesting({ width: 1200, height: 1200, shapes: [{ id: 'layer', name: 'layer', contours }] });
  expect(drawing.shapes).toHaveLength(900);
  const o = { width: 500, height: 700, margin: 5, gap: 3, copies: 1, rotate: true };
  const started = Date.now(), r = nest(drawing.shapes, o);
  // Packing tries rules for up to 6 s and compaction stops at 14 s; the browser allows 30 s.
  expect(Date.now() - started).toBeLessThan(20000);
  expect(r.byBounds).toBe(true);
  expect(r.unplaced).toEqual([]);
  expect(r.sheets.flat()).toHaveLength(900);
  let outside = 0, touching = 0;
  for (const sheet of r.sheets) {
    const boxes = sheet.map(bounds);
    for (const b of boxes) if (b.x < 5 || b.y < 5 || b.x + b.width > 495 || b.y + b.height > 695) outside++;
    for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
      const a = boxes[i], b = boxes[j];
      // Rectangle parts: the distance between their rectangles is the distance between the parts.
      const dx = Math.max(0, b.x - (a.x + a.width), a.x - (b.x + b.width)), dy = Math.max(0, b.y - (a.y + a.height), a.y - (b.y + b.height));
      if (Math.hypot(dx, dy) < 3 - 1e-6) touching++;
    }
  }
  expect({ outside, touching }).toEqual({ outside: 0, touching: 0 });
});

// A 40 × 10 bar drawn turned by `deg` degrees around (cx, cy).
const bar = (id: string, cx: number, cy: number, deg: number): Shape => {
  const a = deg * Math.PI / 180, c = Math.cos(a), s = Math.sin(a);
  return { id, name: id, contours: [{ closed: true, points: [[-20, -5], [20, -5], [20, 5], [-20, 5]].map(([x, y]) => ({ x: cx + x * c - y * s, y: cy + x * s + y * c })) }] };
};

test('a part drawn at an angle finds the turn that gives its smallest bounding rectangle', () => {
  for (const deg of [0, 17, 30, 45, 80]) {
    const shape = bar('b', 50, 50, deg), b = bounds(normalize(shape, snugAngle(shape)));
    expect(b.width * b.height).toBeCloseTo(400, 3);
  }
  expect(snugAngle(rect('r', 0, 0, 30, 20))).toBe(0);
});

test('turning pieces to any angle packs tilted parts on fewer sheets, small jobs and big', () => {
  for (const count of [40, 300]) {
    const shapes = Array.from({ length: count }, (_, i) => bar(`b${i}`, 30 + (i % 10) * 60, 30 + Math.floor(i / 10) * 60, 20 + (i * 13) % 50));
    const o = { width: 200, height: 150, margin: 2, gap: 2, copies: 1, rotate: true };
    const square = nest(shapes, o), turned = nest(shapes, { ...o, anyAngle: true });
    expect(turned.unplaced).toEqual([]);
    expect(turned.sheets.length).toBeLessThan(square.sheets.length);
    for (const sheet of turned.sheets) for (const part of sheet) { const b = bounds(part); expect(b.x).toBeGreaterThanOrEqual(2); expect(b.x + b.width).toBeLessThanOrEqual(198 + 1e-6); }
  }
});

test('after packing by rectangle, outlines are pressed together without touching, saving sheets', () => {
  type P = { x: number; y: number };
  const segDist = (p: P, a: P, b: P) => { const dx = b.x - a.x, dy = b.y - a.y, l = dx * dx + dy * dy, t = l ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / l)) : 0; return Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy); };
  const crosses = (a: P, b: P, c: P, d: P) => { const o = (p: P, q: P, r: P) => Math.sign((q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x)); return o(a, b, c) * o(a, b, d) < 0 && o(c, d, a) * o(c, d, b) < 0; };
  const gapBetween = (A: P[], B: P[]) => {
    let m = Infinity;
    for (let i = 0; i < A.length; i++) for (let j = 0; j < B.length; j++) {
      const a = A[i], a2 = A[(i + 1) % A.length], b = B[j], b2 = B[(j + 1) % B.length];
      if (crosses(a, a2, b, b2)) return 0;
      m = Math.min(m, segDist(a, b, b2), segDist(a2, b, b2), segDist(b, a, a2), segDist(b2, a, a2));
    }
    return m;
  };
  const tri = (i: number): Shape => { const s = 15 + (i * 7) % 20; return { id: `t${i}`, name: `t${i}`, contours: [{ closed: true, points: [{ x: 0, y: 0 }, { x: s, y: 0 }, { x: 0, y: s }] }] }; };
  const shapes = Array.from({ length: 400 }, (_, i) => tri(i));
  const o = { width: 300, height: 300, margin: 5, gap: 2, copies: 1, rotate: true };
  const r = nest(shapes, o);
  expect(r.byBounds).toBe(true);
  expect(r.unplaced).toEqual([]);
  expect(r.sheets.flat()).toHaveLength(400);
  // Rectangles alone need 4 sheets for these triangles.
  expect(r.sheets.length).toBeLessThanOrEqual(3);
  let closest = Infinity, outside = 0;
  for (const sheet of r.sheets) {
    const rings = sheet.map(s => s.contours[0].points), boxes = sheet.map(bounds);
    boxes.forEach(b => { if (b.x < 5 - 1e-6 || b.y < 5 - 1e-6 || b.x + b.width > 295 + 1e-6 || b.y + b.height > 295 + 1e-6) outside++; });
    for (let i = 0; i < rings.length; i++) for (let j = i + 1; j < rings.length; j++) {
      const a = boxes[i], b = boxes[j];
      if (a.x > b.x + b.width + 3 || b.x > a.x + a.width + 3 || a.y > b.y + b.height + 3 || b.y > a.y + a.height + 3) continue;
      closest = Math.min(closest, gapBetween(rings[i], rings[j]));
    }
  }
  expect(outside).toBe(0);
  expect(closest).toBeGreaterThanOrEqual(2 - 1e-6);
});

test('resizing can size the design itself, not the page it was drawn on', () => {
  // A 40 × 20 outline at (20, 30) on a 100 × 100 page.
  const d = { width: 100, height: 100, shapes: [rect('a', 20, 30, 40, 20)] };
  expect(artworkBounds(d)).toEqual({ x: 20, y: 30, width: 40, height: 20 });
  const out = repeatDrawing(d, 80, 40, 2, 1, 5, 'artwork');
  expect(out.width).toBe(165); expect(out.height).toBe(40);
  expect(out.shapes.map(bounds)).toEqual([{ x: 0, y: 0, width: 80, height: 40 }, { x: 85, y: 0, width: 80, height: 40 }]);
  // The page as drawn, margins included, as before.
  expect(bounds(repeatDrawing(d, 80, 40, 1, 1, 0).shapes[0])).toEqual({ x: 16, y: 12, width: 32, height: 8 });
});
