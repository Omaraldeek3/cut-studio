'use client';
import { useMemo, useState } from 'react';
import type { Drawing } from './types';
import { tx, type Language } from './copy';
import { ErrorNote, Exports, NumberField, Section, Stat, Toggle, VectorPreview } from './ui';
import { VectorInput } from './vector-input';
import { defaultCnc, prepareForCnc, type CncOptions } from './cnc';

type Props = { lang: Language; drawing: Drawing | null; setDrawing: (d: Drawing | null) => void; filename: string; setFilename: (n: string) => void; onNest: (d: Drawing) => void };

export function CncWorkspace(props: Props) {
  const { lang, drawing } = props;
  const [o, setO] = useState<CncOptions>(defaultCnc);
  const set = <K extends keyof CncOptions>(key: K) => (value: CncOptions[K]) => setO(v => ({ ...v, [key]: value }));
  const built = useMemo(() => {
    if (!drawing) return { result: null, error: '' };
    try { return { result: prepareForCnc(drawing, o), error: '' }; } catch (e) { return { result: null, error: e instanceof Error ? e.message : 'Invalid settings.' }; }
  }, [drawing, o]);
  const r = built.result;
  return <>
    <div className="workspace">
      <aside className="controls">
        <VectorInput {...props} />
        <Section title={tx(lang, 'Bit and corners', 'الريشة والزوايا')} number="02">
          <NumberField label={tx(lang, 'Bit diameter', 'قطر الريشة')} value={o.bit} onChange={set('bit')} min={0.1} max={50} step={0.1} unit="mm" />
          <Toggle label={tx(lang, 'Dogbones in inside corners', 'تفريغ الزوايا الداخلية (Dogbone)')} value={o.dogbones} onChange={set('dogbones')} />
          {o.dogbones && <NumberField label={tx(lang, 'Corners up to', 'الزوايا حتى')} value={o.maxAngle} onChange={set('maxAngle')} min={60} max={179} step={5} unit="°" />}
          <p className="micro">{tx(lang, 'A round bit leaves a fillet in every inside corner, so a square tab will not seat. A dogbone cuts a relief the size of the bit through the corner. 135° catches every right angle and sharper.', 'الريشة الدائرية تترك تقويساً في كل زاوية داخلية، فلا يدخل اللسان المربع. التفريغ يقص دائرة بحجم الريشة عند الزاوية. القيمة ١٣٥° تشمل كل زاوية قائمة وأحدّ منها.')}</p>
        </Section>
        <Section title={tx(lang, 'Holding tabs', 'جسور التثبيت')} number="03">
          <div className="field-pair">
            <NumberField label={tx(lang, 'Tabs per part', 'جسور لكل قطعة')} value={o.tabs} onChange={set('tabs')} min={0} max={12} />
            {o.tabs > 0 && <NumberField label={tx(lang, 'Tab width', 'عرض الجسر')} value={o.tabWidth} onChange={set('tabWidth')} min={0.5} max={50} step={0.5} unit="mm" />}
          </div>
          <p className="micro">{tx(lang, 'Gaps left in each part outline (holes are not touched), widened by the bit so the uncut tab is the width you set. Most CAM programs add tabs themselves; use these only if yours cuts the drawn line directly.', 'فجوات في حد كل قطعة (لا تُمس الثقوب)، تُوسَّع بقطر الريشة ليبقى الجسر غير المقصوص بالعرض الذي تحدده. أغلب برامج CAM تضيف الجسور بنفسها؛ استخدم هذه فقط إذا كان برنامجك يقص الخط المرسوم مباشرة.')}</p>
        </Section>
        <div className="control-action"><ErrorNote error={built.error} lang={lang} /></div>
      </aside>
      <div className="canvas-column">
        <div className="canvas-toolbar"><span className={`status-pill ${r ? 'ready' : ''}`}><i />{r ? tx(lang, 'Ready for the router', 'جاهز للراوتر') : tx(lang, 'Import a design', 'استورد تصميماً')}</span><span className="micro">{tx(lang, 'Engraving lines are left as they are', 'خطوط الحفر تبقى كما هي')}</span></div>
        <VectorPreview drawing={r?.drawing ?? drawing} lang={lang} issues={r?.tooNarrowAt} />
        <div className="stats-row">
          <Stat label={tx(lang, 'Dogbones added', 'زوايا مفرّغة')} value={r ? r.dogbones : '—'} />
          <Stat label={tx(lang, 'Holes narrower than the bit', 'ثقوب أضيق من الريشة')} value={r ? r.tooNarrow : '—'} />
          <Stat label={tx(lang, 'Tabs', 'الجسور')} value={r ? r.tabs : '—'} />
        </div>
        {r && r.tooNarrow > 0 && <div className="tip-card" role="status"><span className="tip-mark">!</span><p>{tx(lang, `${r.tooNarrow} holes or slots are narrower than the ${o.bit} mm bit (ringed in red): it cannot enter them. Use a smaller bit for them, or widen them.`, `ثقوب أو فتحات أضيق من ريشة ${o.bit} مم (محاطة بالأحمر): ${r.tooNarrow}. لا تدخلها الريشة؛ استخدم ريشة أصغر لها أو وسّعها.`)}</p></div>}
      </div>
    </div>
    <Exports drawing={r?.drawing ?? null} name="cnc-ready" lang={lang} extra={r && <button className="text-button" onClick={() => props.onNest(r.drawing)}>{tx(lang, 'Use in nesting', 'استخدم في الترتيب')} ↗</button>} />
  </>;
}
