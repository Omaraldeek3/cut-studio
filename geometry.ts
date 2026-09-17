import type { Bounds, Contour, Drawing, NestOptions, NestResult, Point, Shape } from './types';

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
  return {...shape,contours:shape.contours.map(c=>({...c,points:c.points.map(fn)}))};
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
export const MAX_NEST_PIECES=500;
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
  const closed=shape.contours.filter(c=>c.closed&&c.points.length>=3&&Math.abs(signedArea(c.points))>=0.001);
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
export function nest(shapes:Shape[],o:NestOptions):NestResult {
  const start=Date.now(); finite(o.width,1,3000,'Sheet width');finite(o.height,1,3000,'Sheet height');finite(o.margin,0,100,'Margin');finite(o.gap,0,100,'Spacing');finite(o.copies,1,100,'Copies');
  if(!Number.isInteger(o.copies)||!shapes.length||shapes.length*o.copies>MAX_NEST_PIECES)throw new Error(`Use 1–${MAX_NEST_PIECES} total parts and whole-number copies.`);
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
  const angles=o.rotate?[0,90,180,270]:[0];
  const kinds=shapes.map((shape,index)=>{
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
  const instances=shapes.flatMap((s,kind)=>Array.from({length:o.copies},(_,i)=>({kind,id:`${s.id}-${i}`,name:s.name})));
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
export function costEstimate(price:number,sheets:number,pieces:number,overhead:number,labour:number,machine:number){
  finite(price,0,1e7,'Sheet price');finite(sheets,0,10000,'Sheets');finite(pieces,1,1e7,'Finished pieces');finite(overhead,0,1000,'Overhead');finite(labour,0,1e7,'Labour');finite(machine,0,1e7,'Machine cost');
  const material=price*sheets,extras=labour+machine,total=(material+extras)*(1+overhead/100);return{material,extras,total,perItem:total/pieces};
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
