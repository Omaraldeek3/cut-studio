'use client';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { tx, type Language } from './copy';
import { ErrorNote, Help, Icon, Range, Section, Stat, Toggle } from './ui';
import { bytes, decodeImage, ImageDrop, IMAGE_TYPES, saveFile, usePastedImage } from './image-input';
import { coverage, defaultMask, refine, MASK_SIDE, type MaskOptions } from './cutout';
import type { CutoutReply } from './cutout.worker';
import type { Handover } from './generate-workspace';

/* Removes the background of a photo on this computer. IS-Net finds the
   subject; the edge can then be kept soft for print or made crisp for
   cutting and engraving. The result goes out as a transparent PNG, on a
   colour of one's choosing, as a silhouette to trace into a cut line, to the
   engraver, or onto a product mockup. */

export type ImageTarget = 'trace' | 'engrave' | 'mockup';
type Source = { name: string; file: File; width: number; height: number; canvas: HTMLCanvasElement };
type Backdrop = 'none' | 'white' | 'colour';
const MAX_PIXELS = 16_000_000;

/** A canvas of the photo with the mask as its alpha, at the photo's own size. */
function compose(source: Source, mask: Uint8Array, backdrop: Backdrop, colour: string): HTMLCanvasElement {
  const { width, height } = source;
  // The 1024 mask, stretched back over the photo with smooth scaling.
  const small = document.createElement('canvas');
  small.width = small.height = MASK_SIDE;
  const sc = small.getContext('2d')!, img = sc.createImageData(MASK_SIDE, MASK_SIDE);
  for (let i = 0; i < mask.length; i++) { img.data[i * 4 + 3] = mask[i]; }
  sc.putImageData(img, 0, 0);
  const out = document.createElement('canvas');
  out.width = width; out.height = height;
  const c = out.getContext('2d')!;
  c.imageSmoothingQuality = 'high';
  c.drawImage(small, 0, 0, width, height);
  c.globalCompositeOperation = 'source-in';
  c.drawImage(source.canvas, 0, 0);
  if (backdrop !== 'none') {
    c.globalCompositeOperation = 'destination-over';
    c.fillStyle = backdrop === 'white' ? '#ffffff' : colour;
    c.fillRect(0, 0, width, height);
  }
  c.globalCompositeOperation = 'source-over';
  return out;
}

/** The subject as solid black on white: what the tracer turns into a cut line. */
function silhouette(source: Source, mask: Uint8Array): HTMLCanvasElement {
  const shape = compose(source, mask, 'none', '');
  const c = shape.getContext('2d')!;
  c.globalCompositeOperation = 'source-in';
  c.fillStyle = '#000'; c.fillRect(0, 0, shape.width, shape.height);
  c.globalCompositeOperation = 'destination-over';
  c.fillStyle = '#fff'; c.fillRect(0, 0, shape.width, shape.height);
  return shape;
}

const toBlob = (canvas: HTMLCanvasElement, type = 'image/png', quality?: number) => new Promise<Blob>((resolve, reject) => canvas.toBlob(b => (b ? resolve(b) : reject(new Error('Canvas is unavailable in this browser.'))), type, quality));

