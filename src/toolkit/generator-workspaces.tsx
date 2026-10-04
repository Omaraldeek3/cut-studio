'use client';
import { useEffect, useId, useMemo, useState } from 'react';
import type * as HB from 'harfbuzzjs';
import { builtInFonts, textLoops, WEIGHTS, type FontChoice } from './fonts';
import dynamic from 'next/dynamic';
import type { SpinPart } from './gear3d';

const Gear3D = dynamic(() => import('./gear3d'), { ssr: false });
import type { Drawing } from './types';
import { tx, type Language } from './copy';
import { ErrorNote, Exports, Icon, NumberField, Section, Stat, Toggle, VectorPreview } from './ui';
import { download } from './export';
import {
  defaultGear, defaultHinge, defaultPattern, defaultPuzzle, defaultRuler, defaultTag, defaultTestCard,
  centreDistance, gearDrawing, gearGeometry, gearPairDrawing, hingeDrawing, pathStats, patternDrawing, printSize, puzzleDrawing,
  resolution, rulerDrawing, steps, tagDrawing, testCardDrawing, MAX_TEST_SQUARES,
  type GearOptions, type HingeOptions, type PatternKind, type PatternOptions, type PuzzleOptions,
  type RulerOptions, type TagOptions, type TagShape, type TestCardOptions,
} from './generators';

/* The parametric tools share one frame: settings on the side, the drawing in
   the middle, its numbers beneath, and the same SVG and DXF export as the rest
   of the workshop. Each tool only supplies its settings and its generator. */

type Built = { drawing: Drawing | null; error: string };

function build(make: () => Drawing): Built {
  try { return { drawing: make(), error: '' }; } catch (e) { return { drawing: null, error: e instanceof Error ? e.message : 'Invalid settings.' }; }
}

function useOptions<T extends object>(initial: T) {
  const [options, setOptions] = useState<T>(initial);
  const set = <K extends keyof T>(key: K) => (value: T[K]) => setOptions(o => ({ ...o, [key]: value }));
  return [options, set, setOptions] as const;
}

const metres = (mm: number) => (mm / 1000).toFixed(2);

function Frame({ lang, built, name, caption, children, stats, tip, onNest, below, exportsExtra, preview, tabs }: {
  lang: Language; built: Built; name: string; caption: string; children: React.ReactNode;
  stats?: React.ReactNode; tip?: string; onNest?: (d: Drawing) => void; below?: React.ReactNode; exportsExtra?: React.ReactNode;
  preview?: React.ReactNode; tabs?: React.ReactNode;
}) {
  const { drawing, error } = built;
  const size = drawing ? `${drawing.width.toFixed(1)} × ${drawing.height.toFixed(1)}` : '—';
  const lengths = drawing ? pathStats(drawing) : null;
  const nest = onNest && <button className="button secondary" disabled={!drawing} onClick={() => { if (drawing) onNest(drawing); }}><Icon name="nest" size={16}/>{tx(lang, 'Arrange on sheet', 'ترتيب على اللوح')}</button>;
  return <>
    <div className="workspace">
      <aside className="controls">{children}<div className="control-action"><ErrorNote error={error} lang={lang}/></div></aside>
      <div className="canvas-column">
        <div className="canvas-toolbar">
          {tabs ?? <span className={`status-pill ${drawing ? 'ready' : ''}`}><i/>{drawing ? tx(lang, 'Ready to cut', 'جاهز للقص') : tx(lang, 'Check the settings', 'راجع الإعدادات')}</span>}
          <span className="micro">{tx(lang, 'Red cuts · blue engraves', 'الأحمر للقص · الأزرق للحفر')}</span>
        </div>
        {preview ?? <VectorPreview drawing={drawing} lang={lang} caption={caption}/>}
        <div className="stats-row">
          <Stat label={tx(lang, 'Size', 'المقاس')} value={size} unit="mm"/>
          <Stat label={tx(lang, 'Cut length', 'طول القص')} value={lengths ? metres(lengths.cut) : '—'} unit="m"/>
          {stats ?? <Stat label={tx(lang, 'Engrave length', 'طول الحفر')} value={lengths ? metres(lengths.engrave) : '—'} unit="m"/>}
        </div>
        {tip && <div className="tip-card"><span className="tip-mark">i</span><p>{tip}</p></div>}
        {below}
      </div>
    </div>
    <Exports drawing={drawing} name={name} lang={lang} extra={<>{exportsExtra}{nest}</>}/>
  </>;
}

function TextField({ label, value, onChange, max = 40 }: { label: string; value: string; onChange: (v: string) => void; max?: number }) {
  const id = useId();
  return <label className="field" htmlFor={id}><span>{label}</span><div className="input-wrap"><input id={id} value={value} maxLength={max} onChange={e => onChange(e.target.value)}/></div></label>;
}

