/* Talks to the game's page. The page is not trusted: every answer has a time
   limit and is checked before it is used. */
const ANSWER_MS = 8000;
const PACE_MS = { least: 100, usual: 900, most: 20000 };
const cleanPace = (ms) => (Number.isFinite(ms) ? Math.min(PACE_MS.most, Math.max(PACE_MS.least, ms)) : PACE_MS.usual);
const isFingerprint = (x) => typeof x === 'string' && /^[0-9a-f]{16}$/.test(x);

const cleanScore = (s) => (Array.isArray(s) && s.length === 2 && s.every((n) => Number.isInteger(n) && n >= 0 && n <= 5) ? [s[0], s[1]] : null);

export function cleanResult(r) {
  if (r === null || r === undefined) return null;
  if (typeof r !== 'object' || ![0, 1, null].includes(r.winner)) throw new Error('The game gave a result this app does not understand.');
  return { winner: r.winner, reason: typeof r.reason === 'string' ? r.reason.slice(0, 40) : '', score: cleanScore(r.score) ?? [0, 0] };
}

export function createTable({ send, answerMs = ANSWER_MS }) {
  const waiting = new Map();
  let nextId = 0, onMove = () => {}, isReady;
  const ready = new Promise((resolve) => { isReady = resolve; });
  const ask = (key, msg) => new Promise((resolve, reject) => {
    const timer = setTimeout(() => { waiting.delete(key); reject(new Error('The game stopped answering.')); }, answerMs);
    waiting.set(key, (answer) => { clearTimeout(timer); waiting.delete(key); resolve(answer); });
    send(msg);
  });
  return {
    ready,
    set onMove(fn) { onMove = fn; },
    receive(msg) {
      if (msg?.t === 'ready') isReady();
      else if (msg?.t === 'started') waiting.get('start')?.(msg);
      else if (msg?.t === 'tried' || msg?.t === 'thought') waiting.get(msg.id)?.(msg);
      else if (msg?.t === 'move') onMove(msg.move);
    },
    async start({ seed, me, players, terms, sound, solo = false }) {
      const { fingerprint } = await ask('start', { t: 'start', seed, me, players, terms, sound, solo });
      if (!isFingerprint(fingerprint)) throw new Error('The game did not start.');
      return fingerprint;
    },
    async tryMove(player, move) {
      const id = ++nextId;
      const out = await ask(id, { t: 'try', id, player, move });
      if (out.ok !== true) return { ok: false, error: String(out.error ?? 'not allowed').slice(0, 200) };
      if (!isFingerprint(out.fingerprint)) throw new Error('The game gave a bad answer.');
      const score = cleanScore(out.score);
      return { ok: true, fingerprint: out.fingerprint, result: cleanResult(out.result), ...(score ? { score } : {}) };
    },
    /* Alone only: what the computer plays, and when to ask again. */
    async think() {
      const id = ++nextId, out = await ask(id, { t: 'think', id });
      return { move: out.move ?? null, ms: cleanPace(out.ms) };
    },
    sound: (on) => send({ t: 'sound', on }),
    refused: (error) => send({ t: 'refused', error }),
  };
}
