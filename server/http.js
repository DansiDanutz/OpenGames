/* The leaderboards, over plain HTTP: GET /leaderboard?game=<id>, POST /result?ticket=<id>, GET /health. */
const MAX_RESULT_BYTES = 4 * 1024 * 1024;
const GAME = /^[a-z0-9-]{1,40}$/;

/* A ticket names one match this server introduced. Only such a match can be ranked. */
export function createTickets(lifeMs) {
  const all = new Map();
  return {
    add: (ticket, key) => all.set(ticket, { key, until: Date.now() + lifeMs, isBusy: false, isDone: false }),
    get: (ticket) => { const t = all.get(ticket); return t && t.until > Date.now() ? t : null; },
    sweep: () => { const now = Date.now(); for (const [id, t] of all) if (t.until <= now) all.delete(id); },
  };
}
const reply = (res, status, body) => {
  if (res.headersSent || res.destroyed) return;
  res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', connection: 'close' });
  res.end(JSON.stringify(body));
};
async function readBody(req) {
  const parts = [];
  let bytes = 0;
  for await (const part of req) {
    bytes += part.length;
    if (bytes > MAX_RESULT_BYTES) return null;
    parts.push(part);
  }
  return Buffer.concat(parts).toString('utf8');
}
async function takeResult({ req, res, url, from, limits, tickets, leaderboard }) {
  const id = url.searchParams.get('ticket') ?? '', ticket = tickets.get(id);
  if (++from.results > limits.resultsPerMinute) return reply(res, 429, { error: 'too_many' });
  if (!ticket || ticket.isDone) return reply(res, 404, { error: 'unknown_ticket' });
  if (ticket.isBusy || leaderboard.isFull()) return reply(res, 503, { error: 'busy' });
  ticket.isBusy = true;
  try {
    const text = await readBody(req);
    if (text === null) return reply(res, 413, { error: 'too_large' });
    let transcript;
    try { transcript = JSON.parse(text); } catch { return reply(res, 400, { error: 'bad_request' }); }
    const out = await leaderboard.submit({ transcript, ticket: id, key: ticket.key });
    if (out.ok && out.finished) ticket.isDone = true;
    return reply(res, out.ok ? 200 : 422, out);
  } finally {
    ticket.isBusy = false;
  }
}
export function answerHttp(context) {
  const { req, res, from, limits, leaderboard } = context;
  const url = new URL(req.url, 'http://server');
  const fail = (error) => { console.error('A request failed:', error.message); reply(res, 500, { error: 'failed' }); };
  req.on('error', () => res.destroy());
  if (req.method === 'GET' && url.pathname === '/health') return reply(res, 200, { ok: true });
  if (!leaderboard) return reply(res, 404, { error: 'not_found' });
  if (req.method === 'POST' && url.pathname === '/result') return takeResult({ ...context, url }).catch(fail);
  if (req.method === 'GET' && url.pathname === '/leaderboard') {
    const game = url.searchParams.get('game') ?? '';
    if (++from.reads > limits.readsPerMinute) return reply(res, 429, { error: 'too_many' });
    if (!GAME.test(game)) return reply(res, 400, { error: 'bad_request' });
    try { return reply(res, 200, { players: leaderboard.top(game) }); } catch (error) { return fail(error); }
  }
  return reply(res, 404, { error: 'not_found' });
}
