'use client';
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { Raster } from './image';
import { tx, type Language } from './copy';
import { ErrorNote, Icon, NumberField, Section, Stat, Toggle } from './ui';
import { decodeImage, ImageDrop, IMAGE_TYPES, saveFile, usePastedImage } from './image-input';
import { impose, items, sheets, type Imposition } from './sheet';
import { fillHoles, offsetLoops } from './offset';
import { fitLoop, flatten } from './vectorize';
import { buildPdf, mmToPt, pdfNumber } from './pdf';

/* Print sheet. One design repeated across A4, A3 or a roll: stickers and
   labels for the sticker printer, transfers for the sublimation printer
   (mirrored), each with bleed, guillotine marks and, for print and cut, a
   CutContour line around every copy. The PDF holds the picture once and
   places it many times, so even a full sheet stays small. */

type Design = { raster: Raster; name: string; url: string };
type CutMode = 'none' | 'rect' | 'round' | 'shape';
type Pt = { x: number; y: number };

/** The design with its bleed drawn by repeating the edge pixels outward,
 *  then turned and mirrored as the sheet needs, as a JPEG. */
async function prepareImage(design: Design, itemW: number, itemH: number, bleed: number, rotated: boolean, mirror: boolean, fit: 'cover' | 'contain') {
  const ppm = Math.min(12, Math.max(4, 3000 / Math.max(itemW, itemH)));
  const W = Math.round(itemW * ppm), H = Math.round(itemH * ppm), B = Math.round(bleed * ppm);
  const base = document.createElement('canvas');
  base.width = W + 2 * B; base.height = H + 2 * B;
  const c = base.getContext('2d');
  if (!c) throw new Error('Canvas is unavailable.');
  c.fillStyle = '#fff';
  c.fillRect(0, 0, base.width, base.height);
  const bitmap = await createImageBitmap(new ImageData(new Uint8ClampedArray(design.raster.data), design.raster.width, design.raster.height));
  const scale = fit === 'cover' ? Math.max(W / bitmap.width, H / bitmap.height) : Math.min(W / bitmap.width, H / bitmap.height);
  const dw = bitmap.width * scale, dh = bitmap.height * scale;
  const inner = document.createElement('canvas');
  inner.width = W; inner.height = H;
  const ic = inner.getContext('2d')!;
  ic.fillStyle = '#fff';
  ic.fillRect(0, 0, W, H);
  ic.imageSmoothingQuality = 'high';
  ic.drawImage(bitmap, (W - dw) / 2, (H - dh) / 2, dw, dh);
  c.drawImage(inner, B, B);
  if (B > 0) {
    c.drawImage(inner, 0, 0, 1, H, 0, B, B, H);
    c.drawImage(inner, W - 1, 0, 1, H, B + W, B, B, H);
    c.drawImage(inner, 0, 0, W, 1, B, 0, W, B);
    c.drawImage(inner, 0, H - 1, W, 1, B, B + H, W, B);
    c.drawImage(inner, 0, 0, 1, 1, 0, 0, B, B);
    c.drawImage(inner, W - 1, 0, 1, 1, B + W, 0, B, B);
    c.drawImage(inner, 0, H - 1, 1, 1, 0, B + H, B, B);
    c.drawImage(inner, W - 1, H - 1, 1, 1, B + W, B + H, B, B);
  }
  const out = document.createElement('canvas');
  out.width = rotated ? base.height : base.width; out.height = rotated ? base.width : base.height;
  const oc = out.getContext('2d')!;
  // Mirrored in the item's own frame first, then turned: the same order the
  // preview and the cut lines use.
  if (rotated) { oc.translate(out.width, 0); oc.rotate(Math.PI / 2); }
  if (mirror) { oc.translate(base.width, 0); oc.scale(-1, 1); }
  oc.drawImage(base, 0, 0);
  const blob = await new Promise<Blob | null>(resolve => out.toBlob(resolve, 'image/jpeg', 0.95));
  if (!blob) throw new Error('The design could not be encoded.');
  return { jpeg: new Uint8Array(await blob.arrayBuffer()), width: out.width, height: out.height, url: out.toDataURL('image/jpeg', 0.7) };
}

