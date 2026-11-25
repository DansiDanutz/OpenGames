/* One leaderboard per game. A result counts only when a referee has replayed the whole signed match.
   There is no money here: a place on the board is all there is to win. */
import { DatabaseSync } from 'node:sqlite';
import { Worker } from 'node:worker_threads';
import { canonical, cleanTerms } from '../kit/engine.js';
import { cleanName } from '../app/shell/session.js';

const START = 1200, K = 32, DAY_MS = 24 * 60 * 60 * 1000;
const LIMITS = { perPairPerDay: 5, top: 50, queue: 40, refereeMs: 60_000, minFinished: 0.8, newPlayer: 5 };
const MAX_ENTRIES = 6000;
const isHex64 = (x) => typeof x === 'string' && /^[0-9a-f]{64}$/.test(x);

/* How many points the first player gains. `score` is 1 for a win, 0.5 for a draw, 0 for a loss. */
export const gain = (mine, theirs, score) => Math.round(K * (score - 1 / (1 + 10 ** ((theirs - mine) / 400))));

/* A referee runs in a thread of its own and is stopped when it takes too long. */
function askReferee(transcript, rules, ms) {
  return new Promise((resolve) => {
    const worker = new Worker(new URL('./referee.js', import.meta.url), { workerData: { transcript, rules }, resourceLimits: { maxOldGenerationSizeMb: 256 } });
    const end = (out) => { clearTimeout(timer); worker.terminate(); resolve(out); };
    const timer = setTimeout(() => end({ ok: false, reason: 'the referee took too long' }), ms);
    worker.once('message', end);
    worker.once('error', (error) => end({ ok: false, reason: `the referee stopped: ${error.message}` }));
  });
}

