import type { Contour, Drawing, Point, Shape } from './types';

type Pair = { code: number; value: string };
type Entity = { type: string; pairs: Pair[] };
type Options = { unit?: 'mm' | 'cm' | 'in'; physicalWidthMm?: number };
type Vertex = Point & { bulge: number };
const TAU = Math.PI * 2;
function fail(message: string): never { throw new Error(`DXF: ${message}`); }
const values = (e: Entity, code: number) => e.pairs.filter(p => p.code === code).map(p => p.value);
function number(value: string | undefined, fallback?: number): number {
  if (value === undefined) return fallback === undefined ? fail('Missing required coordinate or number.') : fallback;
  if (!value.trim() || !Number.isFinite(Number(value))) fail('Invalid coordinate or number.');
  return Number(value);
}
const num = (e: Entity, code: number, fallback?: number) => number(values(e, code)[0], fallback);
const xy = (e: Entity, code = 10): Point => ({ x: num(e, code), y: num(e, code + 10) });
const same = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y) < 1e-9;

function read(source: string): { entities: Entity[]; units: number } {
  if (source.length > 32 * 1024 * 1024 || new TextEncoder().encode(source).length > 32 * 1024 * 1024) fail('File exceeds the 32 MB limit.');
  if (source.startsWith('AutoCAD Binary DXF') || source.includes('\0')) fail('Binary DXF is unsupported; export ASCII DXF.');
  const lines = source.replace(/^\uFEFF/, '').replace(/\r/g, '').split('\n');
  while (lines.length && !lines[lines.length - 1].trim()) lines.pop();
  if (lines.length % 2) fail('Malformed ASCII DXF group pairs.');
  const pairs: Pair[] = [];
  for (let i = 0; i < lines.length; i += 2) {
    if (!/^\s*\d+\s*$/.test(lines[i])) fail('Invalid DXF group code.');
    pairs.push({ code: Number(lines[i]), value: lines[i + 1].trim() });
  }
  const entities: Entity[] = [];
  let section = '', units = 0, found = false, eof = false;
  for (let i = 0; i < pairs.length; i++) {
    const p = pairs[i];
    if (p.code === 999) continue;
    if (p.code === 0 && p.value === 'SECTION') {
      if (section || pairs[i + 1]?.code !== 2) fail('Malformed DXF section.');
      section = pairs[++i].value;
      if (section === 'ENTITIES') { if (found) fail('Duplicate ENTITIES section.'); found = true; }
    } else if (p.code === 0 && p.value === 'ENDSEC') {
      if (!section) fail('Unexpected ENDSEC.');
      section = '';
    } else if (p.code === 0 && p.value === 'EOF') {
      if (section || i !== pairs.length - 1) fail('Malformed DXF end of file.');
      eof = true;
    } else if (section === 'HEADER' && p.code === 9 && p.value === '$INSUNITS') {
      if (pairs[i + 1]?.code !== 70) fail('Invalid INSUNITS header.');
      units = number(pairs[++i].value);
    } else if (section === 'ENTITIES') {
      if (p.code !== 0) fail('Entity is missing its type.');
      const entity: Entity = { type: p.value, pairs: [] };
      while (i + 1 < pairs.length && pairs[i + 1].code !== 0) entity.pairs.push(pairs[++i]);
      entities.push(entity);
    }
  }
  if (!found || !eof || section) fail('Missing ENTITIES section or EOF; expected a complete ASCII DXF file.');
  return { entities, units };
}

function planar(e: Entity) {
  for (const p of e.pairs) {
    if ((p.code >= 30 && p.code <= 38) || p.code === 39) {
      if (number(p.value) !== 0) fail(`${e.type} uses a 3D plane, elevation or thickness. Export flat 2D geometry.`);
    }
  }
  if (num(e, 210, 0) !== 0 || num(e, 220, 0) !== 0 || num(e, 230, 1) !== 1) fail(`${e.type} has an unsupported extrusion plane. Flatten it before export.`);
  if (num(e, 67, 0) !== 0) fail(`${e.type} is in paper space; export model-space geometry only.`);
}

