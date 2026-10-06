/* Image models from the user's own account, called straight from the browser.
   This is the one place Cut Studio sends anything out: the description and the
   key go to the service the user picked and nowhere else, and only when the
   user asks for a design. Every service listed here answers browser requests
   (CORS), so no server of ours sits between. Services that do not (Replicate,
   Black Forest Labs' own API, Ideogram) are reached through fal.ai instead. */

export type ProviderId = 'recraft' | 'fal' | 'openai' | 'google' | 'together' | 'openrouter' | 'stability' | 'custom';
/** `price` is the service's published price for one picture of about a megapixel, in US dollars, as of 2026. */
export type Model = { id: string; en: string; ar: string; vector?: boolean; price?: number };
/** One drawing as it came back: an SVG for vector models, otherwise a picture. */
export type Result = { blob: Blob; svg?: string };
export type Request = { key: string; prompt: string; model: string; ratio: string; count: number; base?: string; signal?: AbortSignal };
export type Account = { name: string; credits?: number; unit?: [string, string] };
/** A model from a service's own list. */
export type Listed = { id: string; name: string };
export type Provider = {
  id: ProviderId; name: string; site: string;
  keysUrl: string; pricingUrl: string;
  /** How to get a key, in steps. */
  steps: [string, string][];
  models: Model[];
  /** Any model the service offers can be typed in, not only the listed ones. */
  anyModel?: boolean;
  /** The service is the user's own: its address is asked for. */
  needsBase?: boolean;
  generate: (r: Request) => Promise<Result[]>;
  /** Every image model the service offers, read from its own list; `keyed` when the list needs the key. */
  catalog?: { keyed: boolean; load: (key: string, signal?: AbortSignal) => Promise<Listed[]> };
  /** Checks a key without drawing anything, where the service allows it. */
  account?: (key: string, signal?: AbortSignal, base?: string) => Promise<Account>;
};

export type Purpose = { id: string; en: string; ar: string; note: [string, string]; hint: string; trace: string };
/** What the design is for. Each adds the words that steer the drawing to
 *  something a workshop can use, and names the tracing preset that suits it. */
export const purposes: Purpose[] = [
  { id: 'cut', en: 'Piece to laser cut', ar: 'قطعة للقص بالليزر', note: ['One solid shape, every part joined, so it cuts out in one piece.', 'شكل واحد مصمت، كل أجزائه متصلة، فيُقص قطعة واحدة.'], trace: 'cut',
    hint: 'a single solid black silhouette on a plain white background, bold simple shapes, every part connected so it cuts out as one piece, no thin lines, no text, no shading, no gradients' },
  { id: 'engrave', en: 'Line art to engrave', ar: 'رسم خطي للحفر', note: ['Black lines of an even weight on white, for engraving on wood or acrylic.', 'خطوط سوداء بسماكة واحدة على أبيض، للحفر على الخشب أو الأكريليك.'], trace: 'engrave',
    hint: 'black line art on a plain white background, clean outlines of an even weight, no shading, no gradients, no text' },
  { id: 'sticker', en: 'Sticker or print', ar: 'ستيكر أو طباعة', note: ['Flat colours with a white border, ready for print and cut.', 'ألوان مسطحة بحدّ أبيض، جاهزة للطباعة والقص.'], trace: 'logo',
    hint: 'flat vector sticker illustration, a few bold flat colours, a thick white outline around the whole design, plain white background, no text' },
  { id: 'icon', en: 'Icon or logo mark', ar: 'أيقونة أو رمز شعار', note: ['A simple centred mark in two or three colours.', 'رمز بسيط في الوسط بلونين أو ثلاثة.'], trace: 'logo',
    hint: 'simple flat vector icon, centred, two or three colours, plain white background, no text' },
  { id: 'free', en: 'Exactly as I wrote it', ar: 'كما كتبته تماماً', note: ['Nothing is added to your description.', 'لا يُضاف شيء إلى وصفك.'], trace: '', hint: '' },
];

/** The shapes on offer, as width:height. Each service gets its nearest size. */
export const ratios = ['1:1', '4:3', '3:4', '16:9', '9:16', '2:1', '1:2'] as const;
export const MAX_DESCRIPTION = 600;
export const MAX_COUNT = 4;

