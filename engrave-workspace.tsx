'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { tx, type Language } from './copy';
import { ErrorNote, Icon, NumberField, Range, Section, Stat, Toggle } from './ui';
import { bytes, ImageDrop, IMAGE_TYPES, saveFile, usePastedImage } from './image-input';
import { defaultEngrave, materials, toBmp, type Dither, type EngraveOptions } from './engrave';
import { PngStream } from './upscale-core';

/* Engraving preparation. The picture is resampled to its real size at the
   machine's line resolution first, then adjusted and dithered at that
   resolution, and saved with its DPI so RDWorks, LightBurn or EZCAD place it
   at the size it was prepared for. */

const MAX_OUTPUT = 40_000_000;

const methods: { id: Dither; en: string; ar: string }[] = [
  { id: 'jarvis', en: 'Jarvis — smooth, photos', ar: 'Jarvis — ناعم للصور' },
  { id: 'stucki', en: 'Stucki — sharp, photos', ar: 'Stucki — حاد للصور' },
  { id: 'floyd', en: 'Floyd–Steinberg — fine detail', ar: 'Floyd–Steinberg — تفاصيل دقيقة' },
  { id: 'atkinson', en: 'Atkinson — high contrast', ar: 'Atkinson — تباين عالٍ' },
  { id: 'sierra', en: 'Sierra Lite — fast', ar: 'Sierra Lite — سريع' },
  { id: 'bayer', en: 'Ordered pattern', ar: 'نمط منتظم' },
  { id: 'halftone', en: 'Halftone dots', ar: 'نقاط هافتون' },
  { id: 'threshold', en: 'Black and white only', ar: 'أبيض وأسود فقط' },
  { id: 'grayscale', en: 'Greyscale (power by grey)', ar: 'تدرج رمادي (قوة حسب الرمادي)' },
];

type Source = { file: File; name: string; width: number; height: number; url: string };
type Output = { dots: Uint8Array; width: number; height: number; key: string };