function Choice<T extends string>({ label, value, options, onChange }: { label: string; value: T; options: [T, string][]; onChange: (v: T) => void }) {
  return <label className="field"><span>{label}</span><select aria-label={label} value={value} onChange={e => onChange(e.target.value as T)}>{options.map(([key, name]) => <option key={key} value={key}>{name}</option>)}</select></label>;
}

// ——— Living hinge ———

export function HingeWorkspace({ lang, onNest }: { lang: Language; onNest: (d: Drawing) => void }) {
  const [o, set] = useOptions<HingeOptions>(defaultHinge);
  const built = useMemo(() => build(() => hingeDrawing(o)), [o]);
  const lines = built.drawing ? built.drawing.shapes[0].contours.length - 1 : 0;
  return <Frame lang={lang} built={built} name={`living-hinge-${o.width}x${o.height}`} onNest={onNest}
    caption={tx(lang, 'Panel outline and hinge slits', 'حدود اللوح وشقوق المفصل')}
    stats={<Stat label={tx(lang, 'Slits', 'الشقوق')} value={lines || '—'}/>}
    tip={tx(lang, 'Tighter line spacing and longer slits bend further but weaken the panel. For 3 mm plywood, start around 1.5 mm spacing and 3 mm bridges, and cut a small sample first.', 'تباعد أقل وشقوق أطول يعني انحناءً أكبر ولوحاً أضعف. لخشب ٣ مم ابدأ بتباعد ١٫٥ مم وجسور ٣ مم، واقطع عينة صغيرة أولاً.')}>
    <Section title={tx(lang, 'Panel', 'اللوح')} number="01">
      <div className="field-pair"><NumberField label={tx(lang, 'Width', 'العرض')} value={o.width} onChange={set('width')} min={10} unit="mm"/><NumberField label={tx(lang, 'Height', 'الارتفاع')} value={o.height} onChange={set('height')} min={10} unit="mm"/></div>
      <NumberField label={tx(lang, 'Corner radius', 'نصف قطر الزوايا')} value={o.radius} onChange={set('radius')} max={100} step={0.5} unit="mm"/>
    </Section>
    <Section title={tx(lang, 'Hinge pattern', 'نقش المفصل')} number="02">
      <NumberField label={tx(lang, 'Hinge zone width', 'عرض منطقة المفصل')} value={o.zone} onChange={set('zone')} min={2} unit="mm"/>
      <div className="field-pair"><NumberField label={tx(lang, 'Slit length', 'طول الشق')} value={o.slit} onChange={set('slit')} min={2} step={0.5} unit="mm"/><NumberField label={tx(lang, 'Bridge', 'الجسر')} value={o.gap} onChange={set('gap')} min={0.5} step={0.5} unit="mm"/></div>
      <div className="field-pair"><NumberField label={tx(lang, 'Line spacing', 'تباعد الخطوط')} value={o.spacing} onChange={set('spacing')} min={0.4} step={0.1} unit="mm"/><NumberField label={tx(lang, 'Edge margin', 'هامش الحافة')} value={o.margin} onChange={set('margin')} step={0.5} unit="mm"/></div>
    </Section>
  </Frame>;
}

// ——— Gear ———

/** Fewest teeth an involute gear has before its teeth undercut: 2 / sin²(pressure angle). */
const minTeeth = (pressure: number) => Math.floor(2 / Math.sin((pressure * Math.PI) / 180) ** 2);

