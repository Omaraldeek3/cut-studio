'use client';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import type { Raster } from './image';
import { slugs, tx, type Language } from './copy';
import { ErrorNote, Help, Icon, NumberField, Range, Section, Stat, Toggle } from './ui';
import { bytes, decodeImage, ImageDrop, IMAGE_TYPES, saveFile, usePastedImage } from './image-input';
import { planPrint } from './upscale-core';
import type { UpscaleModel, WorkerRequest } from './upscale.worker';

/* The upscaler. It enlarges a picture with Real-ESRGAN, an AI model that
   draws in the detail a plain enlargement can only blur, and writes a JPEG or
   PNG that already carries its print resolution. A planner answers the first
   question a large print raises: how many pixels does this size really need
   from the distance people will stand? */

const MAX_INPUT = 30_000_000;
const MAX_SIDE = 65535;

type Probe = { tile: { x: number; y: number; width: number; height: number }; width: number; height: number; data: Uint8ClampedArray; seconds: number };
type Result = { url: string; blob: Blob; width: number; height: number; seconds: number; format: 'jpeg' | 'png' };
type Source = { raster: Raster; name: string; url: string };

const models: { id: UpscaleModel; en: [string, string]; ar: [string, string] }[] = [
  { id: 'general', en: ['Photo', 'People, products, places'], ar: ['صورة فوتوغرافية', 'أشخاص ومنتجات وأماكن'] },
  { id: 'general-wdn', en: ['Low-quality photo', 'Heavy JPEG noise, WhatsApp images'], ar: ['صورة ضعيفة الجودة', 'تشويش JPEG قوي، صور واتساب'] },
  { id: 'graphics', en: ['Graphics & logos', 'Flat colour, cartoons, text'], ar: ['رسومات وشعارات', 'ألوان مسطحة، رسوم، نصوص'] },
];

const distances = [
  { m: 1, en: 'In hand · 1 m', ar: 'في اليد · ١ م' },
  { m: 3, en: 'Indoor sign · 3 m', ar: 'لافتة داخلية · ٣ م' },
  { m: 5, en: 'Shop front · 5 m', ar: 'واجهة محل · ٥ م' },
  { m: 12, en: 'Billboard · 12 m', ar: 'لوحة طرق · ١٢ م' },
];

/** Jobs a print shop gets every week, each setting the picture type, the
 *  print width and the distance in one click. */
const jobs: { en: string; ar: string; model: UpscaleModel; width: number; distance: number }[] = [
  { en: 'Shop front from a WhatsApp photo', ar: 'واجهة محل من صورة واتساب', model: 'general-wdn', width: 400, distance: 5 },
  { en: 'A2 poster from a phone photo', ar: 'بوستر A2 من صورة جوال', model: 'general', width: 42, distance: 1 },
  { en: 'Roll-up with a small logo', ar: 'رول أب بشعار صغير', model: 'graphics', width: 85, distance: 3 },
  { en: 'Billboard', ar: 'لوحة طرق', model: 'general', width: 600, distance: 12 },
];

function CropCanvas({ raster, crop, scale, smooth, label }: { raster: Raster; crop: { x: number; y: number; width: number; height: number }; scale: number; smooth: boolean; label: string }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const node = canvas.current;
    if (!node) return;
    const small = document.createElement('canvas');
    small.width = crop.width; small.height = crop.height;
    const piece = new ImageData(crop.width, crop.height);
    for (let y = 0; y < crop.height; y++) {
      const from = ((crop.y + y) * raster.width + crop.x) * 4;
      piece.data.set(raster.data.subarray(from, from + crop.width * 4), y * crop.width * 4);
    }
    small.getContext('2d')?.putImageData(piece, 0, 0);
    node.width = crop.width * scale; node.height = crop.height * scale;
    const context = node.getContext('2d');
    if (!context) return;
    context.imageSmoothingEnabled = smooth;
    context.imageSmoothingQuality = 'high';
    context.drawImage(small, 0, 0, node.width, node.height);
  }, [raster, crop, scale, smooth]);
  return <canvas ref={canvas} className="up-crop" role="img" aria-label={label} />;
}

function PixelsCanvas({ width, height, data, label }: { width: number; height: number; data: Uint8ClampedArray; label: string }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const node = canvas.current;
    if (!node) return;
    node.width = width; node.height = height;
    node.getContext('2d')?.putImageData(new ImageData(new Uint8ClampedArray(data), width, height), 0, 0);
  }, [width, height, data]);
  return <canvas ref={canvas} className="up-crop" role="img" aria-label={label} />;
}

