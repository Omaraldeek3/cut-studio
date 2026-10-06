'use client';
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import Link from 'next/link';
import { slugs, tx, type Language } from './copy';
import { ErrorNote, Help, Icon, Range, Section, Stat, Toggle } from './ui';
import { saveFile } from './image-input';
import type { ImageTarget } from './cutout-workspace';
import {
  composePrompt, estimate, MAX_COUNT, MAX_DESCRIPTION, PROVIDERS, provider as providerOf, purposes, ratios,
  storeBase, storedBase, storedKey, storedProvider, storeKey, storeProvider, toPng, watchStore,
  type Account, type ProviderId, type Result,
} from './image-ai';

/* Design from a description. Every other tool works on this computer; this
   one asks an AI image model to draw, through the user's own account with
   Recraft, fal.ai (FLUX and hundreds more), OpenAI, Google and others,
   because drawing a picture from words needs a model far too big to run in a
   browser. From here a design goes to the tracer for cutting lines, or
   straight to the user as a file. */

export type Handover = { file: File; preset?: string };
type Design = { id: number; result: Result; url: string; purpose: string; by: string };

const examples: [string, string][] = [
  ['A camel walking past two palm trees', 'جمل يمشي بجانب نخلتين'],
  ['A coffee cup with steam shaped like a heart', 'فنجان قهوة يتصاعد منه بخار على شكل قلب'],
  ['A falcon with open wings', 'صقر بجناحين مفتوحين'],
  ['A lantern with a crescent moon', 'فانوس رمضان مع هلال'],
];
const OTHER = '__other__';
const extension = (type: string) => (/svg/.test(type) ? 'svg' : /jpe?g/.test(type) ? 'jpg' : /webp/.test(type) ? 'webp' : 'png');

let nextId = 1;

