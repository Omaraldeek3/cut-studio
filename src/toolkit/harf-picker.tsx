'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import { tx, type Language } from './copy';
import { HARF_URL, harfCatalogue, harfCategories, harfFileUrl, previewFamily, weightNames, type HarfFont } from './harf';

/* Harf's Arabic fonts as a list of cards, each showing the text being set in
   that font. A card loads its font only once it scrolls into view, so opening
   the list costs one small file, not two hundred fonts. */

function FontCard({ font, sample, selected, onPick, lang }: { font: HarfFont; sample: string; selected: boolean; onPick: () => void; lang: Language }) {
  const card = useRef<HTMLButtonElement>(null);
  const [family, setFamily] = useState('');
  useEffect(() => {
    const node = card.current;
    if (!node || family) return;
    const watch = new IntersectionObserver(entries => {
      if (!entries.some(e => e.isIntersecting)) return;
      watch.disconnect();
      previewFamily(font).then(setFamily, () => setFamily('inherit'));
    }, { rootMargin: '120px' });
    watch.observe(node);
    return () => watch.disconnect();
  }, [font, family]);
  const category = harfCategories.find(c => c.id === font.category);
  return <button ref={card} type="button" role="option" aria-selected={selected} className={`harf-card${selected ? ' selected' : ''}`} onClick={onPick}>
    <span className="harf-sample" dir="auto" style={family ? { fontFamily: `${family}, var(--tool-arabic)` } : undefined} aria-hidden="true">{family ? sample : '…'}</span>
    <span className="harf-name"><b dir="ltr">{font.family}</b><small>{category ? tx(lang, category.en, category.ar) : font.category} · <bdi dir="ltr">{font.licence === 'Open' ? tx(lang, 'open licence', 'رخصة مفتوحة') : font.licence}</bdi></small></span>
  </button>;
}

export function HarfPicker({ lang, text, selected, weight, onPick, onWeight }: { lang: Language; text: string; selected: HarfFont | null; weight: number; onPick: (font: HarfFont) => void; onWeight: (weight: number) => void }) {
  const [fonts, setFonts] = useState<HarfFont[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('');
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let live = true;
    harfCatalogue().then(list => { if (live) { setFonts(list); setFailed(false); } }, () => { if (live) setFailed(true); });
    return () => { live = false; };
  }, [attempt]);
  const sample = useMemo(() => text.split('\n').find(line => line.trim())?.trim().slice(0, 28) || 'خط عربي جميل', [text]);
  const needle = query.trim().toLowerCase();
  const shown = useMemo(() => (fonts ?? []).filter(f => (!category || f.category === category) && (!needle || f.family.toLowerCase().includes(needle) || f.designers.some(d => d.toLowerCase().includes(needle)))), [fonts, category, needle]);
  return <div className="harf-picker">
    <div className="harf-head"><b>{tx(lang, 'Harf fonts', 'خطوط حرف')}</b><span>{fonts ? tx(lang, `${fonts.length} free Arabic fonts`, `${fonts.length} خطاً عربياً مجانياً`) : ''}</span></div>
    {failed ? <div className="harf-failed"><p>{tx(lang, 'The Harf font library could not be reached. Check the internet connection, or use Tajawal or a font on this computer below.', 'تعذّر الوصول إلى مكتبة خطوط حرف. تأكد من الاتصال بالإنترنت، أو استخدم تجوال أو خطاً من جهازك في الأسفل.')}</p><button type="button" className="text-button" onClick={() => setAttempt(a => a + 1)}>{tx(lang, 'Try again', 'حاول مرة أخرى')}</button></div> : <>
      <input className="harf-search" type="search" value={query} onChange={e => setQuery(e.target.value)} placeholder={tx(lang, 'Search by font or designer', 'ابحث باسم الخط أو المصمم')} aria-label={tx(lang, 'Search Harf fonts', 'ابحث في خطوط حرف')} />
      <div className="harf-cats" role="group" aria-label={tx(lang, 'Font style', 'نوع الخط')}>{harfCategories.map(c => <button key={c.id || 'all'} type="button" className={category === c.id ? 'selected' : ''} onClick={() => setCategory(c.id)}>{tx(lang, c.en, c.ar)}</button>)}</div>
      <div className="harf-list" role="listbox" aria-label={tx(lang, 'Harf fonts', 'خطوط حرف')}>
        {!fonts ? <p className="micro">{tx(lang, 'Loading the font list…', 'جارٍ تحميل قائمة الخطوط…')}</p>
          : shown.length ? shown.map(font => <FontCard key={font.id} font={font} sample={sample} selected={selected?.id === font.id} onPick={() => onPick(font)} lang={lang} />)
          : <p className="micro">{tx(lang, 'No font matches that.', 'لا يوجد خط بهذا الاسم.')}</p>}
      </div>
    </>}
    {selected && selected.weights.length > 1 && <div className="preset-row harf-weights" role="group" aria-label={tx(lang, 'Weight', 'السماكة')}>{selected.weights.map(w => <button key={w} type="button" className={weight === w ? 'selected' : ''} onClick={() => onWeight(w)}>{weightNames[w] ? tx(lang, weightNames[w][0], weightNames[w][1]) : w}</button>)}</div>}
    {selected && <p className="micro harf-licence">{tx(lang, 'Free to use; its licence: ', 'مجاني للاستخدام، ورخصته: ')}<a href={harfFileUrl(selected.licenceFile)} target="_blank" rel="noopener">{selected.licence === 'Open' ? tx(lang, 'open licence', 'رخصة مفتوحة') : selected.licence}</a>{' · '}<a href={HARF_URL} target="_blank" rel="noopener">{tx(lang, 'more in Harf', 'المزيد في حرف')}</a></p>}
  </div>;
}
