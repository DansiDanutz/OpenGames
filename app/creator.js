/* creator.json, beside a game: where its creator can be supported, and one sponsor. OpenGames never touches the money.
   { "support": "https://ko-fi.com/name", "sponsor": { "name": "...", "text": "...", "url": "https://..." } }
   It is approved like every other file, but two players with different lines can still meet. */
export const CREATOR_FILE = 'creator.json';
/* Pages where somebody can be supported, and what comes after the host. */
const SUPPORT = { 'github.com': /^\/sponsors\/[\w-]{1,39}$/, 'ko-fi.com': /^\/\w{1,60}$/, 'buymeacoffee.com': /^\/[\w.-]{1,60}$/, 'www.patreon.com': /^\/[\w-]{1,60}$/,
  'liberapay.com': /^\/[\w.-]{1,60}$/, 'opencollective.com': /^\/[\w-]{1,60}$/,
  'nervixpay.live': /^\/l\/[\da-f]{8}(-[\da-f]{4}){3}-[\da-f]{12}$/ };
/* What a player should know before they open the page, for the places where it is not an ordinary payment. */
const NOTES = { 'nervixpay.live': 'Payment there is in crypto, on NervixPay. Ask an adult first.' };
const MAX_URL = 200, MAX_BYTES = 2048, KEYS = ['support', 'sponsor'], SPONSOR_KEYS = ['name', 'text', 'url'];

const isObject = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
const onlyHas = (v, keys) => Object.keys(v).every((k) => keys.includes(k));
/* One line, without characters that are invisible or turn the text around. The only space is the plain one. */
const HIDDEN = /[\p{C}\p{Default_Ignorable_Code_Point}\u2800]|(?! )\p{Z}/u;
export const isLine = (v, max) => typeof v === 'string' && v.trim() === v && v.length > 0 && v.length <= max && !HIDDEN.test(v);
/* A plain web address with a name of plain letters, so that what is shown is where it goes. */
function webAddress(v) {
  if (typeof v !== 'string' || v.length > MAX_URL || !/^https:\/\/[\x21-\x7e]+$/.test(v) || !URL.canParse(v)) return null;
  const url = new URL(v);
  const isName = /^(?!xn--)[a-z0-9-]+(\.(?!xn--)[a-z0-9-]+)*\.[a-z]{2,}$/.test(url.hostname);
  return isName && !url.port && !url.username && !url.password ? url : null;
}
export function readCreator(data) {
  if (!data) return { support: null, sponsor: null };
  if (data.length > MAX_BYTES) throw new Error(`${CREATOR_FILE} is too large`);
  const c = JSON.parse(data.toString('utf8'));
  if (!isObject(c) || !onlyHas(c, KEYS)) throw new Error(`${CREATOR_FILE} may only have support and sponsor`);
  if (c.support !== undefined) {
    const url = webAddress(c.support);
    if (!url || url.search || url.hash || !(Object.hasOwn(SUPPORT, url.hostname) && SUPPORT[url.hostname].test(url.pathname))) throw new Error(`support must be a page at ${Object.keys(SUPPORT).join(', ')}`);
  }
  const s = c.sponsor;
  if (s !== undefined && !(isObject(s) && onlyHas(s, SPONSOR_KEYS) && isLine(s.name, 40) && isLine(s.text, 80) && webAddress(s.url))) throw new Error('sponsor must have a name, one line of text and an https address');
  const support = c.support ? new URL(c.support) : null, note = support && NOTES[support.hostname];
  return { support: support?.href ?? null, sponsor: s ? { name: s.name, text: s.text, url: new URL(s.url).href } : null, ...(note && { supportNote: note }) };
}
