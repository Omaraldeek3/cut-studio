import type { Bounds, Contour, Drawing, NestOptions, NestResult, Point, Shape } from './types';
import { flattenCurve, mapCurve } from './path';
import { fitPolyline, straightenCurve } from './fit';

export const TOLERANCE = 0.1;
export function finite(value: number, min: number, max: number, name: string) {
  if (!Number.isFinite(value) || value < min || value > max) throw new Error(`${name}: enter a value from ${min} to ${max}.`);
  return value;
}
export function bounds(shape: Shape): Bounds {
  let x=Infinity,y=Infinity,right=-Infinity,bottom=-Infinity;
  for(const c of shape.contours) for(const p of c.points){x=Math.min(x,p.x);y=Math.min(y,p.y);right=Math.max(right,p.x);bottom=Math.max(bottom,p.y);}
  if(!Number.isFinite(x)) throw new Error('Empty geometry.');
  return {x,y,width:right-x,height:bottom-y};
}
export function mapShape(shape: Shape, fn: (p: Point)=>Point): Shape {
  return {...shape,contours:shape.contours.map(c=>({...c,points:c.points.map(fn),...(c.curve?{curve:mapCurve(c.curve,fn)}:{})}))};
}
export function moveShape(shape:Shape,x:number,y:number){return mapShape(shape,p=>({x:p.x+x,y:p.y+y}));}
export function normalize(shape:Shape,angle=0){
  const rotated=rotateShape(shape,angle);
  const b=bounds(rotated);return moveShape(rotated,-b.x,-b.y);
}
export function signedArea(points:Point[]){let sum=0;for(let i=0;i<points.length;i++){const a=points[i],b=points[(i+1)%points.length];sum+=a.x*b.y-b.x*a.y;}return sum/2;}
function inside(p:Point,points:Point[]){let yes=false;for(let i=0,j=points.length-1;i<points.length;j=i++){const a=points[i],b=points[j];if((a.y>p.y)!==(b.y>p.y)&&p.x<(b.x-a.x)*(p.y-a.y)/(b.y-a.y)+a.x)yes=!yes;}return yes;}
export function shapeArea(s:Shape){return Math.max(0,s.contours.reduce((sum,c,i)=>{if(!c.closed)return sum;const depth=s.contours.filter((o,j)=>j!==i&&o.closed&&inside(c.points[0],o.points)).length;return sum+Math.abs(signedArea(c.points))*(depth%2?-1:1);},0));}
function distPointSegment(p:Point,a:Point,b:Point){const dx=b.x-a.x,dy=b.y-a.y;const t=Math.max(0,Math.min(1,((p.x-a.x)*dx+(p.y-a.y)*dy)/(dx*dx+dy*dy||1)));return Math.hypot(p.x-a.x-t*dx,p.y-a.y-t*dy);}
function cross(a:Point,b:Point,c:Point){return(b.x-a.x)*(c.y-a.y)-(b.y-a.y)*(c.x-a.x);}
function segmentDistance(a:Point,b:Point,c:Point,d:Point){
  if(Math.max(a.x,b.x)>=Math.min(c.x,d.x)&&Math.max(c.x,d.x)>=Math.min(a.x,b.x)&&Math.max(a.y,b.y)>=Math.min(c.y,d.y)&&Math.max(c.y,d.y)>=Math.min(a.y,b.y)&&cross(a,b,c)*cross(a,b,d)<=0&&cross(c,d,a)*cross(c,d,b)<=0)return 0;
  return Math.min(distPointSegment(a,c,d),distPointSegment(b,c,d),distPointSegment(c,a,b),distPointSegment(d,a,b));
}
export function shapesCollide(a:Shape,b:Shape,gap:number):boolean {
  const ba=bounds(a),bb=bounds(b);
  if(ba.x+ba.width+gap<bb.x||bb.x+bb.width+gap<ba.x||ba.y+ba.height+gap<bb.y||bb.y+bb.height+gap<ba.y)return false;
  for(const ca of a.contours)for(const cb of b.contours){
    // Treat holes as occupied for nesting: a part cannot be placed inside a cutout.
    if(ca.closed&&inside(cb.points[0],ca.points)||cb.closed&&inside(ca.points[0],cb.points))return true;
    const pa=ca.points,pb=cb.points;
    for(let i=0;i<pa.length-(ca.closed?0:1);i++)for(let j=0;j<pb.length-(cb.closed?0:1);j++){
      const p=pa[i],q=pa[(i+1)%pa.length],r=pb[j],s=pb[(j+1)%pb.length];
      if(Math.max(p.x,q.x)+gap<Math.min(r.x,s.x)||Math.max(r.x,s.x)+gap<Math.min(p.x,q.x)||Math.max(p.y,q.y)+gap<Math.min(r.y,s.y)||Math.max(r.y,s.y)+gap<Math.min(p.y,q.y))continue;
      const distance=segmentDistance(p,q,r,s);
      if(distance<=1e-8||distance<gap-1e-8)return true;
    }
  }
  return false;
}
const NEST_NODE_BUDGET=8000;
export const MAX_NEST_PIECES=5000;
/** Above this many pieces, parts are packed by their bounding rectangles. */
export const OUTLINE_NEST_MAX=150;
const SIMPLIFY_STEPS=[0,0.05,0.1,0.2,0.35,0.5,0.75,1,1.5,2];
function boxOf(points:Point[]):Bounds{let x=Infinity,y=Infinity,right=-Infinity,bottom=-Infinity;for(const p of points){x=Math.min(x,p.x);y=Math.min(y,p.y);right=Math.max(right,p.x);bottom=Math.max(bottom,p.y);}return {x,y,width:right-x,height:bottom-y};}
function boxWithin(inner:Bounds,outer:Bounds){return inner.x>=outer.x&&inner.y>=outer.y&&inner.x+inner.width<=outer.x+outer.width&&inner.y+inner.height<=outer.y+outer.height;}
function convexHull(points:Point[]):Point[]{
  const sorted=[...points].sort((a,b)=>a.x-b.x||a.y-b.y),lower:Point[]=[],upper:Point[]=[];
  for(const p of sorted){while(lower.length>=2&&cross(lower[lower.length-2],lower[lower.length-1],p)<=0)lower.pop();lower.push(p);}
  for(let i=sorted.length-1;i>=0;i--){const p=sorted[i];while(upper.length>=2&&cross(upper[upper.length-2],upper[upper.length-1],p)<=0)upper.pop();upper.push(p);}
  return [...lower.slice(0,-1),...upper.slice(0,-1)];
}
/** Douglas-Peucker on a closed ring. Every source vertex stays within tolerance
 * of the simplified ring, and because distance to a segment is convex, so does
 * every source edge. Only source vertices are kept, so bounds never grow. */
function simplifyRing(points:Point[],tolerance:number):Point[]{
  const n=points.length;if(tolerance<=0||n<=4)return points;
  let far=0,farthest=-1;
  for(let i=1;i<n;i++){const d=Math.hypot(points[i].x-points[0].x,points[i].y-points[0].y);if(d>farthest){farthest=d;far=i;}}
  const keep=new Uint8Array(n),stack:[number,number][]=[[0,far],[far,n]];keep[0]=keep[far]=1;
  while(stack.length){
    const [a,b]=stack.pop()!,pa=points[a],pb=points[b%n];let split=-1,max=tolerance;
    for(let i=a+1;i<b;i++){const d=distPointSegment(points[i],pa,pb);if(d>max){max=d;split=i;}}
    if(split>=0){keep[split]=1;stack.push([a,split],[split,b]);}
  }
  const result=points.filter((_,i)=>keep[i]);
  return result.length>=3&&Math.abs(signedArea(result))>=0.001?result:points;
}
/** The rings that bound a part from outside. Holes and engraving inside them
 * never touch another part (nesting does not place parts inside cutouts), so
 * only these rings take part in collision tests. Anything not provably inside
 * an outer ring makes the whole part fall back to its convex hull. */
