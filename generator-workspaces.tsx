'use client';
import { useId, useMemo, useState } from 'react';
import type { Drawing } from './types';
import { tx, type Language } from './copy';
import { ErrorNote, Exports, Icon, NumberField, Section, Stat, Toggle, VectorPreview } from './ui';
import { VectorInput } from './vector-input';
import { download } from './export';
import {
  defaultGear, defaultHinge, defaultJob, defaultPattern, defaultPuzzle, defaultRuler, defaultSign, defaultTag, defaultTestCard,
  duration, gearDrawing, gearGeometry, hingeDrawing, jobEstimate, pathStats, patternDrawing, printSize, puzzleDrawing,
  resolution, rulerDrawing, signDrawing, steps, tagDrawing, testCardDrawing,
  type GearOptions, type HingeOptions, type JobOptions, type PatternKind, type PatternOptions, type PuzzleOptions,
  type RulerOptions, type SignOptions, type TagOptions, type TagShape, type TestCardOptions,
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

function Frame({ lang, built, name, caption, children, stats, tip, onNest }: {
  lang: Language; built: Built; name: string; caption: string; children: React.ReactNode;
  stats?: React.ReactNode; tip?: string; onNest?: (d: Drawing) => void;
}) {
  const { drawing, error } = built;
  const size = drawing ? `${drawing.width.toFixed(1)} × ${drawing.height.toFixed(1)}` : '—';
  const lengths = drawing ? pathStats(drawing) : null;
  const nest = onNest && <button className="button secondary" disabled={!drawing} onClick={() => { if (drawing) onNest(drawing); }}><Icon name="nest" size={16}/>{tx(lang, 'Arrange on sheet', 'ترتيب على اللوح')}</button>;
  return <>
    <div className="workspace">
      <aside className="controls">{children}<div className="control-action"><ErrorNote error={error}/></div></aside>
      <div className="canvas-column">
        <div className="canvas-toolbar">
          <span className={`status-pill ${drawing ? 'ready' : ''}`}><i/>{drawing ? tx(lang, 'Ready to cut', 'جاهز للقص') : tx(lang, 'Check the settings', 'راجع الإعدادات')}</span>
          <span className="micro">{tx(lang, 'Red cuts · blue engraves', 'الأحمر للقص · الأزرق للحفر')}</span>
        </div>
        <VectorPreview drawing={drawing} lang={lang} caption={caption}/>
        <div className="stats-row">
          <Stat label={tx(lang, 'Size', 'المقاس')} value={size} unit="mm"/>
          <Stat label={tx(lang, 'Cut length', 'طول القص')} value={lengths ? metres(lengths.cut) : '—'} unit="m"/>
          {stats ?? <Stat label={tx(lang, 'Engrave length', 'طول الحفر')} value={lengths ? metres(lengths.engrave) : '—'} unit="m"/>}
        </div>
        {tip && <div className="tip-card"><span className="tip-mark">i</span><p>{tip}</p></div>}
      </div>
    </div>
    <Exports drawing={drawing} name={name} lang={lang} extra={nest}/>
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

export function GearWorkspace({ lang, onNest }: { lang: Language; onNest: (d: Drawing) => void }) {
  const [o, set] = useOptions<GearOptions>(defaultGear);
  const built = useMemo(() => build(() => gearDrawing(o)), [o]);
  const g = gearGeometry({ ...o, teeth: Math.round(o.teeth) });
  return <Frame lang={lang} built={built} name={`gear-${Math.round(o.teeth)}t-m${o.module}`} onNest={onNest}
    caption={tx(lang, 'Gear outline · pitch circle engraved', 'حدود الترس · دائرة الخطوة محفورة')}
    stats={<Stat label={tx(lang, 'Pitch diameter', 'قطر الخطوة')} value={(g.pitch * 2).toFixed(2)} unit="mm"/>}
    tip={tx(lang, 'Two gears mesh when they share the same module and pressure angle. Place their centres apart by the sum of their pitch radii.', 'يتعشّق ترسان إذا تساوى الموديول وزاوية الضغط. ضع مركزيهما على مسافة تساوي مجموع نصفي قطري الخطوة.')}>
    <Section title={tx(lang, 'Teeth', 'الأسنان')} number="01">
      <div className="field-pair"><NumberField label={tx(lang, 'Tooth count', 'عدد الأسنان')} value={o.teeth} onChange={set('teeth')} min={6} max={200}/><NumberField label={tx(lang, 'Module', 'الموديول')} value={o.module} onChange={set('module')} min={0.3} max={20} step={0.1} unit="mm"/></div>
      <div className="preset-row">{[14.5, 20, 25].map(angle => <button key={angle} className={o.pressure === angle ? 'selected' : ''} onClick={() => set('pressure')(angle)} dir="ltr">{angle}°</button>)}</div>
      <NumberField label={tx(lang, 'Root clearance', 'خلوص القاع')} value={o.clearance} onChange={set('clearance')} max={0.5} step={0.05}/>
    </Section>
    <Section title={tx(lang, 'Axle', 'المحور')} number="02">
      <NumberField label={tx(lang, 'Bore diameter', 'قطر فتحة المحور')} value={o.bore} onChange={set('bore')} step={0.5} unit="mm"/>
      <p className="micro" dir="ltr">Ø {(g.outer * 2).toFixed(2)} mm · root Ø {(g.root * 2).toFixed(2)} mm</p>
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
  const [o, set] = useOptions<TagOptions>(defaultTag);
  const built = useMemo(() => build(() => tagDrawing(o)), [o]);
  const shapes: [TagShape, string][] = [['rounded', tx(lang, 'Rounded rectangle', 'مستطيل بزوايا دائرية')], ['circle', tx(lang, 'Circle', 'دائرة')], ['hexagon', tx(lang, 'Hexagon', 'سداسي')], ['star', tx(lang, 'Star', 'نجمة')], ['shield', tx(lang, 'Shield', 'درع')]];
  return <Frame lang={lang} built={built} name={`tag-${o.shape}-${o.width}x${o.height}`} onNest={onNest}
    caption={tx(lang, 'Tag outline, hole and engraving', 'حدود البطاقة والثقب والحفر')}
    tip={tx(lang, 'Send the tag to nesting to fill a sheet with copies. The engraving font covers A–Z, 0–9, space and hyphen.', 'أرسل البطاقة إلى ترتيب القطع لتملأ لوحاً كاملاً بنسخ منها. خط الحفر يدعم A–Z و 0–9 والمسافة والشرطة.')}>
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
      <TextField label={tx(lang, 'Engraved text (A–Z, 0–9)', 'النص المحفور (A–Z و 0–9)')} value={o.text} onChange={set('text')} max={24}/>
      <NumberField label={tx(lang, 'Letter height', 'ارتفاع الحرف')} value={o.textHeight} onChange={set('textHeight')} min={1.5} step={0.5} unit="mm"/>
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
  return <Frame lang={lang} built={built} name={`test-card-${o.columns}x${o.rows}`}
    caption={tx(lang, 'Squares and labels engrave · the border cuts', 'المربعات والأرقام للحفر · الإطار للقص')}
    stats={<Stat label={tx(lang, 'Squares', 'المربعات')} value={Math.round(o.columns) * Math.round(o.rows) || '—'}/>}
    tip={tx(lang, 'In RDWorks, give each square its own layer and set the speed of its column and the power of its row. Afterwards, the darkest clean square is your setting.', 'في RDWorks اجعل لكل مربع طبقته، وأعطه سرعة عموده وقوة صفه. بعد الحفر، أغمق مربع نظيف هو إعدادك.')}>
    <Section title={tx(lang, 'Grid', 'الشبكة')} number="01">
      <div className="field-pair"><NumberField label={tx(lang, 'Speed steps', 'درجات السرعة')} value={o.columns} onChange={set('columns')} min={1} max={12}/><NumberField label={tx(lang, 'Power steps', 'درجات القوة')} value={o.rows} onChange={set('rows')} min={1} max={12}/></div>
      <div className="field-pair"><NumberField label={tx(lang, 'Square size', 'مقاس المربع')} value={o.cell} onChange={set('cell')} min={4} max={40} unit="mm"/><NumberField label={tx(lang, 'Gap', 'الفراغ')} value={o.gap} onChange={set('gap')} min={1} max={20} unit="mm"/></div>
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

// ——— Sign ———

export function SignWorkspace({ lang, onNest }: { lang: Language; onNest: (d: Drawing) => void }) {
  const [o, set] = useOptions<SignOptions>(defaultSign);
  const built = useMemo(() => build(() => signDrawing(o)), [o]);
  return <Frame lang={lang} built={built} name={`sign-${o.line1.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-') || 'plate'}`} onNest={onNest}
    caption={tx(lang, 'Plate cuts · letters and border engrave', 'اللوحة للقص · الحروف والإطار للحفر')}
    tip={tx(lang, 'The letters are single strokes, so they engrave as clean lines in one pass. For Arabic lettering, prepare the text in CorelDRAW, convert it to curves, and bring it in through nesting.', 'الحروف بخط واحد فتُحفر كخطوط نظيفة بمرور واحد. للكتابة العربية جهّز النص في CorelDRAW وحوّله إلى منحنيات ثم استورده عبر ترتيب القطع.')}>
    <Section title={tx(lang, 'Lettering', 'الكتابة')} number="01">
      <TextField label={tx(lang, 'First line', 'السطر الأول')} value={o.line1} onChange={set('line1')} max={30}/>
      <TextField label={tx(lang, 'Second line (optional)', 'السطر الثاني (اختياري)')} value={o.line2} onChange={set('line2')} max={40}/>
      <NumberField label={tx(lang, 'Letter height', 'ارتفاع الحرف')} value={o.height} onChange={set('height')} min={3} max={120} unit="mm"/>
    </Section>
    <Section title={tx(lang, 'Plate', 'اللوحة')} number="02">
      <div className="field-pair"><NumberField label={tx(lang, 'Padding', 'الحشوة')} value={o.padding} onChange={set('padding')} min={2} unit="mm"/><NumberField label={tx(lang, 'Corner radius', 'نصف قطر الزوايا')} value={o.radius} onChange={set('radius')} unit="mm"/></div>
      <Toggle label={tx(lang, 'Mounting holes', 'ثقوب التثبيت')} value={o.holes} onChange={set('holes')}/>
      <Toggle label={tx(lang, 'Engraved border', 'إطار محفور')} value={o.border} onChange={set('border')}/>
    </Section>
  </Frame>;
}

// ——— Job time ———

type InputProps = { lang: Language; drawing: Drawing | null; setDrawing: (d: Drawing | null) => void; filename: string; setFilename: (n: string) => void };

export function JobTimeWorkspace(props: InputProps) {
  const { lang, drawing } = props;
  const [o, set] = useOptions<JobOptions>(defaultJob);
  const [currency, setCurrency] = useState('ILS');
  const result = useMemo(() => {
    if (!drawing) return { value: null, error: '' };
    try { return { value: jobEstimate(drawing, o), error: '' }; } catch (e) { return { value: null, error: e instanceof Error ? e.message : 'Invalid settings.' }; }
  }, [drawing, o]);
  const r = result.value;
  const csv = () => { if (r) download(`Item,Value\nCut length (mm),${r.cut.toFixed(1)}\nEngrave length (mm),${r.engrave.toFixed(1)}\nPaths,${r.cutPaths + r.engravePaths}\nTime per copy (s),${r.each.toFixed(1)}\nCopies,${o.copies}\nTotal time (s),${r.seconds.toFixed(1)}\nMachine cost (${currency}),${r.cost.toFixed(2)}\n`, 'job-estimate.csv', 'text/csv'); };
  return <div className="workspace"><aside className="controls">
    <VectorInput {...props}/>
    <Section title={tx(lang, 'Machine', 'الماكينة')} number="02">
      <div className="field-pair"><NumberField label={tx(lang, 'Cut speed', 'سرعة القص')} value={o.cutSpeed} onChange={set('cutSpeed')} min={0.1} step={0.5} unit="mm/s"/><NumberField label={tx(lang, 'Engrave speed', 'سرعة الحفر')} value={o.engraveSpeed} onChange={set('engraveSpeed')} min={0.1} unit="mm/s"/></div>
      <div className="field-pair"><NumberField label={tx(lang, 'Pierce time', 'زمن الثقب')} value={o.pierce} onChange={set('pierce')} step={0.1} unit="s"/><NumberField label={tx(lang, 'Travel allowance', 'هامش الحركة')} value={o.travel} onChange={set('travel')} max={300} unit="%"/></div>
    </Section>
    <Section title={tx(lang, 'Job', 'العمل')} number="03">
      <NumberField label={tx(lang, 'Copies', 'عدد النسخ')} value={o.copies} onChange={set('copies')} min={1} max={100000}/>
      <div className="field-pair"><NumberField label={tx(lang, 'Machine rate / hour', 'أجرة الساعة')} value={o.rate} onChange={set('rate')} step={0.5} unit={currency}/>
        <label className="field"><span>{tx(lang, 'Currency', 'العملة')}</span><select value={currency} onChange={e => setCurrency(e.target.value)}><option value="ILS">ILS</option><option value="USD">USD</option><option value="JOD">JOD</option><option value="EUR">EUR</option></select></label></div>
    </Section>
    <div className="control-action"><ErrorNote error={result.error}/></div>
  </aside>
  <div className="canvas-column">
    <div className="cost-card">
      <div className="cost-card-heading"><span className="eyebrow">{tx(lang, 'ESTIMATED MACHINE TIME', 'الزمن التقديري على الماكينة')}</span><Icon name="jobtime" size={28}/></div>
      <span>{tx(lang, 'Total for all copies', 'الإجمالي لكل النسخ')}</span>
      <div className="cost-total" dir="ltr"><strong data-testid="job-time">{r ? duration(r.seconds) : '—'}</strong><small>{r && r.seconds >= 3600 ? 'h:mm:ss' : 'm:ss'}</small></div>
      <div className="cost-per"><span>{tx(lang, 'Machine cost', 'تكلفة الماكينة')}</span><strong dir="ltr">{r ? r.cost.toFixed(2) : '—'} {currency}</strong></div>
      <div className="cost-breakdown">
        <div><span>{tx(lang, 'Cutting', 'القص')} <small dir="ltr">{r ? `${(r.cut / 1000).toFixed(2)} m` : ''}</small></span><b dir="ltr">{r ? duration(r.cutting) : '—'}</b></div>
        <div><span>{tx(lang, 'Vector engraving', 'الحفر الخطي')} <small dir="ltr">{r ? `${(r.engrave / 1000).toFixed(2)} m` : ''}</small></span><b dir="ltr">{r ? duration(r.engraving) : '—'}</b></div>
        <div><span>{tx(lang, 'Piercing', 'الثقب')} <small dir="ltr">{r ? `${r.cutPaths + r.engravePaths} ×` : ''}</small></span><b dir="ltr">{r ? duration(r.piercing) : '—'}</b></div>
        <div><span>{tx(lang, 'Per copy, with travel', 'للنسخة الواحدة مع الحركة')}</span><b dir="ltr">{r ? duration(r.each) : '—'}</b></div>
      </div>
      <div className="cost-formula">{tx(lang, '(length ÷ speed + paths × pierce) × (1 + travel ÷ 100) × copies', '(الطول ÷ السرعة + المسارات × الثقب) × (١ + الحركة ÷ ١٠٠) × النسخ')}</div>
      <button className="button dark wide" disabled={!r} onClick={csv}><Icon name="download" size={17}/>{tx(lang, 'Download estimate', 'تحميل التقدير')}</button>
    </div>
    <div className="tip-card"><span className="tip-mark">i</span><p>{tx(lang, 'An estimate from path lengths. Acceleration on short curves makes real jobs slower; raise the travel allowance until it matches a job you have timed.', 'تقدير من أطوال المسارات. التسارع في المنحنيات القصيرة يجعل العمل الفعلي أبطأ؛ ارفع هامش الحركة حتى يطابق عملاً وقّته بنفسك.')}</p></div>
  </div></div>;
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
    <div className="control-action"><ErrorNote error={forward.e || back.e}/></div>
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
