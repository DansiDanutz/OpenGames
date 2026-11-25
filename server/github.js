/* Public facts about the repository on GitHub, for the admin view: stars, forks, watchers and pull requests.
   No token: only what anybody can read. It writes nothing. A failure gives no facts and a short reason. */
const REPO = 'DansiDanutz/OpenGames', OWNER = 'DansiDanutz';
export const CREATORS_ROOM = 'https://github.com/DansiDanutz/OpenGames-creators/settings/access';
const LIMITS = { ttlMs: 10 * 60 * 1000, failedTtlMs: 60 * 1000, timeoutMs: 8000, maxBytes: 2 * 1024 * 1024, open: 20, merged: 10, closedPage: 30, titleLength: 200 };
const LOGIN = /^[A-Za-z0-9-]{1,39}(?:\[bot\])?$/;
const GAME_FILE = /^games\/([a-z0-9-]{1,40})\//;
const PULL_URL = /^https:\/\/github\.com\/[A-Za-z0-9-]{1,39}\/[A-Za-z0-9._-]{1,100}\/pull\/\d{1,9}$/;
const TIME = /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/;

/* What a person reads, not what went wrong inside. */
class Failure extends Error {}
const reasonOf = (error) => {
  if (error instanceof Failure) return error.message;
  if (error?.name === 'TimeoutError' || error?.name === 'AbortError') return 'GitHub did not answer in time';
  return 'GitHub cannot be reached';
};
const count = (v) => (Number.isSafeInteger(v) && v >= 0 ? v : 0);
const text = (v, most) => (typeof v === 'string' ? v.slice(0, most) : '');
const login = (user) => (typeof user?.login === 'string' && LOGIN.test(user.login) ? user.login : null);
const time = (v) => (typeof v === 'string' && TIME.test(v) ? v : null);

async function readCapped(res, most) {
  if (Number(res.headers.get('content-length')) > most) throw new Failure('GitHub sent too much');
  if (!res.body) return '';
  const reader = res.body.getReader(), parts = [];
  let bytes = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    bytes += value.length;
    if (bytes > most) { await reader.cancel(); throw new Failure('GitHub sent too much'); }
    parts.push(value);
  }
  return Buffer.concat(parts).toString('utf8');
}
/* One GET of the public API. isList: the answer must be an array, else an object. */
async function getJson(fetch, url, { signal, maxBytes }, isList) {
  const res = await fetch(url, { headers: { accept: 'application/vnd.github+json', 'user-agent': 'OpenGames-server', 'x-github-api-version': '2022-11-28' }, redirect: 'error', signal });
  if (!res.ok) { await res.body?.cancel(); throw new Failure(`GitHub answered ${res.status}`); }
  let data;
  try { data = JSON.parse(await readCapped(res, maxBytes)); } catch (error) { if (error instanceof Failure) throw error; throw new Failure('GitHub sent something unexpected'); }
  if (Array.isArray(data) !== isList || data === null || typeof data !== 'object') throw new Failure('GitHub sent something unexpected');
  return data;
}

const isPull = (p) => p && typeof p === 'object' && Number.isSafeInteger(p.number) && p.number > 0;
const gamesIn = (files) => [...new Set(files.map((f) => GAME_FILE.exec(typeof f?.filename === 'string' ? f.filename : '')?.[1]).filter(Boolean))].sort();
const pullOf = (p, L) => ({ number: p.number, title: text(p.title, L.titleLength), author: login(p.user), url: typeof p.html_url === 'string' && PULL_URL.test(p.html_url) ? p.html_url : null });

/* fetch: injected for tests. clock: for the cache. */
export function createGitHub({ fetch = globalThis.fetch, clock = Date.now, repo = REPO, owner = OWNER, limits = {} } = {}) {
  const L = { ...LIMITS, ...limits }, api = `https://api.github.com/repos/${repo}`;
  let kept = null, asking = null, files = new Map();      // files: `${number}@${sha}` -> game ids, which only change with a new commit

  async function gamesOf(p, ask) {
    const key = `${p.number}@${text(p.head?.sha, 64)}`;
    if (files.has(key)) return { key, games: files.get(key) };
    try { return { key, games: gamesIn(await ask(`${api}/pulls/${p.number}/files?per_page=100`, true)) }; } catch { return { key, games: null }; }
  }
  async function openPulls(ask) {
    const pulls = (await ask(`${api}/pulls?state=open&sort=created&direction=desc&per_page=${L.open}`, true)).filter(isPull).slice(0, L.open);
    const found = await Promise.all(pulls.map((p) => gamesOf(p, ask)));
    files = new Map(found.filter((f) => f.games !== null).map((f) => [f.key, f.games]));
    return pulls.map((p, i) => ({ ...pullOf(p, L), createdAt: time(p.created_at), games: found[i].games }));
  }
  async function mergedPulls(ask) {
    const closed = (await ask(`${api}/pulls?state=closed&sort=updated&direction=desc&per_page=${L.closedPage}`, true)).filter((p) => isPull(p) && time(p.merged_at));
    return closed.toSorted((a, b) => b.merged_at.localeCompare(a.merged_at)).slice(0, L.merged)
      .map((p) => { const pull = pullOf(p, L); return { ...pull, mergedAt: p.merged_at, invite: !!pull.author && pull.author !== owner && p.user?.type !== 'Bot' }; });
  }
  async function refresh() {
    const signal = AbortSignal.timeout(L.timeoutMs), ask = (url, isList) => getJson(fetch, url, { signal, maxBytes: L.maxBytes }, isList);
    try {
      const facts = await ask(api, false);
      const [open, merged] = await Promise.all([openPulls(ask), mergedPulls(ask)]);
      return { github: { repo, url: `https://github.com/${repo}`, stars: count(facts.stargazers_count), forks: count(facts.forks_count), watchers: count(facts.subscribers_count), open, merged, creatorsRoom: CREATORS_ROOM } };
    } catch (error) {
      const reason = reasonOf(error);
      console.error('GitHub facts failed:', reason);
      return { github: null, reason };
    }
  }
  return {
    /* { github: {...} } or { github: null, reason }. Never throws. */
    async facts() {
      const now = clock();
      if (kept && kept.until > now) return kept.value;
      asking ??= refresh().then((value) => {
        kept = { value, until: clock() + (value.github ? L.ttlMs : L.failedTtlMs) };
        asking = null;
        return value;
      });
      return asking;
    },
  };
}
