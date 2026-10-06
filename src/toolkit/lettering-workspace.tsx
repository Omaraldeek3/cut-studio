'use client';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type * as HB from 'harfbuzzjs';
import type { Contour, Drawing, Shape } from './types';
import type { ToolId } from './copy';
import { tx, type Language } from './copy';
import { ErrorNote, Exports, Icon, NumberField, Range, Section, Stat, Toggle, VectorPreview } from './ui';
import { commandLoops, groupLoops, layoutText, type Align } from './lettering';
import { builtInFonts, builtInLatin, loadHarfBuzz, shaperFrom, WEIGHTS, type FontChoice, type LocalFont } from './fonts';
import { harfShaper, startWeight, weightNames, type HarfFont } from './harf';
import { HarfPicker } from './harf-picker';
import { offsetContours, stencilContours, unionContours } from './vector-ops';
import { anchorMarks, type AnchorOptions } from './anchor';
import { circle, roundedRect } from './generators';
import { bounds, moveShape } from './geometry';

/* Arabic and English lettering as cut paths. Text is shaped by HarfBuzz in
   the browser, with the built-in Tajawal, any font installed on this
   computer, or a font file. Overlapping letters (Arabic joins overlap by
   design) can be welded into one clean outline, so the laser or the plotter
   never cuts a line through the middle of a word. */

type PlateOptions = { shape: 'rect' | 'pill'; padding: number; radius: number; holes: 0 | 2 | 4; holeSize: number; textOn: 'engrave' | 'cut' | 'stencil' };

/** Puts a cut plate around lettered text: a door sign or a name plate.
 *  Engraved text stays on the plate as one part; cut letters become their
 *  own parts (for a second colour of acrylic) and leave an engraved outline
 *  on the plate to glue them onto. */
export function withPlate(letters: Shape[], width: number, height: number, o: PlateOptions): { drawing: Drawing; parts: number } {
  if (!(o.padding > 0)) throw new Error('The margin must be above zero.');
  const w = width + 2 * o.padding, h = height + 2 * o.padding;
  const radius = o.shape === 'pill' ? h / 2 : Math.max(0, Math.min(o.radius, w / 2, h / 2));
  const outline: Contour = { closed: true, points: roundedRect(0, 0, w, h, radius) };
  const holeR = o.holeSize / 2;
  if (o.holes && holeR * 2 + 2 > o.padding) throw new Error('The holes do not fit in the margin. Widen the margin or use smaller holes.');
  const inset = o.shape === 'pill' ? Math.max(o.padding / 2, h / 2 - Math.sqrt(Math.max(0, (h / 2) ** 2 - (h / 2 - o.padding / 2) ** 2))) : o.padding / 2;
  const centres = o.holes === 2 ? [[inset, h / 2], [w - inset, h / 2]] : o.holes === 4 ? [[o.padding / 2, o.padding / 2], [w - o.padding / 2, o.padding / 2], [o.padding / 2, h - o.padding / 2], [w - o.padding / 2, h - o.padding / 2]] : [];
  if (o.holes === 4 && o.shape === 'pill') throw new Error('A plate with rounded ends takes two holes, at the sides.');
  const holeContours: Contour[] = centres.map(([x, y]) => ({ closed: true, points: circle(x, y, holeR) }));
  const text = letters.map(s => moveShape(s, o.padding, o.padding));
  const plateShape: Shape = { id: 'plate', name: 'Plate', contours: [outline, ...holeContours] };
  if (o.textOn === 'stencil') {
    // The letters are cut out of the plate itself: the plate is the stencil.
    plateShape.contours.push(...text.flatMap(s => s.contours));
    return { drawing: { width: w, height: h, shapes: [plateShape] }, parts: 1 };
  }
  if (o.textOn === 'engrave') {
    plateShape.contours.push(...text.flatMap(s => s.contours.map(c => ({ ...c, layer: 'engrave' as const }))));
    return { drawing: { width: w, height: h, shapes: [plateShape] }, parts: 1 };
  }
  plateShape.contours.push(...text.flatMap(s => s.contours.map(c => ({ ...c, layer: 'engrave' as const }))));
  // The letters to cut sit below the plate, never on it, so the plate is not cut through.
  const gap = 10, below = letters.map(s => moveShape(s, o.padding, h + gap));
  return { drawing: { width: w, height: h + gap + height, shapes: [plateShape, ...below] }, parts: 1 + below.length };
}