export function composePrompt(description: string, purpose: Purpose) {
  const text = description.trim().replace(/\s+/g, ' ').slice(0, MAX_DESCRIPTION);
  return purpose.hint ? `${text}. Style: ${purpose.hint}.` : text;
}

/** The cost of one request in dollars, where the price is known. */
export const estimate = (model: Model | undefined, count: number) => (model?.price !== undefined ? model.price * count : undefined);

// ——— Sizes ———

const parts = (ratio: string) => { const [w, h] = ratio.split(':').map(Number); return { w, h }; };
/** Pixel size for a ratio, `long` on the longer side, both multiples of 16. */
export function pixels(ratio: string, long = 1024) {
  const { w, h } = parts(ratio), even = (n: number) => Math.max(256, Math.round(n / 16) * 16);
  return w >= h ? { width: even(long), height: even((long * h) / w) } : { width: even((long * w) / h), height: even(long) };
}
/** The closest of a service's own ratios. */
export function nearest(ratio: string, options: string[]) {
  const { w, h } = parts(ratio), r = Math.log(w / h);
  return options.reduce((best, o) => { const p = parts(o); return Math.abs(Math.log(p.w / p.h) - r) < Math.abs(Math.log(parts(best).w / parts(best).h) - r) ? o : best; });
}

// ——— Keys ———

const KEY_EVENT = 'cut-studio:ai-key';
// Recraft keeps the name it had when it was the only service.
const keyStore = (id: ProviderId) => (id === 'recraft' ? 'cut-studio:recraft-key' : `cut-studio:${id}-key`);
const BASE_STORE = 'cut-studio:custom-base', PROVIDER_STORE = 'cut-studio:ai-provider';
const read = (name: string) => { try { return localStorage.getItem(name) ?? ''; } catch { return ''; } };
const write = (name: string, value: string) => {
  try { if (value) localStorage.setItem(name, value); else localStorage.removeItem(name); } catch { /* private window: kept for this visit only */ }
  window.dispatchEvent(new Event(KEY_EVENT));
};
/** The key remembered on this computer for a service, or '' (also on the server). */
export const storedKey = (id: ProviderId) => read(keyStore(id));
export const storeKey = (id: ProviderId, key: string) => write(keyStore(id), key);
/** The model last chosen for a service, so it is picked again next time. Not secret. */
export const storedModel = (id: ProviderId) => read(`cut-studio:${id}-model`);
export const storeModel = (id: ProviderId, model: string) => write(`cut-studio:${id}-model`, model);
export const storedBase = () => read(BASE_STORE);
export const storeBase = (base: string) => write(BASE_STORE, base);
/** The service last used, so a returning user lands on it. Not secret. */
export const storedProvider = (): ProviderId => { const id = read(PROVIDER_STORE); return (PROVIDERS.some(p => p.id === id) ? id : 'recraft') as ProviderId; };
export const storeProvider = (id: ProviderId) => write(PROVIDER_STORE, id);
/** For useSyncExternalStore: tells a page when a remembered value changes, here or in another tab. */
export function watchStore(onChange: () => void) {
  window.addEventListener(KEY_EVENT, onChange);
  window.addEventListener('storage', onChange);
  return () => { window.removeEventListener(KEY_EVENT, onChange); window.removeEventListener('storage', onChange); };
}

// ——— Calls ———

