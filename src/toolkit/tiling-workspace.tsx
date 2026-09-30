'use client';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { tx, type Language } from './copy';
import { ErrorNote, Icon, NumberField, Range, Section, Stat, Toggle } from './ui';
import { bytes, ImageDrop, IMAGE_TYPES, saveFile, usePastedImage } from './image-input';
import { setJpegDpi } from './upscale-core';
import { eyelets, planTiles, zip, type Panel, type TileDirection, type TilePlan } from './tiling';

/* Poster tiling. The artwork stays a decoded bitmap; each panel is drawn at
   the source's own resolution only when it is saved, so a very large print
   never needs one canvas the size of the whole thing. */

type Art = { bitmap: ImageBitmap; name: string; url: string; bytes: number };

const MEDIA = [100, 127, 137, 152, 160, 180, 250, 320];

async function renderPanel(art: Art, plan: TilePlan, panel: Panel, total: number, o: { margin: number; overlap: number; direction: TileDirection; eyelet: number; labels: boolean; quality: number }) {
  const ppc = plan.pixelsPerCm;
  const margin = Math.round(o.margin * ppc);
  const width = panel.px.width + margin * 2, height = panel.px.height + margin * 2;
  if (width > 32000 || height > 32000 || width * height > 260_000_000) throw new Error('A panel is too large for the browser to draw. Lower the print resolution or split into more panels.');
  const canvas = document.createElement('canvas');
  canvas.width = width; canvas.height = height;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Canvas is unavailable in this browser.');
  context.fillStyle = '#fff';
  context.fillRect(0, 0, width, height);
  context.drawImage(art.bitmap, panel.px.x, panel.px.y, panel.px.width, panel.px.height, margin, margin, panel.px.width, panel.px.height);
  if (margin > 0) {
    const line = Math.max(1, Math.round(ppc * 0.05));
    context.strokeStyle = '#000';
    context.fillStyle = '#000';
    context.lineWidth = line;
    // Where the neighbouring panels' edges fall: ticks in the border.
    const overlap = o.overlap * ppc;
    const ticks: number[] = [];
    if (panel.index > 1) ticks.push(margin + overlap);
    if (panel.index < total) ticks.push(margin + (o.direction === 'columns' ? panel.px.width : panel.px.height) - overlap);
    context.setLineDash([line * 4, line * 3]);
    for (const at of ticks) {
      context.beginPath();
      if (o.direction === 'columns') {
        context.moveTo(at, 0); context.lineTo(at, margin * 0.8);
        context.moveTo(at, height); context.lineTo(at, height - margin * 0.8);
      } else {
        context.moveTo(0, at); context.lineTo(margin * 0.8, at);
        context.moveTo(width, at); context.lineTo(width - margin * 0.8, at);
      }
      context.stroke();
    }
    context.setLineDash([]);
    if (o.eyelet > 0) {
      const r = Math.max(2, Math.min(margin * 0.25, ppc * 0.5));
      const ring = (x: number, y: number) => { context.beginPath(); context.arc(x, y, r, 0, Math.PI * 2); context.stroke(); };
      for (const cm of eyelets(width / ppc, o.eyelet)) { ring(cm * ppc, margin / 2); ring(cm * ppc, height - margin / 2); }
      for (const cm of eyelets(height / ppc, o.eyelet)) { ring(margin / 2, cm * ppc); ring(width - margin / 2, cm * ppc); }
    }
    if (o.labels) {
      const size = Math.max(10, Math.min(margin * 0.42, ppc * 4));
      context.font = `700 ${size}px Arial, sans-serif`;
      context.textBaseline = 'middle';
      context.fillText(`${panel.index} / ${total}   ${art.name}   ↑ TOP · أعلى`, margin * 1.5 + (o.eyelet > 0 ? margin : 0), margin / 2);
    }
  }
  const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/jpeg', o.quality / 100));
  canvas.width = canvas.height = 0;
  if (!blob) throw new Error('The panel could not be encoded. Try a lower resolution.');
  const withDpi = setJpegDpi(new Uint8Array(await blob.arrayBuffer()), plan.dpi);
  return new Blob([withDpi], { type: 'image/jpeg' });
}

