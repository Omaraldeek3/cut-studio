'use client';
import { useEffect, useState, useSyncExternalStore } from 'react';
import Link from 'next/link';
import { descriptions, titles, toolIds, tx, type Language, type ToolId } from './copy';
import { Icon } from './ui';
import { NestWorkspace, EditWorkspace, KerfWorkspace } from './vector-workspaces';
import { CostWorkspace } from './cost-workspace';
import { BoxWorkspace } from './box-workspace';
import { EngraveWorkspace } from './engrave-workspace';
import { VectorizeWorkspace } from './vectorize-workspace';
import { UpscaleWorkspace } from './upscale-workspace';
import { TilingWorkspace } from './tiling-workspace';
import { ContourWorkspace } from './contour-workspace';
import { LetteringWorkspace } from './lettering-workspace';
import { DpiWorkspace, GearWorkspace, HingeWorkspace, JobTimeWorkspace, PatternWorkspace, PuzzleWorkspace, RulerWorkspace, SignWorkspace, TagWorkspace, TestCardWorkspace } from './generator-workspaces';
import { referenceDrawing, sampleDrawing } from './samples';
import { download, toDxf, toSvg } from './export';
import type { Drawing } from './types';

// E1: the only approved change inside src/toolkit. The query is read after
// hydration through useSyncExternalStore, so the server snapshot and the static
// HTML stay English and there is no hydration mismatch. Only the exact value
// "ar" switches the interface; anything else, including no value, stays English.
const subscribeToQuery = () => () => {};
const readQueryLang = (): Language => (new URLSearchParams(window.location.search).get('lang') === 'ar' ? 'ar' : 'en');
const serverQueryLang = (): Language => 'en';

