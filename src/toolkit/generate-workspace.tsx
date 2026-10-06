'use client';
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import Link from 'next/link';
import { slugs, tx, type Language } from './copy';
import { ErrorNote, Help, Icon, Range, Section, Stat, Toggle } from './ui';
import { saveFile } from './image-input';
import { composePrompt, estimate, MAX_DESCRIPTION, purposes, ratios, recraftAccount, recraftGenerate, recraftModels, RECRAFT_KEYS_URL, RECRAFT_PRICING_URL, storedKey, storeKey, svgToPng, watchStoredKey } from './recraft';

/* Design from a description. Every other tool works on this computer; this
   one asks Recraft's AI to draw, with the user's own API key, because drawing
   a picture from words needs a model far too big to run in a browser. The
   design comes back as an SVG, and from here it goes to the tracer for
   cutting lines, or straight to the user as a file. */

export type Handover = { file: File; preset?: string };
type Design = { id: number; svg: string; url: string; prompt: string; purpose: string; ratio: string };

const examples: [string, string][] = [
  ['A camel walking past two palm trees', 'جمل يمشي بجانب نخلتين'],
  ['A coffee cup with steam shaped like a heart', 'فنجان قهوة يتصاعد منه بخار على شكل قلب'],
  ['A falcon with open wings', 'صقر بجناحين مفتوحين'],
  ['A lantern with a crescent moon', 'فانوس رمضان مع هلال'],
];

let nextId = 1;

