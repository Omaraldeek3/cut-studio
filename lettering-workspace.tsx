'use client';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type * as HB from 'harfbuzzjs';
import type { Drawing, Shape } from './types';
import type { ToolId } from './copy';
import { tx, type Language } from './copy';
import { ErrorNote, Exports, Icon, NumberField, Range, Section, Stat, Toggle, VectorPreview } from './ui';
import { commandLoops, groupLoops, layoutText, type Align, type Command, type Fonts, type Shaper } from './lettering';
import { woffToSfnt } from './woff';
import { fitLoop, flatten, isolines } from './vectorize';

/* Arabic and English lettering as cut paths. Text is shaped by HarfBuzz in
   the browser, with the built-in Tajawal, any font installed on this
   computer, or a font file. Overlapping letters (Arabic joins overlap by
   design) can be welded into one clean outline, so the laser or the plotter
   never cuts a line through the middle of a word. */

type LocalFont = { family: string; fullName: string; postscriptName: string; style: string; blob: () => Promise<Blob> };
type FontChoice = { label: string; fonts: Fonts };

let harfbuzz: Promise<typeof HB> | null = null;
function loadHarfBuzz() {
  return (harfbuzz ??= import(/* webpackIgnore: true */ /* turbopackIgnore: true */ new URL('/vendor/harfbuzz/index.mjs', window.location.origin).href) as Promise<typeof HB>);
}

async function shaperFrom(hb: typeof HB, bytes: Uint8Array, postscript?: string): Promise<Shaper> {
  const sfnt = await woffToSfnt(bytes);
  const blob = new hb.Blob(sfnt);
  // A collection (.ttc) holds several faces; pick the one asked for.
  const collection = sfnt[0] === 0x74 && sfnt[1] === 0x74 && sfnt[2] === 0x63 && sfnt[3] === 0x66;
  let face = new hb.Face(blob, 0);
  if (collection && postscript) {
    for (let i = 0; i < 32; i++) {
      const candidate = new hb.Face(blob, i);
      if (!candidate.upem) break;
      if (candidate.getName(6, 'en') === postscript) { face = candidate; break; }
    }
  }
  if (!face.upem) throw new Error('This file is not a font HarfBuzz can read.');
  return { font: new hb.Font(face), upem: face.upem };
}

/** The built-in Tajawal: an Arabic file and a Latin file of one weight. */
async function builtInFonts(weight: string): Promise<{ engine: typeof HB; choice: FontChoice }> {
  const engine = await loadHarfBuzz();
  const read = async (script: string) => new Uint8Array(await (await fetch(`/vendor/fonts/tajawal-${script}-${weight}-normal.woff`)).arrayBuffer());
  const [arabic, latin] = await Promise.all([shaperFrom(engine, await read('arabic')), shaperFrom(engine, await read('latin'))]);
  return { engine, choice: { label: `Tajawal ${WEIGHTS.find(x => x.id === weight)?.en ?? ''}`, fonts: { arabic, latin } } };
}

const WEIGHTS = [{ id: '400', en: 'Regular', ar: 'عادي' }, { id: '700', en: 'Bold', ar: 'عريض' }, { id: '900', en: 'Black', ar: 'عريض جداً' }];

/** Welds glyphs by filling them on a fine canvas and tracing the result. */
function weld(glyphs: Command[][], bounds: { x0: number; y0: number; x1: number; y1: number }) {
  const side = 3200, pad = 6;
  const scale = side / Math.max(bounds.x1 - bounds.x0, bounds.y1 - bounds.y0);
  const w = Math.ceil((bounds.x1 - bounds.x0) * scale) + pad * 2, h = Math.ceil((bounds.y1 - bounds.y0) * scale) + pad * 2;
  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) throw new Error('Canvas is unavailable in this browser.');
  const X = (v: number) => (v - bounds.x0) * scale + pad, Y = (v: number) => (v - bounds.y0) * scale + pad;
  const path = new Path2D();
  for (const glyph of glyphs) for (const c of glyph) {
    const v = c.values;
    if (c.type === 'M') path.moveTo(X(v[0]), Y(v[1]));
    else if (c.type === 'L') path.lineTo(X(v[0]), Y(v[1]));
    else if (c.type === 'Q') path.quadraticCurveTo(X(v[0]), Y(v[1]), X(v[2]), Y(v[3]));
    else if (c.type === 'C') path.bezierCurveTo(X(v[0]), Y(v[1]), X(v[2]), Y(v[3]), X(v[4]), Y(v[5]));
    else if (c.type === 'Z') path.closePath();
  }
  context.fill(path, 'nonzero');
  const data = context.getImageData(0, 0, w, h).data;
  const field = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) field[i] = data[i * 4 + 3] / 255;
  // The canvas's own anti-aliasing places the edge between pixels.
  return isolines(field, w, h, 0.5)
    .map(loop => flatten(fitLoop(loop, 0.3, 75), 0.04))
    .map(loop => loop.map(p => ({ x: (p.x - pad) / scale + bounds.x0, y: (p.y - pad) / scale + bounds.y0 })));
}

