'use client';
import { useEffect, useRef, useState } from 'react';
import { tx, type Language } from './copy';
import type { Drawing } from './types';
import type { ImageOptions, Raster, traceImage } from './image';
import { download } from './export';
import { ErrorNote, Exports, Icon, NumberField, Range, Section, Stat, Toggle, VectorPreview } from './ui';

const defaults: ImageOptions = { threshold: 128, brightness: 0, contrast: 0, noise: 0, simplify: 0, invert: false };
function sampleRaster(): Raster {
  const width = 256, height = 256, data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const radius = Math.hypot(x - 128, y - 120);
    const ring = radius < 84 && radius > 48;
    const stem = x >= 109 && x < 147 && y >= 158 && y < 223;
    const foot = x >= 71 && x < 185 && y >= 207 && y < 229;
    const value = ring || stem || foot ? 24 : 255, at = (y * width + x) * 4;
    data[at] = data[at + 1] = data[at + 2] = value; data[at + 3] = 255;
  }
  return { width, height, data };
}
function RasterPreview({ raster, title, lang }: { raster: Raster | null; title: string; lang: Language }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const node = canvas.current;
    if (node && raster) {
      node.width = raster.width; node.height = raster.height;
      node.getContext('2d')?.putImageData(new ImageData(new Uint8ClampedArray(raster.data), raster.width, raster.height), 0, 0);
    }
  }, [raster]);
  return <div className="preview-surface"><div className="preview-top"><span>{title}</span><b dir="ltr">{raster ? `${raster.width} × ${raster.height} px` : '—'}</b></div><div className="paper-stage">{raster ? <canvas ref={canvas} className="raster-paper" role="img" aria-label={title} style={{ maxWidth: '100%', maxHeight: 420, objectFit: 'contain', background: '#fff' }} /> : <div className="empty-preview"><Icon name="engrave" size={42}/><p>{tx(lang, 'Your result will appear here', 'ستظهر النتيجة هنا')}</p></div>}</div><div className="preview-bottom"><span>{tx(lang, 'Pixels stay on your device', 'تبقى الصورة على جهازك')}</span></div></div>;
}
type Result = { source: Raster; key: string; drawing?: Drawing; raster?: Raster };
export function ImageWorkspace({ lang, tool, onNest }: { lang: Language; tool: 'trace' | 'engrave'; onNest: (drawing: Drawing) => void }) {
  const [source, setSource] = useState<Raster | null>(sampleRaster), [filename, setFilename] = useState('studio-symbol.png');
  const [options, setOptions] = useState<ImageOptions>(defaults), [width, setWidth] = useState(100), [dither, setDither] = useState(true);
  const [job, setJob] = useState<Result | null>(null), [busy, setBusy] = useState(false), [loading, setLoading] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState('');
  const worker = useRef<Worker | null>(null), deadline = useRef<ReturnType<typeof setTimeout> | null>(null), ticket = useRef(0), urls = useRef(new Set<string>());
  useEffect(() => {
    const pendingUrls = urls.current;
    const invalidatePendingLoad = () => { ticket.current++; };
    return () => { invalidatePendingLoad(); worker.current?.terminate(); if (deadline.current) clearTimeout(deadline.current); pendingUrls.forEach(url => URL.revokeObjectURL(url)); };
  }, []);
  const key = JSON.stringify({ options, width, dither, tool });
  const current = job?.source === source && job.key === key ? job : null;
  const drawing = current?.drawing ?? null, output = current?.raster ?? null;
  function stop() { worker.current?.terminate(); worker.current = null; if (deadline.current) clearTimeout(deadline.current); deadline.current = null; setBusy(false); }
  function adjust<K extends keyof ImageOptions>(name: K, value: ImageOptions[K]) { setOptions(previous => ({ ...previous, [name]: value })); }
  async function load(file?: File) {
    if (!file) return;
    stop(); const version = ++ticket.current; setLoading(true); setJob(null); setSource(null); setError(''); setNotice('');
    let url = '';
    try {
      if (file.size > 10 * 1024 * 1024) throw new Error(tx(lang, 'Choose an image smaller than 10 MB.', 'اختر صورة أصغر من ١٠ ميغابايت.'));
      if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) throw new Error(tx(lang, 'Choose a PNG, JPEG or WebP image.', 'اختر صورة بصيغة PNG أو JPEG أو WebP.'));
      url = URL.createObjectURL(file); urls.current.add(url);
      const image = new Image();
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => { image.src = ''; reject(new Error(tx(lang, 'Image decoding timed out. Try a smaller file.', 'استغرق فتح الصورة وقتاً طويلاً. جرّب ملفاً أصغر.'))); }, 15000);
        image.onload = () => { clearTimeout(timer); resolve(); };
        image.onerror = () => { clearTimeout(timer); reject(new Error(tx(lang, 'This image could not be decoded. Try another file.', 'تعذّر فتح هذه الصورة. جرّب ملفاً آخر.'))); };
        image.src = url;
      });
      if (version !== ticket.current) return;
      if (!image.naturalWidth || !image.naturalHeight || image.naturalWidth * image.naturalHeight > 40_000_000) throw new Error(tx(lang, 'Image dimensions are too large. Resize below 40 megapixels first.', 'أبعاد الصورة كبيرة جداً. قلّلها إلى أقل من ٤٠ مليون بكسل.'));
      const scale = Math.min(1, 768 / Math.max(image.naturalWidth, image.naturalHeight));
      const canvas = document.createElement('canvas'); canvas.width = Math.max(1, Math.round(image.naturalWidth * scale)); canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
      const context = canvas.getContext('2d', { willReadFrequently: true }); if (!context) throw new Error('Canvas is unavailable.');
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      const pixels = context.getImageData(0, 0, canvas.width, canvas.height);
      setSource({ width: canvas.width, height: canvas.height, data: pixels.data }); setFilename(file.name);
      if (scale < 1) setNotice(tx(lang, `Resized from ${image.naturalWidth} × ${image.naturalHeight} to ${canvas.width} × ${canvas.height} pixels for responsive processing.`, `صُغّرت الصورة من ${image.naturalWidth} × ${image.naturalHeight} إلى ${canvas.width} × ${canvas.height} بكسل لتسريع المعالجة.`));
    } catch (cause) { if (version === ticket.current) setError(cause instanceof Error ? cause.message : 'Image import failed.'); }
    finally { if (url) { URL.revokeObjectURL(url); urls.current.delete(url); } if (version === ticket.current) setLoading(false); }
  }
  function run() {
    if (!source) return; stop(); setError(''); setJob(null);
    if (tool === 'trace' && (!Number.isFinite(width) || width < 0.1 || width > 3000)) { setError(tx(lang, 'Output width must be between 0.1 and 3,000 mm.', 'يجب أن يكون عرض الناتج بين ٠٫١ و٣٠٠٠ مم.')); return; }
    const input = source, inputKey = key;
    try {
      const active = new Worker(new URL('./image.worker.ts', import.meta.url)); worker.current = active; setBusy(true);
      const fail = (message: string) => { if (worker.current !== active) return; stop(); setError(message); };
      deadline.current = setTimeout(() => fail(tx(lang, 'Processing reached 30 seconds. Reduce the image size or increase noise removal.', 'بلغت المعالجة ٣٠ ثانية. قلّل حجم الصورة أو ارفع إزالة التشويش.')), 30000);
      active.onerror = () => fail(tx(lang, 'Image processing failed. Try a smaller image.', 'تعذّرت معالجة الصورة. جرّب صورة أصغر.'));
      active.onmessage = (event: MessageEvent<{ error?: string; vector?: ReturnType<typeof traceImage>; raster?: Raster }>) => {
        if (worker.current !== active) return;
        if (event.data.error) { fail(event.data.error); return; }
        stop();
        if (event.data.vector) {
          const traced = event.data.vector;
          if (!traced.contours.length) { setError(tx(lang, 'No dark shapes found. Adjust the threshold or invert the image.', 'لم يُعثر على أشكال داكنة. اضبط العتبة أو اعكس الصورة.')); return; }
          const scale = width / traced.width;
          setJob({ source: input, key: inputKey, drawing: { width, height: traced.height * scale, shapes: [{ id: 'traced-artwork', name: 'Traced artwork', contours: traced.contours.map(contour => ({ ...contour, points: contour.points.map(point => ({ x: point.x * scale, y: point.y * scale })) })) }] } });
        } else if (event.data.raster) setJob({ source: input, key: inputKey, raster: event.data.raster });
      };
      active.postMessage({ raster: input, options, tool, dither });
    } catch (cause) { stop(); setError(cause instanceof Error ? cause.message : 'Could not start image processing.'); }
  }
  function exportPng() {
    if (!output) return;
    try {
      const canvas = document.createElement('canvas'); canvas.width = output.width; canvas.height = output.height;
      const context = canvas.getContext('2d'); if (!context) throw new Error('Canvas is unavailable.');
      context.putImageData(new ImageData(new Uint8ClampedArray(output.data), output.width, output.height), 0, 0);
      canvas.toBlob(blob => { if (blob) download(blob, 'engraving-prepared.png', 'image/png'); else setError(tx(lang, 'PNG export failed. Try processing again.', 'تعذّر تصدير الصورة. حاول المعالجة مجدداً.')); }, 'image/png');
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'PNG export failed.'); }
  }
  return <><div className="workspace"><aside className="controls"><Section title={tx(lang, 'Your image', 'الصورة')} number="01">
    <label className="upload-zone"><input type="file" accept="image/png,image/jpeg,image/webp" aria-label={tx(lang, 'Import image', 'استيراد صورة')} disabled={busy || loading} onChange={event => { void load(event.target.files?.[0]); event.target.value = ''; }}/><span className="upload-icon"><Icon name="upload"/></span><strong>{loading ? tx(lang, 'Reading image…', 'جارٍ فتح الصورة…') : tx(lang, 'Import image', 'استيراد صورة')}</strong><span dir="ltr">PNG · JPEG · WebP · 10 MB</span></label>
    <div className="file-chip"><span className="file-symbol">IMG</span><div><strong>{filename}</strong><small>{source ? `${source.width} × ${source.height} px` : tx(lang, 'No image loaded', 'لم تُحمّل صورة')}</small></div></div>
    <button className="text-button" onClick={() => { stop(); ticket.current++; setLoading(false); setSource(sampleRaster()); setFilename('studio-symbol.png'); setJob(null); setNotice(''); setError(''); }}>{tx(lang, 'Use sample image', 'استخدم الصورة التجريبية')}</button>{notice && <p className="micro">{notice}</p>}
    </Section><fieldset disabled={busy || loading}><Section title={tx(lang, 'Image adjustments', 'تعديل الصورة')} number="02">
    <Range label={tx(lang, 'Threshold', 'العتبة')} value={options.threshold} min={0} max={255} onChange={value => adjust('threshold', value)}/><Range label={tx(lang, 'Brightness', 'السطوع')} value={options.brightness} min={-100} max={100} onChange={value => adjust('brightness', value)}/><Range label={tx(lang, 'Contrast', 'التباين')} value={options.contrast} min={-100} max={100} onChange={value => adjust('contrast', value)}/><Toggle label={tx(lang, 'Invert image', 'عكس الصورة')} value={options.invert} onChange={value => adjust('invert', value)}/><NumberField label={tx(lang, 'Remove specks up to', 'إزالة نقاط حتى')} value={options.noise} min={0} max={1000} unit="px²" onChange={value => adjust('noise', value)}/>
    </Section><Section title={tool === 'trace' ? tx(lang, 'Vector output', 'ناتج الفيكتور') : tx(lang, 'Engraving output', 'ناتج الحفر')} number="03">{tool === 'trace' ? <><NumberField label={tx(lang, 'Output width', 'عرض الناتج')} value={width} min={0.1} max={3000} step={0.1} unit="mm" onChange={setWidth}/><Range label={tx(lang, 'Simplify outlines', 'تبسيط الحدود')} value={options.simplify} min={0} max={3} step={0.1} onChange={value => adjust('simplify', value)}/><p className="micro">{tx(lang, 'Zero preserves pixel boundaries. Higher values approximate shapes; inspect thin details and holes before cutting.', 'الصفر يحافظ على حدود البكسل. القيم الأعلى تقرّب الأشكال؛ افحص التفاصيل الدقيقة والثقوب قبل القص.')}</p></> : <><Toggle label={tx(lang, 'Floyd–Steinberg dithering', 'تنقيط فلويد–شتاينبرغ')} value={dither} onChange={setDither}/><p className="micro">{tx(lang, 'Creates opaque black-and-white pixels. Dithering spreads tones into dots. Set physical size in your engraving software.', 'ينشئ بكسلات معتمة بالأبيض والأسود. يحوّل التنقيط الدرجات إلى نقاط. اضبط المقاس الفعلي في برنامج الحفر.')}</p></>}</Section></fieldset>
    <div className="control-action"><button className="button primary wide" disabled={!source || busy || loading} onClick={run}>{busy ? tx(lang, 'Processing…', 'جارٍ المعالجة…') : tool === 'trace' ? tx(lang, 'Trace image', 'تحويل الصورة') : tx(lang, 'Process image', 'معالجة الصورة')}<Icon name="arrow" size={18}/></button>{busy && <button className="text-button" onClick={stop}>{tx(lang, 'Cancel', 'إلغاء')}</button>}<ErrorNote error={error}/></div></aside>
    <div className="canvas-column"><div className="canvas-toolbar"><span role="status" className={`status-pill ${current ? 'ready' : ''}`}><i/>{current ? tool === 'trace' ? tx(lang, 'Vector ready', 'الفيكتور جاهز') : tx(lang, 'Image ready', 'الصورة جاهزة') : tx(lang, 'Ready to process', 'جاهز للمعالجة')}</span><span className="micro">{tx(lang, 'Local processing · original preserved', 'معالجة محلية · الأصل محفوظ')}</span></div>
    <div className="image-comparison"><RasterPreview raster={source} title={tx(lang, 'Original image', 'الصورة الأصلية')} lang={lang}/>{tool === 'trace' ? <VectorPreview drawing={drawing} lang={lang} filled caption={tx(lang, 'Traced outlines · millimetres', 'الحدود المحوّلة · ملليمتر')}/> : <RasterPreview raster={output} title={tx(lang, 'Prepared image', 'الصورة المجهّزة')} lang={lang}/>}</div>
    <div className="stats-row"><Stat label={tx(lang, 'Source pixels', 'بكسلات المصدر')} value={source ? `${source.width} × ${source.height}` : '—'}/>{tool === 'trace' ? <><Stat label={tx(lang, 'Closed contours', 'حدود مغلقة')} value={drawing?.shapes[0].contours.length ?? '—'}/><Stat label={tx(lang, 'Output size', 'أبعاد الناتج')} value={drawing ? `${drawing.width.toFixed(1)} × ${drawing.height.toFixed(1)}` : '—'} unit="mm"/></> : <Stat label={tx(lang, 'Output mode', 'نوع الناتج')} value={dither ? tx(lang, 'Dithered', 'منقّط') : tx(lang, 'Threshold', 'عتبة')}/>}</div>
    <div className="tip-card"><span className="tip-mark">i</span><p>{tool === 'trace' ? tx(lang, 'Start with a clear logo or silhouette. Transparent areas are placed on white before processing. Physical width scales the entire image, including its margins.', 'ابدأ بشعار واضح أو رسم أحادي اللون. تُوضع المساحات الشفافة على خلفية بيضاء قبل المعالجة. يشمل العرض الفعلي كامل الصورة وهوامشها.') : tx(lang, 'Use a small material sample to check contrast and dot detail. This image does not contain laser power or speed settings.', 'استخدم عينة صغيرة من الخامة لفحص التباين ودقة النقاط. لا تتضمن الصورة إعدادات قوة الليزر أو سرعته.')}</p></div></div></div>
    {tool === 'trace' ? <Exports drawing={drawing} lang={lang} name="traced-artwork" disabled={busy || loading} extra={drawing && <button className="text-button" disabled={busy || loading} onClick={() => onNest(drawing)}>{tx(lang, 'Use in nesting', 'استخدم في الترتيب')} ↗</button>}/> : <div className="export-bar"><div><strong>{tx(lang, 'Ready for your engraving workflow', 'جاهز لخطوات الحفر التالية')}</strong><span>{tx(lang, 'Black-and-white PNG · pixel dimensions preserved', 'صورة بالأبيض والأسود · أبعاد البكسل محفوظة')}</span></div><button className="button dark" disabled={!output || busy || loading} onClick={exportPng}><Icon name="download" size={16}/>{tx(lang, 'Export PNG', 'تصدير PNG')}</button></div>}
  </>;
}