function vertices(e: Entity): Vertex[] {
  const result: Vertex[] = [];
  for (const p of e.pairs) {
    if (p.code === 10) result.push({ x: number(p.value), y: NaN, bulge: 0 });
    else if (p.code === 20 || p.code === 42) {
      const v = result.at(-1);
      if (!v) fail('Polyline vertex data is out of order.');
      if (p.code === 20) v.y = number(p.value); else v.bulge = number(p.value);
    }
    if ([40, 41, 43].includes(p.code) && number(p.value) !== 0) fail('Wide polylines are unsupported; convert their outline to closed paths.');
  }
  if (result.some(p => !Number.isFinite(p.y))) fail('Polyline vertex is missing a coordinate.');
  return result;
}

function geometry(entities: Entity[], tolerance: number): Shape[] {
  const shapes: Shape[] = [];
  let nodeCount = 0;
  const add = (points: Point[], p: Point) => {
    if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) fail('Geometry contains non-finite coordinates.');
    if (++nodeCount > 1_000_000) fail('Drawing exceeds the 1,000,000 node limit. Simplify curves before importing.');
    points.push(p);
  };
  const curve = (points: Point[], center: Point, a: Point, b: Point, start: number, sweep: number, includeStart = true) => {
    start %= TAU;
    const radius = Math.max(Math.hypot(a.x, a.y), Math.hypot(b.x, b.y));
    if (!(radius > 0)) fail('Curve has zero radius.');
    const step = Math.min(Math.PI / 8, 2 * Math.acos(Math.max(-1, 1 - tolerance / radius)));
    const count = Math.ceil(Math.abs(sweep) / Math.max(step, 1e-12));
    if (count > 20000) fail('Curve exceeds the 20,000 node limit.');
    // Include the analytic x/y extrema even for rotated ellipses.
    const ts = Array.from({ length: count + 1 }, (_, i) => i / count);
    for (const extremum of [Math.atan2(b.x, a.x), Math.atan2(b.y, a.y)])
      for (let q = -4; q <= 4; q++) {
        const t = (extremum + q * Math.PI - start) / sweep;
        if (t > 0 && t < 1) ts.push(t);
      }
    ts.sort((x, y) => x - y);
    let last = -1;
    for (const t of ts) {
      if ((!includeStart && t === 0) || t - last < 1e-12) continue;
      last = t;
      const angle = t === 1 && Math.abs(Math.abs(sweep) - TAU) < 1e-12 ? start : start + sweep * t;
      add(points, { x: center.x + a.x * Math.cos(angle) + b.x * Math.sin(angle), y: center.y + a.y * Math.cos(angle) + b.y * Math.sin(angle) });
    }
  };
  const polyline = (vs: Vertex[], closed: boolean): Contour => {
    if (vs.length < 2) fail('Polyline needs at least two vertices.');
    const points: Point[] = [];
    add(points, { x: vs[0].x, y: vs[0].y });
    for (let i = 0; i < vs.length - (closed ? 0 : 1); i++) {
      const a = vs[i], b = vs[(i + 1) % vs.length];
      if (!a.bulge) add(points, { x: b.x, y: b.y });
      else {
        const dx = b.x - a.x, dy = b.y - a.y, chord = Math.hypot(dx, dy);
        if (!chord) fail('Bulged segment has coincident endpoints.');
        const offset = chord * (1 - a.bulge * a.bulge) / (4 * a.bulge);
        const center = { x: (a.x + b.x) / 2 - dy * offset / chord, y: (a.y + b.y) / 2 + dx * offset / chord };
        const r = Math.hypot(a.x - center.x, a.y - center.y);
        curve(points, center, { x: r, y: 0 }, { x: 0, y: r }, Math.atan2(a.y - center.y, a.x - center.x), 4 * Math.atan(a.bulge), false);
        points[points.length - 1] = { x: b.x, y: b.y };
      }
    }
    return { points, closed };
  };

  for (let i = 0; i < entities.length; i++) {
    const e = entities[i];
    planar(e);
    let contour: Contour;
    if (e.type === 'LINE') {
      contour = { closed: false, points: [] };
      add(contour.points, xy(e)); add(contour.points, xy(e, 11));
    }
    else if (e.type === 'LWPOLYLINE') {
      const vs = vertices(e), flags = num(e, 70, 0);
      if (flags & ~129) fail('Unsupported LWPOLYLINE flags.');
      if (num(e, 90) !== vs.length) fail('LWPOLYLINE vertex count does not match.');
      contour = polyline(vs, !!(flags & 1));
    } else if (e.type === 'POLYLINE') {
      const flags = num(e, 70, 0);
      if (flags & ~129) fail('3D, mesh or fitted POLYLINE is unsupported. Export ordinary 2D polylines.');
      vertices(e); // Reject nonzero widths, including defaults on the POLYLINE header.
      const vs: Vertex[] = [];
      while (entities[i + 1]?.type === 'VERTEX') {
        const v = entities[++i]; planar(v);
        if (num(v, 70, 0) !== 0) fail('Fitted or 3D VERTEX is unsupported.');
        const parsed = vertices(v);
        if (parsed.length !== 1) fail('Invalid POLYLINE vertex.');
        vs.push(parsed[0]);
      }
      if (entities[++i]?.type !== 'SEQEND') fail('POLYLINE is missing SEQEND.');
      contour = polyline(vs, !!(flags & 1));
    } else if (e.type === 'CIRCLE' || e.type === 'ARC' || e.type === 'ELLIPSE') {
      const center = xy(e), points: Point[] = [];
      let a: Point, b: Point, start = 0, sweep = TAU, closed = e.type !== 'ARC';
      if (e.type === 'ELLIPSE') {
        a = xy(e, 11);
        const ratio = num(e, 40);
        if (!(ratio > 0 && ratio <= 1)) fail('ELLIPSE has an invalid axis ratio.');
        b = { x: -a.y * ratio, y: a.x * ratio };
        start = num(e, 41, 0); const end = num(e, 42, TAU);
        sweep = ((end - start) % TAU + TAU) % TAU || TAU;
        closed = Math.abs(sweep - TAU) < 1e-9;
      } else {
        const r = num(e, 40);
        if (!(r > 0)) fail('Circle or arc radius must be positive.');
        a = { x: r, y: 0 }; b = { x: 0, y: r };
        if (e.type === 'ARC') {
          start = num(e, 50) * Math.PI / 180;
          sweep = ((num(e, 51) * Math.PI / 180 - start) % TAU + TAU) % TAU;
          if (!sweep) fail('ARC has a zero sweep.');
        }
      }
      curve(points, center, a, b, start, sweep);
      contour = { points, closed };
    } else if (e.type === 'SPLINE') {
      const points: Point[] = [];
      const spline = splineEvaluator(e);
      const distance = (p: Point, a: Point, b: Point) => {
        const dx = b.x - a.x, dy = b.y - a.y, length2 = dx * dx + dy * dy;
        const t = length2 ? Math.max(0, Math.min(1, ((p.x-a.x)*dx+(p.y-a.y)*dy)/length2)) : 0;
        return Math.hypot(p.x-a.x-t*dx,p.y-a.y-t*dy);
      };
      const flatten = (start: number, end: number, a: Point, b: Point, depth: number) => {
        const dt = end - start;
        const mid = spline.at(start + dt / 2);
        const error = Math.max(distance(mid,a,b), distance(spline.at(start+dt/4),a,b), distance(spline.at(start+3*dt/4),a,b));
        if (error <= tolerance) add(points,b);
        else {
          if (depth >= 20) fail('SPLINE cannot be flattened accurately within the complexity limit.');
          flatten(start,start+dt/2,a,mid,depth+1); flatten(start+dt/2,end,mid,b,depth+1);
        }
      };
      add(points,spline.at(spline.breaks[0]));
      for (let j=1;j<spline.breaks.length;j++) {
        // Seed each knot span to avoid missing inflections in high-degree curves.
        const start=spline.breaks[j-1], step=(spline.breaks[j]-start)/8;
        for(let k=0;k<8;k++) flatten(start+k*step,start+(k+1)*step,points[points.length-1],spline.at(start+(k+1)*step),0);
      }
      if (spline.closed && !same(points[0],points[points.length-1])) fail('Closed SPLINE endpoints do not meet. Export a closed polyline.');
      contour = {points,closed:spline.closed};
    } else fail(`Unsupported entity ${e.type}. Convert it to flat LINE, POLYLINE, LWPOLYLINE, CIRCLE, ARC, ELLIPSE or SPLINE geometry before import.`);
    if (contour.closed && same(contour.points[0], contour.points[contour.points.length - 1])) contour.points.pop();
    if (contour.points.length < 2 || contour.points.every(p => same(p, contour.points[0]))) fail(`${e.type} has no usable length.`);
    shapes.push({ id: `dxf-${shapes.length + 1}`, name: values(e, 8)[0] || e.type, contours: [contour] });
    if (shapes.length > 5000) fail('Drawing exceeds the 5,000 shape limit.');
  }
  if (!shapes.length) fail('No cut geometry found in ENTITIES.');
  return shapes;
}