export function LetteringWorkspace({ lang, onSend }: { lang: Language; onSend: (drawing: Drawing, tool: ToolId, name?: string) => void }) {
  const [text, setText] = useState('افتتاح قريباً');
  const [choice, setChoice] = useState<FontChoice | null>(null);
  const [weight, setWeight] = useState('700');
  const [locals, setLocals] = useState<LocalFont[] | null>(null);
  const [localName, setLocalName] = useState('');
  const [fit, setFit] = useState<'width' | 'height'>('width');
  const [size, setSize] = useState(600);
  const [lineHeight, setLineHeight] = useState(110);
  const [wordSpacing, setWordSpacing] = useState(0);
  const [letterSpacing, setLetterSpacing] = useState(0);
  const [align, setAlign] = useState<Align>('center');
  const [welded, setWelded] = useState(true);
  const [mirror, setMirror] = useState(false);
  const [hb, setHb] = useState<typeof HB | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(true);
  const fontInput = useRef<HTMLInputElement>(null);

  const loadBuiltIn = useCallback((w: string) => builtInFonts(w).then(
    ({ engine, choice: next }) => { setHb(engine); setChoice(next); setError(''); setBusy(false); },
    cause => { setError(cause instanceof Error ? cause.message : 'The font could not be loaded.'); setBusy(false); },
  ), []);

  useEffect(() => { void loadBuiltIn('700'); }, [loadBuiltIn]);

  const fromBytes = async (bytes: Uint8Array, label: string, postscript?: string) => {
    setBusy(true); setError('');
    try {
      const engine = await loadHarfBuzz();
      const shaper = await shaperFrom(engine, bytes, postscript);
      setHb(engine);
      setChoice({ label, fonts: { arabic: shaper, latin: shaper } });
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'The font could not be loaded.'); }
    finally { setBusy(false); }
  };

  const listLocal = async () => {
    const query = (window as unknown as { queryLocalFonts?: () => Promise<LocalFont[]> }).queryLocalFonts;
    if (!query) { setError(tx(lang, 'This browser cannot list installed fonts. Use Chrome or Edge on a computer, or upload the font file.', 'هذا المتصفح لا يستطيع عرض الخطوط المثبتة. استخدم Chrome أو Edge على الكمبيوتر، أو ارفع ملف الخط.')); return; }
    try {
      const fonts = await query();
      setLocals([...fonts].sort((a, b) => a.fullName.localeCompare(b.fullName)));
    } catch { setError(tx(lang, 'Permission to read installed fonts was not given.', 'لم يُسمح بقراءة الخطوط المثبتة.')); }
  };

  const layout = useMemo(() => {
    if (!hb || !choice || !text.trim()) return null;
    try {
      return layoutText(hb, choice.fonts, text, { lineHeight: lineHeight / 100, wordSpacing: wordSpacing / 100, letterSpacing: letterSpacing / 100, align });
    } catch { return null; }
  }, [hb, choice, text, lineHeight, wordSpacing, letterSpacing, align]);

  const result = useMemo((): { drawing: Drawing | null; parts: number; problem: string } => {
    if (!layout) return { drawing: null, parts: 0, problem: '' };
    try {
      const exact = commandLoops(layout.glyphs, 0.4);
      if (!exact.length) return { drawing: null, parts: 0, problem: '' };
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for (const loop of exact) for (const p of loop) { x0 = Math.min(x0, p.x); y0 = Math.min(y0, p.y); x1 = Math.max(x1, p.x); y1 = Math.max(y1, p.y); }
      const loops = welded ? weld(layout.glyphs, { x0, y0, x1, y1 }) : exact;
      if (!(size > 0)) throw new Error('Size must be above zero.');
      const k = size / (fit === 'width' ? x1 - x0 : y1 - y0);
      const width = (x1 - x0) * k, height = (y1 - y0) * k;
      const toMm = (p: { x: number; y: number }) => ({ x: mirror ? width - (p.x - x0) * k : (p.x - x0) * k, y: (p.y - y0) * k });
      const groups = groupLoops(loops);
      const shapes: Shape[] = groups.map((group, i) => ({ id: `letter-${i}`, name: `Letter ${i + 1}`, contours: group.map(loop => ({ closed: true, points: loop.map(toMm) })) }));
      return { drawing: { width, height, shapes }, parts: groups.length, problem: '' };
    } catch (cause) { return { drawing: null, parts: 0, problem: cause instanceof Error ? cause.message : 'Lettering failed.' }; }
  }, [layout, welded, size, fit, mirror]);

  const drawing = result.drawing;
  const name = text.trim().slice(0, 24).replace(/[\\/:*?"<>|\s]+/g, '-') || 'lettering';

  return <>
    <div className="workspace">
      <aside className="controls">
        <Section title={tx(lang, 'Text', 'النص')} number="01">
          <label className="field"><span>{tx(lang, 'Write one or more lines', 'اكتب سطراً أو أكثر')}</span>
            <textarea className="lt-text" dir="auto" rows={3} value={text} onChange={e => setText(e.target.value)} />
          </label>
        </Section>
        <Section title={tx(lang, 'Font', 'الخط')} number="02">
          <div className="preset-row">{WEIGHTS.map(w => <button key={w.id} className={choice?.label.startsWith('Tajawal') && weight === w.id ? 'selected' : ''} onClick={() => { setWeight(w.id); setBusy(true); void loadBuiltIn(w.id); }}>{tx(lang, `Tajawal ${w.en}`, `تجوال ${w.ar}`)}</button>)}</div>
          <button className="button secondary wide" onClick={() => void listLocal()}>{tx(lang, 'Fonts on this computer…', 'الخطوط المثبتة على الجهاز…')}<Icon name="lettering" size={16} /></button>
          {locals && <label className="field" style={{ marginTop: 10 }}><span>{tx(lang, 'Installed font', 'خط مثبت')}</span>
            <select value={localName} onChange={async e => {
              const font = locals.find(f => f.postscriptName === e.target.value);
              setLocalName(e.target.value);
              if (font) await fromBytes(new Uint8Array(await (await font.blob()).arrayBuffer()), font.fullName, font.postscriptName);
            }}>
              <option value="">{tx(lang, `${locals.length} fonts — choose one`, `${locals.length} خطاً — اختر واحداً`)}</option>
              {locals.map(f => <option key={f.postscriptName} value={f.postscriptName}>{f.fullName}</option>)}
            </select>
          </label>}
          <button className="text-button" onClick={() => fontInput.current?.click()}>{tx(lang, 'Or upload a font file (TTF, OTF, WOFF)', 'أو ارفع ملف خط (TTF أو OTF أو WOFF)')}</button>
          <input ref={fontInput} type="file" hidden accept=".ttf,.otf,.woff,.ttc,font/ttf,font/otf,font/woff" onChange={async e => {
            const file = e.target.files?.[0];
            e.target.value = '';
            if (file) await fromBytes(new Uint8Array(await file.arrayBuffer()), file.name.replace(/\.[^.]+$/, ''));
          }} />
          <p className="micro">{tx(lang, 'In use:', 'المستخدم:')} <b>{choice?.label ?? '—'}</b></p>
        </Section>
        <Section title={tx(lang, 'Size and spacing', 'المقاس والمسافات')} number="03">
          <div className="field-pair">
            <label className="field"><span>{tx(lang, 'Fit to', 'اضبط على')}</span>
              <select value={fit} onChange={e => setFit(e.target.value as 'width' | 'height')}>
                <option value="width">{tx(lang, 'Width', 'العرض')}</option>
                <option value="height">{tx(lang, 'Height', 'الارتفاع')}</option>
              </select>
            </label>
            <NumberField label={tx(lang, 'Size', 'المقاس')} value={size} onChange={setSize} min={1} max={20000} unit="mm" />
          </div>
          <Range label={tx(lang, 'Line spacing', 'تباعد الأسطر')} value={lineHeight} min={70} max={200} onChange={setLineHeight} />
          <Range label={tx(lang, 'Word spacing', 'تباعد الكلمات')} value={wordSpacing} min={-20} max={100} onChange={setWordSpacing} />
          <Range label={tx(lang, 'Letter spacing (Latin)', 'تباعد الحروف (لاتيني)')} value={letterSpacing} min={-10} max={50} onChange={setLetterSpacing} />
          <div className="preset-row">{(['right', 'center', 'left'] as const).map(a => <button key={a} className={align === a ? 'selected' : ''} onClick={() => setAlign(a)}>{a === 'right' ? tx(lang, 'Right', 'يمين') : a === 'center' ? tx(lang, 'Centre', 'وسط') : tx(lang, 'Left', 'يسار')}</button>)}</div>
        </Section>
        <Section title={tx(lang, 'For cutting', 'للقص')} number="04">
          <Toggle label={tx(lang, 'Weld overlapping letters', 'ادمج الحروف المتداخلة')} value={welded} onChange={setWelded} />
          <Toggle label={tx(lang, 'Mirror (engrave on the back)', 'عكس (للحفر من الخلف)')} value={mirror} onChange={setMirror} />
        </Section>
        <div className="control-action"><ErrorNote error={error || result.problem} /></div>
      </aside>
      <div className="canvas-column">
        <div className="canvas-toolbar">
          <span className={`status-pill ${drawing ? 'ready' : ''}`}><i />{busy ? tx(lang, 'Loading the font…', 'جارٍ تحميل الخط…') : drawing ? tx(lang, 'Ready to cut', 'جاهز للقص') : tx(lang, 'Type some text', 'اكتب نصاً')}</span>
          {layout && layout.missing > 0 && <span className="micro lt-warning">{tx(lang, `This font has no shape for ${layout.missing} character(s).`, `هذا الخط لا يحتوي على ${layout.missing} من الحروف.`)}</span>}
        </div>
        <VectorPreview drawing={drawing} lang={lang} filled caption={welded ? tx(lang, 'Welded outlines · millimetres', 'حدود مدموجة · ملليمتر') : tx(lang, 'Font outlines · millimetres', 'حدود الخط · ملليمتر')} />
        <div className="stats-row">
          <Stat label={tx(lang, 'Size', 'المقاس')} value={drawing ? `${drawing.width.toFixed(1)} × ${drawing.height.toFixed(1)}` : '—'} unit="mm" />
          <Stat label={tx(lang, 'Parts', 'القطع')} value={result.parts || '—'} />
          <Stat label={tx(lang, 'Lines', 'الأسطر')} value={layout?.lines ?? '—'} />
        </div>
        <div className="tip-card"><span className="tip-mark">i</span><p>{tx(lang, 'For raised acrylic letters, send the text to Contour & offset to draw its base. Parts are single letters or joined words, ready to nest on the sheet.', 'للحروف البارزة من الأكريليك، أرسل النص إلى أداة الكونتور والإزاحة لرسم قاعدته. القطع حروف منفردة أو كلمات متصلة، جاهزة للترتيب على اللوح.')}</p></div>
      </div>
    </div>
    <Exports drawing={drawing} lang={lang} name={name} extra={<>
      <button className="button secondary" disabled={!drawing} onClick={() => { if (drawing) onSend(drawing, 'contour', `${name}.svg`); }}><Icon name="contour" size={16} />{tx(lang, 'Add an outline', 'أضف حداً')}</button>
      <button className="text-button" disabled={!drawing} onClick={() => { if (drawing) onSend(drawing, 'nest', `${name}.svg`); }}>{tx(lang, 'Arrange on sheet', 'ترتيب على اللوح')} ↗</button>
    </>} />
  </>;
}