export default function Toolkit(){
 const queryLang=useSyncExternalStore(subscribeToQuery,readQueryLang,serverQueryLang);
 const [chosenLang,setChosenLang]=useState<Language|null>(null);
 const lang:Language=chosenLang??queryLang;
 const [active,setActive]=useState<ToolId>('nest'),[drawing,setDrawing]=useState<Drawing|null>(sampleDrawing),[filename,setFilename]=useState('studio-samples.svg'),[guide,setGuide]=useState(false);
 useEffect(()=>{document.documentElement.lang=lang;document.documentElement.dir=lang==='ar'?'rtl':'ltr';},[lang]);
 const index=lang==='ar'?1:0;
 function onNest(d:Drawing){setDrawing(d);setFilename('prepared-artwork.svg');setActive('nest');}
 const props={lang,drawing,setDrawing,filename,setFilename,onNest};
 // Hands artwork from one tool to another, e.g. lettering to contour.
 function onSend(d:Drawing,tool:ToolId,name='artwork.svg'){setDrawing(d);setFilename(name);setActive(tool);}
 function workspace(){switch(active){
  case 'nest':return <NestWorkspace {...props}/>;
  case 'trace':return <VectorizeWorkspace lang={lang} onNest={onNest}/>;
  case 'upscale':return <UpscaleWorkspace lang={lang}/>;
  case 'tiles':return <TilingWorkspace lang={lang}/>;
  case 'contour':return <ContourWorkspace {...props}/>;
  case 'lettering':return <LetteringWorkspace lang={lang} onSend={onSend}/>;
  case 'clean':case 'repeat':return <EditWorkspace key={active} {...props} tool={active}/>;
  case 'cost':return <CostWorkspace lang={lang}/>;
  case 'kerf':return <KerfWorkspace lang={lang}/>;
  case 'engrave':return <EngraveWorkspace lang={lang}/>;
  case 'box':return <BoxWorkspace lang={lang} onNest={onNest}/>;
  case 'hinge':return <HingeWorkspace lang={lang} onNest={onNest}/>;
  case 'gear':return <GearWorkspace lang={lang} onNest={onNest}/>;
  case 'puzzle':return <PuzzleWorkspace lang={lang} onNest={onNest}/>;
  case 'tag':return <TagWorkspace lang={lang} onNest={onNest}/>;
  case 'pattern':return <PatternWorkspace lang={lang} onNest={onNest}/>;
  case 'testcard':return <TestCardWorkspace lang={lang}/>;
  case 'ruler':return <RulerWorkspace lang={lang}/>;
  case 'sign':return <SignWorkspace lang={lang} onNest={onNest}/>;
  case 'jobtime':return <JobTimeWorkspace {...props}/>;
  case 'dpi':return <DpiWorkspace lang={lang}/>;
 }}
 return <div className="toolkit"><a className="tool-skip" href="#workspace">{tx(lang,'Skip to workspace','انتقل إلى مساحة العمل')}</a><aside className="sidebar"><Link href="/tools" className="brand" aria-label="Cut Studio home"><span className="brand-mark"><svg viewBox="0 0 32 32" fill="none" aria-hidden="true"><path d="M3 3h12v12H3zM19 3h10v6H19zM19 13h10v16H19zM3 19h12v10H3z" fill="currentColor"/></svg></span><span>CUT<span className="brand-light">STUDIO</span><small>{tx(lang,'THE DESIGNER’S WORKBENCH','مساحة أدوات المصمّم')}</small></span></Link><div className="sidebar-caption">{tx(lang,'YOUR TOOLS','أدواتك')}<span>{String(toolIds.length).padStart(2,'0')}</span></div><nav aria-label={tx(lang,'Design tools','أدوات التصميم')}>{toolIds.map((id,i)=><button key={id} className={active===id?'active':''} aria-label={titles[id][index]} aria-current={active===id?'page':undefined} onClick={()=>setActive(id)}><Icon name={id}/><span>{titles[id][index]}</span><small>{String(i+1).padStart(2,'0')}</small></button>)}</nav><div className="sidebar-foot"><div className="local-badge"><span/> {tx(lang,'Your files stay on your device','ملفاتك تبقى على جهازك')}</div><p>{tx(lang,'Built for the way you make.','أدوات تناسب طريقة عملك.')}</p><div className="app-names" dir="ltr"><b>CorelDRAW</b><b>Ai</b><b>RDWorks</b></div><button className="guide-button" onClick={()=>setGuide(v=>!v)}><span>?</span>{tx(lang,'Workflow & file guide','دليل الاستخدام والملفات')}<Icon name="arrow" size={15}/></button></div></aside>
 <div className="main-shell"><header className="topbar"><div className="breadcrumb"><span>{tx(lang,'WORKSPACE','مساحة العمل')}</span><span>/</span><b>{titles[active][index]}</b></div><div className="topbar-actions"><span className="local-indicator"><span/>{tx(lang,'Local processing','معالجة محلية')}</span><button className="language-button" onClick={()=>setChosenLang(lang==='en'?'ar':'en')}>{lang==='en'?'العربية':'English'}</button><span className="avatar">OA</span></div></header><main id="workspace" className="tool-main"><div className="page-heading"><div><div className="eyebrow">{String(toolIds.indexOf(active)+1).padStart(2,'0')} / {tx(lang,'THE RIGHT TOOL. A BETTER RESULT.','الأداة المناسبة. نتيجة أفضل.')}</div><h1>{titles[active][index]}</h1><p>{descriptions[active][index]}</p></div><span className="tool-emblem"><Icon name={active} size={32}/></span></div>
 {guide&&<section className="workflow-guide"><div><h2>{tx(lang,'From artwork to laser','من التصميم إلى الليزر')}</h2><button className="text-button" onClick={()=>setGuide(false)}>{tx(lang,'Close','إغلاق')} ×</button></div><ol><li>{tx(lang,'Import SVG, ASCII DXF or CDR. Convert text to curves first. CDR uses the local converter; choose a page for multi-page files. Each geometry element is a part.','استورد SVG أو DXF نصياً أو CDR. حوّل النصوص إلى منحنيات أولاً. يستخدم CDR المحوّل المحلي؛ اختر صفحة للملفات متعددة الصفحات. كل عنصر هندسي قطعة مستقلة.')}</li><li>{tx(lang,'Upload, set millimetres, process, and inspect the preview. Curves export as line segments with a 0.1 mm approximation target.','حمّل التصميم واضبط الأبعاد وعالج الملف وافحص المعاينة. تُقرب المنحنيات إلى مقاطع مستقيمة بدقة مستهدفة ٠٫١ مم.')}</li><li>{tx(lang,'Use SVG for editing, or DXF for RDWorks. Select millimetres when importing. Check the reference square measures exactly 100 × 100 mm.','استخدم SVG للتعديل أو DXF لبرنامج RDWorks. اختر الملليمتر عند الاستيراد، وتأكد أن المربع المرجعي يقيس ١٠٠ × ١٠٠ مم.')}</li><li>{tx(lang,'Assign cut/engrave settings in RDWorks. For unitless DXF, select the original units. CDR text, bitmaps and unsupported effects must be converted to plain curves first. AI input is not supported.','اضبط القص والحفر في RDWorks. لملفات DXF بلا وحدات، اختر الوحدات الأصلية. حوّل نصوص CDR والصور والتأثيرات إلى منحنيات بسيطة أولاً. لا يدعم الاستيراد AI.')}</li></ol><div className="guide-downloads"><button className="button secondary" onClick={()=>download(toSvg(referenceDrawing),'100mm-reference.svg')}>{tx(lang,'100 mm square · SVG','مربع ١٠٠ مم · SVG')}</button><button className="button secondary" onClick={()=>download(toDxf(referenceDrawing),'100mm-reference.dxf','application/dxf')}>{tx(lang,'100 mm square · DXF','مربع ١٠٠ مم · DXF')}</button></div></section>}
 {workspace()}
 <footer className="tool-footer"><span>CUTSTUDIO <span> / </span> {tx(lang,'Small tools. More room to create.','أدوات صغيرة. مساحة أكبر للإبداع.')}</span><span>{tx(lang,'On your computer. No account. Just your work.','على جهازك ودون حساب. مساحة لعملك.')}</span></footer></main></div></div>;
}