function assemblySvg(plan: TilePlan, o: { width: number; height: number; margin: number }, name: string) {
  const scale = 800 / Math.max(o.width, o.height);
  const w = o.width * scale, h = o.height * scale;
  const rects = plan.panels.map(p => {
    const x = p.x * scale, y = p.y * scale, pw = p.width * scale, ph = p.height * scale;
    return `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${pw.toFixed(1)}" height="${ph.toFixed(1)}" fill="${p.index % 2 ? '#dce6c0' : '#f0e0c8'}" fill-opacity="0.7" stroke="#2a4233" stroke-width="1.5"/>`
      + `<text x="${(x + pw / 2).toFixed(1)}" y="${(y + ph / 2).toFixed(1)}" font-size="28" font-family="Arial" font-weight="700" text-anchor="middle" fill="#2a4233">${p.index}</text>`
      + `<text x="${(x + pw / 2).toFixed(1)}" y="${(y + ph / 2 + 26).toFixed(1)}" font-size="13" font-family="Arial" text-anchor="middle" fill="#2a4233">${p.width.toFixed(1)} × ${p.height.toFixed(1)} cm</text>`;
  }).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" width="${(w + 40).toFixed(0)}" height="${(h + 90).toFixed(0)}" viewBox="-20 -60 ${(w + 40).toFixed(1)} ${(h + 90).toFixed(1)}">\n<text x="0" y="-32" font-size="18" font-family="Arial" font-weight="700" fill="#2a4233">${name.replace(/[<&]/g, '')} — ${o.width} × ${o.height.toFixed(1)} cm, ${plan.panels.length} panels, ${plan.dpi.toFixed(0)} DPI</text>\n<text x="0" y="-12" font-size="12" font-family="Arial" fill="#5a6b4f">Border ${o.margin} cm on every panel. Shaded bands are overlaps.</text>\n${rects}\n</svg>\n`;
}