/** Evaluate a control-point NURBS in homogeneous coordinates using de Boor's algorithm. */
function splineEvaluator(e: Entity) {
  const degree = num(e,71), flags = num(e,70,0);
  if (!Number.isInteger(degree) || degree<1 || degree>5 || flags & ~31) fail('Unsupported SPLINE degree or flags; supported degrees are 1–5.');
  const xs=values(e,10).map(v=>number(v)), ys=values(e,20).map(v=>number(v));
  const knots=values(e,40).map(v=>number(v)), weights=values(e,41).map(v=>number(v));
  if (!xs.length) fail('Fit-point-only SPLINE is unsupported; export control points or flatten it to a polyline.');
  if (xs.length>20000 || knots.length>20006) fail('SPLINE exceeds the 20,000 node limit.');
  if (xs.length!==ys.length || xs.length!==num(e,73) || knots.length!==num(e,72) || knots.length!==xs.length+degree+1 || xs.length<=degree) fail('Malformed SPLINE control points or knot count.');
  if (weights.length && (weights.length!==xs.length || weights.some(w=>w<=0))) fail('SPLINE requires one positive weight per control point.');
  if (knots.some((v,i)=>i>0 && v<knots[i-1]) || !(knots[degree]<knots[xs.length])) fail('SPLINE knots must be ordered with a nonzero domain.');
  const breaks=[...new Set(knots.slice(degree,xs.length+1))];
  let multiplicity=0,lastKnot=NaN;
  for(const knot of knots) {
    multiplicity=knot===lastKnot?multiplicity+1:1;lastKnot=knot;
    if(knot>breaks[0] && knot<breaks[breaks.length-1] && multiplicity>degree) fail('Discontinuous SPLINE is unsupported. Split it into separate paths.');
  }
  const at=(t:number):Point=>{
    let span=xs.length-1;
    if(t<knots[xs.length]) {
      let low=degree,high=xs.length;
      while(low+1<high) {const mid=Math.floor((low+high)/2);if(knots[mid]<=t)low=mid;else high=mid;}
      span=low;
    }
    const d=Array.from({length:degree+1},(_,j)=>{const i=span-degree+j,w=weights[i]??1;return [xs[i]*w,ys[i]*w,w];});
    for(let r=1;r<=degree;r++) for(let j=degree;j>=r;j--) {
      const i=span-degree+j,denominator=knots[i+degree-r+1]-knots[i];
      const alpha=denominator?(t-knots[i])/denominator:0;
      for(let axis=0;axis<3;axis++)d[j][axis]=(1-alpha)*d[j-1][axis]+alpha*d[j][axis];
    }
    return {x:d[degree][0]/d[degree][2],y:d[degree][1]/d[degree][2]};
  };
  return {at,breaks,closed:!!(flags&3)};
}

