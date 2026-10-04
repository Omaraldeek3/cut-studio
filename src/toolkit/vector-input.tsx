'use client';
import {useEffect,useRef,useState} from 'react';
import type {Drawing} from './types';
import {parseSvg} from './svg-import';
import {parseDxf} from './dxf-import';
import {extractCdrPages,type CdrPage} from './cdr-pages';
import {sampleDrawing} from './samples';
import {tx,type Language} from './copy';
import {ErrorNote,Icon,NumberField,Section} from './ui';

type Props={lang:Language;drawing:Drawing|null;setDrawing:(d:Drawing|null)=>void;filename:string;setFilename:(n:string)=>void};
type Unit='auto'|'mm'|'cm'|'in';
/** Converts a CorelDRAW file with libcdr in a worker, stopping it after 40 seconds. */
function convertCdr(bytes:ArrayBuffer,signal:AbortSignal,lang:Language){
 return new Promise<string>((resolve,reject)=>{
  const worker=new Worker(new URL('./cdr.worker.ts',import.meta.url));
  const stop=(error:Error)=>{clearTimeout(timer);signal.removeEventListener('abort',cancel);worker.terminate();reject(error);};
  const abort=()=>Object.assign(new Error('aborted'),{name:'AbortError'});
  const cancel=()=>stop(abort());
  const timer=setTimeout(cancel,40000);
  signal.addEventListener('abort',cancel);
  worker.onmessage=(event:MessageEvent<{xhtml?:string;failed?:string}>)=>{
   const {xhtml,failed}=event.data;
   if(typeof xhtml==='string'){clearTimeout(timer);signal.removeEventListener('abort',cancel);worker.terminate();resolve(xhtml);return;}
   stop(new Error(failed==='unsupported'?tx(lang,'This is not a CorelDRAW file this reader supports, or it is password-protected. In CorelDRAW choose File › Save As and an older CDR version, or export as SVG.','هذا ليس ملف CorelDRAW يدعمه القارئ، أو أنه محمي بكلمة مرور. في CorelDRAW اختر ملف › حفظ باسم وإصدار CDR أقدم، أو صدّره بصيغة SVG.')
    :failed==='size'?tx(lang,'This CorelDRAW file is too complex to read here. Simplify it or export it as SVG.','ملف CorelDRAW هذا معقد جداً للقراءة هنا. بسّطه أو صدّره بصيغة SVG.')
    :tx(lang,'This CorelDRAW file could not be read. It may be damaged or use an unsupported version. Try File › Save As an older CDR version, or export as SVG.','تعذرت قراءة ملف CorelDRAW هذا. قد يكون تالفاً أو بإصدار غير مدعوم. جرّب ملف › حفظ باسم بإصدار CDR أقدم، أو صدّره بصيغة SVG.')));
  };
  worker.onerror=()=>stop(new Error(tx(lang,'The CorelDRAW reader could not start in this browser. Update the browser, or export the file as SVG.','تعذر تشغيل قارئ CorelDRAW في هذا المتصفح. حدّث المتصفح أو صدّر الملف بصيغة SVG.')));
  worker.postMessage({bytes},[bytes]);
 });
}
export function VectorInput({lang,drawing,setDrawing,filename,setFilename}:Props){
 const [physical,setPhysical]=useState(NaN),[unit,setUnit]=useState<Unit>('auto'),[error,setError]=useState(''),[busy,setBusy]=useState(false),[phase,setPhase]=useState('');
 const [pages,setPages]=useState<CdrPage[]>([]),[notice,setNotice]=useState(''),[page,setPage]=useState(0),[pending,setPending]=useState<File|null>(null);
 const ticket=useRef(0),abort=useRef<AbortController|null>(null);
 useEffect(()=>()=>{ticket.current++;abort.current?.abort();},[]);
 const width=Number.isFinite(physical)?physical:undefined;
 async function load(file?:File,chosenUnit:Unit=unit){
  if(!file)return;abort.current?.abort();const controller=new AbortController();abort.current=controller;
  const current=++ticket.current;setError('');setNotice('');setBusy(true);setDrawing(null);setPending(file);setPages([]);setPage(0);setPhase('');
  try{
   const ext=file.name.split('.').at(-1)?.toLowerCase();
   if(!ext||!['svg','dxf','cdr'].includes(ext))throw new Error(tx(lang,'Choose an SVG, DXF or CDR file.','اختر ملف SVG أو DXF أو CDR.'));
   const max=ext==='cdr'?10:32;
   if(file.size>max*1024*1024)throw new Error(`${ext.toUpperCase()}: ${tx(lang,'maximum file size','أقصى حجم للملف')} ${max} MB.`);
   let result:Drawing,skipped={skippedText:0,skippedImages:0};
   if(ext==='cdr'){
    setPhase(tx(lang,'Reading the CorelDRAW file…','جارٍ قراءة ملف CorelDRAW…'));
    const xhtml=await convertCdr(await file.arrayBuffer(),controller.signal,lang);
    if(current!==ticket.current)return;
    const converted=extractCdrPages(xhtml);setPages(converted);skipped=converted[0];result=await parseSvg(converted[0].svg,width);
   }else if(ext==='dxf')result=parseDxf(await file.text(),{unit:chosenUnit==='auto'?undefined:chosenUnit,physicalWidthMm:width});
   else result=await parseSvg(await file.text(),width);
   if(current!==ticket.current)return;setDrawing(result);setFilename(file.name);setNotice(skippedNotice(skipped.skippedText+(result.skippedText||0),skipped.skippedImages));
  }catch(e){if(current===ticket.current)setError(e instanceof Error&&e.name==='AbortError'?tx(lang,'Import was cancelled or timed out. Try a smaller file.','أُلغي الاستيراد أو انتهت مهلته. جرّب ملفاً أصغر.'):e instanceof Error?e.message:'Import failed.');}
  finally{if(current===ticket.current){setBusy(false);setPhase('');}}
 }
 async function choosePage(index:number){const current=++ticket.current;setPage(index);setError('');setNotice('');setDrawing(null);setBusy(true);try{const result=await parseSvg(pages[index].svg,width);if(current===ticket.current){setDrawing(result);setNotice(skippedNotice(pages[index].skippedText+(result.skippedText||0),pages[index].skippedImages));setFilename(`${pending?.name||'artwork.cdr'} · ${tx(lang,'page','صفحة')} ${index+1}`);}}catch(e){setError(e instanceof Error?e.message:'Page import failed.');}finally{if(current===ticket.current)setBusy(false);}}
 function skippedNotice(skippedText:number,skippedImages:number){
  const parts=[skippedText&&tx(lang,`${skippedText} text object${skippedText>1?'s':''}`,`${skippedText} نص`),skippedImages&&tx(lang,`${skippedImages} bitmap${skippedImages>1?'s':''}`,`${skippedImages} صورة نقطية`)].filter(Boolean);
  return parts.length?tx(lang,`Ignored ${parts.join(' and ')}: not converted to curves, so not cut or nested. To include text, convert it to curves (CorelDRAW: Ctrl+Q).`,`تم تجاهل ${parts.join(' و')} لأنها غير محوّلة إلى منحنيات، فلن تُقص أو تُرتّب. لتضمين النص حوّله إلى منحنيات (CorelDRAW: Ctrl+Q).`):'';
 }
 function reset(){ticket.current++;abort.current?.abort();setBusy(false);setError('');setNotice('');setPages([]);setPending(null);setDrawing(sampleDrawing());setFilename('studio-samples.svg');}
 const format=(pending?.name||filename).split('.').at(-1)?.split(' ')[0].toUpperCase()||'SVG';
 return <Section title={tx(lang,'Your artwork','التصميم')} number="01">
  <label className="upload-zone"><input type="file" accept=".svg,.dxf,.cdr,image/svg+xml,application/dxf,application/x-coreldraw" aria-label={tx(lang,'Import vector file','استيراد ملف فيكتور')} disabled={busy} onChange={e=>{void load(e.target.files?.[0]);e.target.value='';}}/><span className="upload-icon"><Icon name="upload"/></span><strong>{busy?phase||tx(lang,'Reading outlines…','جارٍ قراءة الحدود…'):tx(lang,'Import artwork','استيراد التصميم')}</strong><span dir="ltr">SVG · DXF · CDR</span></label>
  <p className="micro">{tx(lang,'SVG, DXF and CorelDRAW (CDR) files are read in your browser and never uploaded. Convert text to curves before importing.','تُقرأ ملفات SVG وDXF وCorelDRAW (CDR) في متصفحك ولا تُرفع إلى أي مكان. حوّل النصوص إلى منحنيات قبل الاستيراد.')}</p>
  <details className="import-options"><summary>{tx(lang,'Units & import size','الوحدات ومقاس الاستيراد')}</summary>
   <label className="field"><span>{tx(lang,'DXF units','وحدات DXF')}</span><select aria-label={tx(lang,'DXF units','وحدات DXF')} value={unit} disabled={busy} onChange={e=>{const next=e.target.value as Unit;setUnit(next);if(pending?.name.toLowerCase().endsWith('.dxf'))void load(pending,next);}}><option value="auto">{tx(lang,'Read from file','قراءة من الملف')}</option><option value="mm">{tx(lang,'Millimetres','ملليمتر')} (mm)</option><option value="cm">{tx(lang,'Centimetres','سنتيمتر')} (cm)</option><option value="in">{tx(lang,'Inches','بوصة')} (in)</option></select></label>
   <NumberField label={tx(lang,'Import width override','عرض الاستيراد الاختياري')} value={physical} onChange={setPhysical} min={0.1} max={3000} step={0.1} unit="mm" optional/>
   <p className="micro">{tx(lang,'Optional. Set before import. For a DXF without units, choose its original units. A width override intentionally resizes the artwork.','اختياري. حدده قبل الاستيراد. لملف DXF بلا وحدات، اختر وحداته الأصلية. تغيير العرض يعيد تحجيم التصميم.')}</p>
   {pending&&<button className="text-button" disabled={busy} onClick={()=>void load(pending)}>{tx(lang,'Reimport with these settings','إعادة الاستيراد بهذه الإعدادات')}</button>}
  </details>
  {pages.length>1&&<label className="field"><span>{tx(lang,'CDR page','صفحة CDR')} ({pages.length})</span><select aria-label={tx(lang,'CDR page','صفحة CDR')} value={page} disabled={busy} onChange={e=>void choosePage(+e.target.value)}>{pages.map((_,i)=><option key={i} value={i}>{tx(lang,'Page','صفحة')} {i+1}</option>)}</select><small className="micro">{tx(lang,'Only the selected page is imported.','تُستورد الصفحة المحددة فقط.')}</small></label>}
  <div className="file-chip"><span className="file-symbol">{format}</span><div><strong>{filename}</strong><small>{drawing?`${drawing.shapes.length} ${tx(lang,'parts loaded','قطع محملة')}`:tx(lang,'No artwork loaded','لم يُحمّل تصميم')}</small></div></div>
  <button className="text-button" onClick={reset}>{busy?tx(lang,'Cancel and use sample','إلغاء واستخدام العينة'):tx(lang,'Use sample artwork','استخدم التصميم التجريبي')}</button>{notice&&<p role="status" className="micro">{notice}</p>}<ErrorNote error={error} lang={lang}/>
 </Section>;
}