export function GearWorkspace({ lang, onNest }: { lang: Language; onNest: (d: Drawing) => void }) {
  const [o, set] = useOptions<GearOptions>(defaultGear);
  const [pair, setPair] = useState(false), [teeth2, setTeeth2] = useState(36), [bore2, setBore2] = useState(defaultGear.bore);
  const [view, setView] = useState<'flat' | '3d'>('flat'), [thickness, setThickness] = useState(4);
  const built = useMemo(() => build(() => (pair ? gearPairDrawing(o, teeth2, bore2) : gearDrawing(o))), [o, pair, teeth2, bore2]);
  const g = gearGeometry({ ...o, teeth: Math.round(o.teeth) });
  const spinParts = useMemo((): SpinPart[] => built.drawing ? built.drawing.shapes.map((s, i) => {
    const cut = s.contours.filter(c => c.layer !== 'engrave');
    const pitchCircle = s.contours.find(c => c.layer === 'engrave')!;
    const xs = pitchCircle.points.map(p => p.x), ys = pitchCircle.points.map(p => p.y);
    const centre = { x: (Math.min(...xs) + Math.max(...xs)) / 2, y: (Math.min(...ys) + Math.max(...ys)) / 2 };
    return { outline: cut[0].points, holes: cut.slice(1).map(c => c.points), centre, ratio: i ? -Math.round(o.teeth) / Math.round(teeth2) : 1 };
  }) : [], [built.drawing, o.teeth, teeth2]);
  const smallest = pair ? Math.min(Math.round(o.teeth), Math.round(teeth2)) : Math.round(o.teeth);
  const undercut = smallest < minTeeth(o.pressure);
  const tabs = <div className="sheet-tabs view-tabs" role="tablist">
    <button role="tab" aria-selected={view === 'flat'} className={view === 'flat' ? 'selected' : ''} onClick={() => setView('flat')}>{tx(lang, 'Flat layout', 'التخطيط المسطّح')}</button>
    <button role="tab" aria-selected={view === '3d'} className={view === '3d' ? 'selected' : ''} onClick={() => setView('3d')}>{tx(lang, '3D view', 'عرض ثلاثي الأبعاد')}</button>
  </div>;
  return <Frame lang={lang} built={built} name={pair ? `gears-${Math.round(o.teeth)}t-${Math.round(teeth2)}t-m${o.module}` : `gear-${Math.round(o.teeth)}t-m${o.module}`} onNest={onNest}
    caption={tx(lang, 'Gear outline · pitch circle engraved', 'حدود الترس · دائرة الخطوة محفورة')}
    tabs={tabs}
    preview={view === '3d' && built.drawing ? <div className="preview-surface box-3d-surface"><Gear3D parts={spinParts} thickness={thickness} lang={lang}/></div> : undefined}
    stats={<>
      <Stat label={tx(lang, 'Pitch diameter', 'قطر الخطوة')} value={(g.pitch * 2).toFixed(2)} unit="mm"/>
      {pair && <Stat label={tx(lang, 'Centre distance', 'المسافة بين المركزين')} value={centreDistance(o.module, o.teeth, teeth2).toFixed(2)} unit="mm"/>}
      {pair && <Stat label={tx(lang, 'Ratio', 'نسبة التخفيض')} value={`1 : ${(Math.round(teeth2) / Math.round(o.teeth)).toFixed(2)}`}/>}
    </>}
    below={undercut ? <ErrorNote error={tx(lang, `Gears with fewer than ${minTeeth(o.pressure)} teeth at ${o.pressure}° undercut and may jam. Use more teeth or a larger pressure angle.`, `التروس بأقل من ${minTeeth(o.pressure)} سناً بزاوية ${o.pressure}° تتآكل قاعدة أسنانها وقد تعلق. استخدم أسناناً أكثر أو زاوية ضغط أكبر.`)} lang={lang}/> : null}
    tip={pair
      ? tx(lang, 'The two gears are laid out in mesh: drill the axle holes the centre distance apart. Cut a pair first and check how freely they turn; add a little clearance for a looser fit.', 'الترسان مرسومان متعشّقين: ضع ثقبي المحورين على المسافة بين المركزين. اقطع زوجاً أولاً وتأكد من سهولة الدوران؛ زد الخلوص قليلاً لتعشيق أرخى.')
      : tx(lang, 'Two gears mesh when they share the same module and pressure angle. Turn on the second gear to lay out a meshing pair.', 'يتعشّق ترسان إذا تساوى الموديول وزاوية الضغط. فعّل الترس الثاني لرسم زوج متعشّق.')}>
    <Section title={tx(lang, 'Teeth', 'الأسنان')} number="01">
      <div className="field-pair"><NumberField label={tx(lang, 'Tooth count', 'عدد الأسنان')} value={o.teeth} onChange={set('teeth')} min={6} max={200}/><NumberField label={tx(lang, 'Module', 'الموديول')} value={o.module} onChange={set('module')} min={0.3} max={20} step={0.1} unit="mm"/></div>
      <div className="preset-row">{[14.5, 20, 25].map(angle => <button key={angle} className={o.pressure === angle ? 'selected' : ''} onClick={() => set('pressure')(angle)} dir="ltr">{angle}°</button>)}</div>
      <NumberField label={tx(lang, 'Root clearance', 'خلوص القاع')} value={o.clearance} onChange={set('clearance')} max={0.5} step={0.05}/>
    </Section>
    <Section title={tx(lang, 'Axle', 'المحور')} number="02">
      <NumberField label={tx(lang, 'Bore diameter', 'قطر فتحة المحور')} value={o.bore} onChange={set('bore')} step={0.5} unit="mm"/>
      <p className="micro" dir="ltr">Ø {(g.outer * 2).toFixed(2)} mm · root Ø {(g.root * 2).toFixed(2)} mm</p>
    </Section>
    <Section title={tx(lang, 'Second gear', 'الترس الثاني')} number="03">
      <Toggle label={tx(lang, 'Add a meshing gear', 'أضف ترساً متعشّقاً')} value={pair} onChange={setPair}/>
      {pair && <div className="field-pair"><NumberField label={tx(lang, 'Its tooth count', 'عدد أسنانه')} value={teeth2} onChange={setTeeth2} min={6} max={200}/><NumberField label={tx(lang, 'Its bore', 'قطر محوره')} value={bore2} onChange={setBore2} step={0.5} unit="mm"/></div>}
    </Section>
    <Section title={tx(lang, '3D view', 'العرض ثلاثي الأبعاد')} number="04">
      <NumberField label={tx(lang, 'Material thickness', 'سماكة الخامة')} value={thickness} onChange={setThickness} min={0.5} max={50} step={0.5} unit="mm"/>
    </Section>
  </Frame>;
}

