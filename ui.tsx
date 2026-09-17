'use client';
import { useId } from 'react';
import type { Drawing } from './types';
import type { Language, ToolId } from './copy';
import { tx } from './copy';
import { download, pathData, toDxf, toSvg } from './export';

export function Icon({name,size=20}:{name:ToolId|'arrow'|'upload'|'check'|'grid'|'download';size?:number}){
 const paths:Record<string,React.ReactNode>={nest:<><rect x="3" y="3" width="8" height="11" rx="1"/><rect x="14" y="3" width="7" height="6" rx="1"/><rect x="3" y="17" width="8" height="4" rx="1"/><path d="M14 12h7v9h-7z"/></>,trace:<><path d="M4 18 10 5l10 14-16-1Z"/><circle cx="10" cy="5" r="2"/><circle cx="20" cy="19" r="2"/><circle cx="4" cy="18" r="2"/></>,clean:<><path d="m5 19 12-12M13 5l6 6M17 3l4 4M5 3v4M3 5h4M18 16v5M15.5 18.5h5"/></>,repeat:<><rect x="3" y="3" width="11" height="11" rx="1"/><path d="M18 10h3v11H10v-3M7 7h3v3"/></>,cost:<><rect x="5" y="2" width="14" height="20" rx="2"/><path d="M8 6h8M8 11h1m3 0h1m3 0h1M8 15h1m3 0h1m3 0h1M8 19h1m3 0h1m3 0h1"/></>,kerf:<><path d="M3 5h3v8h3V5h3v8h3V5h3v8h3v7H3Z"/></>,engrave:<><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="9" cy="8" r="1.5"/><path d="m3 18 6-6 4 4 3-3 5 5"/></>,box:<><path d="m12 3 9 4.5v9L12 21l-9-4.5v-9Z"/><path d="m3 7.5 9 4.5 9-4.5M12 12v9"/></>,arrow:<path d="M5 12h14m-5-5 5 5-5 5"/>,upload:<><path d="M12 16V3m-5 5 5-5 5 5M4 16v5h16v-5"/></>,check:<path d="m5 12 4 4L19 6"/>,grid:<><path d="M3 8h18M3 16h18M8 3v18M16 3v18"/></>,download:<><path d="M12 3v13m-5-5 5 5 5-5M4 17v4h16v-4"/></>};
 return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]}</svg>;
}
export function NumberField({label,value,onChange,min=0,max=3000,step=1,unit,optional=false}:{label:string;value:number;onChange:(v:number)=>void;min?:number;max?:number;step?:number;unit?:string;optional?:boolean}){
 const id=useId();return <label className="field" htmlFor={id}><span>{label}</span><div className="input-wrap"><input id={id} type="number" value={Number.isFinite(value)?value:''} onChange={e=>onChange(e.target.value===''?NaN:e.target.valueAsNumber)} min={min} max={max} step={step} placeholder={optional?'Auto':'—'}/>{unit&&<span>{unit}</span>}</div></label>;
}
export function Toggle({label,value,onChange}:{label:string;value:boolean;onChange:(b:boolean)=>void}){return <label className="toggle"><span>{label}</span><input type="checkbox" checked={value} onChange={e=>onChange(e.target.checked)}/><span className="switch" aria-hidden="true"/></label>;}
export function Range({label,value,onChange,min,max,step=1}:{label:string;value:number;onChange:(n:number)=>void;min:number;max:number;step?:number}){return <label className="range"><span>{label}<b>{value}</b></span><input aria-label={label} type="range" value={value} min={min} max={max} step={step} onChange={e=>onChange(+e.target.value)}/></label>;}
export function ErrorNote({error}:{error:string}){return error?<div role="alert" className="error-note">{error}</div>:null;}
export function Section({title,children,number}:{title:string;children:React.ReactNode;number?:string}){return <section className="control-section"><h3>{number&&<span>{number}</span>}{title}</h3>{children}</section>;}
export function Stat({label,value,unit}:{label:string;value:React.ReactNode;unit?:string}){return <div className="stat"><span>{label}</span><strong>{value}<small>{unit}</small></strong></div>;}
export function VectorPreview({drawing,lang,filled=false,caption,labels}:{drawing:Drawing|null;lang:Language;filled?:boolean;caption?:string;labels?:{x:number;y:number;value:string}[]}){
 const colors=['#d78155','#a5ba9a','#e1bb5d','#8fa6bc','#c7aac0','#e0a58b'];
 return <div className="preview-surface"><div className="preview-top"><span><Icon name="grid" size={15}/> {tx(lang,'ARTBOARD','لوحة العمل')}</span><b dir="ltr">{drawing?`${drawing.width.toFixed(1)} × ${drawing.height.toFixed(1)} mm`:'—'}</b></div><div className="paper-stage">{drawing&&drawing.width>0&&drawing.height>0?<svg className="vector-paper" viewBox={`0 0 ${drawing.width} ${drawing.height}`} style={{aspectRatio:`${drawing.width}/${drawing.height}`}} role="img" aria-label={tx(lang,'Vector artwork preview','معاينة حدود التصميم')}>
  <rect width={drawing.width} height={drawing.height} fill="#fffcf5"/>
  {drawing.shapes.map((s,i)=><path key={s.id} d={pathData(s)} fill={filled?colors[i%colors.length]:'none'} fillRule="evenodd" stroke={filled?'#334038':'#c76a44'} strokeWidth={filled?0.7:1} vectorEffect="non-scaling-stroke"/>)}
  {drawing.shapes.filter(s=>s.contours.some(c=>c.layer==='engrave')).map(s=><path key={`${s.id}-engrave`} d={pathData(s,'engrave')} fill="none" stroke="#2f5db8" strokeWidth={0.8} vectorEffect="non-scaling-stroke"/>)}
  {labels?.map((l,i)=><text key={i} x={l.x} y={l.y+4} fontSize="4" fill="#476481" fontFamily="monospace">{l.value}</text>)}
 </svg>:<div className="empty-preview"><Icon name="trace" size={42}/><p>{tx(lang,'Your preview will appear here','ستظهر المعاينة هنا')}</p></div>}</div><div className="preview-bottom"><span><i/>{caption||tx(lang,'Physical dimensions · millimetres','أبعاد فعلية · ملليمتر')}</span><span dir="ltr">1:1 EXPORT</span></div></div>;
}
export function Exports({drawing,name='cut-studio',lang,disabled=false,extra}:{drawing:Drawing|null;name?:string;lang:Language;disabled?:boolean;extra?:React.ReactNode}){
 const save=(format:'svg'|'dxf')=>{if(drawing)download(format==='svg'?toSvg(drawing):toDxf(drawing),`${name}.${format}`,format==='svg'?'image/svg+xml':'application/dxf');};
 return <div className="export-bar"><div><strong>{tx(lang,'Ready for your next step','جاهز للخطوة التالية')}</strong><span dir="ltr">SVG → CorelDRAW / Illustrator · DXF → RDWorks</span></div><div className="export-actions">{extra}<button className="button secondary" onClick={()=>save('svg')} disabled={!drawing||disabled}><Icon name="download" size={16}/>{tx(lang,'Export SVG','تصدير SVG')}</button><button className="button dark" onClick={()=>save('dxf')} disabled={!drawing||disabled}><Icon name="download" size={16}/>{tx(lang,'Export DXF','تصدير DXF')}</button></div></div>;
}
