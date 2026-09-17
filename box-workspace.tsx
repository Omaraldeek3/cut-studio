'use client';
import { useMemo, useState } from 'react';
import dynamic from 'next/dynamic';
import { bounds } from './geometry';
import { buildBox, defaultBoxOptions, hasLid, type BoxOptions, type BoxResult, type BoxType } from './box';
import { tx, type Language } from './copy';
import type { Drawing } from './types';
import { ErrorNote, Exports, Icon, NumberField, Section, Stat, Toggle, VectorPreview } from './ui';

const Box3D = dynamic(() => import('./box3d'), { ssr: false });

const boxTypes: { id: BoxType; en: string; ar: string; icon: React.ReactNode }[] = [
  { id: 'closed', en: 'Closed box', ar: 'صندوق مغلق', icon: <><path d="m20 4 14 6v14l-14 6-14-6V10Z"/><path d="m6 10 14 6 14-6M20 16v14"/></> },
  { id: 'open', en: 'Open tray', ar: 'صينية مفتوحة', icon: <><path d="m6 14 14 6 14-6v10l-14 6-14-6Z"/><path d="m6 14 14-6 14 6M20 20v10"/></> },
  { id: 'liftoff', en: 'Lift-off lid', ar: 'غطاء علوي', icon: <><path d="m6 17 14 6 14-6v8l-14 6-14-6Z"/><path d="M20 23v8"/><path d="m6 9 14-6 14 6-14 6Z"/></> },
  { id: 'sliding', en: 'Sliding lid', ar: 'غطاء منزلق', icon: <><path d="m6 13 14 6 14-6v11l-14 6-14-6Z"/><path d="M20 19v11"/><path d="m2 9 14-5 16 6-14 5Z"/></> },
  { id: 'drawer', en: 'Drawer', ar: 'درج', icon: <><path d="M14 4h22v20H14Z"/><path d="M4 12h20v16H4Z"/><path d="M11 20h6"/></> },
];
const arabicNames: Record<string, string> = { Bottom: 'القاعدة', Top: 'الغطاء العلوي', Front: 'الأمام', Back: 'الخلف', Left: 'اليسار', Right: 'اليمين', Lid: 'الغطاء', 'Lid locator': 'مثبّت الغطاء', 'Drawer face': 'واجهة الدرج' };
function partName(name: string, lang: Language) {
  if (lang === 'en') return name;
  if (arabicNames[name]) return arabicNames[name];
  const divider = name.match(/^Divider (\w+)$/); if (divider) return `فاصل ${divider[1]}`;
  const [group, side] = name.split(' ');
  const sideName = arabicNames[side[0].toUpperCase() + side.slice(1)] || side;
  return `${group === 'Sleeve' ? 'الغلاف' : 'الدرج'} · ${sideName}`;
}