function bounds(shapes: Shape[]) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const s of shapes) for (const c of s.contours) for (const p of c.points) {
    minX = Math.min(minX, p.x); minY = Math.min(minY, p.y); maxX = Math.max(maxX, p.x); maxY = Math.max(maxY, p.y);
  }
  return { minX, minY, maxX, maxY, width: maxX - minX, height: maxY - minY };
}

type Segment = { a: Point; b: Point; minX: number; minY: number; maxX: number; maxY: number };
const TOUCH_EPSILON = 1e-9;
function segments(points: Point[]): Segment[] {
  return points.map((a,i)=>{const b=points[(i+1)%points.length];return {
    a,b,minX:Math.min(a.x,b.x),minY:Math.min(a.y,b.y),maxX:Math.max(a.x,b.x),maxY:Math.max(a.y,b.y),
  };});
}
function overlaps(a: Segment | ReturnType<typeof bounds>, b: Segment | ReturnType<typeof bounds>) {
  return a.minX<=b.maxX+TOUCH_EPSILON && b.minX<=a.maxX+TOUCH_EPSILON && a.minY<=b.maxY+TOUCH_EPSILON && b.minY<=a.maxY+TOUCH_EPSILON;
}
function boundariesTouch(first: Segment[], second: Segment[]): boolean {
  // Sweep segment bounds in X, comparing only simultaneously active segments from opposite contours.
  const events=[first,second].flatMap((list,owner)=>list.flatMap(segment=>[
    {x:segment.minX-TOUCH_EPSILON,start:true,owner,segment},
    {x:segment.maxX+TOUCH_EPSILON,start:false,owner,segment},
  ])).sort((a,b)=>a.x-b.x || Number(b.start)-Number(a.start));
  const active=[new Set<Segment>(),new Set<Segment>()];
  const side=(a:Point,b:Point,p:Point)=>{
    const cross=(b.x-a.x)*(p.y-a.y)-(b.y-a.y)*(p.x-a.x);
    return Math.abs(cross)<=TOUCH_EPSILON*Math.max(1,Math.hypot(b.x-a.x,b.y-a.y))?0:Math.sign(cross);
  };
  for(const event of events) {
    const s=event.segment;
    if(!event.start) {active[event.owner].delete(s);continue;}
    for(const t of active[1-event.owner]) {
      if(!overlaps(s,t))continue;
      if(side(s.a,s.b,t.a)*side(s.a,s.b,t.b)<=0 && side(t.a,t.b,s.a)*side(t.a,t.b,s.b)<=0)return true;
    }
    active[event.owner].add(s);
  }
  return false;
}
function inside(point: Point, polygon: Point[]) {
  let contained=false;
  for(let i=0,j=polygon.length-1;i<polygon.length;j=i++) {
    const a=polygon[i],b=polygon[j];
    if((a.y>point.y)!==(b.y>point.y) && point.x<(b.x-a.x)*(point.y-a.y)/(b.y-a.y)+a.x)contained=!contained;
  }
  return contained;
}