/** Turns a failed answer into a message the user can act on. */
async function failure(name: string, response: Response, model?: string): Promise<Error> {
  let detail = '';
  try {
    const text = await response.text();
    try { const body = JSON.parse(text); const e = Array.isArray(body) ? body[0] : body; detail = String(e?.message ?? e?.error?.message ?? (typeof e?.error === 'string' ? e.error : '') ?? e?.detail?.[0]?.msg ?? e?.detail ?? e?.errors?.[0] ?? e?.code ?? ''); if (detail === '[object Object]') detail = ''; }
    catch { detail = text.slice(0, 200); }
  } catch { /* no body */ }
  const own = name === 'The service';
  if (response.status === 401 || response.status === 403 || /api.?key|unauthori[sz]ed|invalid.*(token|key)/i.test(detail) && response.status < 500 && response.status !== 404) return new Error(`${name} did not accept this API key. Copy it again from ${own ? 'the service' : `your ${name} account`}.`);
  if (response.status === 402 || /credit|balance|insufficient|quota|billing|exhausted/i.test(detail)) return new Error(`${own ? 'Your balance with the service' : `Your ${name} balance`} is not enough for this design. Add credit, then try again.`);
  if (response.status === 429) return new Error(`${name} is limiting requests for a moment. Wait a minute and try again.`);
  if (response.status === 404 && model) return new Error(`${name} does not know the model “${model}”. Check its name on ${name}.`);
  if (/moderat|safety|content.?polic|nsfw|blocked|prohibited/i.test(detail)) return new Error(`${name} would not draw this description. Change the wording and try again.`);
  const short = detail.replace(/\s+/g, ' ').trim().slice(0, 160);
  return new Error(short && response.status < 500 ? `${name} could not make the design: ${short}` : `${name} could not make the design. Try again in a moment.`);
}

async function send(name: string, url: string, init: RequestInit, model?: string): Promise<Response> {
  let response: Response;
  try { response = await fetch(url, init); }
  catch (cause) {
    if (cause instanceof Error && cause.name === 'AbortError') throw cause;
    throw new Error(`${name} could not be reached. Check your internet connection.`);
  }
  if (!response.ok) throw await failure(name, response, model);
  return response;
}
const json = async (name: string, url: string, init: RequestInit, model?: string) => (await send(name, url, init, model)).json();
const post = (body: unknown, headers: Record<string, string>, signal?: AbortSignal): RequestInit => ({ method: 'POST', signal, headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) });

function bytes(base64: string) {
  const binary = atob(base64), out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}
const fromBase64 = (base64: string, type = 'image/png') => new Blob([bytes(base64)], { type });
/** A data URL or a web address, as a picture. */
async function fromUrl(name: string, url: string, signal?: AbortSignal): Promise<Blob> {
  const data = /^data:([^;,]+)?(;base64)?,([\s\S]*)$/.exec(url);
  if (data) return data[2] ? fromBase64(data[3], data[1] || 'image/png') : new Blob([decodeURIComponent(data[3])], { type: data[1] || 'image/png' });
  return (await send(name, url, { signal })).blob();
}
/** Runs single-picture requests one after another until `count` are made. */
async function each(count: number, one: () => Promise<Result[]>) {
  const out: Result[] = [];
  for (let i = 0; i < count; i++) out.push(...(await one()));
  return out;
}
function some(name: string, results: Result[]) {
  if (!results.length) throw new Error(`${name} could not make the design. Try again in a moment.`);
  return results;
}
const isSvg = (type: string) => /svg/i.test(type);
async function asResult(blob: Blob): Promise<Result> {
  return isSvg(blob.type) ? { blob, svg: await blob.text() } : { blob };
}

// ——— The services ———

const recraft: Provider = {
  id: 'recraft', name: 'Recraft', site: 'recraft.ai',
  keysUrl: 'https://app.recraft.ai/profile/api', pricingUrl: 'https://www.recraft.ai/pricing?tab=api',
  steps: [['Sign up at recraft.ai.', 'أنشئ حساباً في recraft.ai.'], ['Buy API units (separate from the monthly plan).', 'اشترِ وحدات API (منفصلة عن الاشتراك الشهري).'], ['Create a key on your profile page and paste it here.', 'أنشئ مفتاحاً من صفحة ملفك والصقه هنا.']],
  models: [
    { id: 'recraftv4_1_vector', price: 0.08, vector: true, en: 'Vector, best quality', ar: 'فيكتور، أفضل جودة' },
    { id: 'recraftv2_vector', price: 0.044, vector: true, en: 'Vector, economy for simple icons', ar: 'فيكتور اقتصادي للأيقونات البسيطة' },
    { id: 'recraftv3', price: 0.04, en: 'Picture (Recraft V3)', ar: 'صورة (Recraft V3)' },
  ],
  async generate(r) {
    const vector = /vector/.test(r.model), size = nearest(r.ratio, ['1:1', '4:3', '3:4', '16:9', '9:16', '2:1', '1:2']);
    const body = await json('Recraft', 'https://external.api.recraft.ai/v1/images/generations', post({ prompt: r.prompt, model: r.model, size, n: r.count, response_format: 'b64_json' }, { Authorization: `Bearer ${r.key}` }, r.signal), r.model);
    const items: { b64_json?: string }[] = Array.isArray(body?.data) ? body.data : [];
    return some('Recraft', items.flatMap(item => {
      if (!item.b64_json) return [];
      if (!vector) return [{ blob: fromBase64(item.b64_json, 'image/webp') }];
      const svg = new TextDecoder().decode(bytes(item.b64_json));
      return /<svg[\s>]/i.test(svg) ? [{ blob: new Blob([svg], { type: 'image/svg+xml' }), svg }] : [];
    }));
  },
  async account(key, signal) {
    const body = await json('Recraft', 'https://external.api.recraft.ai/v1/users/me', { signal, headers: { Authorization: `Bearer ${key}` } });
    return { name: String(body?.name || body?.email || ''), credits: Number(body?.credits ?? NaN), unit: ['units', 'وحدة'] };
  },
};