/** A cake topper: one backing piece, an outline `outline` mm around the
 *  whole text with a bar along its bottom so every letter joins, and
 *  `spikes` pointed stakes beneath. The text is either engraved on it or cut
 *  as separate letters for a second colour, with an engraved guide on the
 *  backing to place them. */
export type TopperOptions = { outline: number; spikes: 1 | 2; spikeLength: number; spikeWidth: number; textOn: 'layered' | 'engrave' };
export function topper(letters: Shape[], width: number, height: number, o: TopperOptions): { drawing: Drawing; parts: number; loose: number } {
  if (!(o.outline >= 1 && o.outline <= 50)) throw new Error('Outline thickness must be between 1 and 50 mm.');
  if (!(o.spikeLength >= 10 && o.spikeLength <= 300) || !(o.spikeWidth >= 2 && o.spikeWidth <= 40)) throw new Error('Spikes must be 10 to 300 mm long and 2 to 40 mm wide.');
  const pad = o.outline, text = letters.map(s => moveShape(s, pad, pad));
  const loops = text.flatMap(s => s.contours.map(c => c.points));
  const silhouette = offsetContours(loops, o.outline);
  // A bar across the lower part of the text joins letters the outline alone leaves apart.
  const bar = roundedRect(pad, pad + height * 0.55, width, height * 0.45 + o.outline * 0.6, 0);
  const bottom = pad + height + o.outline * 0.6, xs = o.spikes === 1 ? [pad + width / 2] : [pad + width * 0.25, pad + width * 0.75];
  const spikes = xs.map(x => [{ x: x - o.spikeWidth / 2, y: bottom - 2 }, { x: x + o.spikeWidth / 2, y: bottom - 2 }, { x: x + o.spikeWidth / 2, y: bottom + o.spikeLength - o.spikeWidth }, { x, y: bottom + o.spikeLength }, { x: x - o.spikeWidth / 2, y: bottom + o.spikeLength - o.spikeWidth }]);
  const back = unionContours([...silhouette.map(c => c.points), bar, ...spikes]);
  // Pieces of the backing: outlines not inside another one.
  const inside = (p: { x: number; y: number }, poly: { x: number; y: number }[]) => { let yes = false; for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) { const a = poly[i], b = poly[j]; if ((a.y > p.y) !== (b.y > p.y) && p.x < (b.x - a.x) * (p.y - a.y) / (b.y - a.y) + a.x) yes = !yes; } return yes; };
  const pieces = back.filter(c => back.filter(d => d !== c && inside(c.points[0], d.points)).length % 2 === 0).length;
  const w = width + 2 * pad, h = bottom + o.spikeLength;
  const backShape: Shape = { id: 'topper', name: 'Topper', contours: [...back, ...(o.textOn === 'engrave' || o.textOn === 'layered' ? text.flatMap(s => s.contours.map(c => ({ ...c, layer: 'engrave' as const }))) : [])] };
  if (o.textOn === 'engrave') return { drawing: { width: w, height: h, shapes: [backShape] }, parts: 1, loose: pieces - 1 };
  // The letters to cut in the second colour, below the topper; its engraving shows where they go.
  const gap = 10, below = letters.map(s => moveShape(s, pad, h + gap));
  return { drawing: { width: w, height: h + gap + height, shapes: [backShape, ...below] }, parts: 1 + below.length, loose: pieces - 1 };
}

