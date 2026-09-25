'use client';
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { Contour, Drawing, Shape } from './types';
import type { Raster } from './image';
import { tx, type Language } from './copy';
import { ErrorNote, Exports, Icon, NumberField, Range, Section, Stat, Toggle, VectorPreview } from './ui';
import { VectorInput } from './vector-input';
import { decodeImage, ImageDrop, IMAGE_TYPES, saveFile, usePastedImage } from './image-input';
import { fillHoles, offsetLoops } from './offset';
import { fitLoop, flatten } from './vectorize';
import { buildPdf, mmToPt, pdfNumber } from './pdf';

/* Contour and offset. A vector shape (letters, a logo) or a picture (a
   sticker) is rasterised finely, and outlines are drawn at a set distance
   from it: a base plate for acrylic letters, a weeding border, or the cut line
   around a printed sticker, which also exports as a print-and-cut PDF whose
   line is the "CutContour" spot colour cutters look for. */

type Mode = 'vector' | 'image';
type Props = { lang: Language; drawing: Drawing | null; setDrawing: (d: Drawing | null) => void; filename: string; setFilename: (n: string) => void; onNest: (d: Drawing) => void };
type Sticker = { raster: Raster; name: string; url: string };
type Placement = { x: number; y: number; width: number; height: number };
type Built = { drawing: Drawing | null; rings: Contour[][]; error: string; ppm: number; placement: Placement | null };

const RASTER_SIDE = 2600;

/** Fills the closed cut contours of a drawing into a 0/1 mask with `pad` mm
 *  of empty space around them. Returns the mask and where it sits in mm. */
function rasterizeDrawing(drawing: Drawing, pad: number) {
  const closed = drawing.shapes.map(s => ({ ...s, contours: s.contours.filter(c => c.closed && c.layer !== 'engrave' && c.points.length > 2) })).filter(s => s.contours.length);
  if (!closed.length) throw new Error('The drawing has no closed outlines to offset.');
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const s of closed) for (const c of s.contours) for (const p of c.points) { x0 = Math.min(x0, p.x); y0 = Math.min(y0, p.y); x1 = Math.max(x1, p.x); y1 = Math.max(y1, p.y); }
  const spanX = x1 - x0 + pad * 2, spanY = y1 - y0 + pad * 2;
  const ppm = Math.min(30, Math.max(1.5, RASTER_SIDE / Math.max(spanX, spanY)));
  const w = Math.ceil(spanX * ppm), h = Math.ceil(spanY * ppm);
  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) throw new Error('Canvas is unavailable in this browser.');
  context.fillStyle = '#000';
  for (const s of closed) {
    const path = new Path2D();
    for (const c of s.contours) {
      c.points.forEach((p, i) => { const x = (p.x - x0 + pad) * ppm, y = (p.y - y0 + pad) * ppm; if (i) path.lineTo(x, y); else path.moveTo(x, y); });
      path.closePath();
    }
    context.fill(path, 'evenodd');
  }
  const data = context.getImageData(0, 0, w, h).data;
  const mask = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) mask[i] = data[i * 4 + 3] >= 128 ? 1 : 0;
  return { mask, w, h, ppm, originX: x0 - pad, originY: y0 - pad, source: closed };
}

/** The sticker's shape: opaque pixels when the picture has transparency,
 *  otherwise every pixel that differs from the colour of its corners. */
function stickerMask(raster: Raster, padPx: number) {
  const { width, height, data } = raster;
  let transparent = false;
  for (let i = 3; i < data.length; i += 4) if (data[i] < 250) { transparent = true; break; }
  const corners = [0, width - 1, (height - 1) * width, height * width - 1];
  const bg = [0, 1, 2].map(k => corners.reduce((sum, i) => sum + data[i * 4 + k], 0) / 4);
  const w = width + padPx * 2, h = height + padPx * 2;
  const mask = new Uint8Array(w * h);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const i = (y * width + x) * 4;
    const on = transparent ? data[i + 3] >= 128 : Math.abs(data[i] - bg[0]) + Math.abs(data[i + 1] - bg[1]) + Math.abs(data[i + 2] - bg[2]) > 36;
    mask[(y + padPx) * w + x + padPx] = on ? 1 : 0;
  }
  return { mask, w, h, transparent };
}