/** A cut line around the design's own shape, in mm of the item box. */
function shapeOutline(design: Design, itemW: number, itemH: number, offset: number, fit: 'cover' | 'contain'): Pt[][] {
  const { width, height, data } = design.raster;
  let transparent = false;
  for (let i = 3; i < data.length; i += 4) if (data[i] < 250) { transparent = true; break; }
  const corner = [0, 1, 2].map(k => data[k]);
  const pad = 4;
  const w = width + pad * 2, h = height + pad * 2, mask = new Uint8Array(w * h);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const i = (y * width + x) * 4;
    const on = transparent ? data[i + 3] >= 128 : Math.abs(data[i] - corner[0]) + Math.abs(data[i + 1] - corner[1]) + Math.abs(data[i + 2] - corner[2]) > 36;
    mask[(y + pad) * w + x + pad] = on ? 1 : 0;
  }
  const scale = fit === 'cover' ? Math.max(itemW / width, itemH / height) : Math.min(itemW / width, itemH / height);
  const ox = (itemW - width * scale) / 2, oy = (itemH - height * scale) / 2;
  return offsetLoops(fillHoles(mask, w, h), w, h, offset / scale)
    .map(loop => flatten(fitLoop(loop, 0.5, 70), 0.3))
    .map(loop => loop.map(p => ({ x: ox + (p.x - pad) * scale, y: oy + (p.y - pad) * scale })));
}

function roundedRect(w: number, h: number, r: number): Pt[] {
  const radius = Math.min(r, w / 2, h / 2), points: Pt[] = [];
  const corner = (cx: number, cy: number, start: number) => { for (let i = 0; i <= 8; i++) { const a = start + (i / 8) * (Math.PI / 2); points.push({ x: cx + radius * Math.cos(a), y: cy + radius * Math.sin(a) }); } };
  corner(w - radius, radius, -Math.PI / 2); corner(w - radius, h - radius, 0); corner(radius, h - radius, Math.PI / 2); corner(radius, radius, Math.PI);
  return points;
}