export function BoxWorkspace({ lang, onNest }: { lang: Language; onNest: (d: Drawing) => void }) {
  const [options, setOptions] = useState<BoxOptions>(defaultBoxOptions), [view, setView] = useState<'flat' | '3d'>('flat');
  const set = <K extends keyof BoxOptions>(key: K) => (value: BoxOptions[K]) => setOptions(o => ({ ...o, [key]: value }));
  const setHand = (key: keyof BoxOptions['handHoles']) => (value: number | boolean) => setOptions(o => ({ ...o, handHoles: { ...o.handHoles, [key]: value } }));
  const { result, error } = useMemo((): { result: BoxResult | null; error: string } => {
    try { return { result: buildBox(options), error: '' }; } catch (e) { return { result: null, error: e instanceof Error ? e.message : 'Invalid box settings.' }; }
  }, [options]);
  const drawing = result?.drawing ?? null, lid = hasLid(options.type);
  const size = (s: { width: number; depth: number; height: number }) => `${+s.width.toFixed(1)} × ${+s.depth.toFixed(1)} × ${+s.height.toFixed(1)}`;
  const nestButton = <button className="button secondary" disabled={!drawing} onClick={() => { if (drawing) onNest(drawing); }}><Icon name="nest" size={16}/>{tx(lang, 'Arrange on sheet', 'ترتيب على اللوح')}</button>;
  const name = result ? `${options.type}-box-${Math.round(result.outside.width)}x${Math.round(result.outside.depth)}x${Math.round(result.outside.height)}-${options.thickness}mm` : 'box';
  return <><div className="workspace"><aside className="controls">
    <Section title={tx(lang, 'Box type', 'نوع الصندوق')} number="01">
      <div className="box-types" role="radiogroup" aria-label={tx(lang, 'Box type', 'نوع الصندوق')}>
        {boxTypes.map(type => <button key={type.id} role="radio" aria-checked={options.type === type.id} className={options.type === type.id ? 'selected' : ''} onClick={() => set('type')(type.id)}>
          <svg viewBox="0 0 40 34" width="40" height="34" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" aria-hidden="true">{type.icon}</svg><span>{tx(lang, type.en, type.ar)}</span>
        </button>)}
      </div>
    </Section>
    <Section title={tx(lang, 'Box size', 'مقاس الصندوق')} number="02">
      <label className="field"><span>{tx(lang, 'Dimensions are', 'الأبعاد المدخلة')}</span><select aria-label={tx(lang, 'Dimensions are', 'الأبعاد المدخلة')} value={options.sizing} onChange={e => set('sizing')(e.target.value as BoxOptions['sizing'])}><option value="outside">{tx(lang, 'Outside size (finished object)', 'المقاس الخارجي (الشكل النهائي)')}</option><option value="inside">{tx(lang, 'Inside size (usable space)', 'المقاس الداخلي (المساحة المتاحة)')}</option></select></label>
      <NumberField label={tx(lang, 'Width', 'العرض')} value={options.width} onChange={set('width')} min={1} step={0.5} unit="mm"/>
      <div className="field-pair"><NumberField label={tx(lang, 'Depth', 'العمق')} value={options.depth} onChange={set('depth')} min={1} step={0.5} unit="mm"/><NumberField label={tx(lang, 'Height', 'الارتفاع')} value={options.height} onChange={set('height')} min={1} step={0.5} unit="mm"/></div>
    </Section>
    <Section title={tx(lang, 'Material & joints', 'الخامة والتعشيق')} number="03">
      <div className="field-pair"><NumberField label={tx(lang, 'Material thickness', 'سماكة الخامة')} value={options.thickness} onChange={set('thickness')} min={0.5} max={30} step={0.1} unit="mm"/><NumberField label={tx(lang, 'Finger width', 'عرض السن')} value={options.finger} onChange={set('finger')} min={1} max={1000} step={0.5} unit="mm"/></div>
      <div className="field-pair"><NumberField label={tx(lang, 'Kerf compensation', 'تعويض سماكة القص')} value={options.kerf} onChange={set('kerf')} max={0.5} step={0.01} unit="mm"/><NumberField label={tx(lang, 'Clearance', 'الخلوص')} value={options.clearance} onChange={set('clearance')} max={2} step={0.05} unit="mm"/></div>
      <NumberField label={tx(lang, 'Panel spacing', 'تباعد الألواح')} value={options.spacing} onChange={set('spacing')} max={100} step={0.5} unit="mm"/>
      <p className="micro">{tx(lang, 'Kerf makes joints tight (measure it with Fit test). Clearance is the gap for lids, drawers and slots so they move freely.', 'تعويض القص يجعل التعشيق محكماً (قِسه بأداة اختبار التعشيق). الخلوص هو الفراغ اللازم لحركة الأغطية والأدراج.')}</p>
    </Section>
    <Section title={tx(lang, 'Dividers', 'الفواصل')} number="04">
      <div className="field-pair"><NumberField label={tx(lang, 'Rows (front to back)', 'صفوف (من الأمام للخلف)')} value={options.rows} onChange={set('rows')} max={20}/><NumberField label={tx(lang, 'Columns (left to right)', 'أعمدة (من اليسار لليمين)')} value={options.columns} onChange={set('columns')} max={20}/></div>
      <p className="micro">{tx(lang, 'Dividers slot into each other and lock into the walls with through-tenons.', 'تتداخل الفواصل مع بعضها وتُثبّت في الجدران بألسنة نافذة.')}</p>
    </Section>
    <Section title={tx(lang, 'Extras', 'إضافات')} number="05">
      <Toggle label={tx(lang, 'Engrave part labels', 'حفر أسماء القطع')} value={options.labels} onChange={set('labels')}/>
      {options.type !== 'drawer' && <><Toggle label={tx(lang, 'Hand holes in side walls', 'فتحات يد في الجوانب')} value={options.handHoles.enabled} onChange={setHand('enabled')}/>
        {options.handHoles.enabled && <div className="field-pair"><NumberField label={tx(lang, 'Hole width', 'عرض الفتحة')} value={options.handHoles.width} onChange={setHand('width')} min={5} unit="mm"/><NumberField label={tx(lang, 'Hole height', 'ارتفاع الفتحة')} value={options.handHoles.height} onChange={setHand('height')} min={5} unit="mm"/><NumberField label={tx(lang, 'From top', 'من الأعلى')} value={options.handHoles.fromTop} onChange={setHand('fromTop')} unit="mm"/></div>}</>}
      {lid && <div className="field-pair"><label className="field"><span>{tx(lang, 'Pull', 'مقبض')}</span><select aria-label={tx(lang, 'Pull', 'مقبض')} value={options.pull} onChange={e => set('pull')(e.target.value as BoxOptions['pull'])}><option value="none">{tx(lang, 'None', 'بدون')}</option><option value="thumb">{tx(lang, 'Thumb hole', 'فتحة إبهام')}</option><option value="slot">{tx(lang, 'Finger slot', 'فتحة أصابع')}</option></select></label>{options.pull !== 'none' && <NumberField label={tx(lang, 'Pull size', 'مقاس المقبض')} value={options.pullSize} onChange={set('pullSize')} min={5} max={200} unit="mm"/>}</div>}
      <div className="field-pair"><NumberField label={tx(lang, 'Corner radius', 'تدوير الزوايا')} value={options.cornerRadius} onChange={set('cornerRadius')} max={100} step={0.5} unit="mm"/><NumberField label={tx(lang, 'CNC dogbone', 'تفريغ CNC')} value={options.dogbone} onChange={set('dogbone')} max={5} step={0.1} unit="mm"/></div>
      <p className="micro">{tx(lang, 'Corners are rounded only where no joint meets them (lids, drawer face). Dogbone is the router bit radius; leave 0 for laser.', 'تُدوّر الزوايا الحرة فقط (الأغطية وواجهة الدرج). التفريغ هو نصف قطر ريشة الراوتر؛ اتركه ٠ لليزر.')}</p>
    </Section>
    <div className="control-action"><ErrorNote error={error}/></div>
  </aside>
  <div className="canvas-column">
    <div className="canvas-toolbar"><div className="sheet-tabs view-tabs" role="tablist">
      <button role="tab" aria-selected={view === 'flat'} className={view === 'flat' ? 'selected' : ''} onClick={() => setView('flat')}>{tx(lang, 'Flat layout', 'التخطيط المسطّح')}</button>
      <button role="tab" aria-selected={view === '3d'} className={view === '3d' ? 'selected' : ''} onClick={() => setView('3d')}>{tx(lang, '3D view', 'عرض ثلاثي الأبعاد')}</button>
    </div><span className="micro">{tx(lang, 'Red cuts · blue engraves', 'الأحمر للقص · الأزرق للحفر')}</span></div>
    {view === 'flat' || !result ? <VectorPreview drawing={drawing} lang={lang} filled caption={tx(lang, `${result?.parts.length ?? 0} parts laid out for cutting`, `${result?.parts.length ?? 0} قطعة جاهزة للقص`)}/> : <div className="preview-surface box-3d-surface"><Box3D parts={result.parts} outside={result.outside} thickness={result.thickness} lang={lang}/></div>}
    <div className="stats-row">
      <Stat label={tx(lang, 'Outside size', 'المقاس الخارجي')} value={<span dir="ltr">{result ? size(result.outside) : '—'}</span>} unit=" mm"/>
      <Stat label={tx(lang, 'Usable inside', 'المساحة الداخلية')} value={<span dir="ltr">{result ? size(result.inside) : '—'}</span>} unit=" mm"/>
      <Stat label={tx(lang, 'Parts', 'القطع')} value={result ? result.parts.length : '—'}/>
      <Stat label={tx(lang, 'Layout size', 'مساحة الترتيب')} value={<span dir="ltr">{drawing ? `${Math.ceil(drawing.width)} × ${Math.ceil(drawing.height)}` : '—'}</span>} unit=" mm"/>
    </div>
    {result && result.unlabelled.length > 0 && <p className="micro">{tx(lang, `No room for a label on: ${result.unlabelled.join(', ')}.`, `لا توجد مساحة لاسم القطعة على: ${result.unlabelled.map(n => partName(n, lang)).join('، ')}.`)}</p>}
    {result && <table className="parts-list"><caption>{tx(lang, 'Parts list', 'قائمة القطع')}</caption><thead><tr><th>{tx(lang, 'Part', 'القطعة')}</th><th>{tx(lang, 'Size (mm)', 'المقاس (مم)')}</th><th>{tx(lang, 'Holes', 'الفتحات')}</th></tr></thead><tbody>
      {result.parts.map(p => { const b = bounds(p.shape); return <tr key={p.name}><td>{partName(p.name, lang)}</td><td dir="ltr">{+b.width.toFixed(2)} × {+b.height.toFixed(2)}</td><td>{p.shape.contours.filter(c => c.closed && c.layer !== 'engrave').length - 1}</td></tr>; })}
    </tbody></table>}
    <div className="tip-card"><span className="tip-mark">i</span><p>{tx(lang, 'Cut one test corner before the whole box. Every joint is generated so each piece of material belongs to exactly one part. Use “Arrange on sheet” to nest the parts, or several boxes, on your material.', 'اقطع زاوية تجريبية قبل الصندوق كاملاً. تُولّد كل وصلة بحيث تنتمي كل قطعة من الخامة إلى جزء واحد فقط. استخدم «ترتيب على اللوح» لترتيب القطع أو عدة صناديق على خامتك.')}</p></div>
  </div></div><Exports drawing={drawing} name={name} lang={lang} extra={nestButton}/></>;
}
