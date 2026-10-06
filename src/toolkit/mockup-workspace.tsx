'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { tx, type Language } from './copy';
import { ErrorNote, Icon, Range, Section, Stat, Toggle } from './ui';
import { ImageDrop, IMAGE_TYPES, saveFile, usePastedImage } from './image-input';
import { defaultMockup, prepareArt, renderMockup, SCENES, type MockupOptions, type PhotoEffect, type SceneId } from './mockup';
import type { Handover } from './generate-workspace';

/* Shows a design on a product before anything is cut or printed: as an
   acrylic sign, cut letters, engraved wood, a shop sign, neon, a T-shirt, a
   mug or a sticker, or on a photo of the customer's own shop front. The
   picture is drawn here and saved as an image to send to the customer. */

type Picture = { image: CanvasImageSource; width: number; height: number; name: string };

/** Opens a PNG, JPEG, WebP or SVG as something a canvas can draw. */
async function openPicture(file: File): Promise<Picture> {
  const name = file.name.replace(/\.[^.]+$/, '') || 'design';
  if (file.type === 'image/svg+xml' || /\.svg$/i.test(file.name)) {
    const text = await file.text();
    const box = /viewBox\s*=\s*["']\s*[-\d.]+[\s,]+[-\d.]+[\s,]+([\d.]+)[\s,]+([\d.]+)/i.exec(text);
    const url = URL.createObjectURL(new Blob([text], { type: 'image/svg+xml' }));
    try {
      const image = new Image();
      image.src = url;
      await image.decode();
      const w = box ? +box[1] : image.naturalWidth || 1000, h = box ? +box[2] : image.naturalHeight || 1000, k = 1400 / Math.max(w, h);
      // SVG is drawn at a generous size so it stays sharp on the product.
      const c = document.createElement('canvas');
      c.width = Math.round(w * k); c.height = Math.round(h * k);
      c.getContext('2d')!.drawImage(image, 0, 0, c.width, c.height);
      return { image: c, width: c.width, height: c.height, name };
    } catch { throw new Error('This image could not be opened. Try saving it again as PNG or JPEG.'); }
    finally { URL.revokeObjectURL(url); }
  }
  try { const bitmap = await createImageBitmap(file); return { image: bitmap, width: bitmap.width, height: bitmap.height, name }; }
  catch { throw new Error('This image could not be opened. Try saving it again as PNG or JPEG.'); }
}

const SAMPLE = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 300"><circle cx="200" cy="140" r="118" fill="#1f5c4a"/><path d="M135 105h104v52a52 52 0 0 1-104 0Z" fill="#f4ead7"/><path d="M239 118h14a22 22 0 0 1 0 44h-16" fill="none" stroke="#f4ead7" stroke-width="12"/><path d="M160 60c-8 14 8 20 0 34M187 54c-8 14 8 20 0 34M214 60c-8 14 8 20 0 34" fill="none" stroke="#e0a542" stroke-width="8" stroke-linecap="round"/><rect x="118" y="214" width="164" height="14" rx="7" fill="#e0a542"/></svg>';

export function MockupWorkspace({ lang, incoming }: { lang: Language; incoming?: Handover | null }) {
  const [design, setDesign] = useState<Picture | null>(null);
  const [photo, setPhoto] = useState<Picture | null>(null);
  const [options, setOptions] = useState<MockupOptions>(defaultMockup());
  const [dropWhite, setDropWhite] = useState(true);
  const [opaque, setOpaque] = useState(false);
  const [error, setError] = useState('');
  const [drawn, setDrawn] = useState<{ width: number; height: number } | null>(null);
  const view = useRef<HTMLCanvasElement>(null);

  const load = useCallback(async (file: File) => {
    setError('');
    try { setDesign(await openPicture(file)); } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
  }, []);
  const onPaste = useCallback((file: File) => { void load(file); }, [load]);
  usePastedImage(onPaste);
  useEffect(() => {
    if (!incoming) return;
    const timer = setTimeout(() => void load(incoming.file), 0);
    return () => clearTimeout(timer);
  }, [incoming, load]);

  useEffect(() => {
    const target = view.current;
    if (!target || !design) return;
    const frame = requestAnimationFrame(() => {
      try {
        const prepared = prepareArt(design.image, design.width, design.height, dropWhite);
        setOpaque(prepared.opaque);
        renderMockup(target, prepared.art, options, options.scene === 'photo' ? photo : null);
        setDrawn({ width: target.width, height: target.height });
      } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    });
    return () => cancelAnimationFrame(frame);
  }, [design, options, dropWhite, photo]);

  const set = <K extends keyof MockupOptions>(key: K) => (value: MockupOptions[K]) => setOptions(o => ({ ...o, [key]: value }));
  const pickScene = (scene: SceneId) => setOptions(o => ({ ...defaultMockup(scene), scale: o.scale, x: o.x, y: o.y, effect: o.effect }));
  const scene = SCENES.find(s => s.id === options.scene)!;
  const name = design?.name ?? 'design';

  function save(type: 'image/png' | 'image/jpeg') {
    view.current?.toBlob(blob => { if (blob) saveFile(blob, `${name}-${options.scene}-mockup.${type === 'image/png' ? 'png' : 'jpg'}`, type); }, type, 0.9);
  }

  return <>
    <div className="workspace">
      <aside className="controls">
        <Section title={tx(lang, 'Design', 'التصميم')} number="01">
          <ImageDrop lang={lang} onFile={file => { void load(file); }} accept={[...IMAGE_TYPES, 'image/svg+xml', '.svg'].join(',')} note="PNG · SVG · JPEG · Ctrl+V" />
          {design && <div className="file-chip"><span className="file-symbol">IMG</span><div><strong>{design.name}</strong><small dir="ltr">{design.width} × {design.height} px</small></div></div>}
          <button className="text-button" onClick={() => void load(new File([SAMPLE], 'sample-logo.svg', { type: 'image/svg+xml' }))}>{tx(lang, 'Use a sample logo', 'استخدم شعاراً تجريبياً')}</button>
          {opaque && <Toggle label={tx(lang, 'Take out its white background', 'أزل خلفيته البيضاء')} value={dropWhite} onChange={setDropWhite} />}
          <p className="micro">{tx(lang, 'A transparent PNG or an SVG works best. For a photo of a product or a person, remove its background first in Remove background.', 'أفضل نتيجة مع PNG شفاف أو SVG. لصورة منتج أو شخص، أزل خلفيتها أولاً من أداة «إزالة الخلفية».')}</p>
        </Section>
        <Section title={tx(lang, 'Product', 'المنتج')} number="02">
          <div className="mk-scenes" role="radiogroup" aria-label={tx(lang, 'Product', 'المنتج')}>
            {SCENES.map(s => <button key={s.id} role="radio" aria-checked={options.scene === s.id} className={options.scene === s.id ? 'selected' : ''} onClick={() => pickScene(s.id)}>{tx(lang, s.en, s.ar)}</button>)}
          </div>
        </Section>
        <Section title={tx(lang, 'Look', 'المظهر')} number="03">
          <Range label={tx(lang, 'Design size (%)', 'حجم التصميم (٪)')} value={options.scale} min={20} max={100} onChange={set('scale')} />
          {options.scene === 'photo' ? <>
            <label className="field"><span>{tx(lang, 'Photo of the place', 'صورة المكان')}</span>
              <input type="file" accept={IMAGE_TYPES.join(',')} aria-label={tx(lang, 'Photo of the place', 'صورة المكان')} onChange={async e => { const f = e.target.files?.[0]; e.target.value = ''; if (f) { try { setPhoto(await openPicture(f)); } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); } } }} />
            </label>
            <Range label={tx(lang, 'Across (%)', 'أفقياً (٪)')} value={options.x} min={0} max={100} onChange={set('x')} />
            <Range label={tx(lang, 'Down (%)', 'عمودياً (٪)')} value={options.y} min={0} max={100} onChange={set('y')} />
            <div className="preset-row" role="radiogroup" aria-label={tx(lang, 'Finish', 'التشطيب')}>
              {([['flat', tx(lang, 'Printed', 'مطبوع')], ['raised', tx(lang, 'Raised', 'بارز')], ['lit', tx(lang, 'Lit', 'مضيء')]] as [PhotoEffect, string][]).map(([id, label]) => <button key={id} role="radio" aria-checked={options.effect === id} className={options.effect === id ? 'selected' : ''} onClick={() => set('effect')(id)}>{label}</button>)}
            </div>
          </> : <label className="field"><span>{options.scene === 'shop' ? tx(lang, 'Wall of the building', 'جدار المبنى') : options.scene === 'sticker' ? tx(lang, 'Laptop colour', 'لون اللابتوب') : tx(lang, 'Wall or backdrop', 'الجدار أو الخلفية')}</span><input type="color" value={options.wall} onChange={e => set('wall')(e.target.value)} /></label>}
          {(options.scene !== 'photo' || options.effect === 'lit') && <label className="field"><span>{tx(lang, ...scene.materialLabel)}</span><input type="color" value={options.material} onChange={e => set('material')(e.target.value)} /></label>}
          {['acrylic', 'letters', 'neon'].includes(options.scene) && <Toggle label={tx(lang, 'Keep the design’s own colours', 'أبقِ ألوان التصميم الأصلية')} value={options.ownColours} onChange={set('ownColours')} />}
          {options.scene === 'shop' && <Toggle label={tx(lang, 'At night, lit', 'ليلاً مع الإضاءة')} value={options.night} onChange={set('night')} />}
        </Section>
        <div className="control-action"><ErrorNote error={error} lang={lang} /></div>
      </aside>
      <div className="canvas-column">
        <div className="canvas-toolbar">
          <span role="status" className={`status-pill ${design ? 'ready' : ''}`}><i />{design ? tx(lang, 'Mockup ready', 'المعاينة جاهزة') : tx(lang, 'Import a design', 'استورد تصميماً')}</span>
          <span className="micro">{tx(lang, 'Drawn on this computer', 'تُرسم على جهازك')}</span>
        </div>
        {!design && <div className="up-intro">
          <div>
            <h2>{tx(lang, 'Show the customer before you cut', 'أرِ الزبون قبل أن تقص')}</h2>
            <p>{tx(lang, 'Drop in a logo or a design and see it as an acrylic sign, cut letters, engraved wood, a lit shop sign, neon, a T-shirt, a mug or a sticker. Or put it on a photo of the customer’s own shop front. Save the picture and send it on WhatsApp.', 'ضع شعاراً أو تصميماً وشاهده لوحة أكريليك أو حروفاً بارزة أو حفراً على خشب أو لافتة مضيئة أو نيون أو تيشيرت أو كوباً أو ستيكر. أو ضعه على صورة واجهة محل الزبون نفسه. احفظ الصورة وأرسلها على واتساب.')}</p>
          </div>
        </div>}
        <div className={`preview-surface mk-surface${design ? '' : ' mk-empty'}`}><canvas ref={view} role="img" aria-label={tx(lang, `Mockup: ${scene.en}`, `معاينة: ${scene.ar}`)} /></div>
        <div className="stats-row">
          <Stat label={tx(lang, 'Product', 'المنتج')} value={tx(lang, scene.en, scene.ar)} />
          <Stat label={tx(lang, 'Picture', 'الصورة')} value={drawn && design ? `${drawn.width} × ${drawn.height}` : '—'} unit=" px" />
        </div>
        {design && <div className="ws-card co-actions"><div className="co-row">
          <button className="button dark" onClick={() => save('image/jpeg')}><Icon name="download" size={16} />{tx(lang, 'Save for WhatsApp (JPEG)', 'احفظ للواتساب (JPEG)')}</button>
          <button className="button secondary" onClick={() => save('image/png')}><Icon name="download" size={16} />PNG</button>
        </div></div>}
        <div className="tip-card"><span className="tip-mark">i</span><p>{tx(lang,
          'A mockup shows the idea, not the exact finish: colours on screen differ from acrylic, wood and fabric. For the real size, put the design on a photo of the place and set it against something of known size, such as the door.',
          'المعاينة توضح الفكرة لا التشطيب الدقيق: الألوان على الشاشة تختلف عن الأكريليك والخشب والقماش. لتقدير المقاس الحقيقي ضع التصميم على صورة المكان وقارنه بشيء معروف المقاس، كالباب.')}</p></div>
      </div>
    </div>
  </>;
}