/** The original and the result on top of each other, split where the slider is. */
function Compare({ url, preview, lang }: { url: string; preview: { width: number; height: number; data: Uint8ClampedArray }; lang: Language }) {
  const [split, setSplit] = useState(50);
  return <div className="up-compare-slider" style={{ aspectRatio: `${preview.width} / ${preview.height}`, ['--ar' as string]: preview.width / preview.height }}>
    {/* eslint-disable-next-line @next/next/no-img-element -- a local object URL, not an optimisable asset */}
    <img src={url} alt={tx(lang, 'Original picture', 'الصورة الأصلية')} />
    <div className="up-after" style={{ clipPath: `inset(0 0 0 ${split}%)` }}><PixelsCanvas width={preview.width} height={preview.height} data={preview.data} label={tx(lang, 'Enlarged result', 'الناتج المكبّر')} /></div>
    <span className="up-divider" style={{ left: `${split}%` }} aria-hidden="true" />
    <span className="up-tag up-tag-before">{tx(lang, 'Before', 'قبل')}</span><span className="up-tag up-tag-after">{tx(lang, 'After', 'بعد')}</span>
    <input type="range" min={0} max={100} value={split} onChange={e => setSplit(+e.target.value)} aria-label={tx(lang, 'Move to compare before and after', 'حرّك للمقارنة بين قبل وبعد')} />
  </div>;
}