// ——— Puzzle ———

export function PuzzleWorkspace({ lang, onNest }: { lang: Language; onNest: (d: Drawing) => void }) {
  const [o, set] = useOptions<PuzzleOptions>(defaultPuzzle);
  const built = useMemo(() => build(() => puzzleDrawing(o)), [o]);
  return <Frame lang={lang} built={built} name={`puzzle-${o.columns}x${o.rows}`} onNest={onNest}
    caption={tx(lang, 'Puzzle border and piece cuts', 'حدود البازل وخطوط القطع')}
    stats={<Stat label={tx(lang, 'Pieces', 'القطع')} value={Math.round(o.columns) * Math.round(o.rows)}/>}
    tip={tx(lang, 'Engrave or glue a picture onto the sheet first, then cut the lines. Pieces of 25 mm or more are easier for small hands.', 'اطبع أو الصق الصورة على اللوح أولاً ثم اقطع الخطوط. القطع بمقاس ٢٥ مم أو أكثر أسهل للأطفال.')}>
    <Section title={tx(lang, 'Grid', 'الشبكة')} number="01">
      <div className="field-pair"><NumberField label={tx(lang, 'Columns', 'الأعمدة')} value={o.columns} onChange={set('columns')} min={2} max={40}/><NumberField label={tx(lang, 'Rows', 'الصفوف')} value={o.rows} onChange={set('rows')} min={2} max={40}/></div>
      <div className="field-pair"><NumberField label={tx(lang, 'Piece size', 'مقاس القطعة')} value={o.piece} onChange={set('piece')} min={8} unit="mm"/><NumberField label={tx(lang, 'Tab size', 'حجم اللسان')} value={o.tab} onChange={set('tab')} min={10} max={30} unit="%"/></div>
      <NumberField label={tx(lang, 'Corner radius', 'نصف قطر الزوايا')} value={o.radius} onChange={set('radius')} max={50} unit="mm"/>
    </Section>
    <Section title={tx(lang, 'Shape', 'الشكل')} number="02">
      <button className="button secondary wide" onClick={() => set('seed')(o.seed + 1)}>{tx(lang, 'Shuffle the tabs', 'بدّل اتجاه الألسنة')}<Icon name="repeat" size={16}/></button>
    </Section>
  </Frame>;
}

// ——— Tags ———

