/* How often each approved game is played: one number per game and day, and nothing about who played.
   Only a match between two addresses that lasted a minute is counted, so the numbers are an estimate.
   Visits to the public pages are one number per page and day too: no address, browser or cookie is kept. */
import { DatabaseSync } from 'node:sqlite';

const DAY_MS = 24 * 60 * 60 * 1000;
export const DAYS = 30;
const LIMITS = { perAddressPerDay: 20, addresses: 50_000 };
/* One home or company is one address: for IPv6 that is the first three parts (a /48). */
const homeOf = (a) => (a.includes(':') ? a.split(':').slice(0, 3).join(':') : a);
const dayOf = (at) => new Date(at).toISOString().slice(0, 10);
const lastDays = (now) => Array.from({ length: DAYS }, (_, i) => dayOf(now - (DAYS - 1 - i) * DAY_MS));
/* The pages a person opens: the games, the app, the creators' start and each game's page. */
const VISITED = /^\/(?:play|creators|games\/[a-z0-9-]{1,40})?$/;
const WEEK = 7;

/* Rows of { page, day, n } as per-day totals and per-page sums for today, the last 7 and the last 30 days. */
function summarize(rows, days) {
  const totals = new Map(), pages = new Map();
  for (const { page, day, n } of rows) {
    totals.set(day, (totals.get(day) ?? 0) + n);
    pages.set(page, [...(pages.get(page) ?? []), { day, n }]);
  }
  const from = (counts, first) => counts.filter((c) => c.day >= first).reduce((sum, c) => sum + c.n, 0);
  return {
    days: days.map((day) => ({ day, total: totals.get(day) ?? 0 })),
    pages: [...pages].map(([page, counts]) => ({ page, today: from(counts, days.at(-1)), week: from(counts, days.at(-WEEK)), month: from(counts, days[0]) }))
      .sort((a, b) => b.month - a.month || a.page.localeCompare(b.page)),
  };
}

/* library: [{ id, hash }], the approved games. */
export function createStats({ file, library, limits = {}, clock = Date.now }) {
  const L = { ...LIMITS, ...limits };
  const keys = new Map(library.map((g) => [`${g.id}@${g.hash}`, g.id]));
  const db = new DatabaseSync(file);
  db.exec(`PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 3000;
    CREATE TABLE IF NOT EXISTS plays (game TEXT, day TEXT, matches INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (game, day)) STRICT;
    CREATE TABLE IF NOT EXISTS visits (page TEXT, day TEXT, n INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (page, day)) STRICT;
    CREATE TABLE IF NOT EXISTS since (one INTEGER PRIMARY KEY CHECK (one = 1), day TEXT NOT NULL) STRICT;`);
  db.prepare('INSERT INTO since (one, day) VALUES (1, ?) ON CONFLICT DO NOTHING').run(dayOf(clock()));
  const q = {
    add: db.prepare('INSERT INTO plays (game, day, matches) VALUES (?, ?, 1) ON CONFLICT DO UPDATE SET matches = matches + 1'),
    recent: db.prepare('SELECT day, matches FROM plays WHERE game = ? AND day >= ?'),
    total: db.prepare('SELECT coalesce(sum(matches), 0) AS n FROM plays WHERE game = ?'),
    visit: db.prepare('INSERT INTO visits (page, day, n) VALUES (?, ?, 1) ON CONFLICT DO UPDATE SET n = n + 1'),
    visits: db.prepare('SELECT page, day, n FROM visits WHERE day >= ?'),
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
      const all = lastDays(clock());
      const counted = new Map(q.recent.all(game, all[0]).map((r) => [r.day, r.matches]));
      return { total: q.total.get(game).n, days: all.map((day) => ({ day, matches: day < since ? null : counted.get(day) ?? 0 })) };
    },
    /* One more visit to a public page today. Any other path is not counted. */
    visited(page) {
      if (typeof page !== 'string' || !VISITED.test(page)) return false;
      q.visit.run(page, dayOf(clock()));
      return true;
    },
    /* The last 30 days, oldest first: { days: [{ day, total }], pages: [{ page, today, week, month }] }. */
    visits() {
      const days = lastDays(clock());
      return summarize(q.visits.all(days[0]), days);
    },
    close: () => db.close(),
  };
}

/* Pages that count each page they showed. A count that fails never stops the page. */
export function counted(pages, stats) {
  const counting = (pathname, headers) => {
    const answer = pages(pathname, headers);
    if (answer && answer.status < 400) {
      try { stats.visited(pathname); } catch (error) { console.error('A visit was not counted:', error.message); }
    }
    return answer;
  };
  counting.has = (pathname) => pages.has(pathname);
  return counting;
}
