'use client';
import { useMemo, useState } from 'react';
import { tx, type Language } from './copy';
import { ErrorNote, NumberField, Section, Stat } from './ui';
import { defaultFeeds, feedsAndSpeeds, type FeedMaterial, type FeedOptions, type Rigidity } from './feeds';

const MATERIAL_NAMES: [FeedMaterial, string, string][] = [
  ['softwood', 'Softwood (pine)', 'خشب طري (صنوبر)'], ['hardwood', 'Hardwood (oak, beech)', 'خشب صلب (سنديان، زان)'],
  ['mdf', 'MDF', 'MDF'], ['plywood', 'Plywood', 'خشب معاكس (بلايوود)'], ['acrylic', 'Acrylic (cast)', 'أكريليك (مصبوب)'],
  ['hdpe', 'HDPE and soft plastics', 'HDPE والبلاستيك الطري'], ['aluminium', 'Aluminium', 'ألمنيوم'],
];

export function FeedsWorkspace({ lang }: { lang: Language }) {
  const [o, setO] = useState<FeedOptions>({ ...defaultFeeds, chipLoad: NaN });
  const set = <K extends keyof FeedOptions>(key: K) => (value: FeedOptions[K]) => setO(v => ({ ...v, [key]: value }));
  const built = useMemo(() => { try { return { r: feedsAndSpeeds(o), error: '' }; } catch (e) { return { r: null, error: e instanceof Error ? e.message : 'Invalid settings.' }; } }, [o]);
  const r = built.r;
  return <div className="workspace">
    <aside className="controls">
      <Section title={tx(lang, 'Material and bit', 'الخامة والريشة')} number="01">
        <label className="field"><span>{tx(lang, 'Material', 'الخامة')}</span>
          <select value={o.material} onChange={e => set('material')(e.target.value as FeedMaterial)}>{MATERIAL_NAMES.map(([id, en, ar]) => <option key={id} value={id}>{tx(lang, en, ar)}</option>)}</select>
        </label>
        <div className="field-pair">
          <NumberField label={tx(lang, 'Bit diameter', 'قطر الريشة')} value={o.diameter} onChange={set('diameter')} min={0.5} max={25} step={0.1} unit="mm" />
          <NumberField label={tx(lang, 'Flutes', 'عدد الحدود (Flutes)')} value={o.flutes} onChange={set('flutes')} min={1} max={6} />
        </div>
      </Section>
      <Section title={tx(lang, 'Your machine', 'ماكينتك')} number="02">
        <div className="field-pair">
          <NumberField label={tx(lang, 'Lowest spindle speed', 'أدنى سرعة دوران')} value={o.minRpm} onChange={set('minRpm')} min={1000} max={60000} step={500} unit="rpm" />
          <NumberField label={tx(lang, 'Highest spindle speed', 'أعلى سرعة دوران')} value={o.maxRpm} onChange={set('maxRpm')} min={1000} max={60000} step={500} unit="rpm" />
        </div>
        <NumberField label={tx(lang, 'Highest feed rate', 'أعلى سرعة تغذية')} value={o.maxFeed} onChange={set('maxFeed')} min={100} max={50000} step={100} unit="mm/min" />
        <label className="field"><span>{tx(lang, 'How rigid it is', 'صلابة الماكينة')}</span>
          <select value={o.rigidity} onChange={e => set('rigidity')(e.target.value as Rigidity)}>
            <option value="light">{tx(lang, 'Light: hobby router, belts or a trim router', 'خفيفة: راوتر هواة أو سيور أو تريمر')}</option>
            <option value="medium">{tx(lang, 'Medium: ball screws, aluminium frame', 'متوسطة: براغي كروية وهيكل ألمنيوم')}</option>
            <option value="heavy">{tx(lang, 'Heavy: steel frame, water-cooled spindle', 'ثقيلة: هيكل حديد وسبندل مبرَّد بالماء')}</option>
          </select>
        </label>
      </Section>
      <Section title={tx(lang, 'Fine tuning', 'ضبط دقيق')} number="03">
        <NumberField label={tx(lang, 'Chip load (blank: from the chart)', 'سماكة الرايش (فارغ: من الجدول)')} value={o.chipLoad ?? NaN} onChange={set('chipLoad')} min={0.005} max={1} step={0.005} unit="mm" optional />
        <p className="micro">{tx(lang, 'Chips like dust or burn marks: raise the chip load. Chipping, chatter or a broken bit: lower it, or cut shallower.', 'إذا خرج الرايش كالغبار أو ظهر حرق: زد سماكة الرايش. إذا تشظّت الحواف أو اهتزت الريشة أو انكسرت: قلّلها أو خفّف عمق القص.')}</p>
      </Section>
      <div className="control-action"><ErrorNote error={built.error} lang={lang} /></div>
    </aside>
    <div className="canvas-column">
      <div className="stats-row feeds-result">
        <Stat label={tx(lang, 'Spindle speed', 'سرعة الدوران')} value={r ? r.rpm : '—'} unit="rpm" />
        <Stat label={tx(lang, 'Feed rate', 'سرعة التغذية')} value={r ? r.feed : '—'} unit="mm/min" />
        <Stat label={tx(lang, 'Plunge rate', 'سرعة النزول')} value={r ? r.plunge : '—'} unit="mm/min" />
        <Stat label={tx(lang, 'Depth per pass', 'العمق لكل مرور')} value={r ? r.depth : '—'} unit="mm" />
        <Stat label={tx(lang, 'Stepover: rough / finish', 'الإزاحة الجانبية: تخشين / تنعيم')} value={r ? `${r.roughStepover} / ${r.finishStepover}` : '—'} unit="mm" />
        <Stat label={tx(lang, 'Chip load', 'سماكة الرايش')} value={r ? r.chipLoad.toFixed(3) : '—'} unit="mm" />
      </div>
      {r && r.notes.includes('feed-limited') && <div className="tip-card" role="status"><span className="tip-mark">!</span><p>{r.notes.includes('below-min-rpm')
        ? tx(lang, 'Your machine cannot feed this fast even at its lowest spindle speed, so the chip is thinner than it should be and the bit may rub and burn. Use a bit with fewer flutes, or a larger one.', 'ماكينتك لا تصل لهذه التغذية حتى بأدنى سرعة دوران، فالرايش أرق من المطلوب وقد تحتك الريشة وتحرق. استخدم ريشة بعدد حدود أقل أو قطر أكبر.')
        : tx(lang, 'The spindle is slowed to match your machine\'s highest feed, keeping the chip load: a slower spindle with the right chip beats a fast one that rubs.', 'خُفّضت سرعة الدوران لتناسب أعلى تغذية لماكينتك مع الحفاظ على سماكة الرايش: الدوران الأبطأ مع رايش صحيح أفضل من دوران سريع يحتك.')}</p></div>}
      <div className="tip-card"><span className="tip-mark">i</span><p>{tx(lang, `Feed = speed × flutes × chip load. The chart chip load for this bit is ${r ? r.chartChipLoad.toFixed(3) : '—'} mm. These are starting values: run a test cut, then listen to the cut and look at the chips.`, `التغذية = سرعة الدوران × عدد الحدود × سماكة الرايش. سماكة الرايش في الجدول لهذه الريشة ${r ? r.chartChipLoad.toFixed(3) : '—'} مم. هذه قيم بداية: جرّب قطعة اختبار، واستمع لصوت القص وانظر إلى الرايش.`)}</p></div>
    </div>
  </div>;
}
