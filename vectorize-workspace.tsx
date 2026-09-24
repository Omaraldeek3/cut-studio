'use client';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Drawing } from './types';
import type { Raster } from './image';
import { tx, type Language } from './copy';
import { ErrorNote, Icon, NumberField, Range, Section, Stat, Toggle } from './ui';
import { toDxf } from './export';
import { defaultVectorize, pathData, type VectorizeOptions, type VectorResult } from './vectorize';
import { colorPdf, colorSvg, outlineSvg, outputHeight, resultToDrawing } from './vector-export';
import { decodeImage, ImageDrop, IMAGE_TYPES, saveFile, usePastedImage } from './image-input';

/* The image-to-vector tool. It re-traces on its own a moment after any
   setting changes, so every slider shows its effect without a button press,
   and it runs in a worker so the page stays responsive while it works. */

const WORKING_PIXELS = 2_500_000;

/** A small flat illustration drawn in code, so the tool opens with something
 *  that shows what colour tracing does. Edges are anti-aliased by sampling
 *  each pixel nine times, like a real exported image. */
function sampleArtwork(): Raster {
  const width = 360, height = 260, data = new Uint8ClampedArray(width * height * 4);
  const shade = (x: number, y: number): [number, number, number] => {
    const sun = Math.hypot(x - 250, y - 88);
    if (sun < 46) return sun < 30 ? [255, 196, 45] : [255, 140, 40];
    const hill = 190 + 22 * Math.sin(x / 38) - 0.08 * x;
    if (y > hill + 26) return [38, 70, 60];
    if (y > hill) return [86, 150, 84];
    const tent = Math.abs(x - 110) < (y - 70) * 0.62 && y > 70 && y < 200;
    if (tent) return Math.abs(x - 110) < (y - 70) * 0.2 ? [40, 44, 70] : [214, 64, 66];
    return [236, 246, 250];
  };
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    let r = 0, g = 0, b = 0;
    for (let sy = 0; sy < 3; sy++) for (let sx = 0; sx < 3; sx++) {
      const [cr, cg, cb] = shade(x + (sx + 0.5) / 3, y + (sy + 0.5) / 3);
      r += cr; g += cg; b += cb;
    }
    const i = (y * width + x) * 4;
    data[i] = r / 9; data[i + 1] = g / 9; data[i + 2] = b / 9; data[i + 3] = 255;
  }
  return { width, height, data };
}

type Source = { raster: Raster; name: string; naturalWidth: number; naturalHeight: number; scaled: boolean };
type Job = { source: Source; key: string; result: VectorResult; elapsed: number };

function RasterCanvas({ raster, className }: { raster: Raster; className?: string }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const node = canvas.current;
    if (!node) return;
    node.width = raster.width;
    node.height = raster.height;
    node.getContext('2d')?.putImageData(new ImageData(new Uint8ClampedArray(raster.data), raster.width, raster.height), 0, 0);
  }, [raster]);
  return <canvas ref={canvas} className={className} aria-hidden="true" />;
}

function VectorArt({ result, outline }: { result: VectorResult; outline: boolean }) {
  return (
    <svg className="vz-art" viewBox={`0 0 ${result.width} ${result.height}`} role="img" aria-label="Traced vector">
      {outline && <rect width={result.width} height={result.height} fill="#fff" />}
      {result.layers.map((layer, i) => (
        <path key={i} fill={layer.color} fillRule="evenodd" d={layer.paths.map(p => pathData(p)).join('')} />
      ))}
    </svg>
  );
}