function outerRings(shape:Shape):Point[][]{
  if(shape.contours.some(c=>c.points.some(p=>!Number.isFinite(p.x)||!Number.isFinite(p.y))))throw new Error('Invalid shape coordinates.');
  const closed=shape.contours.filter(c=>c.closed&&c.layer!=='engrave'&&c.points.length>=3&&Math.abs(signedArea(c.points))>=0.001);
  if(!closed.length)throw new Error('Nesting needs closed, non-empty outlines. Use Vector cleanup to inspect open paths.');
  const info=closed.map(c=>({c,box:boxOf(c.points),area:Math.abs(signedArea(c.points))}));
  const outers=info.filter((a,i)=>!info.some((b,j)=>j!==i&&(b.area>a.area||b.area===a.area&&j<i)&&boxWithin(a.box,b.box)&&inside(a.c.points[0],b.c.points)));
  const outerContours=new Set(outers.map(o=>o.c)),closedContours=new Set(closed);
  // Holes are inside an outer by construction; open or degenerate paths must be checked.
  const covered=(points:Point[])=>{const box=boxOf(points);return outers.some(o=>boxWithin(box,o.box)&&points.length*o.c.points.length<=5_000_000&&points.every(p=>inside(p,o.c.points)));};
  const stray=shape.contours.filter(c=>!outerContours.has(c)&&!closedContours.has(c));
  if(stray.some(c=>c.points.length&&!covered(c.points)))return [convexHull(shape.contours.flatMap(c=>c.points))];
  return outers.map(o=>o.c.points);
}
/** One shape per separate piece. A compound path can hold many pieces (a
 *  traced layer of 1,000 buildings is often a single path): each outline at an
 *  even depth is a piece, with the holes directly inside it, and every other
 *  line goes with the smallest piece whose material it starts on. */
function separateParts(shape:Shape):Shape[]{
  const rings=shape.contours.filter(c=>c.closed&&c.layer!=='engrave'&&c.points.length>=3&&Math.abs(signedArea(c.points))>=0.001);
  if(rings.length<2)return [shape];
  const box=rings.map(c=>boxOf(c.points)),area=rings.map(c=>Math.abs(signedArea(c.points)));
  const holds=(i:number,p:Point)=>p.x>=box[i].x&&p.x<=box[i].x+box[i].width&&p.y>=box[i].y&&p.y<=box[i].y+box[i].height&&inside(p,rings[i].points);
  // Rings that contain each ring, smallest first: its parent is the first.
  const around=rings.map((c,i)=>rings.map((_,j)=>j).filter(j=>j!==i&&area[j]>area[i]&&holds(j,c.points[0])).sort((a,b)=>area[a]-area[b]));
  const outers=rings.map((_,i)=>i).filter(i=>around[i].length%2===0);
  if(outers.length<2)return [shape];
  const pieces=new Map(outers.map(i=>[i,[rings[i]] as Contour[]]));
  rings.forEach((c,i)=>{if(around[i].length%2===1)pieces.get(around[i][0])!.push(c);});
  const ringSet=new Set(rings),rest:Contour[]=[];
  for(const c of shape.contours){
    if(ringSet.has(c))continue;
    const p=c.points[0];
    // The innermost ring around the line's start decides: a piece's outline means its material.
    const host=p?rings.map((_,j)=>j).filter(j=>holds(j,p)).sort((a,b)=>area[a]-area[b])[0]:undefined;
    if(host!==undefined&&pieces.has(host))pieces.get(host)!.push(c);else rest.push(c);
  }
  const out=[...pieces.values()].map((contours,k)=>({...shape,id:`${shape.id}-${k+1}`,name:`${shape.name} ${k+1}`,contours}));
  return rest.length?[...out,{...shape,id:`${shape.id}-rest`,contours:rest}]:out;
}
/** Parts as a cutting job sees them. A shape that lies on another part's
 *  material (an engraving, a hole or a line drawn as its own element) travels
 *  with that part. What lies on no part and has no closed cut outline of its
 *  own cannot be placed: it is left out and counted. */
