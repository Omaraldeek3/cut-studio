'use client';
import { useState } from 'react';
import Link from 'next/link';
import { useRouter, useSelectedLayoutSegment } from 'next/navigation';
import { defaultTool, descriptions, groupOf, groups, slugs, titles, toolFromSlug, toolIds, tx, type Language, type OutsideLink, type ToolId } from './copy';
import { Icon } from './ui';
import { NestWorkspace, EditWorkspace, KerfWorkspace } from './vector-workspaces';
import { QuoteWorkspace } from './quote-workspace';
import { CncWorkspace } from './cnc-workspace';
import { FeedsWorkspace } from './feeds-workspace';
import type { NestedJob } from './quote';
import { BoxWorkspace } from './box-workspace';
import { EngraveWorkspace } from './engrave-workspace';
import { VectorizeWorkspace } from './vectorize-workspace';
import { UpscaleWorkspace } from './upscale-workspace';
import { GenerateWorkspace, type Handover } from './generate-workspace';
import { TilingWorkspace } from './tiling-workspace';
import { ContourWorkspace } from './contour-workspace';
import { LetteringWorkspace } from './lettering-workspace';
import { SheetWorkspace } from './sheet-workspace';
import { DpiWorkspace, GearWorkspace, HingeWorkspace, PatternWorkspace, PuzzleWorkspace, RulerWorkspace, TagWorkspace, TestCardWorkspace, TrophyWorkspace, PolyBoxWorkspace, TemplatesWorkspace } from './generator-workspaces';
import { referenceDrawing, sampleDrawing } from './samples';
import { download, toDxf, toSvg } from './export';
import type { Drawing } from './types';

/* The workbench lives in the locale layout, so moving from tool to tool is a
   navigation that keeps the artwork loaded: each tool has its own address
   (/ar/box-maker, /en/box-maker) and its own page for search engines, while
   the drawing handed between tools stays in this component's state. */