export function EngraveWorkspace({ lang }: { lang: Language }) {
  const [source, setSource] = useState<Source | null>(null);
  const [material, setMaterial] = useState('wood');
  const [options, setOptions] = useState<EngraveOptions>({ ...defaultEngrave, ...materials[0].options });
  const [widthMm, setWidthMm] = useState(100);
  const [dpi, setDpi] = useState(254);
  const [output, setOutput] = useState<Output | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [zoom, setZoom] = useState<'fit' | '1'>('fit');
  const canvas = useRef<HTMLCanvasElement>(null);
  const worker = useRef<Worker | null>(null);

  const set = <K extends keyof EngraveOptions>(name: K) => (value: EngraveOptions[K]) => setOptions(o => ({ ...o, [name]: value }));
  useEffect(() => () => { worker.current?.terminate(); if (source) URL.revokeObjectURL(source.url); }, [source]);

  const load = useCallback(async (file: File) => {
    if (!IMAGE_TYPES.includes(file.type)) { setError(tx(lang, 'Choose a PNG, JPEG, WebP, GIF or BMP image.', 'اختر صورة PNG أو JPEG أو WebP أو GIF أو BMP.')); return; }
    try {
      const bitmap = await createImageBitmap(file);
      setSource({ file, name: file.name.replace(/\.[^.]+$/, '') || 'engraving', width: bitmap.width, height: bitmap.height, url: URL.createObjectURL(file) });
      bitmap.close();
      setError('');
    } catch { setError(tx(lang, 'This image could not be opened.', 'تعذّر فتح الصورة.')); }
  }, [lang]);
  const onPaste = useCallback((file: File) => { void load(file); }, [load]);
  usePastedImage(onPaste);

  const heightMm = source ? (widthMm * source.height) / source.width : 0;
  const outW = Math.max(1, Math.round((widthMm / 25.4) * dpi)), outH = Math.max(1, Math.round((heightMm / 25.4) * dpi));
  const tooBig = outW * outH > MAX_OUTPUT;
  const key = JSON.stringify({ options, outW, outH, file: source?.url });

  useEffect(() => {
    if (!source || tooBig || !(widthMm > 0) || !(dpi > 0)) return;
    const timer = setTimeout(async () => {
      try {
        setBusy(true);
        const bitmap = await createImageBitmap(source.file, { resizeWidth: outW, resizeHeight: outH, resizeQuality: 'high' });
        const scratch = new OffscreenCanvas(outW, outH);
        const context = scratch.getContext('2d');
        if (!context) throw new Error('Canvas is unavailable.');
        context.fillStyle = '#fff';
        context.fillRect(0, 0, outW, outH);
        context.drawImage(bitmap, 0, 0);
        bitmap.close();
        const data = context.getImageData(0, 0, outW, outH).data;
        worker.current?.terminate();
        const active = new Worker(new URL('./engrave.worker.ts', import.meta.url));
        worker.current = active;
        active.onmessage = (event: MessageEvent<{ dots?: Uint8Array; width: number; height: number; error?: string }>) => {
          if (worker.current !== active) return;
          active.terminate(); worker.current = null; setBusy(false);
          if (event.data.error || !event.data.dots) { setError(event.data.error ?? 'Failed.'); return; }
          setOutput({ dots: event.data.dots, width: event.data.width, height: event.data.height, key });
          setError('');
        };
        active.postMessage({ data, width: outW, height: outH, options }, [data.buffer]);
      } catch (cause) {
        setBusy(false);
        setError(cause instanceof Error ? cause.message : 'Engraving preparation failed.');
      }
    }, 250);
    return () => clearTimeout(timer);
  }, [source, options, outW, outH, tooBig, widthMm, dpi, key]);

  useEffect(() => {
    const node = canvas.current;
    if (!node || !output) return;
    node.width = output.width; node.height = output.height;
    const image = new ImageData(output.width, output.height);
    for (let i = 0; i < output.dots.length; i++) {
      const v = output.dots[i];
      image.data[i * 4] = image.data[i * 4 + 1] = image.data[i * 4 + 2] = v;
      image.data[i * 4 + 3] = 255;
    }
    node.getContext('2d')?.putImageData(image, 0, 0);
  }, [output]);

  const pickMaterial = (id: string) => {
    const preset = materials.find(m => m.id === id);
    if (!preset) return;
    setMaterial(id);
    setDpi(preset.dpi);
    setOptions(o => ({ ...o, ...preset.options }));
  };

  const savePng = async () => {
    if (!output) return;
    const png = new PngStream(output.width, output.height, 1, dpi);
    await png.addRows(output.dots);
    saveFile(await png.finish(), `${source?.name ?? 'engraving'}-${Math.round(widthMm)}mm-${dpi}dpi.png`, 'image/png');
  };
  const saveBmp = () => {
    if (!output) return;
    saveFile(toBmp(output.dots, output.width, output.height, dpi), `${source?.name ?? 'engraving'}-${Math.round(widthMm)}mm-${dpi}dpi.bmp`, 'image/bmp');
  };
  const fresh = output && output.key === key;

  return <>
    <div className="workspace">
      <aside className="controls">
        <Section title={tx(lang, 'Picture', 'الصورة')} number="01">
          <ImageDrop lang={lang} onFile={file => { void load(file); }} note="JPEG · PNG · Ctrl+V" />
          {source && <div className="file-chip"><span className="file-symbol">IMG</span><div><strong>{source.name}</strong><small dir="ltr">{source.width} × {source.height} px · {bytes(source.file.size)}</small></div></div>}
          <button className="text-button" onClick={async () => {
            const blob = await (await fetch('/images/coffee.jpg')).blob();
            void load(new File([blob], 'sample-photo.jpg', { type: 'image/jpeg' }));
          }}>{tx(lang, 'Use a sample photo', 'استخدم صورة تجريبية')}</button>
        </Section>
        <Section title={tx(lang, 'Material', 'الخامة')} number="02">
          <label className="field"><span>{tx(lang, 'Start from', 'ابدأ من')}</span>
            <select value={material} onChange={e => pickMaterial(e.target.value)}>
              {materials.map(m => <option key={m.id} value={m.id}>{tx(lang, m.en, m.ar)}</option>)}
            </select>
          </label>
        </Section>
        <Section title={tx(lang, 'Engraved size', 'مقاس الحفر')} number="03">
          <div className="field-pair"><NumberField label={tx(lang, 'Width', 'العرض')} value={widthMm} onChange={setWidthMm} min={1} max={2000} unit="mm" /><NumberField label="DPI" value={dpi} onChange={setDpi} min={50} max={1200} /></div>
          <div className="preset-row">{[254, 300, 318, 500, 600].map(v => <button key={v} className={dpi === v ? 'selected' : ''} onClick={() => setDpi(v)} dir="ltr">{v}</button>)}</div>
          <p className="micro" dir="ltr">{source ? `${widthMm} × ${heightMm.toFixed(1)} mm · ${outW} × ${outH} px · ${(25.4 / dpi).toFixed(3)} mm` : '—'}</p>
          {tooBig && <p className="ws-note">{tx(lang, 'That is more than 40 million pixels. Lower the DPI or the size.', 'هذا أكثر من ٤٠ مليون بكسل. خفّض الدقة أو المقاس.')}</p>}
        </Section>
        <Section title={tx(lang, 'Dots', 'النقاط')} number="04">
          <label className="field"><span>{tx(lang, 'Method', 'الطريقة')}</span>
            <select value={options.dither} onChange={e => set('dither')(e.target.value as Dither)}>
              {methods.map(m => <option key={m.id} value={m.id}>{tx(lang, m.en, m.ar)}</option>)}
            </select>
          </label>
          {options.dither === 'threshold' && <Range label={tx(lang, 'Threshold', 'العتبة')} value={options.threshold} min={1} max={254} onChange={set('threshold')} />}
          {options.dither === 'halftone' && <Range label={tx(lang, 'Dot cell (px)', 'خلية النقطة (بكسل)')} value={options.cell} min={3} max={20} onChange={set('cell')} />}
          <Range label={tx(lang, 'Brightness', 'السطوع')} value={options.brightness} min={-100} max={100} onChange={set('brightness')} />
          <Range label={tx(lang, 'Contrast', 'التباين')} value={options.contrast} min={-100} max={100} onChange={set('contrast')} />
          <Range label={tx(lang, 'Midtones (gamma × 100)', 'الدرجات الوسطى (غاما × ١٠٠)')} value={Math.round(options.gamma * 100)} min={30} max={300} onChange={v => set('gamma')(v / 100)} />
          <Range label={tx(lang, 'Sharpen', 'الحدّة')} value={options.sharpen} min={0} max={100} onChange={set('sharpen')} />
          <Toggle label={tx(lang, 'Invert (engrave the light parts)', 'اعكس (احفر الأجزاء الفاتحة)')} value={options.invert} onChange={set('invert')} />
          <Toggle label={tx(lang, 'Mirror (engrave from the back)', 'مرآة (للحفر من الخلف)')} value={options.mirror} onChange={set('mirror')} />
        </Section>
        <div className="control-action"><ErrorNote error={error} /></div>
      </aside>
      <div className="canvas-column">
        <div className="canvas-toolbar">
          <span className={`status-pill ${fresh ? 'ready' : ''}`}><i />{busy ? tx(lang, 'Preparing…', 'جارٍ التجهيز…') : fresh ? tx(lang, 'Ready to engrave', 'جاهز للحفر') : source ? tx(lang, 'Updating…', 'جارٍ التحديث…') : tx(lang, 'Import a picture', 'استورد صورة')}</span>
          <div className="vz-tabs">
            <button className={zoom === 'fit' ? 'selected' : ''} onClick={() => setZoom('fit')}>{tx(lang, 'Fit', 'ملاءمة')}</button>
            <button className={zoom === '1' ? 'selected' : ''} onClick={() => setZoom('1')} dir="ltr">1:1</button>
          </div>
        </div>
        <div className="preview-surface">
          <div className="preview-top"><span><Icon name="engrave" size={15} /> {tx(lang, 'WHAT THE LASER BURNS', 'ما يحفره الليزر')}</span><b dir="ltr">{output ? `${output.width} × ${output.height} px` : '—'}</b></div>
          <div className="up-stage">
            {source ? <canvas ref={canvas} className={`eg-canvas ${zoom === '1' ? 'actual' : ''}`} aria-label={tx(lang, 'Prepared engraving', 'الحفر المجهّز')} role="img" />
              : <div className="empty-preview"><Icon name="engrave" size={42} /><p>{tx(lang, 'Import, drop or paste a photo', 'استورد صورة أو اسحبها أو الصقها')}</p></div>}
          </div>
          <div className="preview-bottom"><span><i />{tx(lang, 'Black = burnt dot · 1:1 shows every laser line', 'الأسود = نقطة محروقة · ١:١ يعرض كل خط ليزر')}</span></div>
        </div>
        <div className="stats-row">
          <Stat label={tx(lang, 'Pixels', 'البكسلات')} value={source ? `${outW} × ${outH}` : '—'} />
          <Stat label={tx(lang, 'Line interval', 'تباعد الأسطر')} value={(25.4 / dpi).toFixed(3)} unit="mm" />
          <Stat label={tx(lang, 'Size', 'المقاس')} value={source ? `${widthMm} × ${heightMm.toFixed(0)}` : '—'} unit="mm" />
        </div>
        <div className="tip-card"><span className="tip-mark">i</span><p>{tx(lang, 'Set the same line interval in RDWorks, LightBurn or EZCAD as shown here, and engrave at 100% of the file size. Presets are starting points: check them with the power and speed test card.', 'اضبط تباعد الأسطر نفسه المعروض هنا في RDWorks أو LightBurn أو EZCAD، واحفر بمقاس الملف ١٠٠٪. الإعدادات الجاهزة نقاط بداية: تأكد منها ببطاقة اختبار القوة والسرعة.')}</p></div>
      </div>
    </div>
    <div className="export-bar">
      <div><strong>{tx(lang, 'Ready for your engraving software', 'جاهز لبرنامج الحفر')}</strong><span dir="ltr">BMP → RDWorks / EZCAD · PNG → LightBurn · {dpi} DPI</span></div>
      <div className="export-actions">
        <button className="button secondary" disabled={!fresh} onClick={() => void savePng()}><Icon name="download" size={16} />PNG</button>
        <button className="button dark" disabled={!fresh} onClick={saveBmp}><Icon name="download" size={16} />BMP</button>
      </div>
    </div>
  </>;
}
