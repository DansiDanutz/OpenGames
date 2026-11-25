/* What the owner of a server sees in the admin view: visits, matches per game, ranked players and GitHub.
   Only an account whose address is in ADMIN_EMAILS gets it (accounts.js). Nothing in it is about one person. */
import { cleanEmail } from './accounts.js';

const WEEK = 7;
const sum = (days) => days.reduce((n, d) => n + (d.matches ?? 0), 0);

/* ADMIN_EMAILS: addresses separated by commas. A wrong one stops the server rather than locking the owner out quietly. */
export function readAdmins(text = '') {
  return (text ?? '').split(',').map((part) => part.trim()).filter(Boolean).map((part) => {
    const email = cleanEmail(part);
    if (!email) throw new Error(`ADMIN_EMAILS has an address that is not valid: ${part}`);
    return email;
  });
}

function gameRow(g, stats, leaderboard) {
  const s = stats?.of(g.id);
  return {
    id: g.id, name: g.name,
    today: s ? sum(s.days.slice(-1)) : null, week: s ? sum(s.days.slice(-WEEK)) : null, month: s ? sum(s.days) : null, total: s ? s.total : null,
    ranked: leaderboard ? leaderboard.players(g.id) : null,
  };
}

/* games: from readLibrary. stats, leaderboard and github are optional. Returns async () => the report. */
export function createReport({ games, stats = null, leaderboard = null, github = null }) {
  return async () => {
    const facts = github ? await github.facts() : { github: null, reason: 'off' };
    return {
      since: stats?.since ?? null,
      visits: stats ? stats.visits() : null,
      games: games.map((g) => gameRow(g, stats, leaderboard)),
      ranked: leaderboard ? leaderboard.everyone() : null,
      ...facts,
    };
  };
}