export function partsForNesting(source:Drawing):{drawing:Drawing;loose:number}{
  const d={...source,shapes:source.shapes.flatMap(separateParts)};
  const info=d.shapes.map(s=>{
    const rings=s.contours.filter(c=>c.closed&&c.layer!=='engrave'&&c.points.length>=3&&Math.abs(signedArea(c.points))>=0.001);
    return {rings,box:boxOf(s.contours.flatMap(c=>c.points)),area:rings.reduce((a,c)=>Math.max(a,Math.abs(signedArea(c.points))),0)};
  });
  // Material is inside an odd number of a part's cut rings: holes are not material.
  const onMaterial=(p:Point,rings:Contour[])=>rings.reduce((n,c)=>n+(inside(p,c.points)?1:0),0)%2===1;
  const within=(a:Bounds,b:Bounds)=>a.x>=b.x&&a.y>=b.y&&a.x+a.width<=b.x+b.width&&a.y+a.height<=b.y+b.height;
  // Possible containers, bucketed by the grid cells their bounds cover.
  const cell=Math.max(d.width,d.height,1)/64,grid=new Map<string,number[]>();
  info.forEach((x,i)=>{if(!x.rings.length)return;
    for(let gx=Math.floor(x.box.x/cell);gx<=Math.floor((x.box.x+x.box.width)/cell);gx++)for(let gy=Math.floor(x.box.y/cell);gy<=Math.floor((x.box.y+x.box.height)/cell);gy++){const k=`${gx},${gy}`,l=grid.get(k);if(l)l.push(i);else grid.set(k,[i]);}});
  const parent=d.shapes.map((s,i)=>{
    const pts=s.contours.flatMap(c=>c.points);if(!pts.length)return -1;
    const step=Math.max(1,Math.floor(pts.length/16)),samples=[...pts.filter((_,k)=>k%step===0),pts[pts.length-1]];
    let best=-1;
    for(const j of grid.get(`${Math.floor(pts[0].x/cell)},${Math.floor(pts[0].y/cell)}`)??[]){
      // Strictly larger containers only, so no shape can end up inside itself.
      if(j===i||info[j].area<=info[i].area||(best>=0&&info[j].area>=info[best].area)||!within(info[i].box,info[j].box))continue;
      if(samples.every(p=>onMaterial(p,info[j].rings)))best=j;
    }
    return best;
  });
  const root=(i:number):number=>parent[i]<0?i:root(parent[i]);
  const groups=new Map<number,number[]>();
  d.shapes.forEach((_,i)=>{const r=root(i),l=groups.get(r);if(l)l.push(i);else groups.set(r,[i]);});
  const shapes:Shape[]=[];let loose=0;
  for(const [r,members] of [...groups].sort((a,b)=>a[0]-b[0])){
    if(!info[r].rings.length){loose+=members.length;continue;}
    const own=d.shapes[r],others=members.filter(i=>i!==r).map(i=>d.shapes[i]);
    shapes.push(others.length?{...own,name:[...new Set([own.name,...others.map(o=>o.name)])].join(' / '),contours:[...own.contours,...others.flatMap(o=>o.contours)]}:own);
  }
  return {drawing:{...d,shapes},loose};
}
function rotateShape(shape:Shape,angle:number){const a=angle*Math.PI/180,cos=Math.cos(a),sin=Math.sin(a);return mapShape(shape,p=>({x:p.x*cos-p.y*sin,y:p.x*sin+p.y*cos}));}
const CHUNK=16;
// Rings keep bounding boxes for every run of CHUNK consecutive edges, so collision
// tests only compare edges whose neighbourhoods actually meet.
type Ring={xs:Float64Array;ys:Float64Array;box:Bounds;chunks:Float64Array};
type Outline={rings:Ring[];box:Bounds};
function prepare(rings:Point[][],dx=0,dy=0):Outline{
  const prepared=rings.map(points=>{
    const n=points.length,xs=new Float64Array(n),ys=new Float64Array(n),chunks=new Float64Array(Math.ceil(n/CHUNK)*4);
    points.forEach((p,i)=>{xs[i]=p.x+dx;ys[i]=p.y+dy;});
    for(let k=0;k*CHUNK<n;k++){
      let minX=Infinity,minY=Infinity,maxX=-Infinity,maxY=-Infinity;
      for(let i=k*CHUNK;i<=Math.min(n,(k+1)*CHUNK);i++){const x=xs[i%n],y=ys[i%n];minX=Math.min(minX,x);minY=Math.min(minY,y);maxX=Math.max(maxX,x);maxY=Math.max(maxY,y);}
      chunks.set([minX,minY,maxX,maxY],k*4);
    }
    const b=boxOf(points);return {xs,ys,chunks,box:{...b,x:b.x+dx,y:b.y+dy}};
  });
  const b=boxOf(rings.flat());return {rings:prepared,box:{...b,x:b.x+dx,y:b.y+dy}};
}
function insideRing(px:number,py:number,r:Ring){let yes=false;const xs=r.xs,ys=r.ys;for(let i=0,j=xs.length-1;i<xs.length;j=i++){if((ys[i]>py)!==(ys[j]>py)&&px<(xs[j]-xs[i])*(py-ys[i])/(ys[j]-ys[i])+xs[i])yes=!yes;}return yes;}
function pointSegment(px:number,py:number,ax:number,ay:number,bx:number,by:number){const dx=bx-ax,dy=by-ay;const t=Math.max(0,Math.min(1,((px-ax)*dx+(py-ay)*dy)/(dx*dx+dy*dy||1)));return Math.hypot(px-ax-t*dx,py-ay-t*dy);}
const turn=(ax:number,ay:number,bx:number,by:number,cx:number,cy:number)=>(bx-ax)*(cy-ay)-(by-ay)*(cx-ax);
/** shapesCollide for closed outlines, with `a` offset by (dx, dy) and no allocation. */
function outlinesCollide(a:Outline,dx:number,dy:number,b:Outline,gap:number){
  const ab=a.box,bb=b.box;
  if(ab.x+dx+ab.width+gap<bb.x||bb.x+bb.width+gap<ab.x+dx||ab.y+dy+ab.height+gap<bb.y||bb.y+bb.height+gap<ab.y+dy)return false;
  for(const ra of a.rings)for(const rb of b.rings){
    const x0=ra.box.x+dx,y0=ra.box.y+dy;
    if(x0+ra.box.width+gap<rb.box.x||rb.box.x+rb.box.width+gap<x0||y0+ra.box.height+gap<rb.box.y||rb.box.y+rb.box.height+gap<y0)continue;
    // One ring can only contain the other when its box contains the other's box.
    const aHoldsB=x0<=rb.box.x&&y0<=rb.box.y&&x0+ra.box.width>=rb.box.x+rb.box.width&&y0+ra.box.height>=rb.box.y+rb.box.height;
    const bHoldsA=rb.box.x<=x0&&rb.box.y<=y0&&rb.box.x+rb.box.width>=x0+ra.box.width&&rb.box.y+rb.box.height>=y0+ra.box.height;
    if(aHoldsB&&insideRing(rb.xs[0]-dx,rb.ys[0]-dy,ra)||bHoldsA&&insideRing(ra.xs[0]+dx,ra.ys[0]+dy,rb))return true;
    const axs=ra.xs,ays=ra.ys,bxs=rb.xs,bys=rb.ys,na=axs.length,nb=bxs.length,ac=ra.chunks,bc=rb.chunks;
    for(let ka=0;ka<ac.length;ka+=4){
      const cminX=ac[ka]+dx-gap,cminY=ac[ka+1]+dy-gap,cmaxX=ac[ka+2]+dx+gap,cmaxY=ac[ka+3]+dy+gap;
      if(cmaxX<rb.box.x||cminX>rb.box.x+rb.box.width||cmaxY<rb.box.y||cminY>rb.box.y+rb.box.height)continue;
      for(let kb=0;kb<bc.length;kb+=4){
        if(cmaxX<bc[kb]||cminX>bc[kb+2]||cmaxY<bc[kb+1]||cminY>bc[kb+3])continue;
        for(let i=ka/4*CHUNK,iEnd=Math.min(na,i+CHUNK);i<iEnd;i++){
          const px=axs[i]+dx,py=ays[i]+dy,qx=axs[(i+1)%na]+dx,qy=ays[(i+1)%na]+dy;
          const minX=Math.min(px,qx)-gap,maxX=Math.max(px,qx)+gap,minY=Math.min(py,qy)-gap,maxY=Math.max(py,qy)+gap;
          if(maxX<bc[kb]||minX>bc[kb+2]||maxY<bc[kb+1]||minY>bc[kb+3])continue;
          for(let j=kb/4*CHUNK,jEnd=Math.min(nb,j+CHUNK);j<jEnd;j++){
            const rx=bxs[j],ry=bys[j],sx=bxs[(j+1)%nb],sy=bys[(j+1)%nb];
            if(maxX<Math.min(rx,sx)||Math.max(rx,sx)<minX||maxY<Math.min(ry,sy)||Math.max(ry,sy)<minY)continue;
            let distance:number;
            if(Math.max(px,qx)>=Math.min(rx,sx)&&Math.max(rx,sx)>=Math.min(px,qx)&&Math.max(py,qy)>=Math.min(ry,sy)&&Math.max(ry,sy)>=Math.min(py,qy)&&turn(px,py,qx,qy,rx,ry)*turn(px,py,qx,qy,sx,sy)<=0&&turn(rx,ry,sx,sy,px,py)*turn(rx,ry,sx,sy,qx,qy)<=0)distance=0;
            else distance=Math.min(pointSegment(px,py,rx,ry,sx,sy),pointSegment(qx,qy,rx,ry,sx,sy),pointSegment(rx,ry,px,py,qx,qy),pointSegment(sx,sy,px,py,qx,qy));
            if(distance<=1e-8||distance<gap-1e-8)return true;
          }
        }
      }
    }
  }
  return false;
}
const empty:Outline={rings:[],box:{x:Infinity,y:Infinity,width:0,height:0}};
type Placement={kind:number;angle:number;x:number;y:number;id:string;name:string;outline:Outline;box:Bounds};
/** Outline nodes the compaction may work with across all part kinds. */
const COMPACT_NODE_BUDGET=60000;
type Packed={kind:number;angle:number;x:number;y:number;w:number;h:number;id:string;name:string};
/** Slides rectangle-packed pieces up, then left, until their outlines (not
 *  their rectangles) come within the spacing of a neighbour or the margin,
 *  trying each piece half turned too when rotation is allowed. A move is a
 *  jump across the clear space the rectangles show, then steps shorter than
 *  the spacing, so a piece never passes through another. The room this frees
 *  on a sheet is refilled with pieces from later sheets, which can empty
 *  them. Returns the sheets still in use. */
