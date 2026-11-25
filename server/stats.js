/* How often each approved game is played: one number per game and day, and nothing about who played.
   Only a match between two addresses that lasted a minute is counted, so the numbers are an estimate. */
import { DatabaseSync } from 'node:sqlite';

const DAY_MS = 24 * 60 * 60 * 1000;
export const DAYS = 30;
const LIMITS = { perAddressPerDay: 20, addresses: 50_000 };
/* One home or company is one address: for IPv6 that is the first three parts (a /48). */
const homeOf = (a) => (a.includes(':') ? a.split(':').slice(0, 3).join(':') : a);
const dayOf = (at) => new Date(at).toISOString().slice(0, 10);

/* library: [{ id, hash }], the approved games. */
export function createStats({ file, library, limits = {}, clock = Date.now }) {
  const L = { ...LIMITS, ...limits };
  const keys = new Map(library.map((g) => [`${g.id}@${g.hash}`, g.id]));
  const db = new DatabaseSync(file);
  db.exec(`PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 3000;
    CREATE TABLE IF NOT EXISTS plays (game TEXT, day TEXT, matches INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (game, day)) STRICT;
    CREATE TABLE IF NOT EXISTS since (one INTEGER PRIMARY KEY CHECK (one = 1), day TEXT NOT NULL) STRICT;`);
  db.prepare('INSERT INTO since (one, day) VALUES (1, ?) ON CONFLICT DO NOTHING').run(dayOf(clock()));
  const q = {
    add: db.prepare('INSERT INTO plays (game, day, matches) VALUES (?, ?, 1) ON CONFLICT DO UPDATE SET matches = matches + 1'),
    recent: db.prepare('SELECT day, matches FROM plays WHERE game = ? AND day >= ?'),
    total: db.prepare('SELECT coalesce(sum(matches), 0) AS n FROM plays WHERE game = ?'),
  };
  const since = db.prepare('SELECT day FROM since').get().day;
  // Today's addresses stay in memory only: nobody can make one game look busy alone.
  let today = '', seen = new Map();
  return {
    since,
    played(key, from) {
      const addresses = from.map(homeOf), game = keys.get(key), day = dayOf(clock());
      if (!game || addresses[0] === addresses[1]) return false;
      if (day !== today) { today = day; seen = new Map(); }
      const marks = addresses.map((a) => `${game} ${a}`);
      if (marks.some((m) => (seen.get(m) ?? 0) >= L.perAddressPerDay) || seen.size >= L.addresses) return false;
      for (const m of marks) seen.set(m, (seen.get(m) ?? 0) + 1);
      q.add.run(game, day);
      return true;
    },
    /* The last 30 days, oldest first, without the days before counting began. */
    of(game) {
      const now = clock(), all = Array.from({ length: DAYS }, (_, i) => dayOf(now - (DAYS - 1 - i) * DAY_MS));
      const counted = new Map(q.recent.all(game, all[0]).map((r) => [r.day, r.matches]));
      return { total: q.total.get(game).n, days: all.map((day) => ({ day, matches: day < since ? null : counted.get(day) ?? 0 })) };
    },
    close: () => db.close(),
  };
}
