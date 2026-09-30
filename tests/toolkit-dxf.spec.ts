import { test, expect } from '@playwright/test';
import { parseDxf } from '../src/toolkit/dxf-import';
import { toDxf } from '../src/toolkit/export';
import type { Contour } from '../src/toolkit/types';

const dxf = (entities: (string | number)[], units: number | null = 4) => [0,'SECTION',2,'HEADER',...(units === null ? [] : [9,'$INSUNITS',70,units]),0,'ENDSEC',0,'SECTION',2,'ENTITIES',...entities,0,'ENDSEC',0,'EOF'].join('\n');
const line = [0,'LINE',10,-5,20,10,11,15,21,40];

test('R12 exported contours keep dimensions, closedness and y direction', () => {
  const drawing = {width:40,height:30,shapes:[{id:'one',name:'part',contours:[{closed:true,points:[{x:5,y:5},{x:35,y:5},{x:35,y:25}]}]}]};
  const result = parseDxf(toDxf(drawing));
  expect(result.width).toBe(30); expect(result.height).toBe(20);
  expect(result.shapes[0].contours[0]).toEqual({closed:true,points:[{x:0,y:0},{x:30,y:0},{x:30,y:20}]});
});
test('units are explicit and inch/cm dimensions convert to millimetres', () => {
  expect(() => parseDxf(dxf(line, null))).toThrow(/unit/i);
  expect(() => parseDxf(dxf(line, 0))).toThrow(/unit/i);
  expect(parseDxf(dxf(line, null), {unit:'cm'}).width).toBe(200);
  expect(parseDxf(dxf(line, 1)).width).toBe(508);
  expect(parseDxf(dxf(line, 5)).height).toBe(300);
  expect(parseDxf(dxf(line), {physicalWidthMm:100}).height).toBe(150);
});
test('open and axis-aligned lines remain usable', () => {
  const result = parseDxf(dxf([0,'LINE',10,0,20,0,11,10,21,0]));
  expect(result.width).toBe(10); expect(result.height).toBe(1);
  expect(result.shapes[0].contours[0].closed).toBe(false);
});
test('LWPOLYLINE bulge preserves semicircle and closing segment', () => {
  const result = parseDxf(dxf([0,'LWPOLYLINE',90,2,70,1,10,0,20,0,42,1,10,20,20,0]));
  expect(result.width).toBeCloseTo(20); expect(result.height).toBeCloseTo(10,1);
  const contour = result.shapes[0].contours[0];
  expect(contour.closed).toBe(true); expect(contour.points.length).toBeGreaterThan(8);
  expect(contour.points[0]).not.toEqual(contour.points.at(-1));
});
test('circle arc and rotated ellipse flatten to open/closed cut paths', () => {
  const circle = parseDxf(dxf([0,'CIRCLE',10,0,20,0,40,10]));
  expect(circle.width).toBeCloseTo(20); expect(circle.height).toBeCloseTo(20);
  expect(circle.shapes[0].contours[0].closed).toBe(true);
  const arc = parseDxf(dxf([0,'ARC',10,0,20,0,40,10,50,0,51,90]));
  expect(arc.width).toBeCloseTo(10); expect(arc.height).toBeCloseTo(10);
  expect(arc.shapes[0].contours[0].closed).toBe(false);
  const ellipse = parseDxf(dxf([0,'ELLIPSE',10,0,20,0,11,0,21,10,40,0.5,41,0,42,Math.PI*2]));
  expect(ellipse.width).toBeCloseTo(10); expect(ellipse.height).toBeCloseTo(20);
});
test('live text is ignored and reported, text-only drawings explain curves', () => {
  const drawing = parseDxf(dxf([...line,0,'TEXT',10,0,20,0,40,5,1,'Hello',0,'MTEXT',10,0,20,0,40,5,1,'World']));
  expect(drawing.shapes).toHaveLength(1); expect(drawing.skippedText).toBe(2);
  expect(parseDxf(dxf(line)).skippedText).toBeUndefined();
  expect(() => parseDxf(dxf([0,'TEXT',10,0,20,0,40,5,1,'Hello']))).toThrow(/curves/);
});
test('unsupported entities and 3D planes fail rather than lose paths', () => {
  for (const type of ['INSERT','HATCH','DIMENSION','3DFACE']) expect(() => parseDxf(dxf([...line,0,type]))).toThrow(new RegExp(type));
  expect(() => parseDxf(dxf([...line,30,2]))).toThrow(/3D|plane/i);
  expect(() => parseDxf(dxf([0,'CIRCLE',10,0,20,0,40,10,230,-1]))).toThrow(/extrusion|plane/i);
});
test('malformed, empty and excessive inputs are rejected', () => {
  expect(() => parseDxf('not a DXF')).toThrow(/DXF/i);
  expect(() => parseDxf(dxf([]))).toThrow(/geometry|entities/i);
  expect(() => parseDxf(dxf([0,'LINE',10,'NaN',20,0,11,10,21,0]))).toThrow(/number|coordinate/i);
  expect(() => parseDxf(dxf(Array.from({length:5001},()=>line).flat()))).toThrow(/5,000 shape/);
  expect(() => parseDxf(' '.repeat(32 * 1024 * 1024 + 1))).toThrow(/32 MB/);
});
test('submillimetre geometry retains actual dimensions', () => {
  const result = parseDxf(dxf([0,'CIRCLE',10,0,20,0,40,0.1]));
  expect(result.width).toBeCloseTo(0.2); expect(result.height).toBeCloseTo(0.2);
});
test('rational quadratic SPLINE reproduces a quarter circle', () => {
  const result = parseDxf(dxf([0,'SPLINE',70,12,71,2,72,6,73,3,74,0,
    40,0,40,0,40,0,40,1,40,1,40,1,41,1,41,Math.SQRT1_2,41,1,
    10,10,20,0,30,0,10,10,20,10,30,0,10,0,20,10,30,0]));
  expect(result.width).toBeCloseTo(10); expect(result.height).toBeCloseTo(10);
  const c = result.shapes[0].contours[0];
  expect(c.closed).toBe(false); expect(c.points.length).toBeGreaterThan(5);
  for (const p of c.points) expect(Math.hypot(p.x, 10-p.y)).toBeCloseTo(10,6);
});
test('fit-point-only and malformed SPLINEs reject explicitly', () => {
  expect(() => parseDxf(dxf([0,'SPLINE',70,8,71,3,72,0,73,0,74,2,11,0,21,0,11,10,21,10]))).toThrow(/SPLINE/);
});
test('rotated ellipse keeps its analytic extents', () => {
  const r = parseDxf(dxf([0,'ELLIPSE',10,0,20,0,11,10,21,10,40,0.5,41,0,42,Math.PI*2]));
  expect(r.width).toBeCloseTo(2*Math.sqrt(125),6); expect(r.height).toBeCloseTo(r.width,6);
});
test('negative bulges mirror the source arc without reversing its endpoints', () => {
  const make=(bulge:number)=>parseDxf(dxf([0,'LWPOLYLINE',90,2,70,0,10,0,20,0,42,bulge,10,20,20,0])).shapes[0].contours[0];
  const positive=make(1), negative=make(-1);
  expect(positive.points[0].y).toBeCloseTo(0);
  expect(negative.points[0].y).toBeCloseTo(10);
  expect(positive.points.at(-1)?.x).toBeCloseTo(20);
  expect(negative.points.at(-1)?.x).toBeCloseTo(20);
});
test('wrapped arc angles retain the short counterclockwise arc', () => {
  const r=parseDxf(dxf([0,'ARC',10,0,20,0,40,10,50,350,51,10]));
  expect(r.height).toBeCloseTo(20*Math.sin(Math.PI/18),6);
  expect(r.width).toBeCloseTo(10*(1-Math.cos(Math.PI/18)),6);
});
test('curve flattening stays within 0.1mm after physical scaling', () => {
  const r=parseDxf(dxf([0,'CIRCLE',10,0,20,0,40,1]),{physicalWidthMm:10000});
  const points=r.shapes[0].contours[0].points;
  for(let i=0;i<points.length;i++) {
    const a=points[i],b=points[(i+1)%points.length];
    const midpoint={x:(a.x+b.x)/2-5000,y:(a.y+b.y)/2-5000};
    expect(5000-Math.hypot(midpoint.x,midpoint.y)).toBeLessThan(0.1);
  }
});
test('node limits and invalid physical dimensions are enforced', () => {
  const nodes=Array.from({length:1_000_001},(_,i)=>[10,i,20,i%2]).flat();
  expect(()=>parseDxf(dxf([0,'LWPOLYLINE',90,1_000_001,70,0,...nodes]))).toThrow(/1,000,000/);
  expect(()=>parseDxf(dxf(line),{physicalWidthMm:0})).toThrow(/width/i);
  expect(()=>parseDxf(dxf(line,null),{physicalWidthMm:100})).toThrow(/unitless/i);
});
test('cubic SPLINE captures both lobes of an inflection', () => {
  const r=parseDxf(dxf([0,'SPLINE',70,8,71,3,72,8,73,4,
    40,0,40,0,40,0,40,0,40,1,40,1,40,1,40,1,
    10,0,20,0,10,10,20,20,10,20,20,-20,10,30,20,0]));
  expect(r.width).toBeCloseTo(30); expect(r.height).toBeCloseTo(20/Math.sqrt(3),0);
  expect(r.shapes[0].contours[0].points.length).toBeGreaterThan(10);
});
test('physical width scaling can simplify very large source curves before flattening', () => {
  const r=parseDxf(dxf([0,'CIRCLE',10,0,20,0,40,1e12]),{physicalWidthMm:100});
  expect(r.width).toBeCloseTo(100); expect(r.height).toBeCloseTo(100);
  expect(r.shapes[0].contours[0].points.length).toBeLessThan(1000);
});

