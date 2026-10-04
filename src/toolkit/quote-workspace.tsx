'use client';
import { useMemo, useState } from 'react';
import type { Drawing } from './types';
import { tx, type Language } from './copy';
import { ErrorNote, Icon, NumberField, Section, Toggle } from './ui';
import { VectorInput } from './vector-input';
import { download } from './export';
import { duration } from './generators';
import { defaultQuote, quote, quoteMessage, type NestedJob, type QuoteOptions } from './quote';

/* One place to price a job: material, machine time (timed from the artwork's
   lengths, or typed in), labour, overhead and profit, down to a price per
   piece and a message ready to send the customer. */

type Props = { lang: Language; drawing: Drawing | null; setDrawing: (d: Drawing | null) => void; filename: string; setFilename: (n: string) => void; job?: NestedJob | null };

export function QuoteWorkspace(props: Props) {
  const { lang, drawing, filename, job: nested } = props;
  // A job sent from nesting fills in its sheets and pieces; its parts are the whole order.
  const [o, setO] = useState<QuoteOptions>(() => nested ? { ...defaultQuote, copies: nested.pieces, sheets: nested.sheets, artwork: 'order' } : defaultQuote);
  const set = <K extends keyof QuoteOptions>(key: K) => (value: QuoteOptions[K]) => setO(v => ({ ...v, [key]: value }));
  const [currency, setCurrency] = useState('ILS');
  const [timed, setTimed] = useState(true);
  const [job, setJob] = useState('');
  const [copied, setCopied] = useState(false);
  const result = useMemo(() => {
    try { return { q: quote(timed ? drawing : null, o), error: '' }; } catch (e) { return { q: null, error: e instanceof Error ? e.message : 'Invalid input.' }; }
  }, [drawing, o, timed]);
  const q = result.q;
  const money = (v: number) => v.toFixed(2);
  const time = q ? duration(q.seconds) : '—';
  const message = q ? quoteMessage(q, currency, job.trim(), lang, time) : '';
  const copy = async () => { try { await navigator.clipboard.writeText(message); setCopied(true); setTimeout(() => setCopied(false), 2000); } catch { setCopied(false); } };
  const csv = () => { if (!q) return; download(['Item,Amount,Currency', `Material,${money(q.material)},${currency}`, `Machine (${time}),${money(q.machine)},${currency}`, `Labour,${money(q.labour)},${currency}`, `Finishing,${money(q.finishing)},${currency}`, `Overhead,${money(q.overhead)},${currency}`, `Profit,${money(q.profit)},${currency}`, `Total${q.minimumApplied ? ' (minimum price)' : ''},${money(q.total)},${currency}`, `Per piece,${money(q.perPiece)},${currency}`].join('\n') + '\n', 'job-quote.csv', 'text/csv'); };

  return <div className="workspace"><aside className="controls">
    <Section title={tx(lang, 'The job', 'العمل')} number="01">
      <label className="field"><span>{tx(lang, 'Job name (for the quote)', 'اسم العمل (لعرض السعر)')}</span><div className="input-wrap"><input value={job} maxLength={60} onChange={e => setJob(e.target.value)} placeholder={tx(lang, 'e.g. wooden keychains', 'مثلاً: ميداليات خشب')}/></div></label>
      <div className="field-pair">
        <NumberField label={tx(lang, 'Quantity', 'الكمية')} value={o.copies} onChange={set('copies')} min={1} max={100000}/>
        <label className="field"><span>{tx(lang, 'Currency', 'العملة')}</span><select value={currency} onChange={e => setCurrency(e.target.value)}><option value="ILS">ILS · ₪</option><option value="USD">USD · $</option><option value="JOD">JOD · د.أ</option><option value="EUR">EUR · €</option><option value="SAR">SAR · ر.س</option><option value="AED">AED · د.إ</option><option value="EGP">EGP · ج.م</option></select></label>
      </div>
    </Section>
    <Section title={tx(lang, 'Material', 'الخامة')} number="02">
      <div className="field-pair">
        <NumberField label={tx(lang, 'Sheet price', 'سعر اللوح')} value={o.sheetPrice} onChange={set('sheetPrice')} max={1e7} step={0.5} unit={currency}/>
        <NumberField label={tx(lang, 'Sheets used', 'الألواح المستخدمة')} value={o.sheets} onChange={set('sheets')} max={10000} step={0.1}/>
      </div>
      {nested ? <p className="micro from-nesting">{tx(lang, `From the nesting: ${nested.sheets} sheets of ${nested.sheetWidth} × ${nested.sheetHeight} mm, ${nested.pieces} pieces.`, `من الترتيب: ${nested.sheets} لوح بمقاس ${nested.sheetWidth} × ${nested.sheetHeight} مم، و${nested.pieces} قطعة.`)}</p> : <p className="micro">{tx(lang, 'Nesting tells you how many sheets the job fills: Price this job there brings them here.', 'ترتيب القطع يخبرك كم لوحاً يحتاج العمل، وزر «سعّر هذا العمل» هناك ينقلها إلى هنا.')}</p>}
    </Section>
    <Section title={tx(lang, 'Machine time', 'وقت الماكينة')} number="03">
      <Toggle label={tx(lang, 'Time it from the artwork', 'احسبه من التصميم')} value={timed} onChange={setTimed}/>
      {timed ? <>
        <VectorInput {...props}/>
        <div className="field"><span>{tx(lang, 'The file holds', 'الملف يحتوي')}</span><div className="sheet-tabs" role="group" aria-label={tx(lang, 'The file holds', 'الملف يحتوي')}>{([['piece', tx(lang, 'One piece', 'قطعة واحدة')], ['order', tx(lang, 'The whole order', 'الطلب كاملاً')]] as const).map(([k, label]) => <button key={k} type="button" className={o.artwork === k ? 'selected' : ''} aria-pressed={o.artwork === k} onClick={() => set('artwork')(k)}>{label}</button>)}</div></div>
        <p className="micro">{o.artwork === 'piece' ? tx(lang, `Machine time is the file's time × ${q?.copies ?? o.copies} pieces.`, `وقت الماكينة = وقت الملف × ${q?.copies ?? o.copies} قطعة.`) : tx(lang, 'The file already holds every piece: its time is the whole job, and the quantity only divides the price.', 'الملف يحتوي كل القطع: وقته هو وقت العمل كله، والكمية تقسم السعر فقط.')}</p>
        <div className="field-pair"><NumberField label={tx(lang, 'Cut speed', 'سرعة القص')} value={o.cutSpeed} onChange={set('cutSpeed')} min={0.1} step={0.5} unit="mm/s"/><NumberField label={tx(lang, 'Engrave speed', 'سرعة الحفر')} value={o.engraveSpeed} onChange={set('engraveSpeed')} min={0.1} unit="mm/s"/></div>
        <div className="field-pair"><NumberField label={tx(lang, 'Pierce time', 'زمن الثقب')} value={o.pierce} onChange={set('pierce')} step={0.1} unit="s"/><NumberField label={tx(lang, 'Travel allowance', 'هامش الحركة')} value={o.travel} onChange={set('travel')} max={300} unit="%"/></div>
      </> : <NumberField label={tx(lang, 'Machine time for the whole job', 'وقت الماكينة للعمل كله')} value={o.minutes} onChange={set('minutes')} max={1e6} unit="min"/>}
      <NumberField label={tx(lang, 'Machine rate per hour', 'أجرة الماكينة بالساعة')} value={o.rate} onChange={set('rate')} step={0.5} unit={currency}/>
    </Section>
    <Section title={tx(lang, 'Labour and margin', 'العمل والربح')} number="04">
      <NumberField label={tx(lang, 'Labour and extras for the job', 'أجرة العمل والإضافات للعمل كله')} value={o.labour} onChange={set('labour')} max={1e7} step={0.5} unit={currency}/>
      <p className="micro">{tx(lang, 'Design, machine setup, installation: once for the whole job.', 'التصميم وتجهيز الماكينة والتركيب: مرة واحدة للعمل كله.')}</p>
      <NumberField label={tx(lang, 'Finishing per piece', 'التشطيب لكل قطعة')} value={o.finishing} onChange={set('finishing')} max={1e6} step={0.1} unit={currency}/>
      <p className="micro">{tx(lang, 'Sanding, painting, assembly: times the quantity.', 'الصنفرة والدهان والتجميع: تُضرب في الكمية.')}</p>
      <div className="field-pair"><NumberField label={tx(lang, 'Overhead', 'مصاريف عامة')} value={o.overhead} onChange={set('overhead')} max={1000} unit="%"/><NumberField label={tx(lang, 'Profit', 'الربح')} value={o.profit} onChange={set('profit')} max={o.profitMode === 'margin' ? 95 : 1000} unit="%"/></div>
      <div className="field"><span>{tx(lang, 'Profit is a share of', 'الربح نسبة من')}</span><div className="sheet-tabs" role="group" aria-label={tx(lang, 'Profit is a share of', 'الربح نسبة من')}>{([['markup', tx(lang, 'The cost', 'التكلفة')], ['margin', tx(lang, 'The selling price', 'سعر البيع')]] as const).map(([k, label]) => <button key={k} type="button" className={o.profitMode === k ? 'selected' : ''} aria-pressed={o.profitMode === k} onClick={() => set('profitMode')(k)}>{label}</button>)}</div></div>
      <p className="micro">{o.profitMode === 'markup' ? tx(lang, `A cost of 100 sells for ${(100 * (1 + o.profit / 100)).toFixed(2)}.`, `تكلفة ١٠٠ تُباع بـ ${(100 * (1 + o.profit / 100)).toFixed(2)}.`) : tx(lang, `${o.profit}% of the selling price is profit: a cost of 100 sells for ${o.profit < 100 ? (100 / (1 - o.profit / 100)).toFixed(2) : '—'}.`, `${o.profit}٪ من سعر البيع ربح: تكلفة ١٠٠ تُباع بـ ${o.profit < 100 ? (100 / (1 - o.profit / 100)).toFixed(2) : '—'}.`)}</p>
    </Section>
    <Section title={tx(lang, 'Minimum order', 'الحد الأدنى للطلب')} number="05">
      <NumberField label={tx(lang, 'Minimum price', 'أقل سعر للطلب')} value={o.minimum} onChange={set('minimum')} max={1e8} step={1} unit={currency}/>
      <p className="micro">{tx(lang, 'A small job is charged at least this much. 0 means no minimum.', 'العمل الصغير يُحسب بهذا السعر على الأقل. القيمة 0 تعني بلا حد أدنى.')}</p>
    </Section>
    <div className="control-action"><ErrorNote error={result.error} lang={lang}/></div>
  </aside>
  <div className="canvas-column">
    <div className="cost-card">
      <div className="cost-card-heading"><span className="eyebrow">{tx(lang, 'PRICE TO CHARGE', 'السعر للزبون')}</span><Icon name="quote" size={28}/></div>
      <span>{tx(lang, `Total for ${q?.copies ?? '—'} pieces`, `الإجمالي لـ ${q?.copies ?? '—'} قطعة`)}</span>
      <div className="cost-total" dir="ltr"><small>{currency}</small><strong data-testid="quote-total">{q ? money(q.total) : '—'}</strong></div>
      <div className="cost-per"><span>{tx(lang, 'Price per piece', 'سعر القطعة')}</span><strong dir="ltr" data-testid="quote-each">{q ? money(q.perPiece) : '—'} {currency}</strong></div>
      <div className="cost-breakdown">
        <div><span>{tx(lang, 'Material', 'الخامة')} <small dir="ltr">{o.sheets} × {o.sheetPrice}</small></span><b dir="ltr">{q ? money(q.material) : '—'}</b></div>
        <div><span>{tx(lang, 'Machine', 'الماكينة')} <small dir="ltr">{time}{timed && drawing ? ` · ${filename}` : ''}</small></span><b dir="ltr">{q ? money(q.machine) : '—'}</b></div>
        <div><span>{tx(lang, 'Labour and extras', 'العمل والإضافات')}</span><b dir="ltr">{q ? money(q.labour) : '—'}</b></div>
        {o.finishing > 0 && <div><span>{tx(lang, 'Finishing', 'التشطيب')} <small dir="ltr">{q?.copies ?? o.copies} × {o.finishing}</small></span><b dir="ltr">{q ? money(q.finishing) : '—'}</b></div>}
        <div><span>{tx(lang, 'Overhead', 'مصاريف عامة')} <small dir="ltr">{o.overhead}%</small></span><b dir="ltr">{q ? money(q.overhead) : '—'}</b></div>
        <div><span>{tx(lang, 'Cost to you', 'التكلفة عليك')}</span><b dir="ltr">{q ? money(q.cost) : '—'}</b></div>
        <div><span>{tx(lang, 'Profit', 'الربح')} <small dir="ltr">{q?.minimumApplied ? tx(lang, 'minimum price', 'الحد الأدنى') : `${o.profit}%`}</small></span><b dir="ltr">{q ? money(q.profit) : '—'}</b></div>
      </div>
      <div className="cost-formula">{o.profitMode === 'markup' ? tx(lang, '(material + machine + labour) × (1 + overhead) × (1 + profit)', '(الخامة + الماكينة + العمل) × (١ + المصاريف) × (١ + الربح)') : tx(lang, '(material + machine + labour) × (1 + overhead) ÷ (1 − profit)', '(الخامة + الماكينة + العمل) × (١ + المصاريف) ÷ (١ − الربح)')}</div>
      <pre className="quote-message" dir="auto">{message}</pre>
      <div className="quote-actions">
        <button className="button dark" disabled={!q} onClick={() => void copy()}><Icon name="check" size={17}/>{copied ? tx(lang, 'Copied', 'تم النسخ') : tx(lang, 'Copy the quote', 'انسخ عرض السعر')}</button>
        <a className={`button secondary${q ? '' : ' disabled'}`} href={q ? `https://wa.me/?text=${encodeURIComponent(message)}` : undefined} target="_blank" rel="noreferrer">{tx(lang, 'Send by WhatsApp', 'أرسل عبر واتساب')}</a>
        <button className="text-button" disabled={!q} onClick={csv}><Icon name="download" size={16}/>CSV</button>
      </div>
    </div>
    <div className="tip-card"><span className="tip-mark">i</span><p>{tx(lang, 'Machine time from the artwork is an estimate from path lengths; acceleration makes short, curvy jobs slower. Raise the travel allowance until it matches a job you have timed.', 'وقت الماكينة من التصميم تقدير من أطوال المسارات؛ التسارع يجعل الأعمال القصيرة المتعرجة أبطأ. ارفع هامش الحركة حتى يطابق عملاً وقّته بنفسك.')}</p></div>
  </div></div>;
}