export function VectorizeWorkspace({ lang, onNest }: { lang: Language; onNest: (drawing: Drawing) => void }) {
  const [source, setSource] = useState<Source>(() => ({ raster: sampleArtwork(), name: 'sample', naturalWidth: 360, naturalHeight: 260, scaled: false }));
  const [options, setOptions] = useState<VectorizeOptions>({ ...defaultVectorize, colors: 12 });
  const [width, setWidth] = useState(300);
  const [job, setJob] = useState<Job | null>(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [view, setView] = useState<'vector' | 'original' | 'compare'>('vector');
  const [zoom, setZoom] = useState(1);
  const [split, setSplit] = useState(50);
  const worker = useRef<Worker | null>(null);

  const key = JSON.stringify(options);
  const result = job && job.source === source ? job.result : null;
  const stale = !job || job.source !== source || job.key !== key;
  const outline = options.mode === 'outline';
  const set = <K extends keyof VectorizeOptions>(name: K) => (value: VectorizeOptions[K]) => setOptions(o => ({ ...o, [name]: value }));

  const load = useCallback(async (file: File) => {
    if (!IMAGE_TYPES.includes(file.type)) { setError(tx(lang, 'Choose a PNG, JPEG, WebP, GIF or BMP image.', 'اختر صورة PNG أو JPEG أو WebP أو GIF أو BMP.')); return; }
    if (file.size > 40 * 1024 * 1024) { setError(tx(lang, 'Choose an image smaller than 40 MB.', 'اختر صورة أصغر من ٤٠ ميغابايت.')); return; }
    setLoading(true);
    setError('');
    try {
      const decoded = await decodeImage(file, WORKING_PIXELS);
      setSource({ ...decoded, name: file.name.replace(/\.[^.]+$/, '') || 'image' });
      setOptions(o => ({ ...o, hidden: [] }));
      setView('vector');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Image import failed.');
    } finally {
      setLoading(false);
    }
  }, [lang]);
  const onPaste = useCallback((file: File) => { void load(file); }, [load]);
  usePastedImage(onPaste);

  // Trace a moment after the last change, cancelling any trace still running.
  useEffect(() => {
    const input = source, inputKey = key, inputOptions = options;
    const timer = setTimeout(() => {
      worker.current?.terminate();
      const active = new Worker(new URL('./vectorize.worker.ts', import.meta.url));
      worker.current = active;
      setBusy(true);
      setProgress(0);
      setError('');
      active.onmessage = (event: MessageEvent<{ error?: string; fraction?: number; result?: VectorResult; elapsed?: number }>) => {
        if (worker.current !== active) return;
        const message = event.data;
        if (message.fraction !== undefined && !message.result) { setProgress(message.fraction); return; }
        active.terminate();
        worker.current = null;
        setBusy(false);
        if (message.error) setError(message.error);
        else if (message.result) setJob({ source: input, key: inputKey, result: message.result, elapsed: message.elapsed ?? 0 });
      };
      active.onerror = () => {
        if (worker.current !== active) return;
        active.terminate();
        worker.current = null;
        setBusy(false);
        setError(tx(lang, 'Vectorizing failed. Try a smaller image or fewer colours.', 'تعذّر التحويل. جرّب صورة أصغر أو ألواناً أقل.'));
      };
      active.postMessage({ raster: input.raster, options: inputOptions });
    }, 280);
    return () => clearTimeout(timer);
  }, [source, key, options, lang]);

  useEffect(() => () => worker.current?.terminate(), []);

  const drawing = useMemo(() => (result ? resultToDrawing(result, width) : null), [result, width]);
  const heightMm = result ? outputHeight(result, width) : (source.raster.height / source.raster.width) * width;
  const base = `${source.name}-${outline ? 'outline' : `${result?.layers.length ?? 0}-colours`}`;
  const validWidth = Number.isFinite(width) && width >= 1 && width <= 20000;
  // Exports wait for the trace that matches the current settings.
  const ready = !!result && !stale && !busy && validWidth;

  const toggleColour = (color: string) =>
    setOptions(o => ({ ...o, hidden: o.hidden.includes(color) ? o.hidden.filter(c => c !== color) : [...o.hidden, color] }));

  const whiteBackground = result?.palette.find(p => {
    const r = parseInt(p.color.slice(1, 3), 16), g = parseInt(p.color.slice(3, 5), 16), b = parseInt(p.color.slice(5, 7), 16);
    return Math.min(r, g, b) > 232 && p.area > 0.15;
  });

  return <>
    <div className="workspace vz-workspace">
      <aside className="controls">
        <Section title={tx(lang, 'Image', 'الصورة')} number="01">
          <ImageDrop lang={lang} onFile={file => { void load(file); }} busy={loading} note="PNG · JPEG · WebP · Ctrl+V" />
          <div className="file-chip"><span className="file-symbol">IMG</span><div><strong>{source.name === 'sample' ? tx(lang, 'Sample illustration', 'رسم تجريبي') : source.name}</strong><small dir="ltr">{source.naturalWidth} × {source.naturalHeight} px</small></div></div>
          {source.scaled && <p className="micro">{tx(lang, `Traced at ${source.raster.width} × ${source.raster.height} px. Tracing at a higher resolution adds nodes, not detail; vectors enlarge without loss.`, `يُحوَّل بدقة ${source.raster.width} × ${source.raster.height} بكسل. الدقة الأعلى تضيف نقاطاً لا تفاصيل؛ الفيكتور يُكبَّر دون فقد.`)}</p>}
          {source.name !== 'sample' && <button className="text-button" onClick={() => setSource({ raster: sampleArtwork(), name: 'sample', naturalWidth: 360, naturalHeight: 260, scaled: false })}>{tx(lang, 'Use the sample illustration', 'استخدم الرسم التجريبي')}</button>}
        </Section>

        <Section title={tx(lang, 'What is it for?', 'لأي استخدام؟')} number="02">
          <div className="vz-modes" role="radiogroup" aria-label={tx(lang, 'Mode', 'الوضع')}>
            <button role="radio" aria-checked={!outline} className={!outline ? 'selected' : ''} onClick={() => set('mode')('color')}>
              <b>{tx(lang, 'Colour', 'ملوّن')}</b><span>{tx(lang, 'Print & enlarge', 'للطباعة والتكبير')}</span>
            </button>
            <button role="radio" aria-checked={outline} className={outline ? 'selected' : ''} onClick={() => set('mode')('outline')}>
              <b>{tx(lang, 'Outline', 'حدود')}</b><span>{tx(lang, 'Laser & plotter', 'للّيزر والبلوتر')}</span>
            </button>
          </div>
          {!outline ? <>
            <Range label={tx(lang, 'Colours', 'عدد الألوان')} value={options.colors} min={2} max={32} onChange={set('colors')} />
            <label className="field"><span>{tx(lang, 'Shapes', 'الأشكال')}</span>
              <select value={options.layering} onChange={e => set('layering')(e.target.value as VectorizeOptions['layering'])}>
                <option value="stacked">{tx(lang, 'Stacked, no gaps (print)', 'متراكبة بلا فراغات (طباعة)')}</option>
                <option value="cutout">{tx(lang, 'Cut-out, no overlaps (vinyl)', 'مقصوصة بلا تداخل (فينيل)')}</option>
              </select>
            </label>
            <Toggle label={tx(lang, 'Clean JPEG noise', 'تنظيف تشويش JPEG')} value={options.denoise} onChange={set('denoise')} />
          </> : <>
            <Toggle label={tx(lang, 'Automatic threshold', 'عتبة تلقائية')} value={options.threshold === -1} onChange={auto => set('threshold')(auto ? -1 : (result?.threshold ?? 128))} />
            {options.threshold !== -1 && <Range label={tx(lang, 'Threshold', 'العتبة')} value={options.threshold} min={1} max={254} onChange={set('threshold')} />}
            <Toggle label={tx(lang, 'Trace the light parts', 'تتبّع الأجزاء الفاتحة')} value={options.invert} onChange={set('invert')} />
            <Toggle label={tx(lang, 'Clean JPEG noise', 'تنظيف تشويش JPEG')} value={options.denoise} onChange={set('denoise')} />
          </>}
          <Toggle label={tx(lang, 'Keep transparent areas empty', 'اترك المناطق الشفافة فارغة')} value={options.transparent} onChange={set('transparent')} />
        </Section>

        <Section title={tx(lang, 'Detail and curves', 'التفاصيل والمنحنيات')} number="03">
          <Range label={tx(lang, 'Detail', 'التفاصيل')} value={options.detail} min={0} max={100} onChange={set('detail')} />
          <Range label={tx(lang, 'Smoothing', 'النعومة')} value={options.smoothing} min={0} max={100} onChange={set('smoothing')} />
          <Range label={tx(lang, 'Sharp corners', 'الزوايا الحادة')} value={options.corners} min={0} max={100} onChange={set('corners')} />
          <p className="micro">{tx(lang, 'Lower detail removes specks; more smoothing gives fewer, rounder curves; more corners keeps logos and letters crisp.', 'تفاصيل أقل تزيل النقاط الصغيرة؛ نعومة أكثر تعطي منحنيات أقل وأنعم؛ زوايا أكثر تحافظ على حدّة الشعارات والحروف.')}</p>
        </Section>

        <Section title={tx(lang, 'Output size', 'مقاس الناتج')} number="04">
          <NumberField label={tx(lang, 'Width', 'العرض')} value={width} onChange={setWidth} min={1} max={20000} step={1} unit="mm" />
          <p className="micro" dir="ltr">{validWidth ? `${width} × ${heightMm.toFixed(1)} mm` : '—'}</p>
        </Section>
        <div className="control-action"><ErrorNote error={error} /></div>
      </aside>

      <div className="canvas-column">
        <div className="canvas-toolbar">
          <span role="status" className={`status-pill ${result && !stale ? 'ready' : ''}`}><i />
            {busy ? `${tx(lang, 'Tracing', 'جارٍ التحويل')} ${Math.round(progress * 100)}%` : result && !stale ? tx(lang, 'Vector ready', 'الفيكتور جاهز') : tx(lang, 'Updating…', 'جارٍ التحديث…')}
          </span>
          <div className="vz-tabs" role="tablist" aria-label={tx(lang, 'View', 'العرض')}>
            {(['vector', 'compare', 'original'] as const).map(v => (
              <button key={v} role="tab" aria-selected={view === v} className={view === v ? 'selected' : ''} onClick={() => setView(v)}>
                {v === 'vector' ? tx(lang, 'Vector', 'الفيكتور') : v === 'compare' ? tx(lang, 'Compare', 'مقارنة') : tx(lang, 'Original', 'الأصل')}
              </button>
            ))}
          </div>
          <div className="vz-tabs" aria-label={tx(lang, 'Zoom', 'التكبير')}>
            {[1, 2, 4].map(z => <button key={z} className={zoom === z ? 'selected' : ''} onClick={() => setZoom(z)} dir="ltr">{z}×</button>)}
          </div>
        </div>

        <div className="preview-surface">
          <div className="preview-top"><span><Icon name="trace" size={15} /> {tx(lang, 'ARTBOARD', 'لوحة العمل')}</span><b dir="ltr">{validWidth ? `${width} × ${heightMm.toFixed(1)} mm` : '—'}</b></div>
          <div className={`vz-stage ${busy ? 'is-busy' : ''}`}>
            <div className="vz-frame" style={{ '--zoom': zoom, '--ratio': source.raster.width / source.raster.height } as React.CSSProperties}>
              {(view === 'original' || view === 'compare' || !result) && <RasterCanvas raster={source.raster} className="vz-original" />}
              {result && view !== 'original' && (
                <div className="vz-vector" style={view === 'compare' ? { clipPath: `inset(0 0 0 ${split}%)` } : undefined}>
                  <VectorArt result={result} outline={outline} />
                </div>
              )}
              {view === 'compare' && result && <span className="vz-divider" style={{ left: `${split}%` }} aria-hidden="true" />}
            </div>
          </div>
          {view === 'compare' && <div className="vz-split"><input type="range" min={0} max={100} value={split} onChange={e => setSplit(+e.target.value)} aria-label={tx(lang, 'Compare position', 'موضع المقارنة')} /></div>}
          <div className="preview-bottom"><span><i />{outline ? tx(lang, 'Filled shapes = what the laser cuts out', 'الأشكال المعبأة = ما يقصه الليزر') : tx(lang, 'Smooth vector curves · enlarges without loss', 'منحنيات فيكتور ناعمة · تُكبَّر دون فقد')}</span><span dir="ltr">{result ? `${result.width} × ${result.height} px traced` : ''}</span></div>
        </div>

        {result && !outline && (
          <div className="vz-palette" aria-label={tx(lang, 'Colours', 'الألوان')}>
            <div className="vz-palette-head">
              <strong>{tx(lang, 'Colours', 'الألوان')}</strong>
              <span className="micro">{tx(lang, 'Click a colour to leave it out', 'اضغط على لون لإخفائه')}</span>
              {whiteBackground && !whiteBackground.hidden && <button className="text-button" onClick={() => toggleColour(whiteBackground.color)}>{tx(lang, 'Remove white background', 'إزالة الخلفية البيضاء')}</button>}
            </div>
            <div className="vz-swatches">
              {result.palette.map(entry => (
                <button key={entry.color} className="vz-swatch" aria-pressed={!entry.hidden} onClick={() => toggleColour(entry.color)} title={entry.color}>
                  <i style={{ background: entry.color }} />
                  <span dir="ltr">{entry.color}</span>
                  <small dir="ltr">{(entry.area * 100).toFixed(1)}%</small>
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="stats-row">
          <Stat label={tx(lang, 'Colours', 'الألوان')} value={result ? result.layers.length : '—'} />
          <Stat label={tx(lang, 'Shapes', 'الأشكال')} value={result ? result.layers.reduce((n, l) => n + l.paths.length, 0) : '—'} />
          <Stat label={tx(lang, 'Curve nodes', 'نقاط المنحنيات')} value={result ? result.nodes : '—'} />
          <Stat label={tx(lang, 'Time', 'الزمن')} value={job ? (job.elapsed / 1000).toFixed(1) : '—'} unit="s" />
        </div>
        <div className="tip-card"><span className="tip-mark">i</span><p>{outline
          ? tx(lang, 'For cutting, use DXF in RDWorks or the cut-line SVG in CorelDRAW. Use “Arrange on sheet” to nest many copies.', 'للقص استخدم DXF في RDWorks أو ملف خطوط القص SVG في CorelDRAW. واستخدم «ترتيب على اللوح» لترتيب نسخ كثيرة.')
          : tx(lang, 'Logos and cartoons trace best. For photos, raise the colours to 16–32. PDF and SVG keep real curves and open in CorelDRAW, Illustrator and RIP software at the size you set.', 'الشعارات والرسومات تتحوّل بأفضل شكل. للصور الفوتوغرافية ارفع الألوان إلى ١٦–٣٢. ملفات PDF و SVG تحفظ المنحنيات الحقيقية وتفتح في CorelDRAW و Illustrator وبرامج الطباعة بالمقاس الذي حددته.')}</p></div>
      </div>
    </div>

    <div className="export-bar">
      <div><strong>{tx(lang, 'Ready for your next step', 'جاهز للخطوة التالية')}</strong><span dir="ltr">SVG · PDF → CorelDRAW / Illustrator / RIP · DXF → RDWorks</span></div>
      <div className="export-actions">
        <button className="text-button" disabled={!ready} onClick={() => { if (drawing) onNest(drawing); }}>{tx(lang, 'Arrange on sheet', 'ترتيب على اللوح')} ↗</button>
        <button className="button secondary" disabled={!ready} onClick={() => result && saveFile(outlineSvg(result, width), `${base}-cut-lines.svg`, 'image/svg+xml')}><Icon name="download" size={16} />{tx(lang, 'Cut lines SVG', 'خطوط قص SVG')}</button>
        <button className="button secondary" disabled={!ready} onClick={() => drawing && saveFile(toDxf(drawing), `${base}.dxf`, 'application/dxf')}><Icon name="download" size={16} />DXF</button>
        <button className="button secondary" disabled={!ready} onClick={() => result && saveFile(colorPdf(result, width), `${base}.pdf`, 'application/pdf')}><Icon name="download" size={16} />PDF</button>
        <button className="button dark" disabled={!ready} onClick={() => result && saveFile(colorSvg(result, width), `${base}.svg`, 'image/svg+xml')}><Icon name="download" size={16} />{tx(lang, 'Export SVG', 'تصدير SVG')}</button>
      </div>
    </div>
  </>;
}