export default function Toolkit({lang}:{lang:Language}){
 const router=useRouter();
 const segment=useSelectedLayoutSegment();
 const active:ToolId=(segment&&toolFromSlug(segment))||defaultTool;
 const href=(id:ToolId,locale:Language=lang)=>`/${locale}/${slugs[id]}`;
 const setActive=(id:ToolId)=>router.push(href(id));
 const [drawing,setDrawing]=useState<Drawing|null>(sampleDrawing),[filename,setFilename]=useState('studio-samples.svg'),[guide,setGuide]=useState(false),[query,setQuery]=useState('');
 const index=lang==='ar'?1:0;
 function onNest(d:Drawing){setDrawing(d);setFilename('prepared-artwork.svg');setActive('nest');}
 // A nesting result goes to the quote with its sheets and pieces; its parts become the artwork to time.
 const [job,setJob]=useState<NestedJob|null>(null);
 function onQuote(j:NestedJob){setJob(j);setDrawing(j.drawing);setFilename(`nested-${j.sheets}-sheets.svg`);setActive('quote');}
 const props={lang,drawing,setDrawing,filename,setFilename,onNest};
 // Hands artwork from one tool to another, e.g. lettering to contour.
 function onSend(d:Drawing,tool:ToolId,name='artwork.svg'){setDrawing(d);setFilename(name);setActive(tool);}
 // A picture for the tracer, such as a generated design on its way to cutting lines.
 const [handover,setHandover]=useState<Handover|null>(null);
 function onTrace(h:Handover){setHandover(h);setActive('trace');}
 function workspace(){switch(active){
  case 'nest':return <NestWorkspace {...props} onQuote={onQuote}/>;
  case 'trace':return <VectorizeWorkspace lang={lang} onNest={onNest} incoming={handover}/>;
  case 'generate':return <GenerateWorkspace lang={lang} onTrace={onTrace}/>;
  case 'upscale':return <UpscaleWorkspace lang={lang}/>;
  case 'tiles':return <TilingWorkspace lang={lang}/>;
  case 'contour':return <ContourWorkspace {...props}/>;
  case 'lettering':return <LetteringWorkspace lang={lang} onSend={onSend}/>;
  case 'sheet':return <SheetWorkspace lang={lang}/>;
  case 'clean':case 'repeat':return <EditWorkspace key={active} {...props} tool={active}/>;
  case 'quote':return <QuoteWorkspace {...props} job={job&&job.drawing===drawing?job:null}/>;
  case 'kerf':return <KerfWorkspace lang={lang}/>;
  case 'cnc':return <CncWorkspace {...props}/>;
  case 'feeds':return <FeedsWorkspace lang={lang}/>;
  case 'engrave':return <EngraveWorkspace lang={lang}/>;
  case 'box':return <BoxWorkspace lang={lang} onNest={onNest}/>;
  case 'hinge':return <HingeWorkspace lang={lang} onNest={onNest}/>;
  case 'gear':return <GearWorkspace lang={lang} onNest={onNest}/>;
  case 'puzzle':return <PuzzleWorkspace lang={lang} onNest={onNest}/>;
  case 'tag':return <TagWorkspace lang={lang} onNest={onNest}/>;
  case 'trophy':return <TrophyWorkspace lang={lang} onNest={onNest}/>;
  case 'polybox':return <PolyBoxWorkspace lang={lang} onNest={onNest}/>;
  case 'templates':return <TemplatesWorkspace lang={lang} onNest={onNest}/>;
  case 'pattern':return <PatternWorkspace lang={lang} onNest={onNest}/>;
  case 'testcard':return <TestCardWorkspace lang={lang}/>;
  case 'ruler':return <RulerWorkspace lang={lang}/>;
  case 'dpi':return <DpiWorkspace lang={lang}/>;
 }}
 const group=groupOf(active);
 const needle=query.trim().toLowerCase();
 const shown=(id:ToolId)=>!needle||titles[id].some(t=>t.toLowerCase().includes(needle))||descriptions[id].some(t=>t.toLowerCase().includes(needle));
 const linkShown=(l:OutsideLink)=>!needle||l.title.some(t=>t.toLowerCase().includes(needle))||l.note.some(t=>t.toLowerCase().includes(needle));
 // On a phone the tools come from one list; a site of its own opens in a new tab and the list stays on the tool.
 function pick(value:string){if(value.startsWith('https://')){window.open(value,'_blank','noopener');return;}setActive(value as ToolId);}
 return <div className="toolkit"><a className="tool-skip" href="#workspace">{tx(lang,'Skip to workspace','انتقل إلى مساحة العمل')}</a>
 <aside className="sidebar">
  <Link href={`/${lang}`} className="brand" aria-label="Cut Studio home"><span className="brand-mark"><svg viewBox="0 0 32 32" fill="none" aria-hidden="true"><path d="M3 3h12v12H3zM19 3h10v6H19zM19 13h10v16H19zM3 19h12v10H3z" fill="currentColor"/></svg></span><span>Cut<span className="brand-light">Studio</span><small>{tx(lang,'Free tools for makers','أدوات مجانية للورش')}</small></span></Link>
  <label className="tool-search"><Icon name="search" size={16}/><input type="search" value={query} onChange={e=>setQuery(e.target.value)} placeholder={tx(lang,`Search ${toolIds.length} tools`,`ابحث في ${toolIds.length} أداة`)} aria-label={tx(lang,'Search tools','ابحث في الأدوات')}/></label>
  <nav aria-label={tx(lang,'Design tools','أدوات التصميم')}>{groups.map(g=>{const tools=g.tools.filter(shown),links=(g.links??[]).filter(linkShown);return tools.length||links.length?<div className="nav-group" key={g.id}><h2>{g.title[index]}</h2>{tools.map(id=><Link key={id} href={href(id)} className={active===id?'active':''} aria-label={titles[id][index]} aria-current={active===id?'page':undefined} onClick={()=>setQuery('')}><Icon name={id} size={18}/><span>{titles[id][index]}</span></Link>)}{links.map(l=><a key={l.href} href={l.href} target="_blank" rel="noopener" className="nav-out" title={l.note[index]}><Icon name={l.icon} size={18}/><span>{l.title[index]}</span><Icon name="external" size={13}/></a>)}</div>:null;})}{!groups.some(g=>g.tools.some(shown)||(g.links??[]).some(linkShown))&&<p className="nav-empty">{tx(lang,'No tool matches that.','لا توجد أداة بهذا الاسم.')}</p>}</nav>
  <label className="tool-picker"><span>{tx(lang,'Tool','الأداة')}</span><select value={active} onChange={e=>pick(e.target.value)}>{groups.map(g=><optgroup key={g.id} label={g.title[index]}>{g.tools.map(id=><option key={id} value={id}>{titles[id][index]}</option>)}{g.links?.map(l=><option key={l.href} value={l.href}>{`${l.title[index]} ↗`}</option>)}</optgroup>)}</select></label>
  <div className="sidebar-foot"><div className="local-badge"><span/> {tx(lang,'Your files never leave this device','ملفاتك لا تغادر جهازك')}</div><div className="app-names" dir="ltr"><b>CorelDRAW</b><b>Illustrator</b><b>RDWorks</b><b>LightBurn</b></div><button className="guide-button" onClick={()=>setGuide(v=>!v)}><span>?</span>{tx(lang,'Workflow & file guide','دليل الاستخدام والملفات')}</button></div>
 </aside>
 <div className="main-shell"><header className="topbar"><div className="breadcrumb"><span>{group.title[index]}</span><Icon name="chevron" size={14}/><b>{titles[active][index]}</b></div><div className="topbar-actions"><span className="local-indicator"><span/>{tx(lang,'Processed on your device','المعالجة على جهازك')}</span><Link className="language-button" href={href(active,lang==='en'?'ar':'en')} hrefLang={lang==='en'?'ar':'en'}>{lang==='en'?'العربية':'English'}</Link></div></header><main id="workspace" className="tool-main"><div className="page-heading"><span className="tool-emblem"><Icon name={active} size={26}/></span><div><h1>{titles[active][index]}</h1><p>{descriptions[active][index]}</p></div></div>
 {guide&&<section className="workflow-guide"><div><h2>{tx(lang,'From artwork to laser','من التصميم إلى الليزر')}</h2><button className="text-button" onClick={()=>setGuide(false)}>{tx(lang,'Close','إغلاق')} ×</button></div><ol><li>{tx(lang,'Import SVG, ASCII DXF or CDR. Convert text to curves first. CDR files are read in the browser too; choose a page for multi-page files. Each geometry element is a part.','استورد SVG أو DXF نصياً أو CDR. حوّل النصوص إلى منحنيات أولاً. تُقرأ ملفات CDR في المتصفح أيضاً؛ اختر صفحة للملفات متعددة الصفحات. كل عنصر هندسي قطعة مستقلة.')}</li><li>{tx(lang,'Set the sizes in millimetres and check the preview. Files keep real lines, arcs and curves: DXF uses lines and arcs, SVG keeps Bézier curves too.','اضبط المقاسات بالملليمتر وافحص المعاينة. الملفات تحفظ خطوطاً وأقواساً ومنحنيات حقيقية: DXF بالخطوط والأقواس، وSVG بمنحنيات Bézier أيضاً.')}</li><li>{tx(lang,'Use SVG for editing, or DXF for RDWorks. Select millimetres when importing. Check the reference square measures exactly 100 × 100 mm.','استخدم SVG للتعديل أو DXF لبرنامج RDWorks. اختر الملليمتر عند الاستيراد، وتأكد أن المربع المرجعي يقيس ١٠٠ × ١٠٠ مم.')}</li><li>{tx(lang,'Assign cut/engrave settings in RDWorks. For unitless DXF, select the original units. CDR text, bitmaps and unsupported effects must be converted to plain curves first. AI input is not supported.','اضبط القص والحفر في RDWorks. لملفات DXF بلا وحدات، اختر الوحدات الأصلية. حوّل نصوص CDR والصور والتأثيرات إلى منحنيات بسيطة أولاً. لا يدعم الاستيراد AI.')}</li></ol><div className="guide-downloads"><button className="button secondary" onClick={()=>download(toSvg(referenceDrawing),'100mm-reference.svg')}>{tx(lang,'100 mm square · SVG','مربع ١٠٠ مم · SVG')}</button><button className="button secondary" onClick={()=>download(toDxf(referenceDrawing),'100mm-reference.dxf','application/dxf')}>{tx(lang,'100 mm square · DXF','مربع ١٠٠ مم · DXF')}</button></div></section>}
 {workspace()}
 {group.id==='ready'&&group.links?.map(l=><aside key={l.href} className="shakl-card"><span className="tool-emblem"><Icon name={l.icon} size={24}/></span><div><strong>{l.ask[index]}</strong><p>{l.note[index]}</p></div><a className="button secondary" href={l.href} target="_blank" rel="noopener">{l.cta[index]}<Icon name="external" size={15}/></a></aside>)}
 <footer className="tool-footer"><span>Cut Studio · {tx(lang,'Free and open source','مجاني ومفتوح المصدر')}</span><span>{tx(lang,'On your computer. No account. Just your work.','على جهازك ودون حساب. مساحة لعملك.')}</span></footer></main></div></div>;
}