export function TagWorkspace({ lang, onNest }: { lang: Language; onNest: (d: Drawing) => void }) {
  const [o, set] = useOptions<TagOptions>({ ...defaultTag, text: 'اسمك هنا', textHeight: 8 });
  const [style, setStyle] = useState<'font' | 'single'>('font');
  const [weight, setWeight] = useState('700');
  const [engine, setEngine] = useState<{ hb: typeof HB; choice: FontChoice } | null>(null);
  useEffect(() => {
    let live = true;
    builtInFonts(weight).then(({ engine: hb, choice }) => { if (live) setEngine({ hb, choice }); }).catch(() => { if (live) setEngine(null); });
    return () => { live = false; };
  }, [weight]);
  const font = useMemo(() => {
    if (style !== 'font' || !engine || !o.text.trim()) return null;
    try { return textLoops(engine.hb, engine.choice.fonts, o.text.trim(), 1); } catch { return null; }
  }, [style, engine, o.text]);
  const waiting = style === 'font' && !!o.text.trim() && !font;
  const built = useMemo(() => waiting ? { drawing: null, error: '' } : build(() => tagDrawing(style === 'single' ? o : { ...o, text: '' }, font)), [o, style, font, waiting]);
  const shapes: [TagShape, string][] = [['rounded', tx(lang, 'Rounded rectangle', 'مستطيل بزوايا دائرية')], ['circle', tx(lang, 'Circle', 'دائرة')], ['hexagon', tx(lang, 'Hexagon', 'سداسي')], ['star', tx(lang, 'Star', 'نجمة')], ['shield', tx(lang, 'Shield', 'درع')]];
  return <Frame lang={lang} built={built} name={`tag-${o.shape}-${o.width}x${o.height}`} onNest={onNest}
    caption={tx(lang, 'Tag outline, hole and engraving', 'حدود البطاقة والثقب والحفر')}
    tip={style === 'font'
      ? tx(lang, 'Font text is filled: set its blue layer to Scan (engrave) in RDWorks or LightBurn. Send the tag to nesting to fill a sheet with copies.', 'نص الخط مملوء: اجعل طبقته الزرقاء على وضع Scan (حفر) في RDWorks أو LightBurn. أرسل البطاقة إلى ترتيب القطع لتملأ لوحاً بنسخ منها.')
      : tx(lang, 'Single-line letters engrave as lines in one fast pass. They cover A–Z, 0–9, space and hyphen.', 'الحروف ذات الخط الواحد تُحفر كخطوط بمرور واحد سريع، وتدعم A–Z و 0–9 والمسافة والشرطة.')}>
    <Section title={tx(lang, 'Shape', 'الشكل')} number="01">
      <Choice label={tx(lang, 'Outline', 'الحدود')} value={o.shape} options={shapes} onChange={set('shape')}/>
      <div className="field-pair"><NumberField label={tx(lang, 'Width', 'العرض')} value={o.width} onChange={set('width')} min={8} unit="mm"/><NumberField label={tx(lang, 'Height', 'الارتفاع')} value={o.height} onChange={set('height')} min={8} unit="mm"/></div>
      {o.shape === 'rounded' && <NumberField label={tx(lang, 'Corner radius', 'نصف قطر الزوايا')} value={o.radius} onChange={set('radius')} max={100} step={0.5} unit="mm"/>}
    </Section>
    <Section title={tx(lang, 'Hole and border', 'الثقب والإطار')} number="02">
      <div className="field-pair"><NumberField label={tx(lang, 'Hole diameter', 'قطر الثقب')} value={o.hole} onChange={set('hole')} step={0.5} unit="mm"/><NumberField label={tx(lang, 'From top', 'من الأعلى')} value={o.holeOffset} onChange={set('holeOffset')} step={0.5} unit="mm"/></div>
      <NumberField label={tx(lang, 'Engraved border inset', 'إزاحة الإطار المحفور')} value={o.border} onChange={set('border')} step={0.5} unit="mm"/>
    </Section>
    <Section title={tx(lang, 'Text', 'النص')} number="03">
      <TextField label={tx(lang, 'Engraved text', 'النص المحفور')} value={o.text} onChange={set('text')} max={40}/>
      <div className="preset-row">
        {WEIGHTS.map(w => <button key={w.id} className={style === 'font' && weight === w.id ? 'selected' : ''} onClick={() => { setStyle('font'); setWeight(w.id); }}>{tx(lang, `Tajawal ${w.en}`, `تجوال ${w.ar}`)}</button>)}
        <button className={style === 'single' ? 'selected' : ''} onClick={() => setStyle('single')}>{tx(lang, 'Single line A–Z', 'خط واحد A–Z')}</button>
      </div>
      <NumberField label={tx(lang, 'Largest letter height', 'أقصى ارتفاع للحروف')} value={o.textHeight} onChange={set('textHeight')} min={1.5} step={0.5} unit="mm"/>
      <p className="micro">{tx(lang, 'The text shrinks to fit the tag when it would not fit at this height.', 'يصغر النص تلقائياً ليناسب البطاقة إذا لم يتسع بهذا الارتفاع.')}</p>
    </Section>
  </Frame>;
}

// ——— Grille patterns ———