export function ContourWorkspace(props: Props) {
  const { lang, drawing: shared, onNest } = props;
  const [mode, setMode] = useState<Mode>('vector');
  const [distance, setDistance] = useState(5);
  const [rings, setRings] = useState(1);
  const [step, setStep] = useState(5);
  const [holes, setHoles] = useState(true);
  const [original, setOriginal] = useState(true);
  const [smoothing, setSmoothing] = useState(35);
  const [sticker, setSticker] = useState<Sticker | null>(null);
  const [stickerWidth, setStickerWidth] = useState(80);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState('');

  useEffect(() => () => { if (sticker) URL.revokeObjectURL(sticker.url); }, [sticker]);

  const load = useCallback(async (file: File) => {
    if (!IMAGE_TYPES.includes(file.type)) { setLoadError(tx(lang, 'Choose a PNG, JPEG, WebP, GIF or BMP image.', 'اختر صورة PNG أو JPEG أو WebP أو GIF أو BMP.')); return; }
    setLoading(true); setLoadError('');
    try {
      const decoded = await decodeImage(file, 4_000_000);
      setSticker({ raster: decoded.raster, name: file.name.replace(/\.[^.]+$/, '') || 'sticker', url: URL.createObjectURL(file) });
      setMode('image');
    } catch (cause) { setLoadError(cause instanceof Error ? cause.message : 'Image import failed.'); }
    finally { setLoading(false); }
  }, [lang]);
  const onPaste = useCallback((file: File) => { void load(file); }, [load]);
  usePastedImage(onPaste, mode === 'image');

  const built = useMemo((): Built => {
    try {
      const count = Math.round(rings);
      if (!Number.isFinite(distance) || Math.abs(distance) > 500) throw new Error('Offset must be between -500 and 500 mm.');
      if (count < 1 || count > 6) throw new Error('Outlines must be between 1 and 6.');
      const offsets = Array.from({ length: count }, (_, i) => distance + i * step);
      const reach = Math.max(0, ...offsets) + 2;
      const error = 0.35 + (smoothing / 100) * 1.4;
      let mask: Uint8Array, w: number, h: number, ppm: number, originX: number, originY: number;
      const shapes: Shape[] = [];
      if (mode === 'vector') {
        if (!shared) return { drawing: null, rings: [], error: '', ppm: 0, placement: null };
        const r = rasterizeDrawing(shared, reach);
        ({ mask, w, h, ppm, originX, originY } = r);
        if (original) r.source.forEach((s, i) => shapes.push({ ...s, id: `original-${i}`, name: s.name || 'Original' }));
      } else {
        if (!sticker) return { drawing: null, rings: [], error: '', ppm: 0, placement: null };
        if (!(stickerWidth > 0)) throw new Error('Sticker width must be above zero.');
        ppm = sticker.raster.width / stickerWidth;
        const pad = Math.ceil(reach * ppm);
        if ((sticker.raster.width + pad * 2) * (sticker.raster.height + pad * 2) > 20_000_000) throw new Error('The offset is too large for this picture size. Lower the offset or use a smaller picture.');
        const r = stickerMask(sticker.raster, pad);
        ({ mask, w, h } = r);
        originX = -pad / ppm; originY = -pad / ppm;
      }
      const source = holes ? fillHoles(mask, w, h) : mask;
      const ringContours: Contour[][] = offsets.map(d => offsetLoops(source, w, h, d * ppm)
        .map(loop => fitLoop(loop, error, 70))
        .filter(path => path.curves.length)
        .map(path => ({ closed: true, points: flatten(path, 0.02 * ppm).map(p => ({ x: originX + p.x / ppm, y: originY + p.y / ppm })) })));
      if (!ringContours.some(r => r.length)) throw new Error('Nothing is left at that offset. An inward offset may be larger than the shape.');
      ringContours.forEach((contours, i) => { if (contours.length) shapes.push({ id: `offset-${i}`, name: `Offset ${offsets[i]} mm`, contours }); });
      // Everything is moved so the drawing starts at the origin.
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for (const s of shapes) for (const c of s.contours) for (const p of c.points) { x0 = Math.min(x0, p.x); y0 = Math.min(y0, p.y); x1 = Math.max(x1, p.x); y1 = Math.max(y1, p.y); }
      const moved = shapes.map(s => ({ ...s, contours: s.contours.map(c => ({ ...c, points: c.points.map(p => ({ x: p.x - x0, y: p.y - y0 })) })) }));
      const shift = (contours: Contour[]) => contours.map(c => ({ ...c, points: c.points.map(p => ({ x: p.x - x0, y: p.y - y0 })) }));
      // The sticker picture starts at the raster's padding, which is (0, 0) before the shift.
      const placement = mode === 'image' && sticker
        ? { x: -x0, y: -y0, width: stickerWidth, height: (sticker.raster.height / sticker.raster.width) * stickerWidth }
        : null;
      return { drawing: { width: x1 - x0, height: y1 - y0, shapes: moved }, rings: ringContours.map(shift), error: '', ppm, placement };
    } catch (cause) {
      return { drawing: null, rings: [], error: cause instanceof Error ? cause.message : 'Offset failed.', ppm: 0, placement: null };
    }
  }, [mode, shared, sticker, stickerWidth, distance, rings, step, holes, original, smoothing]);

  const drawing = built.drawing;
  const name = mode === 'image' ? `${sticker?.name ?? 'sticker'}-cut-${distance}mm` : `${(props.filename || 'artwork').replace(/\.[^.]+$/, '')}-offset-${distance}mm`;

  const placement = built.placement;

  const printAndCut = async () => {
    if (!sticker || !drawing || !placement) return;
    const canvas = document.createElement('canvas');
    canvas.width = sticker.raster.width; canvas.height = sticker.raster.height;
    const context = canvas.getContext('2d');
    if (!context) return;
    context.fillStyle = '#fff';
    context.fillRect(0, 0, canvas.width, canvas.height);
    const image = await createImageBitmap(new ImageData(new Uint8ClampedArray(sticker.raster.data), sticker.raster.width, sticker.raster.height));
    context.drawImage(image, 0, 0);
    const jpeg = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/jpeg', 0.95));
    if (!jpeg) return;
    const margin = 5;
    const pageW = mmToPt(drawing.width + margin * 2), pageH = mmToPt(drawing.height + margin * 2);
    const pt = (mm: number) => mmToPt(mm + margin);
    let content = `q ${pdfNumber(mmToPt(placement.width))} 0 0 ${pdfNumber(mmToPt(placement.height))} ${pdfNumber(pt(placement.x))} ${pdfNumber(pageH - pt(placement.y + placement.height))} cm /Im0 Do Q\n`;
    content += `/Spot CS 1 SCN 0.25 w\n`;
    for (const ring of built.rings) for (const c of ring) {
      c.points.forEach((p, i) => { content += `${pdfNumber(pt(p.x))} ${pdfNumber(pageH - pt(p.y))} ${i ? 'l' : 'm'}\n`; });
      content += 'h S\n';
    }
    const pdf = buildPdf({ width: pageW, height: pageH, content, images: [{ name: 'Im0', jpeg: new Uint8Array(await jpeg.arrayBuffer()), width: canvas.width, height: canvas.height }], spot: { name: 'CutContour', cmyk: [0, 1, 0, 0] }, title: `${sticker.name} print and cut` });
    saveFile(pdf, `${name}-print-and-cut.pdf`, 'application/pdf');
  };

  const stickerSvg = async () => {
    if (!sticker || !drawing || !placement) return;
    const canvas = document.createElement('canvas');
    canvas.width = sticker.raster.width; canvas.height = sticker.raster.height;
    canvas.getContext('2d')?.putImageData(new ImageData(new Uint8ClampedArray(sticker.raster.data), canvas.width, canvas.height), 0, 0);
    const href = canvas.toDataURL('image/png');
    const cut = built.rings.flat().map(c => `M${c.points.map(p => `${p.x.toFixed(3)} ${p.y.toFixed(3)}`).join('L')}Z`).join('');
    const svg = `<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${drawing.width.toFixed(3)}mm" height="${drawing.height.toFixed(3)}mm" viewBox="0 0 ${drawing.width.toFixed(3)} ${drawing.height.toFixed(3)}">\n  <g id="Print"><image x="${placement.x.toFixed(3)}" y="${placement.y.toFixed(3)}" width="${placement.width.toFixed(3)}" height="${placement.height.toFixed(3)}" xlink:href="${href}"/></g>\n  <g id="CutContour"><path d="${cut}" fill="none" stroke="#ff00ff" stroke-width="0.1"/></g>\n</svg>\n`;
    saveFile(svg, `${name}-print-and-cut.svg`, 'image/svg+xml');
  };

  return <>
    <div className="workspace">
      <aside className="controls">
        <Section title={tx(lang, 'Around what?', 'حول ماذا؟')} number="01">
          <div className="vz-modes" role="radiogroup" aria-label={tx(lang, 'Source', 'المصدر')}>
            <button role="radio" aria-checked={mode === 'vector'} className={mode === 'vector' ? 'selected' : ''} onClick={() => setMode('vector')}><b>{tx(lang, 'Vector', 'فيكتور')}</b><span>{tx(lang, 'Letters, logos, SVG, DXF', 'حروف وشعارات، SVG و DXF')}</span></button>
            <button role="radio" aria-checked={mode === 'image'} className={mode === 'image' ? 'selected' : ''} onClick={() => setMode('image')}><b>{tx(lang, 'Sticker', 'ستيكر')}</b><span>{tx(lang, 'A picture to print and cut', 'صورة للطباعة والقص')}</span></button>
          </div>
        </Section>
        {mode === 'vector' ? <VectorInput {...props} /> : <Section title={tx(lang, 'Picture', 'الصورة')} number="02">
          <ImageDrop lang={lang} onFile={file => { void load(file); }} busy={loading} note="PNG · JPEG · Ctrl+V" />
          {sticker && <div className="file-chip"><span className="file-symbol">IMG</span><div><strong>{sticker.name}</strong><small dir="ltr">{sticker.raster.width} × {sticker.raster.height} px</small></div></div>}
          <NumberField label={tx(lang, 'Printed width', 'عرض الطباعة')} value={stickerWidth} onChange={setStickerWidth} min={1} max={5000} unit="mm" />
          <p className="micro">{tx(lang, 'Transparent PNGs work best. Otherwise the colour of the corners is taken as the background.', 'ملفات PNG الشفافة هي الأفضل. وإلا يُعتبر لون الزوايا هو الخلفية.')}</p>
        </Section>}
        <Section title={tx(lang, 'Outline', 'الحد')} number="03">
          <NumberField label={tx(lang, 'Offset (minus = inward)', 'الإزاحة (بالسالب للداخل)')} value={distance} onChange={setDistance} min={-500} max={500} step={0.5} unit="mm" />
          <div className="preset-row">{[-1, 2, 3, 5, 10].map(v => <button key={v} className={distance === v ? 'selected' : ''} onClick={() => setDistance(v)} dir="ltr">{v > 0 ? `+${v}` : v}</button>)}</div>
          <div className="field-pair"><NumberField label={tx(lang, 'Outlines', 'عدد الحدود')} value={rings} onChange={setRings} min={1} max={6} /><NumberField label={tx(lang, 'Spacing', 'المسافة بينها')} value={step} onChange={setStep} min={0.5} max={200} step={0.5} unit="mm" /></div>
          <Toggle label={tx(lang, 'Fill holes (outer line only)', 'املأ الفراغات (الحد الخارجي فقط)')} value={holes} onChange={setHoles} />
          {mode === 'vector' && <Toggle label={tx(lang, 'Keep the original shapes', 'احتفظ بالأشكال الأصلية')} value={original} onChange={setOriginal} />}
          <Range label={tx(lang, 'Smoothing', 'النعومة')} value={smoothing} min={0} max={100} onChange={setSmoothing} />
        </Section>
        <div className="control-action"><ErrorNote error={loadError || built.error} /></div>
      </aside>
      <div className="canvas-column">
        <div className="canvas-toolbar">
          <span className={`status-pill ${drawing ? 'ready' : ''}`}><i />{drawing ? tx(lang, 'Outline ready', 'الحد جاهز') : mode === 'image' ? tx(lang, 'Import a sticker picture', 'استورد صورة الستيكر') : tx(lang, 'Import a vector file', 'استورد ملف فيكتور')}</span>
          <span className="micro">{tx(lang, 'Overlapping parts weld into one outline', 'الأجزاء المتداخلة تلتحم في حد واحد')}</span>
        </div>
        {mode === 'image' && sticker && drawing && placement
          ? <div className="preview-surface">
              <div className="preview-top"><span><Icon name="contour" size={15} /> {tx(lang, 'PRINT AND CUT', 'طباعة وقص')}</span><b dir="ltr">{drawing.width.toFixed(1)} × {drawing.height.toFixed(1)} mm</b></div>
              <div className="up-stage">
                <svg className="ct-sticker" viewBox={`0 0 ${drawing.width} ${drawing.height}`} role="img" aria-label={tx(lang, 'Sticker with cut line', 'الستيكر مع خط القص')}>
                  <image href={sticker.url} x={placement.x} y={placement.y} width={placement.width} height={placement.height} />
                  {built.rings.map((ring, i) => <path key={i} d={ring.map(c => `M${c.points.map(p => `${p.x} ${p.y}`).join('L')}Z`).join('')} fill="none" stroke="#e0198a" strokeWidth={Math.max(drawing.width, drawing.height) / 400} />)}
                </svg>
              </div>
              <div className="preview-bottom"><span><i />{tx(lang, 'Magenta = CutContour line', 'الوردي = خط القص CutContour')}</span></div>
            </div>
          : <VectorPreview drawing={drawing} lang={lang} caption={tx(lang, 'Offset outlines · millimetres', 'حدود الإزاحة · ملليمتر')} />}
        <div className="stats-row">
          <Stat label={tx(lang, 'Size', 'المقاس')} value={drawing ? `${drawing.width.toFixed(1)} × ${drawing.height.toFixed(1)}` : '—'} unit="mm" />
          <Stat label={tx(lang, 'Outlines', 'الحدود')} value={built.rings.length ? built.rings.reduce((n, r) => n + r.length, 0) : '—'} />
          <Stat label={tx(lang, 'Precision', 'الدقة')} value={built.ppm ? (1 / built.ppm).toFixed(2) : '—'} unit="mm/px" />
        </div>
        <div className="tip-card"><span className="tip-mark">i</span><p>{mode === 'image'
          ? tx(lang, 'The PDF carries the picture and a cut line in the spot colour CutContour, which Roland, Mimaki and most print-and-cut RIPs cut automatically.', 'ملف PDF يحمل الصورة وخط قص بلون خاص اسمه CutContour، تقصه طابعات Roland و Mimaki ومعظم برامج الطباعة والقص تلقائياً.')
          : tx(lang, 'For acrylic letters on a base, offset outward 5–10 mm and cut the base from a second sheet. Arabic letters that touch weld into one clean line.', 'للحروف البارزة على قاعدة، أزح للخارج ٥–١٠ مم واقطع القاعدة من لوح ثانٍ. الحروف العربية المتلامسة تلتحم في خط واحد نظيف.')}</p></div>
      </div>
    </div>
    <Exports drawing={drawing} lang={lang} name={name} extra={<>
      {mode === 'image' && <button className="button secondary" disabled={!placement} onClick={() => void stickerSvg()}><Icon name="download" size={16} />{tx(lang, 'Print & cut SVG', 'SVG للطباعة والقص')}</button>}
      {mode === 'image' && <button className="button secondary" disabled={!placement} onClick={() => void printAndCut()}><Icon name="download" size={16} />{tx(lang, 'Print & cut PDF', 'PDF للطباعة والقص')}</button>}
      <button className="text-button" disabled={!drawing} onClick={() => { if (drawing) onNest(drawing); }}>{tx(lang, 'Arrange on sheet', 'ترتيب على اللوح')} ↗</button>
    </>} />
  </>;
}