function compact(sheets:Packed[][],shapes:Shape[],o:NestOptions,margin:number,gap:number,deadline:number):Packed[][]{
  const rings=shapes.map(outerRings);
  let tolerance=SIMPLIFY_STEPS[SIMPLIFY_STEPS.length-1],simple=rings;
  for(const step of SIMPLIFY_STEPS){
    const next=rings.map(parts=>parts.map(ring=>simplifyRing(ring,step)));
    if(next.reduce((n,parts)=>n+parts.reduce((m,r)=>m+r.length,0),0)<=COMPACT_NODE_BUDGET){tolerance=step;simple=next;break;}
  }
  // The simplified outline is within the tolerance of the real one on each side.
  const spacing=gap+2*tolerance,step=Math.max(0.05,Math.min(1,spacing/2));
  // Outlines anchored at their part's bounding corner, one per kind and turn.
  const cache=new Map<string,Outline>();
  const outline=(p:Packed)=>{
    const key=`${p.kind}:${p.angle}`;let found=cache.get(key);
    if(!found){
      const b=bounds(rotateShape(shapes[p.kind],p.angle));
      const turned=rotateShape({id:'',name:'',contours:simple[p.kind].map(points=>({closed:true,points}))},p.angle).contours.map(c=>c.points);
      found=prepare(turned,-b.x,-b.y);cache.set(key,found);
    }
    return found;
  };
  /** Slides one piece up (or left) as far as it goes, in its best half turn. */
  function settle(sheet:Packed[],p:Packed,up:boolean){
    // Neighbours that the piece could meet on its way.
    const near=sheet.filter(q=>q!==p&&(up?q.x<p.x+p.w+spacing&&q.x+q.w+spacing>p.x&&q.y<p.y+p.h+spacing:q.y<p.y+p.h+spacing&&q.y+q.h+spacing>p.y&&q.x<p.x+p.w+spacing));
    const start=up?p.y:p.x;
    const slide=(angle:number)=>{
      const own=outline({...p,angle});
      const clear=(at:number)=>{const x=up?p.x:at,y=up?at:p.y;return x>=margin-1e-9&&y>=margin-1e-9&&near.every(q=>!outlinesCollide(own,x-q.x,y-q.y,outline(q),spacing));};
      // A turned piece that would overlap where it stands cannot take the turn.
      if(angle!==p.angle&&!clear(start))return start;
      let lead=start;
      for(let guard=0;guard<2000;guard++){
        // Jump across the space no neighbour's rectangle reaches into; a
        // neighbour already level with the piece leaves no clear jump.
        const free=Math.min(lead-margin,...near.map(q=>{const far=up?q.y+q.h:q.x+q.w;return far<=lead?lead-far-spacing:0;}));
        if(free>step){lead-=free;continue;}
        if(clear(lead-step))lead-=step;else break;
      }
      return lead;
    };
    let bestAngle=p.angle,bestLead=slide(p.angle);
    if(o.rotate){const flipped=(p.angle+180)%360,lead=slide(flipped);if(lead<bestLead-1e-6){bestLead=lead;bestAngle=flipped;}}
    if(up)p.y=bestLead;else p.x=bestLead;
    p.angle=bestAngle;
    return bestLead<start-1e-9;
  }
  function settleAll(sheet:Packed[]){
    for(let round=0;round<6&&Date.now()<deadline;round++){
      let moved=0;
      for(const up of [true,false])for(const p of [...sheet].sort(up?(a,b)=>a.y-b.y||a.x-b.x:(a,b)=>a.x-b.x||a.y-b.y)){if(Date.now()>deadline)break;if(settle(sheet,p,up))moved++;}
      if(!moved)break;
    }
  }
  /** The lowest, then leftmost, place for a w × h rectangle above which the
   *  sheet's pieces leave room, on a 1 mm column grid. */
  function spot(sheet:Packed[],w:number,h:number){
    const cols=Math.ceil(o.width),floor=new Float64Array(cols+1).fill(margin);
    for(const q of sheet){const a=Math.max(0,Math.floor(q.x-spacing)),b=Math.min(cols,Math.ceil(q.x+q.w+spacing));for(let c=a;c<b;c++)floor[c]=Math.max(floor[c],q.y+q.h+spacing);}
    let best:{x:number;y:number}|null=null;
    for(let c=Math.ceil(margin);c+w<=o.width-margin+1e-9;c++){
      let y=margin;for(let k=c;k<Math.min(cols,Math.ceil(c+w));k++)y=Math.max(y,floor[k]);
      if(y+h<=o.height-margin+1e-9&&(!best||y<best.y-1e-9))best={x:c,y};
    }
    return best;
  }
  for(let k=0;k<sheets.length&&Date.now()<deadline;k++){
    settleAll(sheets[k]);
    // Pull pieces from later sheets into the room the sheet now has, biggest first.
    const later=sheets.slice(k+1).flatMap((sheet,i)=>sheet.map(p=>({p,from:k+1+i}))).sort((a,b)=>b.p.w*b.p.h-a.p.w*a.p.h);
    for(const {p,from} of later){
      if(Date.now()>deadline)break;
      const turns=o.rotate?[[p.angle,p.w,p.h],[(p.angle+90)%360,p.h,p.w]] as const:[[p.angle,p.w,p.h]] as const;
      let chosen:{x:number;y:number;angle:number;w:number;h:number}|null=null;
      for(const [angle,w,h] of turns){const at=spot(sheets[k],w,h);if(at&&(!chosen||at.y<chosen.y))chosen={...at,angle,w,h};}
      if(!chosen)continue;
      sheets[from].splice(sheets[from].indexOf(p),1);
      Object.assign(p,chosen);sheets[k].push(p);
      for(let i=0;i<3&&(settle(sheets[k],p,true)||settle(sheets[k],p,false));i++);
    }
  }
  return sheets.filter(sheet=>sheet.length);
}
/** The turn, in degrees from 0 to 90, that gives the shape its smallest
 *  bounding rectangle: one of its convex hull's edges lies along an axis. */
export function snugAngle(shape:Shape):number{
  const hull=convexHull(shape.contours.filter(c=>c.layer!=='engrave').flatMap(c=>c.points));
  let best=0,bestArea=Infinity;
  for(let i=0;i<hull.length;i++){
    const a=hull[i],b=hull[(i+1)%hull.length],t=Math.atan2(b.y-a.y,b.x-a.x),cos=Math.cos(-t),sin=Math.sin(-t);
    let x0=Infinity,y0=Infinity,x1=-Infinity,y1=-Infinity;
    for(const p of hull){const x=p.x*cos-p.y*sin,y=p.x*sin+p.y*cos;x0=Math.min(x0,x);x1=Math.max(x1,x);y0=Math.min(y0,y);y1=Math.max(y1,y);}
    const area=(x1-x0)*(y1-y0);
    if(area<bestArea-1e-9){bestArea=area;best=((-t*180/Math.PI)%90+90)%90;}
  }
  // Keep the shape as drawn unless turning it saves more than 1%.
  const b0=bounds(shape);
  return bestArea<b0.width*b0.height*0.99?best:0;
}
type Rect={x:number;y:number;w:number;h:number};
type Fit=(r:Rect,w:number,h:number)=>[number,number];
/** MaxRects placement rules: each scores a free rectangle for a piece, lowest wins. */
const FITS:Fit[]=[
  (r,w,h)=>[Math.min(r.w-w,r.h-h),Math.max(r.w-w,r.h-h)], // best short side
  (r,w,h)=>[r.w*r.h-w*h,Math.min(r.w-w,r.h-h)], // best area
  (r,w,h)=>[r.y+h,r.x], // bottom left
  (r,w,h)=>[Math.max(r.w-w,r.h-h),Math.min(r.w-w,r.h-h)], // best long side
];
/** Packs each piece's bounding rectangle with MaxRects. Every rectangle is
 *  grown by the spacing, and the usable sheet by the same, so neighbours keep
 *  the spacing and the edge keeps the margin. Pieces turn 90° when rotation is
 *  allowed, and first to their snuggest angle when any angle is. Several
 *  placement rules and piece orders are tried, as time allows, and the layout
 *  with the fewest sheets and the smallest used area on the last one is kept. */