export function GenerateWorkspace({ lang, onSendImage }: { lang: Language; onSendImage: (handover: Handover, to: ImageTarget) => void }) {
  // The service used last time, and a key remembered on an earlier visit, are used until the user picks another.
  const lastProvider = useSyncExternalStore(watchStore, storedProvider, () => 'recraft' as ProviderId);
  const [choice, setChoice] = useState<ProviderId | null>(null);
  const id = choice ?? lastProvider, service = providerOf(id);
  const saved = useSyncExternalStore(watchStore, () => storedKey(id), () => '');
  const savedBase = useSyncExternalStore(watchStore, storedBase, () => '');
  const [drafts, setDrafts] = useState<Partial<Record<ProviderId, string>>>({});
  const [rememberChoice, setRememberChoice] = useState<Partial<Record<ProviderId, boolean>>>({});
  const [baseDraft, setBaseDraft] = useState<string | null>(null);
  const key = drafts[id] ?? saved, base = baseDraft ?? savedBase;
  const remember = rememberChoice[id] ?? !!saved;
  const [models, setModels] = useState<Partial<Record<ProviderId, string>>>({});
  const [typed, setTyped] = useState<Partial<Record<ProviderId, string>>>({});
  const [account, setAccount] = useState<(Account & { for: ProviderId }) | null>(null);
  const [checking, setChecking] = useState(false);
  const [description, setDescription] = useState('');
  const [purpose, setPurpose] = useState(purposes[0].id);
  const [ratio, setRatio] = useState<string>('1:1');
  const [count, setCount] = useState(2);
  const [designs, setDesigns] = useState<Design[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const abort = useRef<AbortController | null>(null);
  const urls = useRef<string[]>([]);

  useEffect(() => () => { abort.current?.abort(); urls.current.forEach(URL.revokeObjectURL); }, []);

  const picked = models[id] ?? (service.models[0]?.id ?? OTHER);
  const model = (picked === OTHER ? typed[id] ?? '' : picked).trim();
  const listed = service.models.find(m => m.id === model);
  const chosenPurpose = purposes.find(p => p.id === purpose)!;
  const cost = estimate(listed, count);
  const trimmedKey = key.trim();
  // A service of one's own may need no key; every other service does.
  const ready = (service.needsBase ? /^https?:\/\/./.test(base.trim()) : !!trimmedKey) && !!model;
  const canGenerate = ready && description.trim().length >= 3 && !busy;
  const shown = account?.for === id ? account : null;

  function pickService(next: ProviderId) {
    setChoice(next);
    storeProvider(next);
    setError('');
  }
  function changeKey(next: string) {
    setDrafts(all => ({ ...all, [id]: next }));
    setAccount(null);
    if (remember) storeKey(id, next.trim());
  }
  function changeRemember(on: boolean) {
    setRememberChoice(all => ({ ...all, [id]: on }));
    storeKey(id, on ? trimmedKey : '');
    if (service.needsBase) storeBase(on ? base.trim() : '');
  }
  function changeBase(next: string) {
    setBaseDraft(next);
    if (remember) storeBase(next.trim());
  }
  function forget() {
    storeKey(id, '');
    if (service.needsBase) { storeBase(''); setBaseDraft(''); }
    setDrafts(all => ({ ...all, [id]: '' }));
    setRememberChoice(all => ({ ...all, [id]: false }));
    setAccount(null);
  }

  async function check() {
    if (!trimmedKey || !service.account) return;
    setChecking(true);
    setError('');
    try { setAccount({ ...(await service.account(trimmedKey, undefined, base)), for: id }); }
    catch (cause) { setAccount(null); setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setChecking(false); }
  }

  async function generate() {
    if (!canGenerate) return;
    abort.current?.abort();
    const controller = new AbortController();
    abort.current = controller;
    setBusy(true);
    setError('');
    const prompt = composePrompt(description, chosenPurpose);
    try {
      const results = await service.generate({ key: trimmedKey, prompt, model, ratio, count, base, signal: controller.signal });
      const made = results.map(result => {
        const url = URL.createObjectURL(result.blob);
        urls.current.push(url);
        return { id: nextId++, result, url, purpose, by: `${service.name} · ${model}` };
      });
      setDesigns(list => [...made, ...list].slice(0, 24));
      // The balance just went down: ask for it again if it is on show.
      if (shown && service.account) service.account(trimmedKey, undefined, base).then(a => setAccount({ ...a, for: id }), () => setAccount(null));
    } catch (cause) {
      if (!(cause instanceof Error && cause.name === 'AbortError')) setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      if (abort.current === controller) { abort.current = null; setBusy(false); }
    }
  }

  function cancel() {
    abort.current?.abort();
    abort.current = null;
    setBusy(false);
  }

  async function toTracer(design: Design) {
    try {
      const png = await toPng(design.result);
      const preset = purposes.find(p => p.id === design.purpose)?.trace || undefined;
      onSendImage({ file: new File([png], `design-${design.id}.png`, { type: 'image/png' }), preset }, 'trace');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }

  async function toMockup(design: Design) {
    try { onSendImage({ file: new File([await toPng(design.result)], `design-${design.id}.png`, { type: 'image/png' }) }, 'mockup'); }
    catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
  }

  async function savePicture(design: Design) {
    try {
      if (design.result.svg) saveFile(await toPng(design.result, 3000), `design-${design.id}.png`, 'image/png');
      else saveFile(design.result.blob, `design-${design.id}.${extension(design.result.blob.type)}`, design.result.blob.type || 'image/png');
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
  }

  const dollars = (n: number) => `$${n < 0.1 ? String(+n.toFixed(3)) : n.toFixed(2)}`;
  const prices = service.pricingUrl ? <a href={service.pricingUrl} target="_blank" rel="noreferrer">{tx(lang, `${service.name} prices`, `أسعار ${service.name}`)}</a> : null;
  const costLine = cost !== undefined
    ? <>{tx(lang, `About ${dollars(cost)} from your ${service.name} balance for this request (${dollars(listed!.price!)} a design). `, `نحو ${dollars(cost)} من رصيدك في ${service.name} لهذا الطلب (${dollars(listed!.price!)} للتصميم). `)}{prices && <>{tx(lang, 'Prices change; check: ', 'الأسعار قد تتغير، راجع: ')}{prices}</>}</>
    : prices ? <>{tx(lang, 'This model’s price is not listed here. Check it before drawing: ', 'سعر هذا النموذج غير مسجّل هنا. راجعه قبل الرسم: ')}{prices}</>
    : tx(lang, 'The service bills you at its own prices.', 'تحسب الخدمة التكلفة بأسعارها.');
  const vectorOut = !!listed?.vector;

  return <>
    <div className="workspace">
      <aside className="controls">
        <Section title={tx(lang, 'Service and key', 'الخدمة والمفتاح')} number="01">
          <label className="field"><span>{tx(lang, 'AI service', 'خدمة الذكاء الاصطناعي')}</span>
            <select value={id} onChange={e => pickService(e.target.value as ProviderId)}>
              {PROVIDERS.map(p => <option key={p.id} value={p.id}>{p.id === 'custom' ? tx(lang, 'Another service (OpenAI-compatible)', 'خدمة أخرى (متوافقة مع OpenAI)') : p.id === 'recraft' ? tx(lang, 'Recraft · true vectors', 'Recraft · فيكتور حقيقي') : p.id === 'fal' ? tx(lang, 'fal.ai · FLUX and hundreds more', 'fal.ai · FLUX ومئات غيره') : p.name}</option>)}
            </select>
          </label>
          {service.needsBase && <label className="field"><span>{tx(lang, 'API address', 'عنوان API')}</span>
            <input type="url" dir="ltr" autoComplete="off" spellCheck={false} value={base} placeholder="https://api.example.com/v1" onChange={e => changeBase(e.target.value)} />
          </label>}
          <label className="field"><span>{tx(lang, 'API key', 'مفتاح API')}{service.needsBase ? tx(lang, ' (if the service needs one)', ' (إن احتاجته الخدمة)') : ''}</span>
            <input type="password" dir="ltr" autoComplete="off" spellCheck={false} value={key} placeholder="••••••••••••" onChange={e => changeKey(e.target.value)} />
          </label>
          <Toggle label={tx(lang, 'Remember it on this computer', 'تذكّره على هذا الجهاز')} value={remember} onChange={changeRemember} />
          <div className="gen-key-actions">
            {service.account && <button className="text-button" type="button" disabled={!trimmedKey || checking} onClick={() => void check()}>{checking ? tx(lang, 'Checking…', 'جارٍ الفحص…') : tx(lang, 'Check the key and balance', 'افحص المفتاح والرصيد')}</button>}
            {(key || remember) && <button className="text-button" type="button" onClick={forget}>{tx(lang, 'Forget the key', 'انسَ المفتاح')}</button>}
          </div>
          {shown && <p className="micro gen-ok" role="status">✓ {tx(lang, 'Key accepted', 'المفتاح صحيح')}{shown.name ? ` · ${shown.name}` : ''}{shown.credits !== undefined && Number.isFinite(shown.credits) ? ` · ${tx(lang, 'balance', 'الرصيد')} ${shown.credits} ${tx(lang, ...(shown.unit ?? ['', '']))}` : ''}</p>}
          <p className="micro">{tx(lang, `The key goes from your browser straight to ${service.needsBase ? 'that service' : service.name} and is never sent to Cut Studio. Unless you switch on “Remember”, it is gone when you close the page.`, `يذهب المفتاح من متصفحك إلى ${service.needsBase ? 'تلك الخدمة' : service.name} مباشرة ولا يُرسل إلى Cut Studio أبداً. ما لم تفعّل «تذكّره»، يُنسى عند إغلاق الصفحة.`)}</p>
          <Help lang={lang} label={tx(lang, 'How do I get a key?', 'كيف أحصل على مفتاح؟')}>
            <ol className="gen-steps">
              {service.steps.map(step => <li key={step[0]}>{tx(lang, ...step)}</li>)}
              {service.keysUrl && <li><a href={service.keysUrl} target="_blank" rel="noreferrer">{tx(lang, `${service.name} API keys`, `مفاتيح ${service.name}`)}</a>{service.pricingUrl && <> · <a href={service.pricingUrl} target="_blank" rel="noreferrer">{tx(lang, 'prices', 'الأسعار')}</a></>}</li>}
            </ol>
          </Help>
        </Section>

        <Section title={tx(lang, 'What is it for?', 'لأي استخدام؟')} number="02">
          <div className="ws-choice gen-purpose" role="radiogroup" aria-label={tx(lang, 'Purpose', 'الاستخدام')}>
            {purposes.map(option => (
              <button key={option.id} role="radio" aria-checked={purpose === option.id} className={purpose === option.id ? 'selected' : ''} onClick={() => setPurpose(option.id)}>
                <b>{tx(lang, option.en, option.ar)}</b><span>{tx(lang, ...option.note)}</span>
              </button>
            ))}
          </div>
        </Section>

        <Section title={tx(lang, 'Model and shape', 'النموذج والشكل')} number="03">
          {service.models.length > 0 && <label className="field"><span>{tx(lang, 'Model', 'النموذج')}</span>
            <select aria-label={tx(lang, 'Model', 'النموذج')} value={picked} onChange={e => setModels(all => ({ ...all, [id]: e.target.value }))}>
              {service.models.map(m => <option key={m.id} value={m.id}>{tx(lang, m.en, m.ar)}{m.price !== undefined ? ` · ${dollars(m.price)}` : ''}</option>)}
              {service.anyModel && <option value={OTHER}>{tx(lang, 'Another model…', 'نموذج آخر…')}</option>}
            </select>
          </label>}
          {picked === OTHER && <label className="field"><span>{tx(lang, 'Model name, as the service writes it', 'اسم النموذج كما تكتبه الخدمة')}</span>
            <input dir="ltr" autoComplete="off" spellCheck={false} value={typed[id] ?? ''} placeholder={id === 'fal' ? 'fal-ai/flux/dev' : id === 'openrouter' ? 'google/gemini-2.5-flash-image' : 'model-name'} onChange={e => setTyped(all => ({ ...all, [id]: e.target.value }))} />
          </label>}
          <label className="field"><span>{tx(lang, 'Shape (width:height)', 'الشكل (العرض:الارتفاع)')}</span>
            <select value={ratio} onChange={e => setRatio(e.target.value)} dir="ltr">
              {ratios.map(r => <option key={r} value={r}>{r}</option>)}
            </select>
          </label>
          <Range label={tx(lang, 'Designs per request', 'عدد التصاميم في كل طلب')} value={count} min={1} max={MAX_COUNT} onChange={setCount} />
          <p className="micro">{costLine}</p>
          <p className="micro">{vectorOut
            ? tx(lang, 'This model draws true vectors: the SVG opens in CorelDRAW and Illustrator as it is.', 'هذا النموذج يرسم فيكتوراً حقيقياً: يفتح ملف SVG في CorelDRAW وIllustrator كما هو.')
            : tx(lang, 'This model draws a picture. “Prepare for cutting” turns it into vector lines on this computer.', 'هذا النموذج يرسم صورة. «جهّزه للقص» يحوّلها إلى خطوط فيكتور على جهازك.')}</p>
        </Section>
      </aside>

      <div className="canvas-column">
        <div className="canvas-toolbar">
          <span role="status" className={`status-pill ${designs.length && !busy ? 'ready' : ''}`}><i />
            {busy ? tx(lang, `${service.needsBase ? 'The service' : service.name} is drawing… (10 to 60 seconds)`, `${service.needsBase ? 'الخدمة ترسم' : `${service.name} يرسم`}… (من ١٠ إلى ٦٠ ثانية)`)
              : designs.length ? tx(lang, 'Designs ready', 'التصاميم جاهزة') : ready ? tx(lang, 'Describe the design', 'صف التصميم') : tx(lang, `Paste your ${service.needsBase ? 'service address' : `${service.name} key`} to begin`, `الصق ${service.needsBase ? 'عنوان الخدمة' : `مفتاح ${service.name}`} للبدء`)}
          </span>
          <span className="micro">{tx(lang, 'Drawn by the service you chose · everything else stays on this computer', 'ترسمه الخدمة التي اخترتها · وكل ما عدا ذلك يبقى على جهازك')}</span>
        </div>

        {!ready && <div className="up-intro">
          <div>
            <h2>{tx(lang, 'Draw a design from words', 'ارسم تصميماً من كلمات')}</h2>
            <p>{tx(lang, 'Write what you want, such as “a falcon with open wings”, and an AI image model draws it. Choose what it is for and the drawing is steered to a shape the laser cuts in one piece, line art to engrave, or a sticker in flat colours.', 'اكتب ما تريد، مثل «صقر بجناحين مفتوحين»، فيرسمه نموذج صور بالذكاء الاصطناعي. اختر لأي استخدام، فيُوجَّه الرسم إلى شكل يقصه الليزر قطعة واحدة، أو رسم خطي للحفر، أو ستيكر بألوان مسطحة.')}</p>
            <ul>
              <li><b aria-hidden="true">✓</b>{tx(lang, 'Works with your own account: Recraft for true vectors, fal.ai for FLUX and hundreds of models, OpenAI, Google, Together, OpenRouter, Stability, or any OpenAI-compatible service.', 'يعمل بحسابك أنت: Recraft للفيكتور الحقيقي، وfal.ai لنماذج FLUX ومئات غيرها، وOpenAI وGoogle وTogether وOpenRouter وStability، أو أي خدمة متوافقة مع OpenAI.')}</li>
              <li><b aria-hidden="true">✗</b><span>{tx(lang, 'No key? Draw or photograph your idea and turn it into a vector on this computer: ', 'ليس لديك مفتاح؟ ارسم فكرتك أو صوّرها وحوّلها إلى فيكتور على جهازك: ')}<Link href={`/${lang}/${slugs.trace}`}>{tx(lang, 'Image to vector', 'تحويل صورة إلى فيكتور')}</Link></span></li>
            </ul>
          </div>
        </div>}

        <div className="ws-card gen-prompt">
          <label className="field"><span>{tx(lang, 'Describe the design', 'صف التصميم')}</span>
            <textarea className="lt-text" dir="auto" rows={3} maxLength={MAX_DESCRIPTION} value={description} placeholder={tx(lang, examples[0][0], examples[0][1])}
              onChange={e => setDescription(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) void generate(); }} />
          </label>
          <div className="job-row" role="group" aria-label={tx(lang, 'Examples', 'أمثلة')}>
            {examples.map(example => <button key={example[0]} type="button" onClick={() => setDescription(tx(lang, ...example))}>{tx(lang, ...example)}</button>)}
          </div>
          <p className="micro">{tx(lang, 'Describe one subject plainly. Writing in English gives the most faithful result; do not ask for words in the picture, since lettering is better done in Arabic lettering.', 'صف شيئاً واحداً بوضوح. الكتابة بالإنجليزية تعطي أدق نتيجة؛ ولا تطلب كلمات داخل الصورة، فالكتابة أفضل في أداة الكتابة العربية.')}</p>
          <div className="gen-go">
            {busy
              ? <button className="button secondary" type="button" onClick={cancel}>{tx(lang, 'Cancel', 'إلغاء')}</button>
              : <button className="button dark" type="button" disabled={!canGenerate} onClick={() => void generate()}><Icon name="generate" size={16} />{tx(lang, `Draw ${count === 1 ? 'one design' : `${count} designs`}`, count === 1 ? 'ارسم تصميماً واحداً' : `ارسم ${count} تصاميم`)}</button>}
            {cost !== undefined && <span className="micro" dir="ltr">≈ {dollars(cost)}</span>}
          </div>
          <ErrorNote error={error} lang={lang} />
        </div>

        {busy && <div className="ws-progress gen-wait" aria-hidden="true"><span /></div>}

        {designs.length > 0 && <div className="gen-grid">
          {designs.map(design => (
            <figure key={design.id} className="gen-card">
              <div className="gen-art">
                {/* eslint-disable-next-line @next/next/no-img-element -- a generated SVG shown as an image, so nothing in it can run */}
                <img src={design.url} alt={tx(lang, 'Generated design', 'تصميم مولَّد')} />
              </div>
              <figcaption>
                <button className="button dark" type="button" onClick={() => void toTracer(design)}>{tx(lang, 'Prepare for cutting', 'جهّزه للقص')} ↗</button>
                {design.result.svg && <button className="button secondary" type="button" onClick={() => saveFile(design.result.svg!, `design-${design.id}.svg`, 'image/svg+xml')}><Icon name="download" size={16} />SVG</button>}
                <button className="button secondary" type="button" onClick={() => void toMockup(design)}><Icon name="mockup" size={16} />{tx(lang, 'On a product', 'على منتج')}</button>
                <button className="button secondary" type="button" onClick={() => void savePicture(design)}><Icon name="download" size={16} />{design.result.svg ? 'PNG' : extension(design.result.blob.type).toUpperCase()}</button>
                <small className="micro gen-by" dir="ltr">{design.by}</small>
              </figcaption>
            </figure>
          ))}
        </div>}

        <div className="stats-row">
          <Stat label={tx(lang, 'Designs', 'التصاميم')} value={designs.length || '—'} />
          <Stat label={tx(lang, 'Cost per request', 'تكلفة الطلب')} value={cost !== undefined ? dollars(cost) : tx(lang, 'Service price', 'سعر الخدمة')} />
          <Stat label={tx(lang, 'Output', 'الناتج')} value={vectorOut ? 'SVG' : tx(lang, 'Picture', 'صورة')} />
        </div>
        <div className="tip-card"><span className="tip-mark">i</span><p>{tx(lang,
          '“Prepare for cutting” opens the design in Image to vector with the settings for its purpose, so you get clean cut lines, a DXF and the nesting from there. A Recraft vector model also gives its own SVG, for print and for editing in CorelDRAW or Illustrator.',
          '«جهّزه للقص» يفتح التصميم في «تحويل صورة إلى فيكتور» بإعدادات استخدامه، فتحصل منه على خطوط قص نظيفة وملف DXF وترتيب القطع. ونماذج Recraft الفيكتورية تعطي أيضاً ملف SVG الخاص بها، للطباعة وللتعديل في CorelDRAW أو Illustrator.')}</p></div>
      </div>
    </div>
  </>;
}