export function GenerateWorkspace({ lang, onTrace }: { lang: Language; onTrace: (handover: Handover) => void }) {
  // A key remembered on an earlier visit is used until the user types another.
  const saved = useSyncExternalStore(watchStoredKey, storedKey, () => '');
  const [draft, setDraft] = useState<string | null>(null);
  const [rememberChoice, setRememberChoice] = useState<boolean | null>(null);
  const key = draft ?? saved;
  const remember = rememberChoice ?? !!saved;
  const [account, setAccount] = useState<{ name: string; credits: number } | null>(null);
  const [checking, setChecking] = useState(false);
  const [description, setDescription] = useState('');
  const [purpose, setPurpose] = useState(purposes[0].id);
  const [model, setModel] = useState(recraftModels[0].id);
  const [ratio, setRatio] = useState<string>('1:1');
  const [count, setCount] = useState(2);
  const [designs, setDesigns] = useState<Design[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const abort = useRef<AbortController | null>(null);
  const urls = useRef<string[]>([]);

  useEffect(() => () => { abort.current?.abort(); urls.current.forEach(URL.revokeObjectURL); }, []);

  const chosenPurpose = purposes.find(p => p.id === purpose)!;
  const chosenModel = recraftModels.find(m => m.id === model)!;
  const cost = estimate(chosenModel, count);
  const trimmedKey = key.trim();
  const canGenerate = !!trimmedKey && description.trim().length >= 3 && !busy;

  function changeKey(next: string) {
    setDraft(next);
    setAccount(null);
    if (remember) storeKey(next.trim());
  }
  function changeRemember(on: boolean) {
    setRememberChoice(on);
    storeKey(on ? trimmedKey : '');
  }
  function forget() {
    storeKey('');
    setDraft('');
    setRememberChoice(false);
    setAccount(null);
  }

  async function check() {
    if (!trimmedKey) return;
    setChecking(true);
    setError('');
    try { setAccount(await recraftAccount(trimmedKey)); }
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
      const svgs = await recraftGenerate({ key: trimmedKey, prompt, model, ratio, count, signal: controller.signal });
      const made = svgs.map(svg => {
        const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
        urls.current.push(url);
        return { id: nextId++, svg, url, prompt, purpose, ratio };
      });
      setDesigns(list => [...made, ...list].slice(0, 24));
      // The balance just went down: ask for it again if it is on show.
      if (account) recraftAccount(trimmedKey).then(setAccount, () => setAccount(null));
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
      const png = await svgToPng(design.svg);
      const preset = purposes.find(p => p.id === design.purpose)?.trace || undefined;
      onTrace({ file: new File([png], `design-${design.id}.png`, { type: 'image/png' }), preset });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }

  async function savePng(design: Design) {
    try { saveFile(await svgToPng(design.svg, 3000), `design-${design.id}.png`, 'image/png'); }
    catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
  }

  const dollars = (n: number) => `$${n < 0.1 ? String(+n.toFixed(3)) : n.toFixed(2)}`;

  return <>
    <div className="workspace">
      <aside className="controls">
        <Section title={tx(lang, 'Your Recraft key', 'مفتاح Recraft الخاص بك')} number="01">
          <label className="field"><span>{tx(lang, 'API key', 'مفتاح API')}</span>
            <input type="password" dir="ltr" autoComplete="off" spellCheck={false} value={key} placeholder="••••••••••••" onChange={e => changeKey(e.target.value)} />
          </label>
          <Toggle label={tx(lang, 'Remember it on this computer', 'تذكّره على هذا الجهاز')} value={remember} onChange={changeRemember} />
          <div className="gen-key-actions">
            <button className="text-button" type="button" disabled={!trimmedKey || checking} onClick={() => void check()}>{checking ? tx(lang, 'Checking…', 'جارٍ الفحص…') : tx(lang, 'Check the key and balance', 'افحص المفتاح والرصيد')}</button>
            {(key || remember) && <button className="text-button" type="button" onClick={forget}>{tx(lang, 'Forget the key', 'انسَ المفتاح')}</button>}
          </div>
          {account && <p className="micro gen-ok" role="status">✓ {tx(lang, 'Key accepted', 'المفتاح صحيح')}{account.name ? ` · ${account.name}` : ''}{Number.isFinite(account.credits) ? ` · ${tx(lang, 'balance', 'الرصيد')} ${account.credits} ${tx(lang, 'units', 'وحدة')}` : ''}</p>}
          <p className="micro">{tx(lang, 'The key goes from your browser straight to Recraft and is never sent to Cut Studio. Unless you switch on “Remember”, it is gone when you close the page.', 'يذهب المفتاح من متصفحك إلى Recraft مباشرة ولا يُرسل إلى Cut Studio أبداً. ما لم تفعّل «تذكّره»، يُنسى عند إغلاق الصفحة.')}</p>
          <Help lang={lang} label={tx(lang, 'How do I get a key?', 'كيف أحصل على مفتاح؟')}>
            <ol className="gen-steps">
              <li>{tx(lang, 'Sign up at recraft.ai.', 'أنشئ حساباً في recraft.ai.')}</li>
              <li>{tx(lang, 'Buy API units (separate from the monthly plan): ', 'اشترِ وحدات API (منفصلة عن الاشتراك الشهري): ')}<a href={RECRAFT_PRICING_URL} target="_blank" rel="noreferrer">{tx(lang, 'API prices', 'أسعار API')}</a></li>
              <li>{tx(lang, 'Create a key on your profile page and paste it here: ', 'أنشئ مفتاحاً من صفحة ملفك والصقه هنا: ')}<a href={RECRAFT_KEYS_URL} target="_blank" rel="noreferrer">{tx(lang, 'Recraft API keys', 'مفاتيح Recraft')}</a></li>
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

        <Section title={tx(lang, 'Quality and shape', 'الجودة والشكل')} number="03">
          <label className="field"><span>{tx(lang, 'Model', 'النموذج')}</span>
            <select value={model} onChange={e => setModel(e.target.value)}>
              {recraftModels.map(m => <option key={m.id} value={m.id}>{tx(lang, m.en, m.ar)} · {dollars(m.price)}</option>)}
            </select>
          </label>
          <label className="field"><span>{tx(lang, 'Shape (width:height)', 'الشكل (العرض:الارتفاع)')}</span>
            <select value={ratio} onChange={e => setRatio(e.target.value)} dir="ltr">
              {ratios.map(r => <option key={r} value={r}>{r}</option>)}
            </select>
          </label>
          <Range label={tx(lang, 'Designs per request', 'عدد التصاميم في كل طلب')} value={count} min={1} max={4} onChange={setCount} />
          <p className="micro">{tx(lang, `About ${dollars(cost)} from your Recraft balance for this request.`, `نحو ${dollars(cost)} من رصيدك في Recraft لهذا الطلب.`)}</p>
        </Section>
      </aside>

      <div className="canvas-column">
        <div className="canvas-toolbar">
          <span role="status" className={`status-pill ${designs.length && !busy ? 'ready' : ''}`}><i />
            {busy ? tx(lang, 'Recraft is drawing… (10 to 30 seconds)', 'Recraft يرسم… (من ١٠ إلى ٣٠ ثانية)')
              : designs.length ? tx(lang, 'Designs ready', 'التصاميم جاهزة') : trimmedKey ? tx(lang, 'Describe the design', 'صف التصميم') : tx(lang, 'Paste your Recraft key to begin', 'الصق مفتاح Recraft للبدء')}
          </span>
          <span className="micro">{tx(lang, 'Drawn by Recraft · everything else stays on this computer', 'يرسمه Recraft · وكل ما عدا ذلك يبقى على جهازك')}</span>
        </div>

        {!trimmedKey && <div className="up-intro">
          <div>
            <h2>{tx(lang, 'Draw a design from words', 'ارسم تصميماً من كلمات')}</h2>
            <p>{tx(lang, 'Write what you want, such as “a falcon with open wings”, and an AI draws it as a vector. Choose what it is for and the drawing is steered to a shape the laser cuts in one piece, line art to engrave, or a sticker in flat colours.', 'اكتب ما تريد، مثل «صقر بجناحين مفتوحين»، فيرسمه الذكاء الاصطناعي فيكتوراً. اختر لأي استخدام، فيُوجَّه الرسم إلى شكل يقصه الليزر قطعة واحدة، أو رسم خطي للحفر، أو ستيكر بألوان مسطحة.')}</p>
            <ul>
              <li><b aria-hidden="true">✓</b>{tx(lang, 'Uses your own Recraft account: a few cents a design, paid to Recraft.', 'يعمل بحسابك في Recraft: بضعة سنتات للتصميم تُدفع لـ Recraft.')}</li>
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
            <span className="micro" dir="ltr">≈ {dollars(cost)}</span>
          </div>
          <ErrorNote error={error} lang={lang} />
        </div>

        {busy && <div className="ws-progress gen-wait" aria-hidden="true"><span /></div>}

        {designs.length > 0 && <div className="gen-grid">
          {designs.map(design => (
            <figure key={design.id} className="gen-card">
              <div className="gen-art">
                {/* eslint-disable-next-line @next/next/no-img-element -- an SVG from Recraft shown as an image, so nothing in it can run */}
                <img src={design.url} alt={tx(lang, 'Generated design', 'تصميم مولَّد')} />
              </div>
              <figcaption>
                <button className="button dark" type="button" onClick={() => void toTracer(design)}>{tx(lang, 'Prepare for cutting', 'جهّزه للقص')} ↗</button>
                <button className="button secondary" type="button" onClick={() => saveFile(design.svg, `design-${design.id}.svg`, 'image/svg+xml')}><Icon name="download" size={16} />SVG</button>
                <button className="button secondary" type="button" onClick={() => void savePng(design)}><Icon name="download" size={16} />PNG</button>
              </figcaption>
            </figure>
          ))}
        </div>}

        <div className="stats-row">
          <Stat label={tx(lang, 'Designs', 'التصاميم')} value={designs.length || '—'} />
          <Stat label={tx(lang, 'Cost per request', 'تكلفة الطلب')} value={dollars(cost)} />
          <Stat label={tx(lang, 'Output', 'الناتج')} value="SVG" />
        </div>
        <div className="tip-card"><span className="tip-mark">i</span><p>{tx(lang,
          '“Prepare for cutting” opens the design in Image to vector with the settings for its purpose, so you get clean cut lines, a DXF and the nesting from there. The SVG is Recraft’s own drawing, for print and for editing in CorelDRAW or Illustrator.',
          '«جهّزه للقص» يفتح التصميم في «تحويل صورة إلى فيكتور» بإعدادات استخدامه، فتحصل منه على خطوط قص نظيفة وملف DXF وترتيب القطع. وملف SVG هو رسم Recraft نفسه، للطباعة وللتعديل في CorelDRAW أو Illustrator.')}</p></div>
      </div>
    </div>
  </>;
}