export function SheetWorkspace({ lang }: { lang: Language }) {
  const [design, setDesign] = useState<Design | null>(null);
  const [sheetId, setSheetId] = useState('a4');
  const [sheetW, setSheetW] = useState(210);
  const [sheetH, setSheetH] = useState(297);
  const [itemW, setItemW] = useState(50);
  const [itemH, setItemH] = useState(50);
  const [lock, setLock] = useState(true);
  const [fit, setFit] = useState<'cover' | 'contain'>('contain');
  const [margin, setMargin] = useState(8);
  const [gap, setGap] = useState(4);
  const [bleed, setBleed] = useState(1);
  const [rotate, setRotate] = useState(true);
  const [mirror, setMirror] = useState(false);
  const [marks, setMarks] = useState(true);
  const [cut, setCut] = useState<CutMode>('none');
  const [cutOffset, setCutOffset] = useState(2);
  const [radius, setRadius] = useState(3);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => () => { if (design) URL.revokeObjectURL(design.url); }, [design]);

  const load = useCallback(async (file: File) => {
    if (!IMAGE_TYPES.includes(file.type)) { setError(tx(lang, 'Choose a PNG, JPEG, WebP, GIF or BMP image.', 'اختر صورة PNG أو JPEG أو WebP أو GIF أو BMP.')); return; }
    try {
      const decoded = await decodeImage(file, 6_000_000);
      setDesign({ raster: decoded.raster, name: file.name.replace(/\.[^.]+$/, '') || 'design', url: URL.createObjectURL(file) });
      if (lock) setItemH(Math.round((itemW * decoded.raster.height) / decoded.raster.width * 10) / 10);
      setError('');
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Image import failed.'); }
  }, [lang, lock, itemW]);
  const onPaste = useCallback((file: File) => { void load(file); }, [load]);
  usePastedImage(onPaste);

  const layout = useMemo((): { plan: Imposition | null; problem: string } => {
    try { return { plan: impose({ sheetWidth: sheetW, sheetHeight: sheetH, itemWidth: itemW, itemHeight: itemH, margin, gap, bleed, rotate }), problem: '' }; }
    catch (cause) { return { plan: null, problem: cause instanceof Error ? cause.message : 'Invalid sizes.' }; }
  }, [sheetW, sheetH, itemW, itemH, margin, gap, bleed, rotate]);
  const plan = layout.plan;

  /** The cut line of one item, in its own box, before turning or mirroring. */
  const cutLine = useMemo((): Pt[][] => {
    if (cut === 'none') return [];
    if (cut === 'rect') return [[{ x: 0, y: 0 }, { x: itemW, y: 0 }, { x: itemW, y: itemH }, { x: 0, y: itemH }]];
    if (cut === 'round') return [roundedRect(itemW, itemH, radius)];
    if (!design) return [];
    try { return shapeOutline(design, itemW, itemH, cutOffset, fit); } catch { return []; }
  }, [cut, itemW, itemH, radius, design, cutOffset, fit]);

  const placeCut = useCallback((loop: Pt[], p: { x: number; y: number; rotated: boolean }) => loop.map(q => {
    let x = mirror ? itemW - q.x : q.x, y = q.y;
    if (p.rotated) [x, y] = [itemH - y, x];
    return { x: p.x + x, y: p.y + y };
  }), [mirror, itemW, itemH]);

  const pickSheet = (id: string) => {
    const s = sheets.find(x => x.id === id);
    setSheetId(id);
    if (s) { setSheetW(s.width); setSheetH(s.height); }
  };
  const pickItem = (id: string) => {
    const it = items.find(x => x.id === id);
    if (!it) return;
    setItemW(it.width); setItemH(it.height); setLock(false); setFit('cover');
    if (id.startsWith('mug') || id === 'shirt') setMirror(true);
  };
  const setWidth = (value: number) => {
    setItemW(value);
    if (lock && design && value > 0) setItemH(Math.round(((value * design.raster.height) / design.raster.width) * 10) / 10);
  };

  const savePdf = async () => {
    if (!design || !plan || !plan.placements.length) return;
    setBusy(true); setError('');
    try {
      const image = await prepareImage(design, itemW, itemH, bleed, plan.rotated, mirror, fit);
      const pageW = mmToPt(sheetW), pageH = mmToPt(sheetH);
      const pt = (mm: number) => pdfNumber(mmToPt(mm));
      let content = '';
      for (const p of plan.placements) {
        const x = p.x - bleed, y = p.y - bleed, w = p.width + 2 * bleed, h = p.height + 2 * bleed;
        content += `q ${pt(w)} 0 0 ${pt(h)} ${pt(x)} ${pdfNumber(pageH - mmToPt(y + h))} cm /Im0 Do Q\n`;
      }
      if (marks && plan.placements.length) {
        // Guillotine marks in the margins, one per column and row edge.
        content += '0 0 0 RG 0.3 w\n';
        const xs = new Set<number>(), ys = new Set<number>();
        for (const p of plan.placements) { xs.add(p.x); xs.add(p.x + p.width); ys.add(p.y); ys.add(p.y + p.height); }
        const top = Math.min(...plan.placements.map(p => p.y)) - bleed, bottom = Math.max(...plan.placements.map(p => p.y + p.height)) + bleed;
        const left = Math.min(...plan.placements.map(p => p.x)) - bleed, right = Math.max(...plan.placements.map(p => p.x + p.width)) + bleed;
        const len = Math.max(2, Math.min(6, margin - 1));
        for (const x of xs) {
          content += `${pt(x)} ${pdfNumber(pageH - mmToPt(top - 1))} m ${pt(x)} ${pdfNumber(pageH - mmToPt(top - 1 - len))} l S\n`;
          content += `${pt(x)} ${pdfNumber(pageH - mmToPt(bottom + 1))} m ${pt(x)} ${pdfNumber(pageH - mmToPt(bottom + 1 + len))} l S\n`;
        }
        for (const y of ys) {
          content += `${pt(left - 1)} ${pdfNumber(pageH - mmToPt(y))} m ${pt(left - 1 - len)} ${pdfNumber(pageH - mmToPt(y))} l S\n`;
          content += `${pt(right + 1)} ${pdfNumber(pageH - mmToPt(y))} m ${pt(right + 1 + len)} ${pdfNumber(pageH - mmToPt(y))} l S\n`;
        }
      }
      if (cutLine.length) {
        content += '/Spot CS 1 SCN 0.25 w\n';
        for (const p of plan.placements) for (const loop of cutLine) {
          placeCut(loop, p).forEach((q, i) => { content += `${pt(q.x)} ${pdfNumber(pageH - mmToPt(q.y))} ${i ? 'l' : 'm'}\n`; });
          content += 'h S\n';
        }
      }
      const pdf = buildPdf({
        width: pageW, height: pageH, content,
        images: [{ name: 'Im0', jpeg: image.jpeg, width: image.width, height: image.height }],
        spot: cutLine.length ? { name: 'CutContour', cmyk: [0, 1, 0, 0] } : undefined,
        title: `${design.name} sheet`,
      });
      saveFile(pdf, `${design.name}-${plan.placements.length}-up-${sheetId}.pdf`, 'application/pdf');
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'The sheet could not be saved.'); }
    finally { setBusy(false); }
  };

  const hair = Math.max(sheetW, sheetH) / 500;

  return <>
    <div className="workspace">
      <aside className="controls">
        <Section title={tx(lang, 'Design', 'التصميم')} number="01">
          <ImageDrop lang={lang} onFile={file => { void load(file); }} note="PNG · JPEG · Ctrl+V" />
          {design && <div className="file-chip"><span className="file-symbol">IMG</span><div><strong>{design.name}</strong><small dir="ltr">{design.raster.width} × {design.raster.height} px</small></div></div>}
        </Section>
        <Section title={tx(lang, 'Item', 'القطعة')} number="02">
          <label className="field"><span>{tx(lang, 'Common sizes', 'مقاسات شائعة')}</span>
            <select value="" onChange={e => pickItem(e.target.value)}>
              <option value="">{tx(lang, 'Choose…', 'اختر…')}</option>
              {items.map(it => <option key={it.id} value={it.id}>{tx(lang, it.en, it.ar)} · {it.width} × {it.height}</option>)}
            </select>
          </label>
          <div className="field-pair"><NumberField label={tx(lang, 'Width', 'العرض')} value={itemW} onChange={setWidth} min={1} unit="mm" /><NumberField label={tx(lang, 'Height', 'الارتفاع')} value={itemH} onChange={v => { setItemH(v); setLock(false); }} min={1} unit="mm" /></div>
          <Toggle label={tx(lang, 'Keep the design’s proportions', 'حافظ على نسب التصميم')} value={lock} onChange={setLock} />
          <label className="field"><span>{tx(lang, 'Fit the design', 'ملاءمة التصميم')}</span>
            <select value={fit} onChange={e => setFit(e.target.value as 'cover' | 'contain')}>
              <option value="contain">{tx(lang, 'Whole design inside', 'التصميم كاملاً بالداخل')}</option>
              <option value="cover">{tx(lang, 'Fill the item, crop the rest', 'املأ القطعة واقصص الزائد')}</option>
            </select>
          </label>
        </Section>
        <Section title={tx(lang, 'Sheet', 'الورقة')} number="03">
          <label className="field"><span>{tx(lang, 'Paper', 'الورق')}</span>
            <select value={sheetId} onChange={e => pickSheet(e.target.value)}>
              {sheets.map(s => <option key={s.id} value={s.id}>{tx(lang, s.en, s.ar)} · {s.width} × {s.height}</option>)}
              <option value="custom">{tx(lang, 'Custom', 'مخصص')}</option>
            </select>
          </label>
          {sheetId === 'custom' && <div className="field-pair"><NumberField label={tx(lang, 'Width', 'العرض')} value={sheetW} onChange={setSheetW} min={10} unit="mm" /><NumberField label={tx(lang, 'Height', 'الارتفاع')} value={sheetH} onChange={setSheetH} min={10} unit="mm" /></div>}
          <div className="field-pair"><NumberField label={tx(lang, 'Margin', 'الهامش')} value={margin} onChange={setMargin} min={0} step={0.5} unit="mm" /><NumberField label={tx(lang, 'Gap', 'المسافة')} value={gap} onChange={setGap} min={0} step={0.5} unit="mm" /></div>
          <NumberField label={tx(lang, 'Bleed', 'زيادة الطباعة (bleed)')} value={bleed} onChange={setBleed} min={0} max={10} step={0.5} unit="mm" />
          <Toggle label={tx(lang, 'Turn items when more fit', 'دوّر القطع إن اتسع لأكثر')} value={rotate} onChange={setRotate} />
          <Toggle label={tx(lang, 'Mirror (sublimation transfer)', 'مرآة (طباعة سابليميشن)')} value={mirror} onChange={setMirror} />
          <Toggle label={tx(lang, 'Guillotine marks', 'علامات القص بالمقصلة')} value={marks} onChange={setMarks} />
        </Section>
        <Section title={tx(lang, 'Cut line (print and cut)', 'خط القص (طباعة وقص)')} number="04">
          <div className="preset-row">
            {(['none', 'rect', 'round', 'shape'] as const).map(m => <button key={m} className={cut === m ? 'selected' : ''} onClick={() => setCut(m)}>{m === 'none' ? tx(lang, 'None', 'بدون') : m === 'rect' ? tx(lang, 'Box', 'مستطيل') : m === 'round' ? tx(lang, 'Rounded', 'مستدير') : tx(lang, 'Shape', 'حسب الشكل')}</button>)}
          </div>
          {cut === 'round' && <NumberField label={tx(lang, 'Corner radius', 'نصف قطر الزاوية')} value={radius} onChange={setRadius} min={0} step={0.5} unit="mm" />}
          {cut === 'shape' && <NumberField label={tx(lang, 'Distance from the design', 'البعد عن التصميم')} value={cutOffset} onChange={setCutOffset} min={0} max={20} step={0.5} unit="mm" />}
        </Section>
        <div className="control-action">
          <button className="button primary wide" disabled={!design || !plan?.placements.length || busy} onClick={() => void savePdf()}>{busy ? tx(lang, 'Preparing…', 'جارٍ التجهيز…') : tx(lang, 'Save the sheet (PDF)', 'احفظ الورقة (PDF)')}<Icon name="download" size={18} /></button>
          <ErrorNote error={error || layout.problem} />
        </div>
      </aside>
      <div className="canvas-column">
        <div className="canvas-toolbar">
          <span className={`status-pill ${plan?.placements.length ? 'ready' : ''}`}><i />{plan ? tx(lang, `${plan.placements.length} on the sheet`, `${plan.placements.length} على الورقة`) : '—'}</span>
          <span className="micro">{tx(lang, 'Print the PDF at actual size (100%)', 'اطبع ملف PDF بالحجم الفعلي (١٠٠٪)')}</span>
        </div>
        <div className="preview-surface">
          <div className="preview-top"><span><Icon name="sheet" size={15} /> {tx(lang, 'SHEET', 'الورقة')}</span><b dir="ltr">{sheetW} × {sheetH} mm</b></div>
          <div className="up-stage">
            <svg className="sh-sheet" viewBox={`0 0 ${sheetW} ${sheetH}`} role="img" aria-label={tx(lang, 'Sheet layout', 'تخطيط الورقة')}>
              <rect width={sheetW} height={sheetH} fill="#fff" />
              <rect x={margin} y={margin} width={Math.max(0, sheetW - 2 * margin)} height={Math.max(0, sheetH - 2 * margin)} fill="none" stroke="#c9d3ba" strokeWidth={hair} strokeDasharray={`${hair * 4} ${hair * 3}`} />
              {plan?.placements.map((p, i) => {
                const w = p.width, h = p.height;
                const transform = `translate(${p.x} ${p.y})${p.rotated ? ` translate(${w} 0) rotate(90)` : ''}${mirror ? ` translate(${itemW} 0) scale(-1 1)` : ''}`;
                return <g key={i}>
                  <rect x={p.x - bleed} y={p.y - bleed} width={w + 2 * bleed} height={h + 2 * bleed} fill="#f3f5ec" />
                  {design ? <image href={design.url} x={0} y={0} width={itemW} height={itemH} preserveAspectRatio={fit === 'cover' ? 'xMidYMid slice' : 'xMidYMid meet'} transform={transform} />
                    : <rect x={p.x} y={p.y} width={w} height={h} fill="#e4ead4" />}
                  {cutLine.map((loop, k) => <path key={k} d={`M${placeCut(loop, p).map(q => `${q.x} ${q.y}`).join('L')}Z`} fill="none" stroke="#e0198a" strokeWidth={hair} />)}
                </g>;
              })}
            </svg>
          </div>
          <div className="preview-bottom"><span><i />{cut !== 'none' ? tx(lang, 'Magenta = CutContour line', 'الوردي = خط القص CutContour') : tx(lang, 'Dashed = printable margin', 'المتقطع = هامش الطباعة')}</span></div>
        </div>
        <div className="stats-row">
          <Stat label={tx(lang, 'Copies', 'النسخ')} value={plan ? plan.placements.length : '—'} />
          <Stat label={tx(lang, 'Layout', 'التوزيع')} value={plan ? `${plan.columns} × ${plan.rows}` : '—'} />
          <Stat label={tx(lang, 'Sheet used', 'استغلال الورقة')} value={plan ? (plan.used * 100).toFixed(0) : '—'} unit="%" />
        </div>
        <div className="tip-card"><span className="tip-mark">i</span><p>{tx(lang, 'For sublimation, mirror the sheet and print on transfer paper. For print and cut, the magenta CutContour line is cut by the plotter or the print-and-cut RIP; stickers get 1–2 mm of bleed.', 'للسابليميشن فعّل المرآة واطبع على ورق النقل. للطباعة والقص يقص البلوتر أو برنامج الطباعة والقص الخط الوردي CutContour؛ اترك للستيكرات ١–٢ مم زيادة طباعة.')}</p></div>
      </div>
    </div>
  </>;
}
