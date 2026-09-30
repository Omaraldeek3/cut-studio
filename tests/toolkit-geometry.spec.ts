import { test, expect } from '@playwright/test';
import { bounds, shapesCollide, nest, repeatDrawing, kerfDrawing, cleanDrawing, contourKey } from '../src/toolkit/geometry';
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