export function LetteringWorkspace({ lang, onSend }: { lang: Language; onSend: (drawing: Drawing, tool: ToolId, name?: string) => void }) {
  const [text, setText] = useState('افتتاح قريباً');
  const [choice, setChoice] = useState<FontChoice | null>(null);
  const [weight, setWeight] = useState('700');
  const [locals, setLocals] = useState<LocalFont[] | null>(null);
  const [localName, setLocalName] = useState('');
  const [harf, setHarf] = useState<HarfFont | null>(null), [harfWeight, setHarfWeight] = useState(700);
  const [fit, setFit] = useState<'width' | 'height'>('width');
  const [size, setSize] = useState(600);
  const [lineHeight, setLineHeight] = useState(110);
  const [wordSpacing, setWordSpacing] = useState(0);
  const [letterSpacing, setLetterSpacing] = useState(0);
  const [align, setAlign] = useState<Align>('center');
  const [welded, setWelded] = useState(true);
  const [mirror, setMirror] = useState(false);
  const [plate, setPlate] = useState<'none' | 'rect' | 'pill' | 'topper'>('none');
  const [topperOptions, setTopperOptions] = useState<TopperOptions>({ outline: 4, spikes: 2, spikeLength: 70, spikeWidth: 6, textOn: 'layered' });
  const setTopper = <K extends keyof TopperOptions>(key: K) => (value: TopperOptions[K]) => setTopperOptions(v => ({ ...v, [key]: value }));
  const [padding, setPadding] = useState(15);
  const [plateRadius, setPlateRadius] = useState(6);
  const [holes, setHoles] = useState<0 | 2 | 4>(2);
  const [holeSize, setHoleSize] = useState(5);
  const [textOn, setTextOn] = useState<'engrave' | 'cut' | 'stencil'>('engrave');
  const [bridge, setBridge] = useState(1.5);
  // Letters cut as pieces can have their dots joined on (off until asked); letters cut out of a sheet need stencil bridges instead.
  const [cutStyle, setCutStyle] = useState<'pieces' | 'stencil'>('pieces');
  const [keepDots, setKeepDots] = useState(false), [dotMode, setDotMode] = useState<AnchorOptions['mode']>('auto');
  const [dotDepth, setDotDepth] = useState(15), [dotBridge, setDotBridge] = useState(NaN);
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
    setBusy(true); setError(''); setHarf(null);
    try {
      const engine = await loadHarfBuzz();
      const shaper = await shaperFrom(engine, bytes, postscript);
      setHb(engine);
      setChoice({ label, fonts: { arabic: shaper, latin: shaper } });
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'The font could not be loaded.'); }
    finally { setBusy(false); }
  };

  // A font from Harf, at a weight. An Arabic-only font sets Latin letters and digits in Tajawal.
  const fromHarf = async (font: HarfFont, w: number) => {
    setBusy(true); setError(''); setHarf(font); setHarfWeight(w);
    try {
      const engine = await loadHarfBuzz();
      const arabic = await harfShaper(engine, font, w);
      const latin = font.latin ? arabic : await builtInLatin(engine, w);
      setHb(engine);
      setChoice({ label: `${font.family}${font.weights.length > 1 ? ` ${weightNames[w]?.[0] ?? w}` : ''}`, fonts: { arabic, latin } });
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'The font could not be loaded.'); setHarf(null); }
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

  // Whether the letters come off the machine as pieces (then their dots are
  // kept on) or are cut out of a sheet that stays (then they need bridges).
  const piecesCut = plate === 'none' ? cutStyle === 'pieces' : plate === 'topper' ? topperOptions.textOn === 'layered' : textOn === 'cut';
  const bridged = plate === 'none' ? cutStyle === 'stencil' : plate !== 'topper' && textOn === 'stencil';
  const anchoring = piecesCut && keepDots;
  const result = useMemo((): { drawing: Drawing | null; parts: number; problem: string; bridges?: number; anchored?: number } => {
    if (!layout) return { drawing: null, parts: 0, problem: '' };
    try {
      const exact = commandLoops(layout.glyphs, 0.4);
      if (!exact.length) return { drawing: null, parts: 0, problem: '' };
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for (const loop of exact) for (const p of loop) { x0 = Math.min(x0, p.x); y0 = Math.min(y0, p.y); x1 = Math.max(x1, p.x); y1 = Math.max(y1, p.y); }
      if (!(size > 0)) throw new Error('Size must be above zero.');
      const outlines = (k: number) => {
        const w = (x1 - x0) * k;
        const toMm = (p: { x: number; y: number }) => ({ x: mirror ? w - (p.x - x0) * k : (p.x - x0) * k, y: (p.y - y0) * k });
        // The glyphs again, flattened within 0.005 mm at the final size.
        const fine = commandLoops(layout.glyphs, 0.005 / k).map(loop => loop.map(toMm));
        // Welding unions the outlines as vectors and refits them within 0.01 mm;
        // unwelded outlines keep the font's own, and export fits them.
        const stenciled = bridged ? stencilContours(fine, bridge) : null;
        // Thousandths of an em are the layout's unit, so an em is 1000 of them.
        const anchored = !stenciled && anchoring ? anchorMarks(fine, { mode: dotMode, depth: dotDepth / 100, bridge: Number.isFinite(dotBridge) ? dotBridge : undefined, em: 1000 * k }) : null;
        const contours: Contour[] = stenciled ? stenciled.contours : anchored ? anchored.contours : welded ? unionContours(fine) : fine.map(points => ({ closed: true, points }));
        return { contours, bridges: stenciled?.bridges ?? 0, anchored: anchored?.anchored };
      };
      let k = size / (fit === 'width' ? x1 - x0 : y1 - y0);
      let { contours, bridges, anchored } = outlines(k);
      const byLoop = new Map(contours.map(c => [c.points, c]));
      const groups = groupLoops(contours.map(c => c.points));
      let shapes: Shape[] = groups.map((group, i) => ({ id: `letter-${i}`, name: `Letter ${i + 1}`, contours: group.map(loop => byLoop.get(loop)!) }));
      let width = (x1 - x0) * k, height = (y1 - y0) * k;
      if (anchored) {
        // Moved marks change the text's outline, so measure it again and keep the size asked for.
        const measure = (list: Shape[]) => { let a = Infinity, b = Infinity, c = -Infinity, d = -Infinity; for (const s of list) { const r = bounds(s); a = Math.min(a, r.x); b = Math.min(b, r.y); c = Math.max(c, r.x + r.width); d = Math.max(d, r.y + r.height); } return { x: a, y: b, width: c - a, height: d - b }; };
        let box = measure(shapes);
        const got = fit === 'width' ? box.width : box.height;
        if (Math.abs(got - size) > 0.05) {
          k *= size / got;
          ({ contours, bridges, anchored } = outlines(k));
          const again = new Map(contours.map(c => [c.points, c]));
          shapes = groupLoops(contours.map(c => c.points)).map((group, i) => ({ id: `letter-${i}`, name: `Letter ${i + 1}`, contours: group.map(loop => again.get(loop)!) }));
          box = measure(shapes);
        }
        shapes = shapes.map(s => moveShape(s, -box.x, -box.y));
        width = box.width; height = box.height;
      }
      const parts = shapes.length;
      if (plate === 'none') return { drawing: { width, height, shapes }, parts, problem: '', bridges, anchored };
      if (plate === 'topper') { const t = topper(shapes, width, height, topperOptions); return { drawing: t.drawing, parts: t.parts, problem: t.loose > 0 ? `${t.loose} parts of the topper are not joined to it. Raise the outline thickness.` : '', bridges, anchored }; }
      return { ...withPlate(shapes, width, height, { shape: plate, padding, radius: plateRadius, holes, holeSize, textOn }), problem: '', bridges, anchored };
    } catch (cause) { return { drawing: null, parts: 0, problem: cause instanceof Error ? cause.message : 'Lettering failed.' }; }
  }, [layout, welded, size, fit, mirror, plate, padding, plateRadius, holes, holeSize, textOn, bridged, bridge, topperOptions, anchoring, dotMode, dotDepth, dotBridge]);

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
          <HarfPicker lang={lang} text={text} selected={harf} weight={harfWeight} onPick={font => void fromHarf(font, startWeight(font))} onWeight={w => { if (harf) void fromHarf(harf, w); }} />
          <p className="micro lt-or">{tx(lang, 'Built in, works without internet:', 'مدمج ويعمل دون إنترنت:')}</p>
          <div className="preset-row">{WEIGHTS.map(w => <button key={w.id} className={choice?.label.startsWith('Tajawal') && weight === w.id ? 'selected' : ''} onClick={() => { setWeight(w.id); setHarf(null); setBusy(true); void loadBuiltIn(w.id); }}>{tx(lang, `Tajawal ${w.en}`, `تجوال ${w.ar}`)}</button>)}</div>
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
          {plate === 'none' && <div className="ws-choice lt-cut" role="radiogroup" aria-label={tx(lang, 'How the letters are cut', 'كيف تُقصّ الحروف؟')}>
            <button role="radio" aria-checked={cutStyle === 'pieces'} className={cutStyle === 'pieces' ? 'selected' : ''} onClick={() => setCutStyle('pieces')}><b>{tx(lang, 'Each letter a piece', 'كل حرف قطعة')}</b><span>{tx(lang, 'Acrylic or wood letters to glue on', 'حروف أكريليك أو خشب تُلصق')}</span></button>
            <button role="radio" aria-checked={cutStyle === 'stencil'} className={cutStyle === 'stencil' ? 'selected' : ''} onClick={() => setCutStyle('stencil')}><b>{tx(lang, 'Cut out of a sheet', 'مفرّغة من لوح')}</b><span>{tx(lang, 'A stencil: the sheet stays, letters are holes', 'استنسل: يبقى اللوح والحروف فراغات')}</span></button>
          </div>}
          {piecesCut && <>
            <Toggle label={tx(lang, 'Keep the dots on their letters', 'ثبّت النقاط على حروفها')} value={keepDots} onChange={setKeepDots} />
            <p className="micro">{tx(lang, 'Off, the dots, hamzas and vowel marks stay where the font puts them, as small separate pieces. Turn this on to join each one to its letter, so every letter comes off the machine in one piece.', 'النقاط والهمزات والحركات تبقى كما في الخط، قطعاً صغيرة منفصلة. فعّل هذا الخيار ليصل كل واحدة منها بحرفها، فيخرج كل حرف من الماكينة قطعة واحدة.')}</p>
            {keepDots && <>
              <div className="preset-row" role="radiogroup" aria-label={tx(lang, 'How to join them', 'طريقة التثبيت')}>{([['auto', tx(lang, 'Automatic', 'تلقائي')], ['move', tx(lang, 'Move onto the letter', 'قرّبها حتى تلتصق')], ['bridge', tx(lang, 'Keep in place, bridge', 'مكانها مع جسر')]] as const).map(([id, label]) => <button key={id} role="radio" aria-checked={dotMode === id} className={dotMode === id ? 'selected' : ''} onClick={() => setDotMode(id)}>{label}</button>)}</div>
              <p className="micro">{dotMode === 'auto' ? tx(lang, 'A dot close to its letter is moved down or up until it sinks into it; one further away keeps its place and gets a short bridge.', 'النقطة القريبة من حرفها تنزل أو تصعد حتى تلتصق به، والبعيدة تبقى مكانها ويصلها جسر قصير.')
                : dotMode === 'move' ? tx(lang, 'Every mark is moved straight down or up until it sinks into its letter, the way it is done by hand.', 'كل نقطة تنزل أو تصعد مباشرة حتى تلتصق بحرفها، كما تفعل يدوياً.')
                : tx(lang, 'Every mark stays where the font put it, and a short bridge joins it to its letter.', 'كل نقطة تبقى في مكانها من الخط، ويصلها بحرفها جسر قصير.')}</p>
              {dotMode !== 'bridge' && <Range label={tx(lang, 'How far a dot sinks in (%)', 'مقدار دخول النقطة في الحرف (٪)')} value={dotDepth} min={5} max={50} onChange={setDotDepth} />}
              {dotMode !== 'move' && <NumberField label={tx(lang, 'Bridge width', 'عرض الجسر')} value={dotBridge} onChange={setDotBridge} min={0.3} max={20} step={0.1} unit="mm" optional />}
              {result.anchored !== undefined && <p className="micro lt-anchored">{result.anchored ? tx(lang, `${result.anchored} marks joined to their letters.`, `ثُبّتت ${result.anchored} من النقاط والعلامات على حروفها.`) : tx(lang, 'No loose dots in this text.', 'لا نقاط منفصلة في هذا النص.')}</p>}
            </>}
          </>}
          {bridged && <><NumberField label={tx(lang, 'Bridge width', 'عرض الجسر')} value={bridge} onChange={setBridge} min={0.3} max={20} step={0.1} unit="mm" />
          <p className="micro">{tx(lang, 'In a stencil the letters are cut out and the sheet is kept. The middles of letters such as ه، ص، و and O would fall out with them, so thin bridges hold each middle to the sheet.', 'في الاستنسل تُفرَّغ الحروف ويبقى اللوح. الجزء الداخلي من حروف مثل ه وص وو وO كان سيسقط معها، فتمسكه جسور رفيعة باللوح.')}{result.bridges ? tx(lang, ` ${result.bridges} bridges.`, ` عدد الجسور: ${result.bridges}.`) : ''}</p></>}
        </Section>
        <Section title={tx(lang, 'Sign plate', 'لوحة حول النص')} number="05">
          <div className="preset-row">{([['none', tx(lang, 'No plate', 'بدون لوحة')], ['rect', tx(lang, 'Rectangle', 'مستطيلة')], ['pill', tx(lang, 'Rounded ends', 'أطراف دائرية')], ['topper', tx(lang, 'Cake topper', 'توبر كيك')]] as const).map(([id, label]) => <button key={id} className={plate === id ? 'selected' : ''} onClick={() => setPlate(id)}>{label}</button>)}</div>
          {plate === 'topper' && <>
            <div className="field-pair">
              <NumberField label={tx(lang, 'Outline thickness', 'سماكة الحد حول النص')} value={topperOptions.outline} onChange={setTopper('outline')} min={1} max={50} step={0.5} unit="mm" />
              <label className="field"><span>{tx(lang, 'Spikes', 'الأعواد')}</span><select value={topperOptions.spikes} onChange={e => setTopper('spikes')(Number(e.target.value) as 1 | 2)}><option value={1}>{tx(lang, 'One, in the middle', 'واحد في الوسط')}</option><option value={2}>{tx(lang, 'Two', 'اثنان')}</option></select></label>
            </div>
            <div className="field-pair">
              <NumberField label={tx(lang, 'Spike length', 'طول العود')} value={topperOptions.spikeLength} onChange={setTopper('spikeLength')} min={10} max={300} unit="mm" />
              <NumberField label={tx(lang, 'Spike width', 'عرض العود')} value={topperOptions.spikeWidth} onChange={setTopper('spikeWidth')} min={2} max={40} step={0.5} unit="mm" />
            </div>
            <label className="field"><span>{tx(lang, 'The text on it', 'النص عليه')}</span><select value={topperOptions.textOn} onChange={e => setTopper('textOn')(e.target.value as TopperOptions['textOn'])}><option value="layered">{tx(lang, 'Cut as letters in a second colour, glued on', 'حروف مقصوصة بلون ثانٍ تُلصق عليه')}</option><option value="engrave">{tx(lang, 'Engraved on the topper', 'محفور على التوبر')}</option></select></label>
            <p className="micro">{tx(lang, 'Cut the topper from mirror or glitter acrylic or wood; the engraved text shows where to glue the letters. Wrap the spikes in food-safe film.', 'اقصص التوبر من أكريليك مرآة أو لامع أو من الخشب، والنص المحفور يبيّن مكان لصق الحروف. غلّف الأعواد بغلاف آمن للطعام.')}</p>
          </>}
          {plate !== 'none' && plate !== 'topper' && <>
            <div className="field-pair">
              <NumberField label={tx(lang, 'Margin around the text', 'الهامش حول النص')} value={padding} onChange={setPadding} min={2} max={500} unit="mm" />
              {plate === 'rect' && <NumberField label={tx(lang, 'Corner radius', 'نصف قطر الزوايا')} value={plateRadius} onChange={setPlateRadius} max={500} unit="mm" />}
            </div>
            <div className="field-pair">
              <label className="field"><span>{tx(lang, 'Mounting holes', 'ثقوب التثبيت')}</span>
                <select value={holes} onChange={e => setHoles(Number(e.target.value) as 0 | 2 | 4)}>
                  <option value={0}>{tx(lang, 'None', 'بدون')}</option>
                  <option value={2}>{tx(lang, 'Two, at the sides', 'اثنان على الجانبين')}</option>
                  <option value={4}>{tx(lang, 'Four, at the corners', 'أربعة في الزوايا')}</option>
                </select>
              </label>
              {holes > 0 && <NumberField label={tx(lang, 'Hole diameter', 'قطر الثقب')} value={holeSize} onChange={setHoleSize} min={1} max={30} step={0.5} unit="mm" />}
            </div>
            <label className="field"><span>{tx(lang, 'The text', 'النص')}</span>
              <select value={textOn} onChange={e => setTextOn(e.target.value as 'engrave' | 'cut' | 'stencil')}>
                <option value="engrave">{tx(lang, 'Engraved on the plate', 'محفور على اللوحة')}</option>
                <option value="cut">{tx(lang, 'Cut as separate letters, with a placement guide', 'حروف مقصوصة منفصلة، مع دليل لتركيبها')}</option>
                <option value="stencil">{tx(lang, 'Cut through the plate: a stencil, with bridges', 'مقصوصة من اللوحة: استنسل بجسور')}</option>
              </select>
            </label>
          </>}
        </Section>
        <div className="control-action"><ErrorNote error={error || result.problem} lang={lang} /></div>
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