/**
 * DXF has no compound paths: infer nesting parts by strict geometric containment.
 * Every disjoint enclosed closed contour stays with its outermost enclosing contour;
 * open contours and any contour touching/crossing another closed boundary stay separate.
 * Preserve contour coordinates and closure; combine distinct entity/layer names in the shape name.
 */
function groupContained(shapes: Shape[]): Shape[] {
  const boxes=shapes.map(s=>bounds([s]));
  const paths=shapes.map(s=>s.contours[0]);
  const edges=paths.map(c=>c.closed?segments(c.points):[]);
  const blocked=new Set<number>();
  const containers=shapes.map(()=>[] as number[]);
  const encloses=(a:ReturnType<typeof bounds>,b:ReturnType<typeof bounds>)=>a.minX<=b.minX && a.minY<=b.minY && a.maxX>=b.maxX && a.maxY>=b.maxY;
  for(let i=0;i<shapes.length;i++) for(let j=i+1;j<shapes.length;j++) {
    if(!paths[i].closed || !paths[j].closed || !overlaps(boxes[i],boxes[j]))continue;
    if(boundariesTouch(edges[i],edges[j])) {blocked.add(i);blocked.add(j);continue;}
    if(encloses(boxes[i],boxes[j]) && inside(paths[j].points[0],paths[i].points))containers[j].push(i);
    if(encloses(boxes[j],boxes[i]) && inside(paths[i].points[0],paths[j].points))containers[i].push(j);
  }
  const roots=shapes.map((_,i)=>{
    if(blocked.has(i))return i;
    const candidates=containers[i].filter(j=>!blocked.has(j));
    // The largest enclosing bounds identify the outermost contour in a disjoint containment chain.
    return candidates.reduce((root,j)=>boxes[j].width*boxes[j].height>boxes[root].width*boxes[root].height?j:root,i);
  });
  return shapes.flatMap((shape,i)=>{
    if(roots[i]!==i)return [];
    const children=shapes.filter((_,j)=>j!==i && roots[j]===i);
    return [{...shape,name:[...new Set([shape.name,...children.map(s=>s.name)])].join(' / '),contours:[...shape.contours,...children.flatMap(s=>s.contours)]}];
  });
}