function packByBounds(shapes:Shape[],counts:number[],o:NestOptions,start:number):NestResult{
  shapes.forEach(outerRings);
  const margin=o.margin+TOLERANCE,gap=o.gap+2*TOLERANCE+0.001,W=o.width-2*margin+gap,H=o.height-2*margin+gap;
  const kinds=shapes.map(shape=>{
    const turn=o.rotate&&o.anyAngle?snugAngle(shape):0,b=bounds(turn?rotateShape(shape,turn):shape);
    const sizes=[{angle:turn,w:b.width+gap,h:b.height+gap}];
    if(o.rotate&&Math.abs(b.width-b.height)>1e-9)sizes.push({angle:turn+90,w:b.height+gap,h:b.width+gap});
    return {shape,area:shapeArea(shape),sizes:sizes.filter(z=>z.w<=W+1e-9&&z.h<=H+1e-9)};
  });
  const instances=shapes.flatMap((s,kind)=>Array.from({length:counts[kind]},(_,i)=>({kind,id:`${s.id}-${i}`,name:s.name})));
  const first=(kind:number)=>kinds[kind].sizes[0]??{w:0,h:0};
  const orders:((a:(typeof instances)[number],b:(typeof instances)[number])=>number)[]=[
    (a,b)=>Math.max(first(b.kind).w,first(b.kind).h)-Math.max(first(a.kind).w,first(a.kind).h)||kinds[b.kind].area-kinds[a.kind].area,
    (a,b)=>first(b.kind).w*first(b.kind).h-first(a.kind).w*first(a.kind).h,
    (a,b)=>Math.min(first(b.kind).w,first(b.kind).h)-Math.min(first(a.kind).w,first(a.kind).h)||kinds[b.kind].area-kinds[a.kind].area,
  ];
  const within=(a:Rect,b:Rect)=>a.x>=b.x-1e-9&&a.y>=b.y-1e-9&&a.x+a.w<=b.x+b.w+1e-9&&a.y+a.h<=b.y+b.h+1e-9;
  type Placed={kind:number;angle:number;x:number;y:number;w:number;h:number;id:string;name:string};
  function pack(order:typeof instances,fit:Fit){
    const sheets:{free:Rect[];placed:Placed[]}[]=[],unplaced:string[]=[];let area=0;
    for(const item of order){
      const sizes=kinds[item.kind].sizes;
      if(!sizes.length){unplaced.push(item.name);continue;}
      let done=false;
      for(let k=0;k<=sheets.length&&!done;k++){
        if(k===sheets.length)sheets.push({free:[{x:0,y:0,w:W,h:H}],placed:[]});
        const sheet=sheets[k];
        let best:{r:Rect;z:(typeof sizes)[number]}|null=null,s1=Infinity,s2=Infinity;
        for(const r of sheet.free)for(const z of sizes){
          if(z.w>r.w+1e-9||z.h>r.h+1e-9)continue;
          const [a,b]=fit(r,z.w,z.h);
          if(a<s1||(a===s1&&b<s2)){best={r,z};s1=a;s2=b;}
        }
        if(!best)continue;
        const used={x:best.r.x,y:best.r.y,w:best.z.w,h:best.z.h};
        // Split every free rectangle the new piece overlaps into the parts around it.
        const next:Rect[]=[];
        for(const f of sheet.free){
          if(used.x>=f.x+f.w||used.x+used.w<=f.x||used.y>=f.y+f.h||used.y+used.h<=f.y){next.push(f);continue;}
          if(used.x>f.x)next.push({x:f.x,y:f.y,w:used.x-f.x,h:f.h});
          if(used.x+used.w<f.x+f.w)next.push({x:used.x+used.w,y:f.y,w:f.x+f.w-used.x-used.w,h:f.h});
          if(used.y>f.y)next.push({x:f.x,y:f.y,w:f.w,h:used.y-f.y});
          if(used.y+used.h<f.y+f.h)next.push({x:f.x,y:used.y+used.h,w:f.w,h:f.y+f.h-used.y-used.h});
        }
        sheet.free=next.filter((a,i)=>a.w>1e-6&&a.h>1e-6&&!next.some((b,j)=>j!==i&&within(a,b)&&(!within(b,a)||j<i)));
        sheet.placed.push({kind:item.kind,angle:best.z.angle,x:used.x,y:used.y,w:used.w,h:used.h,id:item.id,name:item.name});
        area+=kinds[item.kind].area;done=true;
      }
      if(!done)unplaced.push(item.name);
    }
    const used=sheets.filter(s=>s.placed.length),last=used[used.length-1]?.placed??[];
    // Fewer sheets first, then the smallest corner of the last sheet in use.
    const score=unplaced.length*1e15+used.length*1e9+Math.max(0,...last.map(p=>p.x+p.w))*Math.max(0,...last.map(p=>p.y+p.h));
    return {sheets:used,unplaced,area,score};
  }
  let chosen:ReturnType<typeof pack>|null=null;
  for(const order of orders)for(const fit of FITS){
    if(chosen&&Date.now()-start>6000)break;
    const r=pack([...instances].sort(order),fit);
    if(!chosen||r.score<chosen.score)chosen=r;
  }
  const placed=chosen!.sheets.map(s=>s.placed.map(p=>({kind:p.kind,angle:p.angle,x:margin+p.x,y:margin+p.y,w:p.w-gap,h:p.h-gap,id:p.id,name:p.name})));
  const out=compact(placed,kinds.map(k=>k.shape),o,margin,gap,start+14000).map(sheet=>sheet.map(p=>({...moveShape(normalize(kinds[p.kind].shape,p.angle),p.x,p.y),id:p.id,name:p.name})));
  return {sheets:out,unplaced:chosen!.unplaced,total:instances.length,area:chosen!.area,elapsed:Date.now()-start,outlineTolerance:0,byBounds:true};
}
export function nest(allShapes:Shape[],o:NestOptions):NestResult {
  const start=Date.now(); finite(o.width,1,3000,'Sheet width');finite(o.height,1,3000,'Sheet height');finite(o.margin,0,100,'Margin');finite(o.gap,0,100,'Spacing');
  const allCounts=o.counts??allShapes.map(()=>o.copies);
  if(allCounts.length!==allShapes.length)throw new Error('Give one quantity for every part.');
  allCounts.forEach(c=>{finite(c,0,100,'Quantity');if(!Number.isInteger(c))throw new Error('Quantities must be whole numbers.');});
  // A part with a quantity of 0 is left out of the job altogether.
  const shapes=allShapes.filter((_,i)=>allCounts[i]>0),counts=allCounts.filter(c=>c>0),pieces=counts.reduce((a,b)=>a+b,0);
  if(!pieces||pieces>MAX_NEST_PIECES)throw new Error(`Use 1–${MAX_NEST_PIECES} total parts.`);
  // Fitting outlines against each other grows with the square of the piece
  // count; rectangles pack thousands of pieces in about a second.
  if(pieces>OUTLINE_NEST_MAX)return packByBounds(shapes,counts,o,start);
  // Dense artwork is nested with simplified outer outlines. The simplification
  // tolerance is added to both sides of every gap, so the full-detail parts
  // placed from these outlines still keep the requested spacing.
  const rings=shapes.map(outerRings);
  let tolerance=-1,outlines:Point[][][]=[];
  for(const step of SIMPLIFY_STEPS){
    outlines=rings.map(parts=>parts.map(ring=>simplifyRing(ring,step)));
    if(outlines.reduce((n,parts)=>n+parts.reduce((m,ring)=>m+ring.length,0),0)<=NEST_NODE_BUDGET){tolerance=step;break;}
  }
  if(tolerance<0)throw new Error('This nesting job is too detailed even with 2 mm outline simplification. Nest fewer parts at once.');
  const margin=o.margin+TOLERANCE,gap=o.gap+2*TOLERANCE+2*tolerance+0.001;
  const kinds=shapes.map((shape,index)=>{
    const turn=o.rotate&&o.anyAngle?snugAngle(shape):0,angles=o.rotate?[turn,turn+90,turn+180,turn+270]:[0];
    const outline:Shape={id:shape.id,name:shape.name,contours:outlines[index].map(points=>({closed:true,points}))};
    const variants=angles.map(angle=>{
      // Anchor the outline to the exact rotated part bounds so a placement
      // offset applies unchanged to the exported full-detail geometry.
      const b=bounds(rotateShape(shape,angle));
      const rotated=rotateShape(outline,angle).contours.map(c=>c.points);
      return {angle,width:b.width,height:b.height,rings:rotated,dx:-b.x,dy:-b.y,outline:prepare(rotated,-b.x,-b.y)};
    }).filter(v=>v.width<=o.width-2*margin&&v.height<=o.height-2*margin);
    return {shape,area:shapeArea(shape),variants};
  });
  const instances=shapes.flatMap((s,kind)=>Array.from({length:counts[kind]},(_,i)=>({kind,id:`${s.id}-${i}`,name:s.name})));
  function pack(order:typeof instances){
    // Sheets only ever gain parts, so a part kind that did not fit a sheet never will.
    const sheets:Placement[][]=[],full:Set<number>[]=[],unplaced:string[]=[];let area=0;
    // A coarse grid per sheet limits collision tests to nearby parts.
    const cell=Math.max(10,Math.max(o.width,o.height)/64),grids:Map<number,number[]>[]=[],seen=new Uint32Array(instances.length);let stamp=0;
    const cellRange=(box:Bounds,dx:number,dy:number,pad:number)=>[Math.floor((box.x+dx-pad)/cell),Math.floor((box.y+dy-pad)/cell),Math.floor((box.x+dx+box.width+pad)/cell),Math.floor((box.y+dy+box.height+pad)/cell)];
    for(const item of order){
      if(Date.now()-start>18000){unplaced.push(item.name);continue;}
      const variants=kinds[item.kind].variants;
      if(!variants.length){unplaced.push(item.name);continue;}
      let placed=false;
      for(let sheetIndex=0;sheetIndex<=sheets.length&&!placed;sheetIndex++){
        if(sheetIndex===sheets.length){sheets.push([]);full.push(new Set());grids.push(new Map());}
        if(full[sheetIndex].has(item.kind))continue;
        const sheet=sheets[sheetIndex];
        let best:Placement|null=null,bestScore=Infinity;
        const boxes=sheet.map(p=>p.box);
        for(const variant of variants){
          const maxX=o.width-margin-variant.width,maxY=o.height-margin-variant.height;
          let blocker=0;
          const tryAt=(x:number,y:number)=>{
            const score=(y+variant.height)*o.width+x+variant.width;if(score>=bestScore)return -1;
            // Most rejected candidates hit the same neighbour as the previous one.
            if(outlinesCollide(variant.outline,x,y,sheet[blocker]?.outline??empty,gap))return blocker;
            const [x0,y0,x1,y1]=cellRange(variant.outline.box,x,y,gap),grid=grids[sheetIndex];stamp++;
            for(let cx=x0;cx<=x1;cx++)for(let cy=y0;cy<=y1;cy++)for(const index of grid.get(cx*4096+cy)||[]){
              if(seen[index]===stamp)continue;seen[index]=stamp;
              if(outlinesCollide(variant.outline,x,y,sheet[index].outline,gap)){blocker=index;return index;}
            }
            best={kind:item.kind,angle:variant.angle,x,y,id:item.id,name:item.name,outline:variant.outline,box:variant.outline.box};bestScore=score;return -1;
          };
          // Always retain a new-row candidate: dense curves can exhaust the
          // bounded vertex search before it reaches a free row below the parts.
          const nextRow=sheet.length?Math.max(...boxes.map(box=>box.y+box.height))+gap:margin;
          if(nextRow<=maxY+1e-7)tryAt(margin,nextRow);
          // Check all bounding-edge contacts before the denser vertex contacts.
          // Otherwise curved edges can crowd useful row starts out of the budget.
          const rowXs=[...new Set([margin,...boxes.flatMap(c=>[c.x,c.x+c.width+gap])])].filter(x=>x>=margin&&x<=maxX+1e-7).sort((a,b)=>a-b);
          const rowYs=[...new Set([margin,...boxes.flatMap(c=>[c.y,c.y+c.height+gap])])].filter(y=>y>=margin&&y<=maxY+1e-7).sort((a,b)=>a-b);
          // Candidates are sorted by y then x, matching the score order, so
          // everything after a success or an already-beaten score is skipped.
          const beaten=(x:number,y:number)=>(y+variant.height)*o.width+x+variant.width>=bestScore;
          // Row starts are bounding-edge contacts: after a collision, jump past the
          // blocking part's box. Concave elbows are covered by the vertex search below.
          rows:for(const y of rowYs){
            if(beaten(margin,y)||Date.now()-start>18000)break rows;
            let skip=-Infinity;
            for(const x of rowXs){if(x<skip)continue;if(beaten(x,y))break;const hit=tryAt(x,y);if(hit>=0){const box=sheet[hit].box;skip=box.x+box.width+gap-1e-7;}}
          }
          const xs=new Set([margin]),ys=new Set([margin]);
          for(const occupied of sheet){const c=occupied.box;xs.add(c.x+c.width+gap);ys.add(c.y+c.height+gap);xs.add(c.x);ys.add(c.y);
            // Vertex-aligned candidates allow parts into the empty elbows of concave shapes.
            for(const ring of occupied.outline.rings) for(let i=0;i<ring.xs.length;i+=Math.max(1,Math.floor(ring.xs.length/16))){const px=ring.xs[i],py=ring.ys[i];xs.add(px+gap);xs.add(px-variant.width-gap);ys.add(py+gap);ys.add(py-variant.height-gap);}
          }
          const xList=[...xs].filter(x=>x>=margin&&x<=maxX+1e-7).sort((a,b)=>a-b).slice(0,100);
          const yList=[...ys].filter(y=>y>=margin&&y<=maxY+1e-7).sort((a,b)=>a-b).slice(0,100);
          let tries=0;
          search:for(const y of yList)for(const x of xList){if(++tries>2500||Date.now()-start>18000||beaten(xList[0],y))break search;if(beaten(x,y))break;tryAt(x,y);}
        }
        if(best){
          const chosen:Placement=best,variant=kinds[item.kind].variants.find(v=>v.angle===chosen.angle)!;
          const outline=prepare(variant.rings,variant.dx+chosen.x,variant.dy+chosen.y);
          const [x0,y0,x1,y1]=cellRange(outline.box,0,0,0);
          for(let cx=x0;cx<=x1;cx++)for(let cy=y0;cy<=y1;cy++){const key=cx*4096+cy,list=grids[sheetIndex].get(key);if(list)list.push(sheet.length);else grids[sheetIndex].set(key,[sheet.length]);}
          sheet.push({...chosen,outline,box:outline.box});area+=kinds[item.kind].area;placed=true;
        }
        else if(!sheet.length){sheets.pop();full.pop();grids.pop();break;}
        else if(Date.now()-start<=18000)full[sheetIndex].add(item.kind);
      }
      if(!placed)unplaced.push(item.name);
    }
    return {sheets:sheets.filter(s=>s.length),unplaced,area};
  }
  let chosen=pack([...instances].sort((a,b)=>kinds[b.kind].area-kinds[a.kind].area));
  if(instances.length<=20&&Date.now()-start<=5000){
    const size=(i:(typeof instances)[number])=>{const v=bounds(kinds[i.kind].shape);return Math.max(v.width,v.height);};
    const second=pack([...instances].sort((a,b)=>size(b)-size(a)));
    const score=(r:typeof chosen)=>r.unplaced.length*1e9+r.sheets.length*1e6+r.sheets.reduce((sum,s)=>sum+Math.max(...s.map(p=>p.box.y+p.box.height)),0);
    if(score(second)<score(chosen))chosen=second;
  }
  const sheets=chosen.sheets.map(sheet=>sheet.map(p=>({...moveShape(normalize(kinds[p.kind].shape,p.angle),p.x,p.y),id:p.id,name:p.name})));
  return {sheets,unplaced:chosen.unplaced,total:instances.length,area:chosen.area,elapsed:Date.now()-start,outlineTolerance:tolerance};
}
export function repeatDrawing(d:Drawing,width:number,height:number,columns:number,rows:number,gap:number):Drawing{
  finite(width,0.1,3000,'Width');finite(height,0.1,3000,'Height');finite(columns,1,100,'Columns');finite(rows,1,100,'Rows');finite(gap,0,100,'Spacing');
  if(!Number.isInteger(columns)||!Number.isInteger(rows)||columns*rows*d.shapes.length>500)throw new Error('Use whole-number rows and columns, up to 500 repeated shapes.');
  const shapes:Shape[]=[];
  for(let r=0;r<rows;r++)for(let c=0;c<columns;c++)for(const s of d.shapes)shapes.push({...mapShape(s,p=>({x:p.x*width/d.width+c*(width+gap),y:p.y*height/d.height+r*(height+gap)})),id:`${s.id}-${r}-${c}`});
  return {width:width*columns+gap*(columns-1),height:height*rows+gap*(rows-1),shapes};
}
export function kerfDrawing(thickness:number,step:number,count:number):Drawing & {labels:{x:number;y:number;value:string}[]}{
  finite(thickness,0.5,30,'Material thickness');finite(step,0.01,1,'Step');finite(count,3,15,'Slots');
  if(!Number.isInteger(count)||thickness-step*(count-1)/2<=0)throw new Error('Use whole-number slots and keep every slot width above zero.');
  const pitch=Math.max(thickness+10,14),width=pitch*count+10,height=40,points:Point[]=[{x:0,y:0}],labels=[];
  for(let i=0;i<count;i++){const slot=thickness+(i-(count-1)/2)*step,x=10+i*pitch;points.push({x,y:0},{x,y:20},{x:x+slot,y:20},{x:x+slot,y:0});labels.push({x:x-2,y:28,value:slot.toFixed(2)});}
  points.push({x:width,y:0},{x:width,y:height},{x:0,y:height});
  return {width,height,shapes:[{id:'coupon',name:'Fit test coupon',contours:[{closed:true,points}]}],labels};
}
export function contourKey(c:Contour){
  const points=c.points.map(p=>`${p.x.toFixed(4)},${p.y.toFixed(4)}`);
  if(!c.closed)return 'open:'+ [points.join(';'),[...points].reverse().join(';')].sort()[0];
  // Booth's minimal rotation: linear memory, including long imported contours.
  const rotation=(p:string[])=>{const n=p.length;let i=0,j=1,k=0;while(i<n&&j<n&&k<n){const a=p[(i+k)%n],b=p[(j+k)%n];if(a===b){k++;continue;}if(a>b){i+=k+1;if(i===j)i++;}else{j+=k+1;if(i===j)j++;}k=0;}const start=Math.min(i,j);return [...p.slice(start),...p.slice(0,start)].join(';');};
  return 'closed:'+ [rotation(points),rotation([...points].reverse())].sort()[0];
}
export function cleanDrawing(d:Drawing,removeDuplicates:boolean,minArea:number){
  finite(minArea,0,100,'Minimum area');const seen=new Set<string>();let duplicates=0,tiny=0,open=0;
  const shapes=d.shapes.map(s=>({...s,contours:s.contours.filter(c=>{
    if(!c.closed)open++;const key=contourKey(c),duplicate=seen.has(key);seen.add(key);if(duplicate)duplicates++;
    const small=c.closed&&Math.abs(signedArea(c.points))<minArea;if(small)tiny++;
    return !(removeDuplicates&&duplicate)&&!small;
  })})).filter(s=>s.contours.length);
  return {drawing:{...d,shapes},duplicates,tiny,open};
}