export function PatternWorkspace({ lang, onNest }: { lang: Language; onNest: (d: Drawing) => void }) {
  const [o, set] = useOptions<PatternOptions>(defaultPattern);
  const built = useMemo(() => build(() => patternDrawing(o)), [o]);
  const holes = built.drawing ? built.drawing.shapes[0].contours.length - 1 : 0;
  const open = built.drawing ? (() => {
    let area = 0;
    for (const c of built.drawing.shapes[0].contours.slice(1)) {
      let a = 0; for (let i = 0; i < c.points.length; i++) { const p = c.points[i], q = c.points[(i + 1) % c.points.length]; a += p.x * q.y - q.x * p.y; }
      area += Math.abs(a / 2);
    }
    return (100 * area) / (o.width * o.height);
  })() : 0;
  const kinds: [PatternKind, string][] = [['hex', tx(lang, 'Honeycomb', 'خلية نحل')], ['circle', tx(lang, 'Circles', 'دوائر')], ['diamond', tx(lang, 'Diamonds', 'معيّنات')], ['slot', tx(lang, 'Slots', 'فتحات طولية')]];
  return <Frame lang={lang} built={built} name={`grille-${o.kind}-${o.width}x${o.height}`} onNest={onNest}
    caption={tx(lang, 'Panel and holes', 'اللوح والفتحات')}
    stats={<><Stat label={tx(lang, 'Holes', 'الفتحات')} value={holes || '—'}/><Stat label={tx(lang, 'Open area', 'المساحة المفتوحة')} value={holes ? open.toFixed(0) : '—'} unit="%"/></>}
    tip={tx(lang, 'Walls thinner than the material thickness can burn or snap. Keep the wall at least equal to the sheet thickness for wood.', 'الجدران الأرق من سماكة الخامة قد تحترق أو تنكسر. اجعل الجدار مساوياً لسماكة الخشب على الأقل.')}>
    <Section title={tx(lang, 'Panel', 'اللوح')} number="01">
      <div className="field-pair"><NumberField label={tx(lang, 'Width', 'العرض')} value={o.width} onChange={set('width')} min={20} unit="mm"/><NumberField label={tx(lang, 'Height', 'الارتفاع')} value={o.height} onChange={set('height')} min={20} unit="mm"/></div>
      <div className="field-pair"><NumberField label={tx(lang, 'Margin', 'الهامش')} value={o.margin} onChange={set('margin')} unit="mm"/><NumberField label={tx(lang, 'Corner radius', 'نصف قطر الزوايا')} value={o.radius} onChange={set('radius')} unit="mm"/></div>
    </Section>
    <Section title={tx(lang, 'Holes', 'الفتحات')} number="02">
      <Choice label={tx(lang, 'Pattern', 'النقش')} value={o.kind} options={kinds} onChange={set('kind')}/>
      <div className="field-pair"><NumberField label={tx(lang, 'Hole size', 'مقاس الفتحة')} value={o.cell} onChange={set('cell')} min={1} step={0.5} unit="mm"/><NumberField label={tx(lang, 'Wall', 'الجدار')} value={o.wall} onChange={set('wall')} min={0.4} step={0.1} unit="mm"/></div>
    </Section>
  </Frame>;
}

// ——— Test card ———

export function TestCardWorkspace({ lang }: { lang: Language }) {
  const [o, set] = useOptions<TestCardOptions>(defaultTestCard);
  const built = useMemo(() => build(() => testCardDrawing(o)), [o]);
  const speeds = steps(o.speedMin, o.speedMax, Math.max(1, Math.round(o.columns) || 1));
  const powers = steps(o.powerMin, o.powerMax, Math.max(1, Math.round(o.rows) || 1));
  const pens = built.drawing ? built.drawing.shapes.flatMap(s => s.contours).flatMap(c => (c.pen ? [c.pen] : [])) : [];
  const settingsOf = (name: string) => name.match(/P(\d+)-S(\d+)/)?.slice(1) ?? ['', ''];
  const sheet = () => download(['Layer,Colour (ACI),Colour (RGB),Power (%),Speed (mm/s)', ...pens.map(p => [p.name, p.aci, p.rgb, ...settingsOf(p.name)].join(','))].join('\n') + '\n', `test-card-${o.columns}x${o.rows}-settings.csv`, 'text/csv');
  return <Frame lang={lang} built={built} name={`test-card-${o.columns}x${o.rows}`}
    caption={tx(lang, 'Each square has its own colour · labels engrave · the border cuts', 'لكل مربع لونه · الأرقام للحفر · الإطار للقص')}
    stats={<Stat label={tx(lang, 'Squares', 'المربعات')} value={Math.round(o.columns) * Math.round(o.rows) || '—'}/>}
    tip={tx(lang, 'Import the DXF or SVG: RDWorks and LightBurn make one layer per colour. Set each layer to Scan with the power and speed in the table below (the layer names say them too). The darkest clean square is your setting.', 'استورد ملف DXF أو SVG: يصنع RDWorks و LightBurn طبقة لكل لون. اجعل كل طبقة على وضع Scan بالقوة والسرعة المكتوبة في الجدول أدناه (واسم الطبقة يذكرهما أيضاً). أغمق مربع نظيف هو إعدادك.')}
    exportsExtra={<button className="button secondary" disabled={!pens.length} onClick={sheet}><Icon name="download" size={16}/>{tx(lang, 'Layer settings (CSV)', 'إعدادات الطبقات (CSV)')}</button>}
    below={pens.length ? <div className="pen-table" role="table" aria-label={tx(lang, 'Layer settings', 'إعدادات الطبقات')}>
      <div className="pen-row pen-head" role="row"><span role="columnheader">{tx(lang, 'Colour', 'اللون')}</span><span role="columnheader">{tx(lang, 'Power', 'القوة')}</span><span role="columnheader">{tx(lang, 'Speed', 'السرعة')}</span></div>
      {pens.map(p => { const [power, speed] = settingsOf(p.name); return <div className="pen-row" role="row" key={p.name}><span role="cell"><i style={{ background: p.rgb }}/>{p.name.slice(0, 2)}</span><span role="cell" dir="ltr">{power}%</span><span role="cell" dir="ltr">{speed} mm/s</span></div>; })}
    </div> : null}>
    <Section title={tx(lang, 'Grid', 'الشبكة')} number="01">
      <div className="field-pair"><NumberField label={tx(lang, 'Speed steps', 'درجات السرعة')} value={o.columns} onChange={set('columns')} min={1} max={12}/><NumberField label={tx(lang, 'Power steps', 'درجات القوة')} value={o.rows} onChange={set('rows')} min={1} max={12}/></div>
      <div className="field-pair"><NumberField label={tx(lang, 'Square size', 'مقاس المربع')} value={o.cell} onChange={set('cell')} min={4} max={40} unit="mm"/><NumberField label={tx(lang, 'Gap', 'الفراغ')} value={o.gap} onChange={set('gap')} min={1} max={20} unit="mm"/></div>
      <p className="micro">{tx(lang, `Up to ${MAX_TEST_SQUARES} squares, one layer each.`, `حتى ${MAX_TEST_SQUARES} مربعاً، لكل مربع طبقته.`)}</p>
    </Section>
    <Section title={tx(lang, 'Ranges', 'المدى')} number="02">
      <div className="field-pair"><NumberField label={tx(lang, 'Speed from', 'السرعة من')} value={o.speedMin} onChange={set('speedMin')} min={1} unit="mm/s"/><NumberField label={tx(lang, 'to', 'إلى')} value={o.speedMax} onChange={set('speedMax')} min={1} unit="mm/s"/></div>
      <div className="field-pair"><NumberField label={tx(lang, 'Power from', 'القوة من')} value={o.powerMin} onChange={set('powerMin')} min={1} max={100} unit="%"/><NumberField label={tx(lang, 'to', 'إلى')} value={o.powerMax} onChange={set('powerMax')} min={1} max={100} unit="%"/></div>
      <p className="micro" dir="ltr">S {speeds.join(' · ')}<br/>P {powers.join(' · ')}</p>
    </Section>
  </Frame>;
}