const polygon=(points:number[][]):Contour=>({closed:true,points:points.map(([x,y])=>({x,y}))});
const rect=(x:number,y:number,w:number,h:number)=>polygon([[x,y],[x+w,y],[x+w,y+h],[x,y+h]]);
const roundtrip=(contours:Contour[])=>parseDxf(toDxf({width:100,height:100,shapes:[{id:'compound',name:'part',contours}]}));
test('DXF compound outer contour and hole roundtrip as one nesting shape', () => {
  const contours=[rect(0,0,40,30),rect(10,10,10,10)];
  const r=roundtrip(contours);
  expect(r.shapes).toHaveLength(1);
  expect(r.shapes[0].contours).toEqual(contours);
  expect(r.shapes[0].name).toBe('CUT');
});
test('nested contours join their outermost enclosing contour regardless of source order', () => {
  const contours=[rect(15,15,5,5),rect(0,0,40,40),rect(10,10,20,20)];
  const r=roundtrip(contours);
  expect(r.shapes).toHaveLength(1);
  expect(r.shapes[0].contours).toEqual([contours[1],contours[0],contours[2]]);
});
test('concave boundary crossing is not mistaken for containment', () => {
  // All rectangle vertices are inside the U, but its upper edge crosses the notch.
  const u=polygon([[0,0],[40,0],[40,40],[25,40],[25,15],[15,15],[15,40],[0,40]]);
  const r=roundtrip([u,rect(10,20,20,10),rect(60,0,10,10)]);
  expect(r.shapes).toHaveLength(3);
  expect(r.shapes.every(s=>s.contours.length===1)).toBe(true);
});
test('touching, crossing, open and uncontained contours remain separate', () => {
  const r=roundtrip([rect(0,0,40,40),rect(0,10,5,5),rect(35,20,10,10),
    {closed:false,points:[{x:10,y:10},{x:20,y:10}]},rect(60,0,10,10)]);
  expect(r.shapes).toHaveLength(5);
  expect(r.shapes[3].contours[0].closed).toBe(false);
});
test('intersecting interior contours remain separate instead of becoming holes', () => {
  const r=roundtrip([rect(0,0,40,40),rect(10,10,15,15),rect(20,20,10,10)]);
  expect(r.shapes).toHaveLength(3);
});
test('grouping preserves distinct layer names and handles dense enclosed contours', () => {
  const entities:(string|number)[]=[];
  for(const [radius,name] of [[100,'OUTER'],[50,'HOLE'],[10,'ISLAND']] as const) {
    entities.push(0,'LWPOLYLINE',8,name,90,4000,70,1);
    for(let i=0;i<4000;i++)entities.push(10,radius*Math.cos(i*Math.PI/2000),20,radius*Math.sin(i*Math.PI/2000));
  }
  const r=parseDxf(dxf(entities));
  expect(r.shapes).toHaveLength(1);
  expect(r.shapes[0].name).toBe('OUTER / HOLE / ISLAND');
  expect(r.shapes[0].contours.map(c=>c.points.length)).toEqual([4000,4000,4000]);
});