// ——— Repair: what "delete overlap" and "join" do in a cutting program ———

/** `simplify` is how far, in mm, reduced outlines may move: runs within it become one line or one curve. */
export type RepairOptions = { overlaps: boolean; join: number; minArea: number; reduce: boolean; simplify?: number };
export type RepairResult = { drawing: Drawing; overlapsRemovedMm: number; joined: number; tiny: number; nodesBefore: number; nodesAfter: number };

const OVERLAP_EPS = 0.02;
const cutLayer = (c: Contour) => c.layer !== 'engrave';
const nodesOf = (c: Contour) => (c.curve ? c.curve.segs.length : c.points.length);

type Piece = { shape: number; contour: number; a: Point; b: Point; keep: [number, number][] };

/** Removes every stretch of a cut line that lies on top of an earlier one. */
function removeOverlaps(d: Drawing): { drawing: Drawing; removed: number } {
  const pieces: Piece[] = [];
  d.shapes.forEach((s, si) => s.contours.forEach((c, ci) => {
    if (!cutLayer(c)) return;
    const n = c.points.length, count = c.closed ? n : n - 1;
    for (let k = 0; k < count; k++) pieces.push({ shape: si, contour: ci, a: c.points[k], b: c.points[(k + 1) % n], keep: [[0, 1]] });
  }));
  // Pieces are bucketed by the cells their bounds touch, so only neighbours are compared.
  const cell = 5, grid = new Map<string, number[]>();
  pieces.forEach((p, i) => {
    const x0 = Math.floor((Math.min(p.a.x, p.b.x) - OVERLAP_EPS) / cell), x1 = Math.floor((Math.max(p.a.x, p.b.x) + OVERLAP_EPS) / cell);
    const y0 = Math.floor((Math.min(p.a.y, p.b.y) - OVERLAP_EPS) / cell), y1 = Math.floor((Math.max(p.a.y, p.b.y) + OVERLAP_EPS) / cell);
    for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) { const k = `${x},${y}`; const list = grid.get(k); if (list) list.push(i); else grid.set(k, [i]); }
  });
  const covered = new Map<number, [number, number][]>();
  const compared = new Set<string>();
  for (const list of grid.values()) for (let x = 0; x < list.length; x++) for (let y = x + 1; y < list.length; y++) {
    const i = Math.min(list[x], list[y]), j = Math.max(list[x], list[y]), key = `${i},${j}`;
    if (compared.has(key)) continue;
    compared.add(key);
    // The later piece gives way to the earlier one along their common stretch.
    const early = pieces[i], late = pieces[j];
    const L = Math.hypot(late.b.x - late.a.x, late.b.y - late.a.y);
    if (L < 1e-9) continue;
    const ux = (late.b.x - late.a.x) / L, uy = (late.b.y - late.a.y) / L;
    const offLine = (p: Point) => Math.abs((p.x - late.a.x) * uy - (p.y - late.a.y) * ux);
    if (offLine(early.a) > OVERLAP_EPS || offLine(early.b) > OVERLAP_EPS) continue;
    const t = (p: Point) => ((p.x - late.a.x) * ux + (p.y - late.a.y) * uy) / L;
    const lo = Math.max(0, Math.min(t(early.a), t(early.b))), hi = Math.min(1, Math.max(t(early.a), t(early.b)));
    if (hi - lo <= 1e-9) continue;
    covered.set(j, [...(covered.get(j) ?? []), [lo, hi]]);
  }
  if (!covered.size) return { drawing: d, removed: 0 };
  let removed = 0;
  for (const [j, spans] of covered) {
    const piece = pieces[j], L = Math.hypot(piece.b.x - piece.a.x, piece.b.y - piece.a.y);
    let keep: [number, number][] = [[0, 1]];
    for (const [lo, hi] of spans) keep = keep.flatMap(([a, b]) => ([[a, Math.min(b, lo)], [Math.max(a, hi), b]] as [number, number][]).filter(([p, q]) => q - p > 1e-9));
    removed += (1 - keep.reduce((sum, [a, b]) => sum + (b - a), 0)) * L;
    // Slivers shorter than the tolerance are noise, not lines to cut.
    piece.keep = keep.filter(([a, b]) => (b - a) * L > OVERLAP_EPS);
  }
  const byContour = new Map<string, Piece[]>();
  for (const p of pieces) { const k = `${p.shape},${p.contour}`; const list = byContour.get(k); if (list) list.push(p); else byContour.set(k, [p]); }
  const at = (p: Piece, t: number) => ({ x: p.a.x + (p.b.x - p.a.x) * t, y: p.a.y + (p.b.y - p.a.y) * t });
  const shapes = d.shapes.map((s, si) => ({ ...s, contours: s.contours.flatMap((c, ci): Contour[] => {
    const own = byContour.get(`${si},${ci}`);
    if (!own || own.every(p => p.keep.length === 1 && p.keep[0][0] === 0 && p.keep[0][1] === 1)) return [c];
    // What is left, as open chains; a closed contour's last chain continues
    // into its first when both run through the contour's start.
    const chains: Point[][] = [];
    let chain: Point[] | null = null;
    for (const p of own) for (const [a, b] of p.keep) {
      const to = at(p, b);
      if (chain && a === 0) chain.push(to);
      else { chain = [at(p, a), to]; chains.push(chain); }
      if (b !== 1) chain = null;
    }
    const first = own[0].keep[0], last = own[own.length - 1].keep.at(-1);
    if (c.closed && chains.length > 1 && first?.[0] === 0 && last?.[1] === 1) { const tail = chains.pop()!; chains[0] = [...tail, ...chains[0].slice(1)]; }
    return chains.map(points => ({ closed: false, points }));
  }) })).filter(s => s.contours.length);
  return { drawing: { ...d, shapes }, removed };
}