const TEXT_ENTITIES = new Set(['TEXT', 'MTEXT', 'ATTDEF', 'ATTRIB']);
/** Import strict, flat ASCII DXF as mm coordinates, with screen Y down and contained closed contours grouped. */
export function parseDxf(source: string, options: Options = {}): Drawing {
  const parsed = read(source), units = parsed.units;
  // Live text has no outline geometry without its font; leave it out and report it.
  const entities = parsed.entities.filter(e => !TEXT_ENTITIES.has(e.type)), skippedText = parsed.entities.length - entities.length;
  if (skippedText && !entities.length) fail('This DXF contains only text. Convert text to curves before importing.');
  const unitScales: Record<number, number> = { 1: 25.4, 2: 304.8, 4: 1, 5: 10, 6: 1000, 7: 1000000, 8: 0.0000254, 9: 0.0254, 10: 914.4, 11: 1e-7, 12: 1e-6, 13: 0.001, 14: 100, 15: 10000, 16: 100000 };
  let scale = options.unit ? { mm: 1, cm: 10, in: 25.4 }[options.unit] : unitScales[units];
  if (!scale) fail(units === 0 ? 'This file is unitless. Choose mm, cm or inches explicitly.' : `Unsupported INSUNITS ${units}; choose the source unit explicitly.`);
  // An explicit target width needs a coarse bounds pass before choosing the final mm tolerance.
  let shapes = geometry(entities, options.physicalWidthMm === undefined ? 0.05 / scale : Infinity);
  let box = bounds(shapes);
  if (options.physicalWidthMm !== undefined) {
    if (!Number.isFinite(options.physicalWidthMm) || options.physicalWidthMm <= 0 || box.width <= 0) fail('Physical width must be positive and the drawing must have nonzero width.');
    scale = options.physicalWidthMm / box.width;
    shapes = geometry(entities, 0.05 / scale);
    box = bounds(shapes);
    scale = options.physicalWidthMm / box.width;
  }
  for (const s of shapes) for (const c of s.contours) for (const p of c.points) {
    p.x = (p.x - box.minX) * scale; p.y = (box.maxY - p.y) * scale;
    if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) fail('Scaled geometry exceeds numeric limits.');
  }
  return { width: box.width ? box.width * scale : 1, height: box.height ? box.height * scale : 1, shapes: groupContained(shapes), ...(skippedText ? { skippedText } : {}) };
}