// ——— Ruler ———

export function RulerWorkspace({ lang }: { lang: Language }) {
  const [o, set] = useOptions<RulerOptions>(defaultRuler);
  const built = useMemo(() => build(() => rulerDrawing(o)), [o]);
  return <Frame lang={lang} built={built} name={`ruler-${o.length}${o.unit}`}
    caption={tx(lang, 'Outline cuts · ticks and numbers engrave', 'الحدود للقص · التدريجات والأرقام للحفر')}
    tip={tx(lang, 'Check the first cut with a caliper. If the length is off, calibrate the machine before trusting any ruler it makes.', 'افحص أول قطعة بالقدمة. إن اختلف الطول، عايِر الماكينة قبل الاعتماد على أي مسطرة تصنعها.')}>
    <Section title={tx(lang, 'Scale', 'التدريج')} number="01">
      <Choice label={tx(lang, 'Units', 'الوحدة')} value={o.unit} options={[['mm', tx(lang, 'Millimetres', 'ملليمتر')], ['in', tx(lang, 'Inches', 'إنش')]]} onChange={set('unit')}/>
      <NumberField label={tx(lang, 'Measuring length', 'طول القياس')} value={o.length} onChange={set('length')} min={20} max={1000} unit="mm"/>
      <div className="preset-row">{[100, 150, 200, 300].map(length => <button key={length} className={o.length === length ? 'selected' : ''} onClick={() => set('length')(length)} dir="ltr">{length}</button>)}</div>
    </Section>
    <Section title={tx(lang, 'Body', 'الجسم')} number="02">
      <div className="field-pair"><NumberField label={tx(lang, 'Width', 'العرض')} value={o.width} onChange={set('width')} min={12} max={100} unit="mm"/><NumberField label={tx(lang, 'End margin', 'هامش الطرف')} value={o.margin} onChange={set('margin')} min={2} unit="mm"/></div>
      <NumberField label={tx(lang, 'Hanging hole', 'ثقب التعليق')} value={o.hole} onChange={set('hole')} step={0.5} unit="mm"/>
    </Section>
  </Frame>;
}

// ——— Resolution ———