/** Connects open cut paths whose ends are within `limit` mm, closing a path
 *  when its own two ends meet. Returns how many joins were made. */
function joinOpen(d: Drawing, limit: number): { drawing: Drawing; joined: number } {
  const open: { shape: number; points: Point[] }[] = [];
  const shapes = d.shapes.map((s, si) => ({ ...s, contours: s.contours.filter(c => {
    if (c.closed || !cutLayer(c)) return true;
    open.push({ shape: si, points: [...c.points] });
    return false;
  }) }));
  const gap = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);
  let joined = 0;
  for (;;) {
    // The closest pair of ends, including a path's own two ends.
    let best = limit, pick: [number, number, boolean, boolean] | null = null;
    for (let i = 0; i < open.length; i++) {
      const p = open[i].points;
      if (p.length > 2 && gap(p[0], p[p.length - 1]) <= best) { best = gap(p[0], p[p.length - 1]); pick = [i, i, true, true]; }
      for (let j = i + 1; j < open.length; j++) {
        const q = open[j].points;
        for (const [endOfI, startOfJ] of [[true, true], [true, false], [false, true], [false, false]] as [boolean, boolean][]) {
          const g = gap(endOfI ? p[p.length - 1] : p[0], startOfJ ? q[0] : q[q.length - 1]);
          if (g <= best) { best = g; pick = [i, j, endOfI, startOfJ]; }
        }
      }
    }
    if (!pick) break;
    joined++;
    const [i, j, endOfI, startOfJ] = pick;
    if (i === j) {
      const p = open[i].points;
      if (gap(p[0], p[p.length - 1]) < 1e-9) p.pop();
      shapes[open[i].shape].contours.push({ closed: true, points: p });
      open.splice(i, 1);
      continue;
    }
    const p = endOfI ? open[i].points : [...open[i].points].reverse();
    let q = startOfJ ? open[j].points : [...open[j].points].reverse();
    if (gap(p[p.length - 1], q[0]) < 1e-9) q = q.slice(1);
    open[i] = { shape: open[i].shape, points: [...p, ...q] };
    open.splice(j, 1);
  }
  for (const r of open) shapes[r.shape].contours.push({ closed: false, points: r.points });
  return { drawing: { ...d, shapes: shapes.filter(s => s.contours.length) }, joined };
}