export function UpscaleWorkspace({ lang }: { lang: Language }) {
  const [source, setSource] = useState<Source | null>(null);
  const [loading, setLoading] = useState(false);
  const [model, setModel] = useState<UpscaleModel>('general');
  const [gpu, setGpu] = useState(true);
  const [printWidth, setPrintWidth] = useState(600);
  const [distance, setDistance] = useState(5);
  const [scale, setScale] = useState(4);
  const [format, setFormat] = useState<'jpeg' | 'png'>('jpeg');
  const [quality, setQuality] = useState(95);
  const [sharpen, setSharpen] = useState(0);
  const [backend, setBackend] = useState<'webgpu' | 'wasm' | ''>('');
  const [probe, setProbe] = useState<Probe | null>(null);
  const [probing, setProbing] = useState(false);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number; elapsed: number } | null>(null);
  const [preview, setPreview] = useState<{ width: number; height: number; data: Uint8ClampedArray } | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState('');
  const worker = useRef<Worker | null>(null);
  const modelKey = useRef('');

  const reset = useCallback(() => {
    worker.current?.terminate();
    worker.current = null;
    modelKey.current = '';
  }, []);

  useEffect(() => () => reset(), [reset]);
  useEffect(() => () => { if (result) URL.revokeObjectURL(result.url); }, [result]);
  useEffect(() => () => { if (source) URL.revokeObjectURL(source.url); }, [source]);

  const load = useCallback(async (file: File) => {
    if (!IMAGE_TYPES.includes(file.type)) { setError(tx(lang, 'Choose a PNG, JPEG, WebP, GIF or BMP image.', 'اختر صورة PNG أو JPEG أو WebP أو GIF أو BMP.')); return; }
    setLoading(true); setError(''); setProbe(null); setPreview(null); setResult(null); setProgress(null);
    try {
      const decoded = await decodeImage(file, MAX_INPUT);
      reset();
      setSource({ raster: decoded.raster, name: file.name.replace(/\.[^.]+$/, '') || 'image', url: URL.createObjectURL(file) });
      if (decoded.scaled) setError(tx(lang, `The image was reduced to ${decoded.raster.width} × ${decoded.raster.height} px, the most this tool enlarges at once.`, `صُغّرت الصورة إلى ${decoded.raster.width} × ${decoded.raster.height} بكسل، وهو أقصى ما تكبّره الأداة دفعة واحدة.`));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Image import failed.');
    } finally {
      setLoading(false);
    }
  }, [lang, reset]);
  const onPaste = useCallback((file: File) => { void load(file); }, [load]);
  usePastedImage(onPaste);

  /** The worker, created on first use, holding the current picture. */
  const ensureWorker = useCallback(() => {
    if (worker.current || !source) return worker.current;
    const active = new Worker(new URL('./upscale.worker.ts', import.meta.url), { type: 'module' });
    worker.current = active;
    const data = source.raster.data.slice();
    active.postMessage({ type: 'source', width: source.raster.width, height: source.raster.height, data } satisfies WorkerRequest, [data.buffer]);
    return active;
  }, [source]);

  const send = useCallback((request: WorkerRequest, onMessage: (message: { type: string; [key: string]: unknown }) => boolean) => {
    const active = ensureWorker();
    if (!active) return;
    const key = `${model}:${gpu}`;
    if (modelKey.current !== key) {
      active.postMessage({ type: 'model', model, gpu } satisfies WorkerRequest);
      modelKey.current = key;
    }
    active.onmessage = event => {
      const message = event.data as { type: string; message?: string; backend?: 'webgpu' | 'wasm' };
      if (message.backend) setBackend(message.backend);
      if (message.type === 'error') {
        setError(message.message ?? 'Upscaling failed.');
        setRunning(false); setProbing(false);
        modelKey.current = '';
        return;
      }
      if (message.type === 'source' || message.type === 'model') return;
      if (onMessage(message)) active.onmessage = null;
    };
    active.postMessage(request);
  }, [ensureWorker, model, gpu]);

  const plan = useMemo(() => {
    if (!source || !(printWidth > 0) || !(distance > 0)) return null;
    try { return planPrint(source.raster.width, source.raster.height, printWidth, distance); } catch { return null; }
  }, [source, printWidth, distance]);

  const outW = source ? Math.round(source.raster.width * scale) : 0;
  const outH = source ? Math.round(source.raster.height * scale) : 0;
  const dpi = outW && printWidth > 0 ? outW / (printWidth / 2.54) : 0;
  const validScale = Number.isFinite(scale) && scale >= 1 && scale <= 8;
  const tooBig = outW > MAX_SIDE || outH > MAX_SIDE;

  const runProbe = (x: number, y: number) => {
    if (!source) return;
    setProbing(true); setError('');
    send({ type: 'probe', x, y }, message => {
      if (message.type !== 'probe') return false;
      setProbe(message as unknown as Probe);
      setProbing(false);
      return true;
    });
  };

  const start = () => {
    if (!source || !validScale || tooBig) return;
    setRunning(true); setError(''); setResult(null); setProgress({ done: 0, total: 1, elapsed: 0 }); setPreview(null);
    send({ type: 'run', width: outW, height: outH, format, quality, dpi, previewWidth: 1400, sharpen }, message => {
      if (message.type === 'progress') { setProgress(message as unknown as { done: number; total: number; elapsed: number }); return false; }
      if (message.type === 'preview') { setPreview(message as unknown as { width: number; height: number; data: Uint8ClampedArray }); return false; }
      if (message.type !== 'done') return false;
      const done = message as unknown as { blob: Blob; width: number; height: number; seconds: number };
      setResult({ url: URL.createObjectURL(done.blob), blob: done.blob, width: done.width, height: done.height, seconds: done.seconds, format });
      setRunning(false);
      return true;
    });
  };

  const cancel = () => { reset(); setRunning(false); setProbing(false); setProgress(null); };

  /** One click for a common job: the picture type, the size and the distance,
   *  and, once a picture is in, the enlargement the planner works out. */
  const applyJob = (job: typeof jobs[number]) => {
    setModel(job.model); setProbe(null); setPrintWidth(job.width); setDistance(job.distance);
    if (source) setScale(Math.min(8, Math.max(1, Math.ceil(planPrint(source.raster.width, source.raster.height, job.width, job.distance).scale * 10) / 10)));
  };

  /** A photo shrunk and squeezed the way pictures arrive from clients, so the
   *  tool can be tried before there is a picture of one's own. */
  const trySample = async () => {
    try {
      const bitmap = await createImageBitmap(await (await fetch('/images/coffee.jpg')).blob());
      const canvas = document.createElement('canvas');
      canvas.width = 360; canvas.height = Math.round((360 * bitmap.height) / bitmap.width);
      canvas.getContext('2d')?.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      const blob = await new Promise<Blob | null>(done => canvas.toBlob(done, 'image/jpeg', 0.55));
      if (blob) await load(new File([blob], 'sample-photo.jpg', { type: 'image/jpeg' }));
    } catch { setError(tx(lang, 'The sample picture could not be loaded.', 'تعذّر تحميل الصورة النموذجية.')); }
  };

  const pick = (event: React.MouseEvent<HTMLButtonElement>) => {
    const image = event.currentTarget.querySelector('img');
    if (!source || !image) return;
    const box = image.getBoundingClientRect();
    runProbe(((event.clientX - box.left) / box.width) * source.raster.width, ((event.clientY - box.top) / box.height) * source.raster.height);
  };

  const eta = progress && progress.done ? (progress.elapsed / progress.done) * (progress.total - progress.done) : 0;
  const clock = (s: number) => (s >= 3600 ? `${Math.floor(s / 3600)}h ${Math.round((s % 3600) / 60)}m` : s >= 60 ? `${Math.floor(s / 60)}m ${Math.round(s % 60)}s` : `${Math.round(s)}s`);
  // The detail shown is the middle 64 × 64 source pixels of the probed tile.
  const crop = useMemo(() => (probe ? {
    x: probe.tile.x + Math.max(0, Math.round(probe.tile.width / 2 - 32)),
    y: probe.tile.y + Math.max(0, Math.round(probe.tile.height / 2 - 32)),
    width: Math.min(64, probe.tile.width), height: Math.min(64, probe.tile.height),
  } : null), [probe]);
  const aiCrop = useMemo(() => {
    if (!probe || !crop) return null;
    const w = crop.width * 4, h = crop.height * 4, data = new Uint8ClampedArray(w * h * 4);
    const ox = (crop.x - probe.tile.x) * 4, oy = (crop.y - probe.tile.y) * 4;
    for (let y = 0; y < h; y++) data.set(probe.data.subarray(((oy + y) * probe.width + ox) * 4, ((oy + y) * probe.width + ox + w) * 4), y * w * 4);
    return { width: w, height: h, data };
  }, [probe, crop]);
  const base = source ? `${source.name}-${outW}x${outH}-${Math.round(dpi)}dpi` : 'upscaled';

  return <>
    <div className="workspace">
      <aside className="controls">
        <Section title={tx(lang, 'Image', 'الصورة')} number="01">
          <ImageDrop lang={lang} onFile={file => { void load(file); }} busy={loading || running} />
          {source && <div className="file-chip"><span className="file-symbol">IMG</span><div><strong>{source.name}</strong><small dir="ltr">{source.raster.width} × {source.raster.height} px</small></div></div>}
        </Section>

        <Section title={tx(lang, 'What is in the picture?', 'ما نوع الصورة؟')} number="02">
          <div className="ws-choice" role="radiogroup" aria-label={tx(lang, 'Model', 'النموذج')}>
            {models.map(option => (
              <button key={option.id} role="radio" aria-checked={model === option.id} className={model === option.id ? 'selected' : ''} disabled={running} onClick={() => { setModel(option.id); setProbe(null); }}>
                <b>{tx(lang, option.en[0], option.ar[0])}</b><span>{tx(lang, option.en[1], option.ar[1])}</span>
              </button>
            ))}
          </div>
          <Help lang={lang} label={tx(lang, 'Which one do I choose?', 'أيّها أختار؟')}>
            <p><b>{tx(lang, 'Photo', 'صورة فوتوغرافية')}</b>: {tx(lang, 'taken with a camera or a phone, and clean when you zoom in. Skin, fabric and backgrounds stay natural.', 'من كاميرا أو جوال، ونظيفة عند تقريبها. يبقى الجلد والقماش والخلفيات طبيعية.')}</p>
            <p><b>{tx(lang, 'Low-quality photo', 'صورة ضعيفة الجودة')}</b>: {tx(lang, 'it came through WhatsApp or Facebook, or was saved many times, and shows small squares and noise. The AI cleans it first, then enlarges it.', 'وصلتك عبر واتساب أو فيسبوك، أو حُفظت مرات كثيرة، فظهرت فيها مربعات صغيرة وتشويش. ينظفها الذكاء الاصطناعي أولاً ثم يكبّرها.')}</p>
            <p><b>{tx(lang, 'Graphics & logos', 'رسومات وشعارات')}</b>: {tx(lang, 'a logo, a cartoon, a screenshot, or a design with writing. Edges stay crisp and colours stay flat.', 'شعار أو رسم كرتوني أو لقطة شاشة أو تصميم فيه كتابة. تبقى الحواف حادة والألوان مسطحة.')}</p>
            <p>{tx(lang, 'Not sure? Choose Photo, then click the picture to see a piece of the result before the whole enlargement.', 'لست متأكداً؟ اختر "صورة فوتوغرافية"، ثم اضغط على الصورة لترى جزءاً من النتيجة قبل التكبير الكامل.')}</p>
          </Help>
        </Section>

        <Section title={tx(lang, 'Print size and distance', 'مقاس الطباعة والمسافة')} number="03">
          <p className="micro">{tx(lang, 'Type how wide you will print it and where people will stand. The tool works out how much to enlarge.', 'اكتب عرض الطباعة واختر من أين سيراها الناس، والأداة تحسب لك كم تحتاج من تكبير.')}</p>
          <div className="job-row" role="group" aria-label={tx(lang, 'Common jobs', 'مهام شائعة')}>
            {jobs.map(job => <button key={job.en} type="button" disabled={running} onClick={() => applyJob(job)}>{tx(lang, job.en, job.ar)}</button>)}
          </div>
          <NumberField label={tx(lang, 'Print width', 'عرض الطباعة')} value={printWidth} onChange={setPrintWidth} min={1} max={10000} unit="cm" />
          <label className="field"><span>{tx(lang, 'Seen from', 'يُشاهَد من مسافة')}</span>
            <select value={distance} onChange={e => setDistance(+e.target.value)}>
              {distances.map(d => <option key={d.m} value={d.m}>{tx(lang, d.en, d.ar)}</option>)}
            </select>
          </label>
          {plan && <div className="ws-note">
            {tx(lang, `From ${distance} m, ${plan.dpi} DPI looks sharp: ${plan.neededWidth} × ${plan.neededHeight} px. Your image gives ${plan.currentDpi.toFixed(0)} DPI at this size.`, `من مسافة ${distance} م تكفي دقة ${plan.dpi} DPI لتبدو حادة: ${plan.neededWidth} × ${plan.neededHeight} بكسل. صورتك تعطي ${plan.currentDpi.toFixed(0)} DPI بهذا المقاس.`)}
            <br />
            {plan.scale <= 1.05
              ? <b>{tx(lang, 'It is already enough; enlarge only to clean it up.', 'دقتها كافية؛ كبّرها فقط لتحسين وضوحها.')}</b>
              : plan.scale <= 8
                ? <button className="text-button" onClick={() => setScale(Math.min(8, Math.ceil(plan.scale * 10) / 10))}>{tx(lang, `Use ${Math.min(8, Math.ceil(plan.scale * 10) / 10)}× enlargement`, `استخدم تكبير ${Math.min(8, Math.ceil(plan.scale * 10) / 10)}×`)}</button>
                : <b>{tx(lang, `It needs ${plan.scale.toFixed(1)}×. 8× here is the most that still looks natural; stand-off distance hides the rest.`, `تحتاج ${plan.scale.toFixed(1)}×. تكبير ٨× هنا أقصى ما يبقى طبيعياً، والمسافة تُخفي الباقي.`)}</b>}
          </div>}
          <Help lang={lang} label={tx(lang, 'Why does the distance matter?', 'لماذا تهمّ المسافة؟')}>
            <p>{tx(lang, 'DPI is how many pixels fall in each inch (2.54 cm) of the print. Up close the eye sees fine detail, so a poster held in the hand needs about 150 DPI or more. From far away it cannot: a shop front seen from 5 m looks just as sharp at about 30 DPI.', 'الـDPI هو عدد البكسلات في كل إنش (٢٫٥٤ سم) من الطباعة. من قريب ترى العين التفاصيل الدقيقة، فالبوستر الذي يُمسك باليد يحتاج نحو ١٥٠ DPI أو أكثر. ومن بعيد لا تراها، فواجهة محل تُرى من ٥ أمتار تبدو بالحدة نفسها بنحو ٣٠ DPI.')}</p>
            <p>{tx(lang, 'So a big print does not always need a huge file. Enlarging past what the distance needs only makes the file heavier.', 'لذلك لا تحتاج الطباعة الكبيرة دائماً إلى ملف ضخم، والتكبير فوق ما تحتاجه المسافة يثقل الملف فقط.')}</p>
          </Help>
        </Section>

        <Section title={tx(lang, 'How much to enlarge', 'كم مرة تُكبَّر؟')} number="04">
          <div className="preset-row">{[2, 3, 4, 6, 8].map(value => <button key={value} className={scale === value ? 'selected' : ''} onClick={() => setScale(value)} dir="ltr">{value}×</button>)}</div>
          <NumberField label={tx(lang, 'Factor', 'المعامل')} value={scale} onChange={setScale} min={1} max={8} step={0.1} unit="×" />
          <p className="micro">{source && validScale
            ? tx(lang, `${scale}× makes every side ${scale} times longer: ${source.raster.width} × ${source.raster.height} px becomes ${outW} × ${outH} px.`, `${scale}× يعني أن كل جانب يصبح أطول ${scale} مرات: ${source.raster.width} × ${source.raster.height} بكسل تصبح ${outW} × ${outH} بكسل.`)
            : tx(lang, '4× makes every side four times longer: a picture 1000 px wide becomes 4000 px wide.', '٤× يعني أن كل جانب يصبح أطول ٤ مرات: صورة عرضها ١٠٠٠ بكسل تصبح ٤٠٠٠ بكسل.')}</p>
          {scale > 4 && <p className="micro">{tx(lang, 'The AI draws detail up to 4×; the rest is a smooth enlargement of its result.', 'الذكاء الاصطناعي يرسم التفاصيل حتى ٤×؛ ما بعدها تكبير ناعم لنتيجته.')}</p>}
          <Help lang={lang}>
            <p>{tx(lang, 'Up to 4×, the AI draws in new detail. Past 4×, its result is enlarged smoothly, so 6× and 8× add size, not detail.', 'حتى ٤× يرسم الذكاء الاصطناعي تفاصيل جديدة. بعد ٤× تُكبَّر نتيجته تكبيراً ناعماً، فالـ٦× والـ٨× تزيد المقاس لا التفاصيل.')}</p>
            <p>{tx(lang, 'A bigger factor takes longer and makes a heavier file: twice the factor is four times the pixels.', 'المعامل الأكبر يحتاج وقتاً أطول ويعطي ملفاً أثقل: ضعف المعامل يعني أربعة أضعاف البكسلات.')}</p>
          </Help>
          <Range label={tx(lang, 'Extra sharpness', 'حدّة إضافية')} value={sharpen} min={0} max={100} onChange={setSharpen} />
          <p className="micro">{tx(lang, 'Leave at 0 for photos of people. Raise it for text, logos and signs that will be seen from far away.', 'اتركها على ٠ لصور الأشخاص. ارفعها للنصوص والشعارات واللافتات التي تُرى من بعيد.')}</p>
          <label className="field"><span>{tx(lang, 'File', 'الملف')}</span>
            <select value={format} onChange={e => setFormat(e.target.value as 'jpeg' | 'png')}>
              <option value="jpeg">{tx(lang, 'JPEG · small, for printing', 'JPEG · حجم صغير للطباعة')}</option>
              <option value="png">{tx(lang, 'PNG · lossless, keeps transparency', 'PNG · بلا فقد ويحفظ الشفافية')}</option>
            </select>
          </label>
          <p className="micro">{tx(lang, 'JPEG for printing: a much smaller file. PNG when the picture has a transparent background or you will edit it again.', 'JPEG للطباعة: ملف أصغر بكثير. PNG إن كانت للصورة خلفية شفافة أو ستعدّلها مرة أخرى.')}</p>
          {format === 'jpeg' && <Range label={tx(lang, 'JPEG quality', 'جودة JPEG')} value={quality} min={70} max={100} onChange={setQuality} />}
          <Toggle label={tx(lang, 'Use the graphics card', 'استخدم كرت الشاشة')} value={gpu} onChange={value => { setGpu(value); modelKey.current = ''; }} />
          <p className="micro">{tx(lang, 'Much faster on most computers. If the result has odd colours or the browser stops responding, turn it off: the processor is slower but always works.', 'أسرع بكثير على أغلب الأجهزة. إن ظهرت ألوان غريبة أو توقف المتصفح عن الاستجابة فأطفئه: المعالج أبطأ لكنه يعمل دائماً.')}</p>
        </Section>
        <div className="control-action">
          {source && plan && validScale && <div className={`up-verdict ${dpi >= plan.dpi * 0.95 ? 'ok' : 'low'}`}>
            <b>{dpi >= plan.dpi * 0.95 ? tx(lang, `Sharp from ${distance} m`, `حادة من مسافة ${distance} م`) : tx(lang, `It will look soft from ${distance} m`, `ستبدو باهتة من مسافة ${distance} م`)}</b>
            <span>{tx(lang, `${outW} × ${outH} px gives ${Math.round(dpi)} DPI at ${printWidth} cm wide; ${plan.dpi} DPI is enough from there.`, `${outW} × ${outH} بكسل تعطي ${Math.round(dpi)} DPI بعرض ${printWidth} سم، ويكفي ${plan.dpi} DPI من هذه المسافة.`)}</span>
          </div>}
          <button className="button primary wide" disabled={!source || running || !validScale || tooBig} onClick={start}>{running ? tx(lang, 'Enlarging…', 'جارٍ التكبير…') : tx(lang, 'Enlarge and save', 'كبّر واحفظ')}<Icon name="arrow" size={18} /></button>
          {running && <button className="text-button" onClick={cancel}>{tx(lang, 'Cancel', 'إلغاء')}</button>}
          {tooBig && <p className="micro">{tx(lang, 'The result would pass 65,535 px on a side. Lower the factor.', 'سيتجاوز الناتج ٦٥٥٣٥ بكسل في أحد جانبيه. خفّض المعامل.')}</p>}
          <ErrorNote error={error} lang={lang} />
        </div>
      </aside>

      <div className="canvas-column">
        <div className="canvas-toolbar">
          <span role="status" className={`status-pill ${result ? 'ready' : ''}`}><i />
            {result ? tx(lang, 'Saved file ready', 'الملف جاهز')
              : running && progress ? `${tx(lang, 'Enlarging', 'جارٍ التكبير')} ${Math.round((100 * progress.done) / progress.total)}%${eta ? ` · ${clock(eta)}` : ''}`
              : source ? tx(lang, 'Click the picture to preview a detail', 'اضغط على الصورة لمعاينة جزء منها') : tx(lang, 'Import a picture to begin', 'استورد صورة للبدء')}
          </span>
          <span className="micro">{backend === 'webgpu' ? tx(lang, 'Running on the graphics card', 'يعمل على كرت الشاشة') : backend === 'wasm' ? tx(lang, 'Running on the processor (slower)', 'يعمل على المعالج (أبطأ)') : tx(lang, 'Processed on this computer', 'المعالجة على هذا الجهاز')}</span>
        </div>

        {!source && <div className="up-intro">
          <div>
            <h2>{tx(lang, 'What this tool is for', 'متى أستخدم هذه الأداة؟')}</h2>
            <p>{tx(lang, 'It makes a small picture big enough to print large, such as a shop front, a banner or a poster, without blocks or blur. The AI does not just stretch the pixels: it draws in the detail that a plain enlargement turns into blur.', 'تجعل الصورة الصغيرة كبيرة بما يكفي لطباعتها بمقاس كبير، كواجهة محل أو بانر أو بوستر، دون مربعات أو ضبابية. الذكاء الاصطناعي لا يمطّ البكسلات فقط، بل يرسم التفاصيل التي يحوّلها التكبير العادي إلى ضباب.')}</p>
            <ul>
              <li><b aria-hidden="true">✓</b>{tx(lang, 'For printing a photo or a logo bigger than it was made for.', 'لطباعة صورة أو شعار بمقاس أكبر مما صُنع له.')}</li>
              <li><b aria-hidden="true">✗</b><span>{tx(lang, 'Not for cutting or engraving a logo on the laser. Turn it into a vector instead: a vector stays sharp at any size. ', 'ليست لقص شعار أو حفره بالليزر. حوّله إلى فيكتور بدلاً من ذلك، فالفيكتور يبقى حاداً بأي مقاس. ')}<Link href={`/${lang}/${slugs.trace}`}>{tx(lang, 'Image to vector', 'تحويل صورة إلى فيكتور')}</Link></span></li>
            </ul>
          </div>
          <button className="button secondary" type="button" disabled={loading} onClick={() => void trySample()}>{tx(lang, 'Try it on a sample picture', 'جرّبها على صورة نموذجية')}</button>
        </div>}
        {!result && <ol className="up-steps">
          <li className={source ? 'done' : ''}><b>{tx(lang, 'Your picture', 'صورتك')}</b><span>{tx(lang, 'Drop, paste or choose it. It stays on this computer.', 'اسحبها أو الصقها أو اخترها. تبقى على جهازك.')}</span></li>
          <li className={source ? 'done' : ''}><b>{tx(lang, 'What it shows and how big you print it', 'نوعها ومقاس طباعتها')}</b><span>{tx(lang, 'The planner works out how much to enlarge it for the distance people will stand.', 'يحسب المخطط كم تحتاج من تكبير حسب المسافة التي يقف منها الناس.')}</span></li>
          <li className={probe ? 'done' : ''}><b>{tx(lang, 'Click the picture to test', 'اضغط على الصورة للتجربة')}</b><span>{tx(lang, 'A small piece is enlarged in seconds, next to an ordinary enlargement, so you see the difference before waiting.', 'يُكبَّر جزء صغير في ثوانٍ بجانب تكبير عادي، فترى الفرق قبل الانتظار.')}</span></li>
          <li><b>{tx(lang, 'Enlarge and save', 'كبّر واحفظ')}</b><span>{tx(lang, 'The whole picture is enlarged piece by piece; then drag across it to compare before and after.', 'تُكبَّر الصورة كاملة قطعةً قطعة؛ ثم اسحب فوقها للمقارنة بين قبل وبعد.')}</span></li>
        </ol>}
        <div className="preview-surface">
          <div className="preview-top"><span><Icon name="upscale" size={15} /> {preview ? tx(lang, 'BEFORE · AFTER', 'قبل · بعد') : tx(lang, 'ORIGINAL', 'الأصل')}</span><b dir="ltr">{source ? `${source.raster.width} × ${source.raster.height} → ${outW} × ${outH} px` : '—'}</b></div>
          <div className="up-stage">
            {preview && source ? <Compare url={source.url} preview={preview} lang={lang} />
              : source ? <button className="up-pick" onClick={pick} disabled={running} aria-label={tx(lang, 'Preview a detail here', 'عاين هذا الجزء')}>
                  {/* eslint-disable-next-line @next/next/no-img-element -- a local object URL, not an optimisable asset */}
                  <img src={source.url} alt={tx(lang, 'Original picture', 'الصورة الأصلية')} className="up-source" />
                </button>
              : <div className="empty-preview"><Icon name="upscale" size={42} /><p>{tx(lang, 'Import, drop or paste a picture (Ctrl+V)', 'استورد صورة أو اسحبها أو الصقها (Ctrl+V)')}</p></div>}
          </div>
          {running && progress && <div className="ws-progress" style={{ margin: '0 13px 10px' }}><span style={{ width: `${(100 * progress.done) / progress.total}%` }} /></div>}
          <div className="preview-bottom"><span><i />{tx(lang, 'The picture never leaves this computer', 'الصورة لا تغادر هذا الجهاز')}</span><span>{tx(lang, 'AI model: ', 'نموذج الذكاء الاصطناعي: ')}<bdi dir="ltr">Real-ESRGAN 4×</bdi></span></div>
        </div>

        {source && (probe || probing) && crop && (
          <div className="ws-card">
            <h3>{tx(lang, 'Detail at 4×', 'جزء مكبّر ٤×')} {probing && <span className="micro">{tx(lang, ' · working…', ' · جارٍ العمل…')}</span>}</h3>
            <div className="up-compare">
              <figure><CropCanvas raster={source.raster} crop={crop} scale={4} smooth={false} label="original pixels" /><figcaption>{tx(lang, 'Original pixels', 'البكسلات الأصلية')}</figcaption></figure>
              <figure><CropCanvas raster={source.raster} crop={crop} scale={4} smooth label="ordinary enlargement" /><figcaption>{tx(lang, 'Ordinary enlargement', 'تكبير عادي')}</figcaption></figure>
              <figure>{aiCrop ? <PixelsCanvas width={aiCrop.width} height={aiCrop.height} data={aiCrop.data} label="AI enlargement" /> : <div className="up-crop" />}<figcaption>{tx(lang, 'AI enlargement', 'تكبير بالذكاء الاصطناعي')}</figcaption></figure>
            </div>
          </div>
        )}

        <div className="stats-row">
          <Stat label={tx(lang, 'Result', 'الناتج')} value={source ? `${outW} × ${outH}` : '—'} unit="px" />
          <Stat label={tx(lang, 'Print resolution', 'دقة الطباعة')} value={dpi ? dpi.toFixed(0) : '—'} unit="DPI" />
          <Stat label={tx(lang, 'Megapixels', 'ميغابكسل')} value={source ? ((outW * outH) / 1e6).toFixed(1) : '—'} />
          <Stat label={tx(lang, 'Time', 'الزمن')} value={result ? clock(result.seconds) : progress ? clock(progress.elapsed) : '—'} />
        </div>

        {result && (
          <div className="export-bar">
            <div><strong>{tx(lang, 'Enlarged and ready to print', 'مكبّرة وجاهزة للطباعة')}</strong><span dir="ltr">{result.width} × {result.height} px · {Math.round(dpi)} DPI · {bytes(result.blob.size)}</span></div>
            <div className="export-actions"><button className="button dark" onClick={() => saveFile(result.blob, `${base}.${result.format === 'jpeg' ? 'jpg' : 'png'}`, result.blob.type)}><Icon name="download" size={16} />{tx(lang, 'Save the file', 'احفظ الملف')}</button></div>
          </div>
        )}
        <div className="tip-card"><span className="tip-mark">i</span><p>{tx(lang,
          'Large prints are seen from a distance: a 6 m shop front seen from 5 m needs about 30 DPI, not 300. The file carries its DPI, so Photoshop and RIP software open it at the print width you set. The first run downloads the model (about 2 MB).',
          'الطباعة الكبيرة تُشاهَد من بعيد: واجهة ٦ أمتار تُرى من ٥ أمتار تحتاج نحو ٣٠ DPI لا ٣٠٠. الملف يحمل دقته، فيفتحه فوتوشوب وبرامج الطباعة بالعرض الذي حددته. أول تشغيل يحمّل النموذج (نحو ٢ ميغابايت).')}</p></div>
      </div>
    </div>
  </>;
}