export function DpiWorkspace({ lang }: { lang: Language }) {
  const [dpi, setDpi] = useState(318), [w, setW] = useState(100), [h, setH] = useState(60), [pw, setPw] = useState(1200), [ph, setPh] = useState(800);
  const forward = useMemo(() => { try { return { v: resolution(dpi, w, h), e: '' }; } catch (e) { return { v: null, e: e instanceof Error ? e.message : '' }; } }, [dpi, w, h]);
  const back = useMemo(() => { try { return { v: printSize(dpi, pw, ph), e: '' }; } catch (e) { return { v: null, e: e instanceof Error ? e.message : '' }; } }, [dpi, pw, ph]);
  const materials: [string, string, number][] = [['Wood', 'خشب', 318], ['Acrylic', 'أكريليك', 500], ['Anodised aluminium', 'ألمنيوم مؤكسد', 600], ['Leather', 'جلد', 254], ['Glass', 'زجاج', 254], ['Slate', 'حجر أردواز', 300]];
  return <div className="workspace"><aside className="controls">
    <Section title={tx(lang, 'Resolution', 'الدقة')} number="01">
      <NumberField label="DPI" value={dpi} onChange={setDpi} min={25} max={2400}/>
      <div className="preset-row">{[254, 300, 318, 500, 600].map(value => <button key={value} className={dpi === value ? 'selected' : ''} onClick={() => setDpi(value)} dir="ltr">{value}</button>)}</div>
    </Section>
    <Section title={tx(lang, 'Engraving size', 'مقاس الحفر')} number="02">
      <div className="field-pair"><NumberField label={tx(lang, 'Width', 'العرض')} value={w} onChange={setW} min={1} unit="mm"/><NumberField label={tx(lang, 'Height', 'الارتفاع')} value={h} onChange={setH} min={1} unit="mm"/></div>
    </Section>
    <Section title={tx(lang, 'Image in pixels', 'الصورة بالبكسل')} number="03">
      <div className="field-pair"><NumberField label={tx(lang, 'Width', 'العرض')} value={pw} onChange={setPw} min={1} max={100000} unit="px"/><NumberField label={tx(lang, 'Height', 'الارتفاع')} value={ph} onChange={setPh} min={1} max={100000} unit="px"/></div>
    </Section>
    <div className="control-action"><ErrorNote error={forward.e || back.e} lang={lang}/></div>
  </aside>
  <div className="canvas-column">
    <div className="cost-card">
      <div className="cost-card-heading"><span className="eyebrow">{tx(lang, 'PIXELS YOU NEED', 'البكسلات المطلوبة')}</span><Icon name="dpi" size={28}/></div>
      <span>{tx(lang, `For ${w} × ${h} mm at ${dpi} DPI`, `لمقاس ${w} × ${h} مم بدقة ${dpi}`)}</span>
      <div className="cost-total" dir="ltr"><strong data-testid="dpi-pixels">{forward.v ? `${forward.v.width} × ${forward.v.height}` : '—'}</strong><small>px</small></div>
      <div className="cost-per"><span>{tx(lang, 'Line interval to set in RDWorks', 'تباعد الأسطر في RDWorks')}</span><strong dir="ltr">{forward.v ? forward.v.interval.toFixed(4) : '—'} mm</strong></div>
      <div className="cost-breakdown">
        <div><span>{tx(lang, 'Lines per millimetre', 'أسطر لكل ملليمتر')}</span><b dir="ltr">{forward.v ? forward.v.linesPerMm.toFixed(2) : '—'}</b></div>
        <div><span>{tx(lang, 'Image size', 'حجم الصورة')}</span><b dir="ltr">{forward.v ? `${forward.v.megapixels.toFixed(2)} MP` : '—'}</b></div>
        <div><span>{tx(lang, `${pw} × ${ph} px prints at`, `${pw} × ${ph} بكسل تُحفر بمقاس`)}</span><b dir="ltr">{back.v ? `${back.v.width.toFixed(1)} × ${back.v.height.toFixed(1)} mm` : '—'}</b></div>
      </div>
      <div className="cost-formula">{tx(lang, 'pixels = mm ÷ 25.4 × DPI · interval = 25.4 ÷ DPI', 'البكسل = الملليمتر ÷ ٢٥٫٤ × الدقة · التباعد = ٢٥٫٤ ÷ الدقة')}</div>
    </div>
    <div className="tip-card"><span className="tip-mark">i</span><p>{tx(lang, 'Common starting points: ', 'نقاط بداية شائعة: ')}{materials.map(([en, ar, value], i) => <button key={en} className="text-button" style={{ padding: '0 4px' }} onClick={() => setDpi(value)}>{tx(lang, en, ar)} {value}{i < materials.length - 1 ? ' ·' : ''}</button>)}{tx(lang, '. Confirm on your material with the power and speed test.', '. تأكد على خامتك ببطاقة اختبار القوة والسرعة.')}</p></div>
  </div></div>;
}
