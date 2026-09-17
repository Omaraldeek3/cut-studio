import type { Contour, Drawing, Shape } from './types';
const n=(v:number)=>{if(!Number.isFinite(v))throw new Error('Export contains an invalid dimension.');return String(Math.round(v*1e5)/1e5);};
const engraved=(c:Contour)=>c.layer==='engrave';
/** Path data for a shape's cut contours, or its engrave contours when `layer` is 'engrave'. */
export function pathData(s:Shape,layer:'cut'|'engrave'='cut'){return s.contours.filter(c=>engraved(c)===(layer==='engrave')).map(c=>c.points.map((p,i)=>`${i?'L':'M'}${n(p.x)} ${n(p.y)}`).join(' ')+(c.closed?' Z':'')).join(' ');}
type Labelled = Drawing & {labels?:{x:number;y:number;value:string}[]};
function labelShapes(d:Labelled):Shape[]{
  const codes:Record<string,string>={'0':'abcedf','1':'bc','2':'abged','3':'abgcd','4':'fgbc','5':'afgcd','6':'afgecd','7':'abc','8':'abcdefg','9':'abfgcd'};
  const segments:Record<string,number[]>={a:[0,0,2,0],b:[2,0,2,2],c:[2,2,2,4],d:[0,4,2,4],e:[0,2,0,4],f:[0,0,0,2],g:[0,2,2,2]};
  return (d.labels||[]).map((label,i)=>({id:`label-${i}`,name:'ENGRAVE',contours:[...label.value].flatMap((ch,j):Contour[]=>ch==='.'?[{closed:false,layer:'engrave',points:[{x:label.x+j*3,y:label.y+4},{x:label.x+j*3+0.3,y:label.y+4}]}]:[...(codes[ch]||'')].map(s=>{const v=segments[s];return{closed:false,layer:'engrave' as const,points:[{x:label.x+j*3+v[0],y:label.y+v[1]},{x:label.x+j*3+v[2],y:label.y+v[3]}]};}))}));
}
export function toSvg(d:Labelled){
  const shapes=[...d.shapes,...labelShapes(d)];
  const paths=(layer:'cut'|'engrave',colour:string)=>shapes.filter(s=>s.contours.some(c=>engraved(c)===(layer==='engrave'))).map(s=>`<path d="${pathData(s,layer)}" fill="none" stroke="${colour}" stroke-width="0.05"/>`).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" width="${n(d.width)}mm" height="${n(d.height)}mm" viewBox="0 0 ${n(d.width)} ${n(d.height)}">\n${paths('cut','#ff0000')}\n${paths('engrave','#0000ff')}\n</svg>`;
}
export function toDxf(d:Labelled){
  const pairs:(string|number)[]=[0,'SECTION',2,'HEADER',9,'$ACADVER',1,'AC1009',9,'$INSUNITS',70,4,9,'$MEASUREMENT',70,1,0,'ENDSEC',0,'SECTION',2,'TABLES',0,'TABLE',2,'LAYER',70,2,0,'LAYER',2,'CUT',70,0,62,1,6,'CONTINUOUS',0,'LAYER',2,'ENGRAVE',70,0,62,5,6,'CONTINUOUS',0,'ENDTAB',0,'ENDSEC',0,'SECTION',2,'ENTITIES'];
  for(const s of [...d.shapes,...labelShapes(d)])for(const c of s.contours){
    const layer=engraved(c)?'ENGRAVE':'CUT';
    pairs.push(0,'POLYLINE',8,layer,66,1,10,0,20,0,30,0,70,c.closed?1:0);
    for(const p of c.points)pairs.push(0,'VERTEX',8,layer,10,n(p.x),20,n(d.height-p.y),30,0);
    pairs.push(0,'SEQEND',8,layer);
  }
  pairs.push(0,'ENDSEC',0,'EOF');return pairs.join('\n')+'\n';
}
export function download(content:string|Blob,name:string,type='image/svg+xml'){
  const url=URL.createObjectURL(typeof content==='string'?new Blob([content],{type}):content);
  const a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