const fal: Provider = {
  id: 'fal', name: 'fal.ai', site: 'fal.ai',
  keysUrl: 'https://fal.ai/dashboard/keys', pricingUrl: 'https://fal.ai/pricing',
  steps: [['Sign up at fal.ai and add credit under Billing.', 'أنشئ حساباً في fal.ai وأضف رصيداً من صفحة Billing.'], ['Create a key under Keys and paste it here.', 'أنشئ مفتاحاً من صفحة Keys والصقه هنا.'], ['Any model on fal.ai works: copy its name from its page, such as fal-ai/flux/dev.', 'يعمل أي نموذج على fal.ai: انسخ اسمه من صفحته، مثل fal-ai/flux/dev.']],
  anyModel: true,
  models: [
    { id: 'fal-ai/flux/schnell', price: 0.003, en: 'FLUX.1 schnell, fast and cheap', ar: 'FLUX.1 schnell، سريع ورخيص' },
    { id: 'fal-ai/flux/dev', price: 0.025, en: 'FLUX.1 dev', ar: 'FLUX.1 dev' },
    { id: 'fal-ai/flux-pro/v1.1', price: 0.04, en: 'FLUX 1.1 pro', ar: 'FLUX 1.1 pro' },
    { id: 'fal-ai/flux-pro/kontext/text-to-image', price: 0.04, en: 'FLUX Kontext pro', ar: 'FLUX Kontext pro' },
    { id: 'fal-ai/recraft/v3/text-to-image', price: 0.04, en: 'Recraft V3 on fal', ar: 'Recraft V3 عبر fal' },
    { id: 'fal-ai/ideogram/v3', price: 0.06, en: 'Ideogram 3', ar: 'Ideogram 3' },
    { id: 'fal-ai/bytedance/seedream/v4/text-to-image', price: 0.03, en: 'Seedream 4', ar: 'Seedream 4' },
    { id: 'fal-ai/nano-banana', price: 0.039, en: 'Gemini image (Nano Banana)', ar: 'صور Gemini (Nano Banana)' },
  ],
  catalog: {
    keyed: false,
    async load(_key, signal) {
      const out: Listed[] = [];
      let cursor = '';
      for (let page = 0; page < 10; page++) {
        const body = await json('fal.ai', `https://api.fal.ai/v1/models?category=text-to-image&limit=100${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`, { signal });
        for (const m of body?.models ?? []) if (m?.endpoint_id && m?.metadata?.status !== 'deprecated') out.push({ id: m.endpoint_id, name: String(m.metadata?.display_name || m.endpoint_id) });
        if (!body?.has_more || !body?.next_cursor) break;
        cursor = body.next_cursor;
      }
      return out;
    },
  },
  async generate(r) {
    const size = pixels(r.ratio, 1024), model = r.model.trim().replace(/^https?:\/\/(queue\.)?fal\.run\//, '').replace(/^\/+|\/+$/g, '');
    const body = await json('fal.ai', `https://fal.run/${model}`, post({ prompt: r.prompt, num_images: r.count, image_size: size, aspect_ratio: nearest(r.ratio, ['1:1', '4:3', '3:4', '16:9', '9:16', '21:9', '9:21']), sync_mode: true }, { Authorization: `Key ${r.key}` }, r.signal), model);
    const images: { url?: string }[] = Array.isArray(body?.images) ? body.images : body?.image ? [body.image] : [];
    return some('fal.ai', await Promise.all(images.filter(i => i.url).map(async i => asResult(await fromUrl('fal.ai', i.url!, r.signal)))));
  },
};

const openai: Provider = {
  id: 'openai', name: 'OpenAI', site: 'platform.openai.com',
  keysUrl: 'https://platform.openai.com/api-keys', pricingUrl: 'https://openai.com/api/pricing/',
  steps: [['Sign in at platform.openai.com and add credit under Billing.', 'سجّل الدخول في platform.openai.com وأضف رصيداً من Billing.'], ['GPT Image needs a verified organisation (Settings → Organization).', 'نماذج GPT Image تحتاج منظمة موثّقة (Settings ← Organization).'], ['Create a key under API keys and paste it here.', 'أنشئ مفتاحاً من API keys والصقه هنا.']],
  anyModel: true,
  models: [
    { id: 'gpt-image-1', price: 0.042, en: 'GPT Image 1', ar: 'GPT Image 1' },
    { id: 'gpt-image-1-mini', price: 0.011, en: 'GPT Image 1 mini, cheaper', ar: 'GPT Image 1 mini، أرخص' },
    { id: 'dall-e-3', price: 0.04, en: 'DALL·E 3', ar: 'DALL·E 3' },
  ],
  async generate(r) {
    const dalle = /^dall-e/.test(r.model), wide = parts(r.ratio).w > parts(r.ratio).h, tall = parts(r.ratio).w < parts(r.ratio).h;
    const size = dalle ? (wide ? '1792x1024' : tall ? '1024x1792' : '1024x1024') : (wide ? '1536x1024' : tall ? '1024x1536' : '1024x1024');
    const one = async (n: number) => {
      const body = await json('OpenAI', 'https://api.openai.com/v1/images/generations', post({ model: r.model, prompt: r.prompt, n, size, ...(dalle ? { response_format: 'b64_json' } : {}) }, { Authorization: `Bearer ${r.key}` }, r.signal), r.model);
      return openAiImages('OpenAI', body, r.signal);
    };
    // DALL·E 3 draws one picture per request.
    return some('OpenAI', r.model === 'dall-e-3' ? await each(r.count, () => one(1)) : await one(r.count));
  },
  catalog: {
    keyed: true,
    async load(key, signal) {
      const body = await json('OpenAI', 'https://api.openai.com/v1/models', { signal, headers: { Authorization: `Bearer ${key}` } });
      return (body?.data ?? []).map((m: { id: string }) => m.id).filter((id: string) => /^(gpt-image|dall-e|chatgpt-image)/.test(id)).sort().map((id: string) => ({ id, name: id }));
    },
  },
  async account(key, signal) {
    await json('OpenAI', 'https://api.openai.com/v1/models', { signal, headers: { Authorization: `Bearer ${key}` } });
    return { name: '' };
  },
};

/** The answer shape OpenAI made common: data[] with b64_json or a url. */
async function openAiImages(name: string, body: { data?: { b64_json?: string; url?: string }[] }, signal?: AbortSignal): Promise<Result[]> {
  const items = Array.isArray(body?.data) ? body.data : [];
  return Promise.all(items.filter(i => i.b64_json || i.url).map(async i => asResult(i.b64_json ? fromBase64(i.b64_json) : await fromUrl(name, i.url!, signal))));
}

const GOOGLE = 'https://generativelanguage.googleapis.com/v1beta';
const google: Provider = {
  id: 'google', name: 'Google AI', site: 'aistudio.google.com',
  keysUrl: 'https://aistudio.google.com/apikey', pricingUrl: 'https://ai.google.dev/gemini-api/docs/pricing',
  steps: [['Sign in at aistudio.google.com with a Google account.', 'سجّل الدخول في aistudio.google.com بحساب Google.'], ['Create an API key and paste it here.', 'أنشئ مفتاح API والصقه هنا.'], ['Image models need billing turned on for the key\'s project.', 'نماذج الصور تحتاج تفعيل الفوترة لمشروع المفتاح.']],
  anyModel: true,
  models: [
    { id: 'gemini-2.5-flash-image', price: 0.039, en: 'Gemini 2.5 Flash Image (Nano Banana)', ar: 'Gemini 2.5 Flash Image (Nano Banana)' },
    { id: 'imagen-4.0-generate-001', price: 0.04, en: 'Imagen 4', ar: 'Imagen 4' },
    { id: 'imagen-4.0-fast-generate-001', price: 0.02, en: 'Imagen 4 Fast', ar: 'Imagen 4 Fast' },
    { id: 'imagen-4.0-ultra-generate-001', price: 0.06, en: 'Imagen 4 Ultra', ar: 'Imagen 4 Ultra' },
  ],
  async generate(r) {
    const aspectRatio = nearest(r.ratio, ['1:1', '4:3', '3:4', '16:9', '9:16']), model = r.model.trim().replace(/^models\//, '');
    const headers = { 'x-goog-api-key': r.key };
    if (/^imagen/.test(model)) {
      const body = await json('Google AI', `${GOOGLE}/models/${model}:predict`, post({ instances: [{ prompt: r.prompt }], parameters: { sampleCount: r.count, aspectRatio } }, headers, r.signal), model);
      const items: { bytesBase64Encoded?: string; mimeType?: string }[] = Array.isArray(body?.predictions) ? body.predictions : [];
      return some('Google AI', items.filter(i => i.bytesBase64Encoded).map(i => ({ blob: fromBase64(i.bytesBase64Encoded!, i.mimeType || 'image/png') })));
    }
    // Gemini answers one picture per request.
    return some('Google AI', await each(r.count, async () => {
      const body = await json('Google AI', `${GOOGLE}/models/${model}:generateContent`, post({ contents: [{ parts: [{ text: r.prompt }] }], generationConfig: { responseModalities: ['IMAGE'], imageConfig: { aspectRatio } } }, headers, r.signal), model);
      const found: { inlineData?: { data: string; mimeType?: string } }[] = body?.candidates?.[0]?.content?.parts ?? [];
      return found.filter(p => p.inlineData?.data).map(p => ({ blob: fromBase64(p.inlineData!.data, p.inlineData!.mimeType || 'image/png') }));
    }));
  },
  catalog: {
    keyed: true,
    async load(key, signal) {
      const out: Listed[] = [];
      let token = '';
      for (let page = 0; page < 5; page++) {
        const body = await json('Google AI', `${GOOGLE}/models?pageSize=1000${token ? `&pageToken=${token}` : ''}`, { signal, headers: { 'x-goog-api-key': key } });
        for (const m of body?.models ?? []) {
          const id = String(m?.name ?? '').replace(/^models\//, '');
          if (/^imagen/.test(id) || /image/.test(id) && (m?.supportedGenerationMethods ?? []).includes('generateContent')) out.push({ id, name: String(m?.displayName || id) });
        }
        if (!body?.nextPageToken) break;
        token = body.nextPageToken;
      }
      return out;
    },
  },
  async account(key, signal) {
    await json('Google AI', `${GOOGLE}/models?pageSize=1`, { signal, headers: { 'x-goog-api-key': key } });
    return { name: '' };
  },
};

const together: Provider = {
  id: 'together', name: 'Together AI', site: 'together.ai',
  keysUrl: 'https://api.together.ai/settings/api-keys', pricingUrl: 'https://www.together.ai/pricing',
  steps: [['Sign up at together.ai and add credit.', 'أنشئ حساباً في together.ai وأضف رصيداً.'], ['Copy your API key from Settings → API keys and paste it here.', 'انسخ مفتاحك من Settings ← API keys والصقه هنا.']],
  anyModel: true,
  models: [
    { id: 'black-forest-labs/FLUX.1-schnell', price: 0.003, en: 'FLUX.1 schnell', ar: 'FLUX.1 schnell' },
    { id: 'black-forest-labs/FLUX.1-dev', price: 0.025, en: 'FLUX.1 dev', ar: 'FLUX.1 dev' },
    { id: 'black-forest-labs/FLUX.1.1-pro', price: 0.04, en: 'FLUX 1.1 pro', ar: 'FLUX 1.1 pro' },
    { id: 'black-forest-labs/FLUX.1-kontext-pro', price: 0.04, en: 'FLUX Kontext pro', ar: 'FLUX Kontext pro' },
  ],
  async generate(r) {
    const { width, height } = pixels(r.ratio, 1024);
    const body = await json('Together AI', 'https://api.together.xyz/v1/images/generations', post({ model: r.model, prompt: r.prompt, width, height, n: r.count, response_format: 'b64_json' }, { Authorization: `Bearer ${r.key}` }, r.signal), r.model);
    return some('Together AI', await openAiImages('Together AI', body, r.signal));
  },
  catalog: {
    keyed: true,
    async load(key, signal) {
      const body = await json('Together AI', 'https://api.together.xyz/v1/models', { signal, headers: { Authorization: `Bearer ${key}` } });
      const all: { id?: string; type?: string; display_name?: string }[] = Array.isArray(body) ? body : body?.data ?? [];
      return all.filter(m => m.id && m.type === 'image').map(m => ({ id: m.id!, name: m.display_name || m.id! }));
    },
  },
  async account(key, signal) {
    await json('Together AI', 'https://api.together.xyz/v1/models', { signal, headers: { Authorization: `Bearer ${key}` } });
    return { name: '' };
  },
};

const openrouter: Provider = {
  id: 'openrouter', name: 'OpenRouter', site: 'openrouter.ai',
  keysUrl: 'https://openrouter.ai/settings/keys', pricingUrl: 'https://openrouter.ai/models?output_modalities=image',
  steps: [['Sign up at openrouter.ai and buy credits.', 'أنشئ حساباً في openrouter.ai واشترِ رصيداً.'], ['Create a key under Keys and paste it here.', 'أنشئ مفتاحاً من Keys والصقه هنا.'], ['Any model that outputs images works: copy its name from its page.', 'يعمل أي نموذج يخرج صوراً: انسخ اسمه من صفحته.']],
  anyModel: true,
  models: [
    { id: 'google/gemini-2.5-flash-image', price: 0.039, en: 'Gemini 2.5 Flash Image', ar: 'Gemini 2.5 Flash Image' },
  ],
  catalog: {
    keyed: false,
    async load(_key, signal) {
      const body = await json('OpenRouter', 'https://openrouter.ai/api/v1/models?output_modalities=image', { signal });
      return (body?.data ?? []).filter((m: { id?: string }) => m.id).map((m: { id: string; name?: string }) => ({ id: m.id, name: m.name || m.id }));
    },
  },
  async generate(r) {
    return some('OpenRouter', await each(r.count, async () => {
      const body = await json('OpenRouter', 'https://openrouter.ai/api/v1/chat/completions', post({ model: r.model, messages: [{ role: 'user', content: r.prompt }], modalities: ['image', 'text'], image_config: { aspect_ratio: nearest(r.ratio, ['1:1', '4:3', '3:4', '16:9', '9:16', '21:9']) } }, { Authorization: `Bearer ${r.key}`, 'X-Title': 'Cut Studio' }, r.signal), r.model);
      const images: { image_url?: { url?: string } }[] = body?.choices?.[0]?.message?.images ?? [];
      return Promise.all(images.filter(i => i.image_url?.url).map(async i => asResult(await fromUrl('OpenRouter', i.image_url!.url!, r.signal))));
    }));
  },
  async account(key, signal) {
    const body = await json('OpenRouter', 'https://openrouter.ai/api/v1/key', { signal, headers: { Authorization: `Bearer ${key}` } });
    const d = body?.data ?? {}, left = d.limit_remaining ?? (d.limit != null ? d.limit - (d.usage ?? 0) : undefined);
    return { name: String(d.label ?? ''), credits: left != null ? Math.round(left * 100) / 100 : undefined, unit: ['dollars left on this key', 'دولار متبقٍ لهذا المفتاح'] };
  },
};

const stability: Provider = {
  id: 'stability', name: 'Stability AI', site: 'platform.stability.ai',
  keysUrl: 'https://platform.stability.ai/account/keys', pricingUrl: 'https://platform.stability.ai/pricing',
  steps: [['Sign up at platform.stability.ai and buy credits.', 'أنشئ حساباً في platform.stability.ai واشترِ رصيداً.'], ['Copy your key from Account → API keys and paste it here.', 'انسخ مفتاحك من Account ← API keys والصقه هنا.']],
  models: [
    { id: 'core', price: 0.03, en: 'Stable Image Core', ar: 'Stable Image Core' },
    { id: 'ultra', price: 0.08, en: 'Stable Image Ultra', ar: 'Stable Image Ultra' },
    { id: 'sd3', price: 0.065, en: 'Stable Diffusion 3.5', ar: 'Stable Diffusion 3.5' },
  ],
  async generate(r) {
    return some('Stability AI', await each(r.count, async () => {
      const form = new FormData();
      form.append('prompt', r.prompt);
      form.append('aspect_ratio', nearest(r.ratio, ['1:1', '3:2', '2:3', '5:4', '4:5', '16:9', '9:16', '21:9', '9:21']));
      form.append('output_format', 'png');
      const response = await send('Stability AI', `https://api.stability.ai/v2beta/stable-image/generate/${r.model}`, { method: 'POST', signal: r.signal, headers: { Authorization: `Bearer ${r.key}`, Accept: 'image/*' }, body: form }, r.model);
      return [{ blob: await response.blob() }];
    }));
  },
  async account(key, signal) {
    const body = await json('Stability AI', 'https://api.stability.ai/v1/user/balance', { signal, headers: { Authorization: `Bearer ${key}` } });
    return { name: '', credits: Number(body?.credits ?? NaN), unit: ['credits', 'رصيد'] };
  },
};

/** Any service that speaks OpenAI's images API: a local server, or another host. */
const custom: Provider = {
  id: 'custom', name: 'Custom service', site: '',
  keysUrl: '', pricingUrl: '',
  steps: [['Enter the service\'s API address, ending before /images/generations (for example https://api.example.com/v1).', 'أدخل عنوان API للخدمة، قبل /images/generations (مثل https://api.example.com/v1).'], ['The service must allow browser requests (CORS).', 'يجب أن تسمح الخدمة بطلبات المتصفح (CORS).']],
  anyModel: true, needsBase: true,
  models: [],
  async generate(r) {
    const base = (r.base ?? '').trim().replace(/\/+$/, '');
    if (!/^https?:\/\//.test(base)) throw new Error('Enter the service address, starting with https://.');
    const { width, height } = pixels(r.ratio, 1024);
    const body = await json('The service', `${base}/images/generations`, post({ model: r.model, prompt: r.prompt, n: r.count, size: `${width}x${height}`, response_format: 'b64_json' }, r.key ? { Authorization: `Bearer ${r.key}` } : {}, r.signal), r.model);
    return some('The service', await openAiImages('The service', body, r.signal));
  },
};

export const PROVIDERS: Provider[] = [recraft, fal, openai, google, together, openrouter, stability, custom];
export const provider = (id: ProviderId) => PROVIDERS.find(p => p.id === id)!;

// ——— Pictures ———

/** Draws an SVG or a picture onto a white canvas and returns it as a PNG, at
 *  `longSide` pixels on its longer side: the form the tracer and the upscaler take. */
export async function toPng(result: Result, longSide = 1500): Promise<Blob> {
  const url = URL.createObjectURL(result.blob);
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    // The viewBox gives the true shape when an SVG carries no width and height.
    const box = result.svg ? /viewBox\s*=\s*["']\s*[-\d.]+[\s,]+[-\d.]+[\s,]+([\d.]+)[\s,]+([\d.]+)/i.exec(result.svg) : null;
    const w = box ? +box[1] : image.naturalWidth || 1024, h = box ? +box[2] : image.naturalHeight || 1024;
    const scale = result.svg ? longSide / Math.max(w, h) : Math.min(1, longSide / Math.max(w, h));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(w * scale);
    canvas.height = Math.round(h * scale);
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Canvas is unavailable in this browser.');
    context.fillStyle = '#fff';
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    return await new Promise<Blob>((resolve, reject) => canvas.toBlob(blob => (blob ? resolve(blob) : reject(new Error('Canvas is unavailable in this browser.'))), 'image/png'));
  } finally {
    URL.revokeObjectURL(url);
  }
}