/** Repairs a drawing for cutting: removes overlapping lines, joins small
 *  gaps, drops tiny closed contours and refits nodes into lines and arcs.
 *  Engraved lines are left exactly as they are. */
export function repairDrawing(d: Drawing, o: RepairOptions): RepairResult {
  finite(o.minArea, 0, 100, 'Minimum area'); finite(o.join, 0, 10, 'Join distance');
  const simplify = o.simplify ?? 0.2;
  if (o.reduce) finite(simplify, 0.01, 2, 'Simplify tolerance');
  const count = (x: Drawing) => x.shapes.reduce((sum, s) => sum + s.contours.filter(cutLayer).reduce((n, c) => n + nodesOf(c), 0), 0);
  const nodesBefore = count(d);
  let drawing = d, overlapsRemovedMm = 0, joined = 0, tiny = 0;
  if (o.overlaps) ({ drawing, removed: overlapsRemovedMm } = removeOverlaps(drawing));
  if (o.join > 0) ({ drawing, joined } = joinOpen(drawing, o.join));
  if (o.minArea > 0) drawing = { ...drawing, shapes: drawing.shapes.map(s => ({ ...s, contours: s.contours.filter(c => {
    const small = cutLayer(c) && c.closed && Math.abs(signedArea(c.points)) < o.minArea;
    if (small) tiny++;
    return !small;
  }) })).filter(s => s.contours.length) };
  // Contours without a curve (changed ones were rebuilt from points) are refitted
  // first; then every cut outline drops the nodes its shape does not need.
  if (o.reduce) drawing = { ...drawing, shapes: drawing.shapes.map(s => ({ ...s, contours: s.contours.map(c => {
    if (!cutLayer(c)) return c;
    const fitted = c.curve ?? fitPolyline(c.points, c.closed, 0.02), curve = straightenCurve(fitted, simplify);
    if (curve.segs.length === fitted.segs.length) return c.curve ? c : { ...c, curve: fitted };
    return { ...c, curve, points: flattenCurve(curve, c.closed, 0.05) };
  }) })) };
  return { drawing, overlapsRemovedMm, joined, tiny, nodesBefore, nodesAfter: count(drawing) };
}