/* library: [{ id, hash, options, rulesPath }], the approved games. */
export function createLeaderboard({ file, library, limits = {}, referee = askReferee }) {
  const L = { ...LIMITS, ...limits };
  const db = new DatabaseSync(file);
  db.exec(`PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 3000;
    CREATE TABLE IF NOT EXISTS players (game TEXT, pub TEXT, name TEXT NOT NULL, rating INTEGER NOT NULL DEFAULT ${START}, wins INTEGER NOT NULL DEFAULT 0,
      losses INTEGER NOT NULL DEFAULT 0, draws INTEGER NOT NULL DEFAULT 0, unfinished INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (game, pub)) STRICT;
    CREATE TABLE IF NOT EXISTS matches (ticket TEXT PRIMARY KEY, game TEXT NOT NULL, a TEXT NOT NULL, b TEXT NOT NULL, finished INTEGER NOT NULL, at INTEGER NOT NULL) STRICT;
    CREATE INDEX IF NOT EXISTS matches_pair ON matches (game, a, b, at);`);
  const q = {
    add: db.prepare('INSERT INTO players (game, pub, name) VALUES (?, ?, ?) ON CONFLICT DO UPDATE SET name = excluded.name'),
    get: db.prepare('SELECT rating FROM players WHERE game = ? AND pub = ?'),
    result: db.prepare('UPDATE players SET rating = rating + ?, wins = wins + ?, losses = losses + ?, draws = draws + ? WHERE game = ? AND pub = ?'),
    unfinished: db.prepare('UPDATE players SET unfinished = unfinished + ? WHERE game = ? AND pub = ?'),
    match: db.prepare('SELECT finished FROM matches WHERE ticket = ?'),
    save: db.prepare('INSERT INTO matches (ticket, game, a, b, finished, at) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT (ticket) DO UPDATE SET finished = excluded.finished, at = excluded.at'),
    recent: db.prepare('SELECT count(*) AS n FROM matches WHERE game = ? AND a = ? AND b = ? AND finished = 1 AND at > ?'),
    players: db.prepare('SELECT count(*) AS n FROM players WHERE game = ? AND wins + losses + draws > 0'),
    top: db.prepare(`SELECT pub, name, rating, wins, losses, draws, unfinished FROM players WHERE game = ? AND wins + losses + draws > 0
      AND (wins + losses + draws + unfinished < ? OR wins + losses + draws >= ? * (wins + losses + draws + unfinished)) ORDER BY rating DESC, wins DESC, pub LIMIT ?`),
  };
  let waiting = 0, chain = Promise.resolve();

  /* Why this is not a ranked match of this ticket, or '' when it is. */
  function problem(t, { ticket, key, pubs }) {
    const game = library.find((g) => g.id === t?.game && g.hash === t?.hash);
    if (!game || `${game.id}@${game.hash}` !== key) return 'not a game of this server';
    if (!Array.isArray(t.players) || t.players.length !== 2 || !t.players.every((p) => isHex64(p?.pub) && cleanName(p.name) === p.name) || t.players[0].pub === t.players[1].pub) return 'not two players';
    if (pubs?.length !== 2 || !t.players.every((p) => pubs.includes(p.pub))) return 'not the players this server introduced';
    if (!isHex64(t.seed) || !isHex64(t.match) || !Array.isArray(t.entries) || t.entries.length > MAX_ENTRIES) return 'not a match';
    try { if (canonical(cleanTerms(game.options, t.terms)) !== canonical(t.terms)) return 'the rules are not well formed'; } catch { return 'the rules are not well formed'; }
    return t.terms.ranked && t.terms.ticket === ticket ? '' : 'the players did not agree on a ranked match';
  }
  function write(t, ticket, result) {
    const [a, b] = t.players, before = q.match.get(ticket);
    if (before?.finished || (before && !result)) return { ok: true, finished: !!before.finished, counted: false };
    const [x, y] = [a.pub, b.pub].sort(), now = Date.now();
    const isOften = !!result && q.recent.get(t.game, x, y, now - DAY_MS).n >= L.perPairPerDay;
    for (const p of [a, b]) q.add.run(t.game, p.pub, p.name);
    if (before) for (const p of [a, b]) q.unfinished.run(-1, t.game, p.pub);
    q.save.run(ticket, t.game, x, y, result ? 1 : 0, now);
    if (!result) { for (const p of [a, b]) q.unfinished.run(1, t.game, p.pub); return { ok: true, finished: false, counted: true }; }
    if (isOften) return { ok: true, finished: true, counted: false };
    const won = result.winner === null ? 0.5 : 1 - result.winner;        // of the first player
    const points = gain(q.get.get(t.game, a.pub).rating, q.get.get(t.game, b.pub).rating, won);
    [[a, points, won], [b, -points, 1 - won]].forEach(([p, change, score]) => q.result.run(change, +(score === 1), +(score === 0), +(score === 0.5), t.game, p.pub));
    return { ok: true, finished: true, counted: true, points: [points, -points] };
  }
  async function judge({ transcript, ticket, key, pubs }) {
    const wrong = problem(transcript, { ticket, key, pubs });
    if (wrong) return { ok: false, error: wrong };
    const game = library.find((g) => g.id === transcript.game);
    const verdict = await referee(transcript, game.rulesPath, L.refereeMs);
    // An unfinished match counts as unfinished only when both players took part.
    const isLeft = verdict.unfinished === true && [0, 1].every((p) => transcript.entries.some((e) => e.player === p));
    if (!verdict.ok && !isLeft) return { ok: false, error: String(verdict.reason).slice(0, 200) };
    db.exec('BEGIN IMMEDIATE');
    try {
      const out = write(transcript, ticket, verdict.ok ? verdict.result : null);
      db.exec('COMMIT');
      return out;
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
  }
  return {
    isFull: () => waiting >= L.queue,
    submit(request) {
      waiting += 1;
      const out = chain.then(() => judge(request)).finally(() => { waiting -= 1; });
      chain = out.catch(() => {});
      return out;
    },
    top: (game) => q.top.all(game, L.newPlayer, L.minFinished, L.top).map((p) => ({ ...p })),
    players: (game) => q.players.get(game).n,
    close: () => db.close(),
  };
}
