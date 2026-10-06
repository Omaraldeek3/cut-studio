/* Recraft's API, called straight from the browser with the user's own key.
   It is the one place Cut Studio sends anything out: the description and the
   key go to Recraft and nowhere else, and only when the user asks for a design.
   Recraft answers browser requests (CORS), so no server of ours sits between. */

export const RECRAFT_API = 'https://external.api.recraft.ai/v1';
/** Where a Recraft user creates an API key; it needs API units bought first. */
export const RECRAFT_KEYS_URL = 'https://app.recraft.ai/profile/api';
export const RECRAFT_PRICING_URL = 'https://www.recraft.ai/pricing?tab=api';
const KEY_STORE = 'cut-studio:recraft-key';

export type RecraftModel = { id: string; price: number; en: string; ar: string };
/** Vector models only: the answer is an SVG. Prices in US dollars per design. */
export const recraftModels: RecraftModel[] = [
  { id: 'recraftv4_1_vector', price: 0.08, en: 'Best quality', ar: 'أفضل جودة' },
  { id: 'recraftv2_vector', price: 0.044, en: 'Economy, for simple icons', ar: 'اقتصادي، للأيقونات البسيطة' },
];

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

/** The shapes Recraft's vector models draw, as width:height. */
export const ratios = ['1:1', '4:3', '3:4', '16:9', '2:1', '1:2'] as const;
export const MAX_DESCRIPTION = 600;

export function composePrompt(description: string, purpose: Purpose) {
  const text = description.trim().replace(/\s+/g, ' ').slice(0, MAX_DESCRIPTION);
  return purpose.hint ? `${text}. Style: ${purpose.hint}.` : text;
}

/** The estimated cost of one request, in dollars. */
export const estimate = (model: RecraftModel, count: number) => model.price * count;

const KEY_EVENT = 'cut-studio:recraft-key';
/** The key remembered on this computer, or '' (also on the server). */
export function storedKey() {
  try { return localStorage.getItem(KEY_STORE) ?? ''; } catch { return ''; }
}
export function storeKey(key: string) {
  try { if (key) localStorage.setItem(KEY_STORE, key); else localStorage.removeItem(KEY_STORE); } catch { /* private window: the key lives for this visit only */ }
  window.dispatchEvent(new Event(KEY_EVENT));
}
/** For useSyncExternalStore: tells a page when the remembered key changes, here or in another tab. */
export function watchStoredKey(onChange: () => void) {
  window.addEventListener(KEY_EVENT, onChange);
  window.addEventListener('storage', onChange);
  return () => { window.removeEventListener(KEY_EVENT, onChange); window.removeEventListener('storage', onChange); };
}

/** Turns a failed answer into a message the user can act on. */
async function failure(response: Response): Promise<Error> {
  let detail = '';
  try { const body = await response.json(); detail = String(body?.message ?? body?.error?.message ?? body?.code ?? ''); } catch { /* not JSON */ }
  if (response.status === 401 || response.status === 403) return new Error('Recraft did not accept this API key. Copy it again from your Recraft profile.');
  if (response.status === 402 || /credit|balance|units|insufficient/i.test(detail)) return new Error('Your Recraft balance is not enough for this design. Add API units in Recraft, then try again.');
  if (response.status === 429) return new Error('Recraft is limiting requests for a moment. Wait a minute and try again.');
  if (response.status === 400 && /prompt|content|moderat|safety/i.test(detail)) return new Error('Recraft would not draw this description. Change the wording and try again.');
  return new Error('Recraft could not make the design. Try again in a moment.');
}

async function call(key: string, path: string, init: RequestInit = {}) {
  let response: Response;
  try {
    response = await fetch(`${RECRAFT_API}${path}`, { ...init, headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' } });
  } catch (cause) {
    if (cause instanceof Error && cause.name === 'AbortError') throw cause;
    throw new Error('Recraft could not be reached. Check your internet connection.');
  }
  if (!response.ok) throw await failure(response);
  return response.json();
}

/** The account behind a key, with its remaining API units. Free to ask. */
export async function recraftAccount(key: string, signal?: AbortSignal): Promise<{ name: string; credits: number }> {
  const body = await call(key, '/users/me', { method: 'GET', signal });
  return { name: String(body?.name || body?.email || ''), credits: Number(body?.credits ?? NaN) };
}

function decodeBase64(text: string) {
  const binary = atob(text), bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

/** Asks for `count` vector designs and returns each as SVG text. */
export async function recraftGenerate(request: { key: string; prompt: string; model: string; ratio: string; count: number; signal?: AbortSignal }): Promise<string[]> {
  const body = await call(request.key, '/images/generations', {
    method: 'POST',
    signal: request.signal,
    body: JSON.stringify({ prompt: request.prompt, model: request.model, size: request.ratio, n: request.count, response_format: 'b64_json' }),
  });
  const items: { b64_json?: string }[] = Array.isArray(body?.data) ? body.data : [];
  const svgs = items.map(item => (item.b64_json ? decodeBase64(item.b64_json) : '')).filter(svg => /<svg[\s>]/i.test(svg));
  if (!svgs.length) throw new Error('Recraft could not make the design. Try again in a moment.');
  return svgs;
}

/** Draws an SVG onto a white canvas and returns it as a PNG, at `longSide`
 *  pixels on its longer side: the form the tracer and the upscaler take. */
export async function svgToPng(svg: string, longSide = 1500): Promise<Blob> {
  const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    // The viewBox gives the true shape when the file carries no width and height.
    const box = /viewBox\s*=\s*["']\s*[-\d.]+[\s,]+[-\d.]+[\s,]+([\d.]+)[\s,]+([\d.]+)/i.exec(svg);
    const w = box ? +box[1] : image.naturalWidth || 1024, h = box ? +box[2] : image.naturalHeight || 1024, scale = longSide / Math.max(w, h);
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