export function TilingWorkspace({ lang }: { lang: Language }) {
  const [art, setArt] = useState<Art | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [width, setWidth] = useState(600);
  const [media, setMedia] = useState(320);
  const [overlap, setOverlap] = useState(2);
  const [margin, setMargin] = useState(3);
  const [direction, setDirection] = useState<TileDirection>('columns');
  const [eyelet, setEyelet] = useState(50);
  const [labels, setLabels] = useState(true);
  const [quality, setQuality] = useState(92);
  const [busy, setBusy] = useState('');

  useEffect(() => () => { if (art) { art.bitmap.close(); URL.revokeObjectURL(art.url); } }, [art]);

  const load = useCallback(async (file: File) => {
    if (!IMAGE_TYPES.includes(file.type)) { setError(tx(lang, 'Choose a PNG, JPEG, WebP, GIF or BMP image.', 'اختر صورة PNG أو JPEG أو WebP أو GIF أو BMP.')); return; }
    setLoading(true); setError('');
    try {
      const bitmap = await createImageBitmap(file);
      setArt({ bitmap, name: file.name.replace(/\.[^.]+$/, '') || 'poster', url: URL.createObjectURL(file), bytes: file.size });
    } catch {
      setError(tx(lang, 'This image could not be opened. Very large files may need to be saved as JPEG first.', 'تعذّر فتح الصورة. قد تحتاج الملفات الكبيرة جداً إلى حفظها بصيغة JPEG أولاً.'));
    } finally {
      setLoading(false);
    }
  }, [lang]);
  const onPaste = useCallback((file: File) => { void load(file); }, [load]);
  usePastedImage(onPaste);

  const height = art ? (width * art.bitmap.height) / art.bitmap.width : 0;
  const result = useMemo((): { plan: TilePlan | null; problem: string } => {
    if (!art) return { plan: null, problem: '' };
    try { return { plan: planTiles(art.bitmap.width, art.bitmap.height, { width, height, media, overlap, margin, direction }), problem: '' }; }
    catch (cause) { return { plan: null, problem: cause instanceof Error ? cause.message : 'Invalid sizes.' }; }
  }, [art, width, height, media, overlap, margin, direction]);
  const plan = result.plan;
  // The other direction, to say when it would use less roll.
  const other = useMemo(() => {
    if (!art || !plan) return null;
    try { return planTiles(art.bitmap.width, art.bitmap.height, { width, height, media, overlap, margin, direction: direction === 'columns' ? 'rows' : 'columns' }); } catch { return null; }
  }, [art, plan, width, height, media, overlap, margin, direction]);
  const options = { margin, overlap, direction, eyelet, labels, quality };
  const fileName = (panel: Panel) => `${art?.name ?? 'poster'}-panel-${String(panel.index).padStart(2, '0')}-of-${String(plan?.panels.length ?? 0).padStart(2, '0')}.jpg`;

  const savePanel = async (panel: Panel) => {
    if (!art || !plan) return;
    setBusy(`${panel.index}`); setError('');
    try { saveFile(await renderPanel(art, plan, panel, plan.panels.length, options), fileName(panel), 'image/jpeg'); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Saving failed.'); }
    finally { setBusy(''); }
  };

  const saveAll = async () => {
    if (!art || !plan) return;
    setBusy('all'); setError('');
    try {
      const files = [];
      for (const panel of plan.panels) files.push({ name: fileName(panel), blob: await renderPanel(art, plan, panel, plan.panels.length, options) });
      files.push({ name: `${art.name}-assembly-plan.svg`, blob: new Blob([assemblySvg(plan, { width, height, margin }, art.name)], { type: 'image/svg+xml' }) });
      saveFile(await zip(files), `${art.name}-panels.zip`, 'application/zip');
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Saving failed.'); }
    finally { setBusy(''); }
  };

  return <>
    <div className="workspace">
      <aside className="controls">
        <Section title={tx(lang, 'Artwork', 'التصميم')} number="01">
          <ImageDrop lang={lang} onFile={file => { void load(file); }} busy={loading} note="JPEG · PNG · Ctrl+V" />
          {art && <div className="file-chip"><span className="file-symbol">IMG</span><div><strong>{art.name}</strong><small dir="ltr">{art.bitmap.width} × {art.bitmap.height} px · {bytes(art.bytes)}</small></div></div>}
        </Section>
        <Section title={tx(lang, 'Print size', 'مقاس الطباعة')} number="02">
          <NumberField label={tx(lang, 'Width', 'العرض')} value={width} onChange={setWidth} min={1} max={100000} unit="cm" />
          <p className="micro" dir="ltr">{art ? `${width} × ${height.toFixed(1)} cm · ${plan ? plan.dpi.toFixed(0) : '—'} DPI` : '—'}</p>
          {plan && plan.dpi < 20 && <p className="ws-note">{tx(lang, `At ${plan.dpi.toFixed(0)} DPI this will look blurred even from a distance. Enlarge the artwork with the AI upscaler first.`, `بدقة ${plan.dpi.toFixed(0)} DPI ستبدو الطباعة ضبابية حتى من بعيد. كبّر التصميم أولاً بأداة التكبير بالذكاء الاصطناعي.`)}</p>}
        </Section>
        <Section title={tx(lang, 'Printer', 'الطابعة')} number="03">
          <label className="field"><span>{tx(lang, 'Roll width', 'عرض الرول')}</span>
            <select value={MEDIA.includes(media) ? media : 0} onChange={e => { const v = +e.target.value; if (v) setMedia(v); }}>
              {MEDIA.map(m => <option key={m} value={m}>{m} cm</option>)}
              {!MEDIA.includes(media) && <option value={0}>{media} cm</option>}
            </select>
          </label>
          <NumberField label={tx(lang, 'Or exact width', 'أو العرض بالضبط')} value={media} onChange={setMedia} min={10} max={1000} unit="cm" />
          <div className="ws-choice" role="radiogroup" aria-label={tx(lang, 'Strips', 'الشرائح')}>
            <button role="radio" aria-checked={direction === 'columns'} className={direction === 'columns' ? 'selected' : ''} onClick={() => setDirection('columns')}><b>{tx(lang, 'Vertical strips', 'شرائح عمودية')}</b><span>{tx(lang, 'Side by side', 'متجاورة')}</span></button>
            <button role="radio" aria-checked={direction === 'rows'} className={direction === 'rows' ? 'selected' : ''} onClick={() => setDirection('rows')}><b>{tx(lang, 'Horizontal strips', 'شرائح أفقية')}</b><span>{tx(lang, 'One above another', 'فوق بعضها')}</span></button>
          </div>
          {plan && other && other.rollLength < plan.rollLength - 0.05 && <p className="micro">{tx(lang, `${direction === 'columns' ? 'Horizontal' : 'Vertical'} strips use ${(plan.rollLength - other.rollLength).toFixed(2)} m less roll (${other.panels.length} panels).`, `الشرائح ${direction === 'columns' ? 'الأفقية' : 'العمودية'} توفر ${(plan.rollLength - other.rollLength).toFixed(2)} م من الرول (${other.panels.length} ألواح).`)}</p>}
        </Section>
        <Section title={tx(lang, 'Joining', 'التركيب')} number="04">
          <div className="field-pair"><NumberField label={tx(lang, 'Overlap', 'التداخل')} value={overlap} onChange={setOverlap} min={0} max={100} step={0.5} unit="cm" /><NumberField label={tx(lang, 'White border', 'الحافة البيضاء')} value={margin} onChange={setMargin} min={0} max={50} step={0.5} unit="cm" /></div>
          <NumberField label={tx(lang, 'Eyelet marks every', 'علامات العيون كل')} value={eyelet} onChange={setEyelet} min={0} max={500} unit="cm" />
          <Toggle label={tx(lang, 'Panel numbers in the border', 'أرقام الألواح في الحافة')} value={labels} onChange={setLabels} />
          <Range label={tx(lang, 'JPEG quality', 'جودة JPEG')} value={quality} min={70} max={100} onChange={setQuality} />
        </Section>
        <div className="control-action">
          <button className="button primary wide" disabled={!plan || !!busy} onClick={() => void saveAll()}>{busy === 'all' ? tx(lang, 'Preparing panels…', 'جارٍ تجهيز الألواح…') : tx(lang, 'Save all panels (ZIP)', 'احفظ كل الألواح (ZIP)')}<Icon name="download" size={18} /></button>
          <ErrorNote error={error || result.problem} />
        </div>
      </aside>

      <div className="canvas-column">
        <div className="canvas-toolbar">
          <span className={`status-pill ${plan ? 'ready' : ''}`}><i />{plan ? tx(lang, `${plan.panels.length} panels`, `${plan.panels.length} ألواح`) : tx(lang, 'Import the artwork', 'استورد التصميم')}</span>
          <span className="micro">{tx(lang, 'Panels keep the artwork’s own pixels, no resampling', 'الألواح تحافظ على بكسلات التصميم نفسها دون إعادة تحجيم')}</span>
        </div>
        <div className="preview-surface">
          <div className="preview-top"><span><Icon name="tiles" size={15} /> {tx(lang, 'LAYOUT', 'التقسيم')}</span><b dir="ltr">{art ? `${width} × ${height.toFixed(1)} cm` : '—'}</b></div>
          <div className="up-stage">
            {art ? <div className="tl-frame">
              {/* eslint-disable-next-line @next/next/no-img-element -- a local object URL */}
              <img src={art.url} alt={tx(lang, 'Artwork', 'التصميم')} />
              {plan && <svg viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" aria-hidden="true">
                {plan.panels.map(p => <g key={p.index}>
                  <rect x={p.x} y={p.y} width={p.width} height={p.height} fill={p.index % 2 ? 'rgba(122,150,88,.18)' : 'rgba(187,105,61,.16)'} stroke="#2a4233" strokeWidth={Math.max(width, height) / 400} />
                </g>)}
              </svg>}
              {plan && plan.panels.map(p => <span key={p.index} className="tl-number" style={{ left: `${((p.x + p.width / 2) / width) * 100}%`, top: `${((p.y + p.height / 2) / height) * 100}%` }}>{p.index}</span>)}
            </div> : <div className="empty-preview"><Icon name="tiles" size={42} /><p>{tx(lang, 'Import, drop or paste the final artwork', 'استورد التصميم النهائي أو اسحبه أو الصقه')}</p></div>}
          </div>
          <div className="preview-bottom"><span><i />{tx(lang, 'Shaded bands are the overlaps', 'الأشرطة المظللة هي مناطق التداخل')}</span><span dir="ltr">{plan ? `${plan.dpi.toFixed(0)} DPI` : ''}</span></div>
        </div>

        {plan && <div className="ws-card">
          <h3>{tx(lang, 'Panels', 'الألواح')}</h3>
          <ul className="tl-list">
            {plan.panels.map(p => <li key={p.index}>
              <b>{p.index}</b>
              <span dir="ltr">{p.width.toFixed(1)} × {p.height.toFixed(1)} cm</span>
              <small dir="ltr">{tx(lang, 'printed', 'مطبوع')} {p.sheetWidth.toFixed(1)} × {p.sheetHeight.toFixed(1)} cm · {p.px.width} × {p.px.height} px</small>
              <button className="button secondary" disabled={!!busy} onClick={() => void savePanel(p)}><Icon name="download" size={15} />{busy === `${p.index}` ? '…' : 'JPEG'}</button>
            </li>)}
          </ul>
        </div>}

        <div className="stats-row">
          <Stat label={tx(lang, 'Panels', 'الألواح')} value={plan ? plan.panels.length : '—'} />
          <Stat label={tx(lang, 'Roll used', 'طول الرول')} value={plan ? plan.rollLength.toFixed(2) : '—'} unit="m" />
          <Stat label={tx(lang, 'Printed area', 'المساحة المطبوعة')} value={plan ? plan.area.toFixed(2) : '—'} unit="m²" />
          <Stat label={tx(lang, 'Resolution', 'الدقة')} value={plan ? plan.dpi.toFixed(0) : '—'} unit="DPI" />
        </div>
        {plan && <div className="export-bar">
          <div><strong>{tx(lang, 'Assembly plan', 'مخطط التركيب')}</strong><span>{tx(lang, 'A numbered drawing of the panels for the fitter', 'رسم مرقّم للألواح لمن يركّبها')}</span></div>
          <div className="export-actions"><button className="button secondary" onClick={() => saveFile(assemblySvg(plan, { width, height, margin }, art?.name ?? 'poster'), `${art?.name ?? 'poster'}-assembly-plan.svg`, 'image/svg+xml')}><Icon name="download" size={16} />SVG</button></div>
        </div>}
        <div className="tip-card"><span className="tip-mark">i</span><p>{tx(lang, 'Each panel is saved with the artwork’s DPI, so your RIP prints it at the right size. Overlap 2–3 cm for pasting, more for welding flex. Enlarge a small image first with the AI upscaler.', 'كل لوح يُحفظ بدقة التصميم، فتطبعه برامج الطباعة بالمقاس الصحيح. تداخل ٢–٣ سم للصق، وأكثر للحام الفليكس. كبّر الصورة الصغيرة أولاً بأداة التكبير بالذكاء الاصطناعي.')}</p></div>
      </div>
    </div>
  </>;
}