export function CutoutWorkspace({ lang, onSendImage, incoming }: { lang: Language; onSendImage: (h: Handover, to: ImageTarget) => void; incoming?: Handover | null }) {
  const [source, setSource] = useState<Source | null>(null);
  const [raw, setRaw] = useState<Uint8Array | null>(null);
  const [options, setOptions] = useState<MaskOptions>(defaultMask);
  const [backdrop, setBackdrop] = useState<Backdrop>('none');
  const [colour, setColour] = useState('#f2efe8');
  const [view, setView] = useState<'after' | 'before'>('after');
  const [gpu, setGpu] = useState(true);
  const [busy, setBusy] = useState(false);
  const [stage, setStage] = useState<{ stage: string; done?: number; total?: number } | null>(null);
  const [run, setRun] = useState<{ backend: string; ms: number } | null>(null);
  const [error, setError] = useState('');
  const worker = useRef<Worker | null>(null);
  const preview = useRef<HTMLDivElement>(null);

  useEffect(() => () => worker.current?.terminate(), []);

  const find = useCallback((s: Source) => {
    worker.current?.terminate();
    const active = new Worker(new URL('./cutout.worker.ts', import.meta.url), { type: 'module' });
    worker.current = active;
    setBusy(true); setError(''); setRaw(null); setRun(null);
    const input = document.createElement('canvas');
    input.width = input.height = MASK_SIDE;
    const c = input.getContext('2d', { willReadFrequently: true })!;
    c.imageSmoothingQuality = 'high';
    c.drawImage(s.canvas, 0, 0, MASK_SIDE, MASK_SIDE);
    const rgba = c.getImageData(0, 0, MASK_SIDE, MASK_SIDE).data;
    active.onmessage = (event: MessageEvent<CutoutReply>) => {
      const m = event.data;
      if (m.type === 'progress') setStage(m);
      else if (m.type === 'mask') { setRaw(m.mask); setRun({ backend: m.backend, ms: m.ms }); setBusy(false); setStage(null); }
      else { setError(m.message); setBusy(false); setStage(null); }
    };
    active.onerror = () => { setError('The AI model could not be started in this browser.'); setBusy(false); setStage(null); };
    active.postMessage({ type: 'run', rgba, gpu }, [rgba.buffer]);
  }, [gpu]);

  const load = useCallback(async (file: File) => {
    setError('');
    try {
      const decoded = await decodeImage(file, MAX_PIXELS);
      const canvas = document.createElement('canvas');
      canvas.width = decoded.raster.width; canvas.height = decoded.raster.height;
      canvas.getContext('2d')!.putImageData(new ImageData(new Uint8ClampedArray(decoded.raster.data), decoded.raster.width, decoded.raster.height), 0, 0);
      const s = { name: file.name.replace(/\.[^.]+$/, '') || 'photo', file, width: canvas.width, height: canvas.height, canvas };
      setSource(s);
      find(s);
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
  }, [find]);
  const onPaste = useCallback((file: File) => { void load(file); }, [load]);
  usePastedImage(onPaste);

  useEffect(() => {
    if (!incoming) return;
    const timer = setTimeout(() => void load(incoming.file), 0);
    return () => clearTimeout(timer);
  }, [incoming, load]);

  const mask = useMemo(() => (raw ? refine(raw, MASK_SIDE, options) : null), [raw, options]);
  const result = useMemo(() => (source && mask ? compose(source, mask, backdrop, colour) : null), [source, mask, backdrop, colour]);

  // The result is drawn into the preview as a canvas, never re-encoded on each change.
  useEffect(() => {
    const host = preview.current;
    if (!host) return;
    host.replaceChildren();
    const shown = view === 'before' ? source?.canvas : result;
    if (!shown) return;
    const copy = document.createElement('canvas');
    copy.width = shown.width; copy.height = shown.height;
    copy.getContext('2d')!.drawImage(shown, 0, 0);
    copy.setAttribute('role', 'img');
    copy.setAttribute('aria-label', view === 'before' ? tx(lang, 'The photo as it was', 'الصورة الأصلية') : tx(lang, 'The photo without its background', 'الصورة بلا خلفية'));
    copy.className = 'co-canvas';
    host.append(copy);
  }, [result, source, view, lang]);

  const set = <K extends keyof MaskOptions>(key: K) => (value: MaskOptions[K]) => setOptions(o => ({ ...o, [key]: value }));
  const name = source?.name ?? 'photo';

  async function save(kind: 'png' | 'jpeg' | 'mask') {
    if (!source || !mask) return;
    try {
      if (kind === 'png') saveFile(await toBlob(compose(source, mask, backdrop, colour)), `${name}-cutout.png`, 'image/png');
      else if (kind === 'jpeg') saveFile(await toBlob(compose(source, mask, backdrop === 'none' ? 'white' : backdrop, colour), 'image/jpeg', 0.92), `${name}-cutout.jpg`, 'image/jpeg');
      else saveFile(await toBlob(silhouette(source, mask)), `${name}-silhouette.png`, 'image/png');
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
  }
  async function send(to: ImageTarget) {
    if (!source || !mask) return;
    try {
      const canvas = to === 'trace' ? silhouette(source, mask) : compose(source, mask, to === 'engrave' ? 'white' : 'none', colour);
      const file = new File([await toBlob(canvas)], `${name}-${to === 'trace' ? 'silhouette' : 'cutout'}.png`, { type: 'image/png' });
      onSendImage({ file, preset: to === 'trace' ? 'cut' : undefined }, to);
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
  }

  const status = busy
    ? stage?.stage === 'download' && stage.total ? tx(lang, `Downloading the AI model, once only… ${Math.round(((stage.done ?? 0) / stage.total) * 100)}%`, `تنزيل نموذج الذكاء الاصطناعي، مرة واحدة فقط… ${Math.round(((stage.done ?? 0) / stage.total) * 100)}٪`)
      : stage?.stage === 'start' ? tx(lang, 'Starting the model…', 'تشغيل النموذج…') : tx(lang, 'Finding the subject…', 'البحث عن العنصر الرئيسي…')
    : mask ? tx(lang, 'Background removed', 'أُزيلت الخلفية') : tx(lang, 'Import a photo', 'استورد صورة');

  return <>
    <div className="workspace">
      <aside className="controls">
        <Section title={tx(lang, 'Photo', 'الصورة')} number="01">
          <ImageDrop lang={lang} onFile={file => { void load(file); }} accept={IMAGE_TYPES.join(',')} note="JPEG · PNG · WebP · Ctrl+V" />
          {source && <div className="file-chip"><span className="file-symbol">IMG</span><div><strong>{source.name}</strong><small dir="ltr">{source.width} × {source.height} px · {bytes(source.file.size)}</small></div></div>}
          <button className="text-button" onClick={async () => {
            const blob = await (await fetch('/images/mug.jpg')).blob();
            void load(new File([blob], 'sample-mug.jpg', { type: 'image/jpeg' }));
          }}>{tx(lang, 'Use a sample photo', 'استخدم صورة تجريبية')}</button>
          <Toggle label={tx(lang, 'Use the graphics card (faster)', 'استخدم كرت الشاشة (أسرع)')} value={gpu} onChange={setGpu} />
        </Section>
        <Section title={tx(lang, 'Edge', 'الحافة')} number="02">
          <div className="ws-choice" role="radiogroup" aria-label={tx(lang, 'Edge', 'الحافة')}>
            <button role="radio" aria-checked={options.edge === 'soft'} className={options.edge === 'soft' ? 'selected' : ''} onClick={() => set('edge')('soft')}><b>{tx(lang, 'Soft, for print', 'ناعمة للطباعة')}</b><span>{tx(lang, 'Keeps hair and fur, fades at the edge', 'تحافظ على الشعر وتتلاشى عند الحافة')}</span></button>
            <button role="radio" aria-checked={options.edge === 'crisp'} className={options.edge === 'crisp' ? 'selected' : ''} onClick={() => set('edge')('crisp')}><b>{tx(lang, 'Crisp, for cutting', 'حادة للقص')}</b><span>{tx(lang, 'A clean line for the laser or the plotter', 'خط نظيف لليزر أو الكتر')}</span></button>
          </div>
          <Range label={tx(lang, 'Edge in or out', 'الحافة للداخل أو للخارج')} value={options.shift} min={-50} max={50} onChange={set('shift')} />
          <p className="micro">{tx(lang, 'Move it in to lose a pale halo of the old background, out to keep more of a fuzzy edge.', 'حرّكها للداخل لتتخلص من هالة باهتة من الخلفية القديمة، وللخارج لتبقي أكثر من الحافة الناعمة.')}</p>
          <Toggle label={tx(lang, 'Keep only the main subject', 'أبقِ العنصر الرئيسي فقط')} value={options.mainOnly} onChange={set('mainOnly')} />
        </Section>
        <Section title={tx(lang, 'New background', 'الخلفية الجديدة')} number="03">
          <div className="preset-row" role="radiogroup" aria-label={tx(lang, 'New background', 'الخلفية الجديدة')}>
            {([['none', tx(lang, 'Transparent', 'شفافة')], ['white', tx(lang, 'White', 'بيضاء')], ['colour', tx(lang, 'A colour', 'لون')]] as const).map(([id, label]) => <button key={id} role="radio" aria-checked={backdrop === id} className={backdrop === id ? 'selected' : ''} onClick={() => setBackdrop(id)}>{label}</button>)}
          </div>
          {backdrop === 'colour' && <label className="field"><span>{tx(lang, 'Colour', 'اللون')}</span><input type="color" value={colour} onChange={e => setColour(e.target.value)} /></label>}
        </Section>
        <div className="control-action"><ErrorNote error={error} lang={lang} /></div>
      </aside>
      <div className="canvas-column">
        <div className="canvas-toolbar">
          <span role="status" className={`status-pill ${mask && !busy ? 'ready' : ''}`}><i />{status}</span>
          <div className="vz-tabs" role="tablist">
            <button role="tab" aria-selected={view === 'after'} className={view === 'after' ? 'selected' : ''} onClick={() => setView('after')}>{tx(lang, 'After', 'بعد')}</button>
            <button role="tab" aria-selected={view === 'before'} className={view === 'before' ? 'selected' : ''} onClick={() => setView('before')}>{tx(lang, 'Before', 'قبل')}</button>
          </div>
        </div>
        {!source && <div className="up-intro">
          <div>
            <h2>{tx(lang, 'Take the background off a photo', 'أزل خلفية أي صورة')}</h2>
            <p>{tx(lang, 'A product, a person, a pet or a car: an AI model finds the subject and removes everything behind it, here on this computer. Then print it, engrave it, cut round it, or show it on a product.', 'منتج أو شخص أو حيوان أو سيارة: يجد نموذج ذكاء اصطناعي العنصر الرئيسي ويزيل كل ما خلفه، هنا على جهازك. ثم اطبعه أو احفره أو قصّ حوله أو اعرضه على منتج.')}</p>
            <ul>
              <li><b aria-hidden="true">✓</b>{tx(lang, 'Free, with no account and no upload: the photo stays on this computer.', 'مجاني، بلا حساب ولا رفع: تبقى الصورة على جهازك.')}</li>
              <li><b aria-hidden="true">✓</b>{tx(lang, 'The model (90 MB) downloads the first time only.', 'يُنزَّل النموذج (٩٠ ميغابايت) في المرة الأولى فقط.')}</li>
            </ul>
          </div>
        </div>}
        {source && <div className={`preview-surface co-surface${view === 'after' && backdrop === 'none' ? ' co-checker' : ''}`} ref={preview} />}
        {busy && <div className="ws-progress" aria-hidden="true"><span style={stage?.total ? { width: `${Math.round(((stage.done ?? 0) / stage.total) * 100)}%` } : undefined} /></div>}
        <div className="stats-row">
          <Stat label={tx(lang, 'Size', 'المقاس')} value={source ? `${source.width} × ${source.height}` : '—'} unit=" px" />
          <Stat label={tx(lang, 'Subject', 'العنصر')} value={mask ? `${Math.round(coverage(mask) * 100)}` : '—'} unit="%" />
          <Stat label={tx(lang, 'Time', 'الوقت')} value={run ? (run.ms / 1000).toFixed(1) : '—'} unit={run ? ` s · ${run.backend === 'webgpu' ? 'GPU' : 'CPU'}` : ''} />
        </div>
        {mask && <div className="ws-card co-actions">
          <div className="co-row">
            <button className="button dark" onClick={() => void save('png')}><Icon name="download" size={16} />{tx(lang, 'PNG', 'PNG')}{backdrop === 'none' ? tx(lang, ', transparent', ' شفافة') : ''}</button>
            <button className="button secondary" onClick={() => void save('jpeg')}><Icon name="download" size={16} />JPEG</button>
            <button className="button secondary" onClick={() => void save('mask')}><Icon name="download" size={16} />{tx(lang, 'Silhouette', 'الظل الأسود')}</button>
          </div>
          <div className="co-row">
            <button className="button secondary" onClick={() => void send('trace')}><Icon name="trace" size={16} />{tx(lang, 'Cut round it (vector)', 'قصّ حوله (فيكتور)')} ↗</button>
            <button className="button secondary" onClick={() => void send('engrave')}><Icon name="engrave" size={16} />{tx(lang, 'Engrave the photo', 'احفر الصورة')} ↗</button>
            <button className="button secondary" onClick={() => void send('mockup')}><Icon name="mockup" size={16} />{tx(lang, 'Show it on a product', 'اعرضه على منتج')} ↗</button>
          </div>
        </div>}
        <div className="tip-card"><span className="tip-mark">i</span><p>{tx(lang,
          '“Cut round it” sends the subject’s silhouette to Image to vector with the cutting preset: one clean outline for a shaped acrylic, wood or sticker cut. For engraving, the subject goes over white so the background is not burnt.',
          '«قصّ حوله» يرسل ظل العنصر إلى «تحويل صورة إلى فيكتور» بإعداد القص: خط خارجي نظيف واحد لقطعة أكريليك أو خشب أو ستيكر بشكلها. وللحفر يوضع العنصر على أبيض حتى لا تُحرق الخلفية.')}</p></div>
        <Help lang={lang} label={tx(lang, 'Where does the model come from?', 'من أين النموذج؟')}>
          <p>{tx(lang, 'IS-Net from the DIS research project (Apache-2.0 licence), served by Cut Studio itself and kept in your browser after the first use. It runs on your graphics card through WebGPU when the browser allows, and on the processor otherwise, which is slower (about half a minute a photo).', 'IS-Net من مشروع البحث DIS (رخصة Apache-2.0)، يقدّمه Cut Studio نفسه ويُحفظ في متصفحك بعد أول استخدام. يعمل على كرت الشاشة عبر WebGPU إن سمح المتصفح، وعلى المعالج في غير ذلك، وهو أبطأ (نحو نصف دقيقة للصورة).')}</p>
        </Help>
      </div>
    </div>
  </>;
}
