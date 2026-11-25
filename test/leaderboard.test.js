import test from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import path from 'node:path';
import { createLeaderboard, gain } from '../server/leaderboard.js';
import { startMatchServer } from '../server/match-server.js';
import { createIdentity } from '../app/shell/session.js';
import { GAME, pair, solution, inRound, until } from './helpers.js';

const TICKETS = Array.from({ length: 9 }, (_, i) => `01234567-89ab-cdef-0123-45678900000${i}`);
const KEY = `${GAME.id}@${GAME.hash}`;
const library = [{ ...GAME, options: [], rulesPath: path.join(import.meta.dirname, '../games/shikaku/rules.js') }];
/* Unless a test says otherwise, the ticket belongs to the players in the match. */
function board(limits) {
  const real = createLeaderboard({ file: ':memory:', library, limits });
  return { ...real, submit: (r) => real.submit({ pubs: r.transcript?.players?.map?.((p) => p?.pub) ?? [], ...r }) };
}
const two = async () => [await createIdentity(), await createIdentity()];
/* A signed match between two players; `winner` gives nothing when nobody finished. */
async function played({ identities, ticket = TICKETS[0], winner = 1, ranked = true }) {
  const { host, guest } = await pair({ identities, ticket, terms: { ranked } });
  for (const side of [host, guest]) await side.session.play(inRound(side, { type: 'cover', cells: 3 }));
  await until(() => host.session.transcript().entries.length === 2);
  if (winner === null) return host.session.transcript();
  const side = [host, guest][winner];
  await side.session.play(solution(side));
  await until(() => host.over && guest.over);
  return host.over.transcript;
}

test('a ranked match moves points from the loser to the winner', async () => {
  const b = board(), identities = await two(), transcript = await played({ identities });
  assert.deepEqual(await b.submit({ transcript, ticket: TICKETS[0], key: KEY }), { ok: true, finished: true, counted: true, points: [-16, 16] });
  assert.deepEqual(b.top('shikaku').map((p) => [p.name, p.rating, p.wins, p.losses]), [['Bob', 1216, 1, 0], ['Ann', 1184, 0, 1]]);
  assert.deepEqual(b.top('gemhold'), []);
});
test('a match counts once, however often it is sent', async () => {
  const b = board(), identities = await two(), transcript = await played({ identities });
  await b.submit({ transcript, ticket: TICKETS[0], key: KEY });
  assert.equal((await b.submit({ transcript, ticket: TICKETS[0], key: KEY })).counted, false);
  assert.equal(b.top('shikaku')[0].wins, 1);
});
test('only a match that both players agreed to rank, with the ticket of this server, counts', async () => {
  const b = board(), identities = await two();
  const transcript = await played({ identities }), friendly = await played({ identities, ranked: false });
  const send = (t, ticket = TICKETS[0], key = KEY) => b.submit({ transcript: t, ticket, key });
  assert.match((await send(friendly)).error, /did not agree/);
  assert.match((await send(transcript, TICKETS[1])).error, /did not agree/);
  assert.match((await send(transcript, TICKETS[0], `gemhold@${GAME.hash}`)).error, /not a game/);
  for (const bad of [null, {}, { ...transcript, players: [] }, { ...transcript, entries: 1 }, { ...transcript, hash: 'b'.repeat(64) }, { ...transcript, terms: { ...transcript.terms, rounds: 2 } }]) assert.equal((await send(bad)).ok, false);
  assert.deepEqual(b.top('shikaku'), []);
});
test('a changed match is refused by the referee', async () => {
  const b = board(), transcript = await played({ identities: await two() });
  for (const change of [(t) => t.players.reverse(), (t) => { t.players[0].name = 'Eve'; }, (t) => { t.entries.at(-1).player = 0; }, (t) => { t.entries[0].move.move.cells = 9; }, (t) => { t.seed = 'f'.repeat(64); }]) {
    const t = structuredClone(transcript);
    change(t);
    assert.equal((await b.submit({ transcript: t, ticket: TICKETS[0], key: KEY })).ok, false);
  }
  assert.deepEqual(b.top('shikaku'), []);
});
test('a match somebody left is remembered for both, until its result arrives', async () => {
  const b = board(), identities = await two();
  const left = await played({ identities, winner: null });
  assert.deepEqual(await b.submit({ transcript: left, ticket: TICKETS[0], key: KEY }), { ok: true, finished: false, counted: true });
  assert.equal((await b.submit({ transcript: left, ticket: TICKETS[0], key: KEY })).counted, false);
  await b.submit({ transcript: await played({ identities, ticket: TICKETS[1] }), ticket: TICKETS[1], key: KEY });
  assert.deepEqual(b.top('shikaku').map((p) => p.unfinished), [1, 1]);
});
test('players who often leave are not shown', async () => {
  const b = board({ newPlayer: 2 }), identities = await two();
  await b.submit({ transcript: await played({ identities }), ticket: TICKETS[0], key: KEY });
  assert.equal(b.top('shikaku').length, 2);
  await b.submit({ transcript: await played({ identities, ticket: TICKETS[1], winner: null }), ticket: TICKETS[1], key: KEY });
  assert.equal(b.top('shikaku').length, 0);
});
test('the same two players cannot collect points all day', async () => {
  const b = board({ perPairPerDay: 2 }), identities = await two(), counted = [];
  for (const ticket of TICKETS.slice(0, 3)) counted.push((await b.submit({ transcript: await played({ identities, ticket }), ticket, key: KEY })).counted);
  assert.deepEqual(counted, [true, true, false]);
});
test('a referee that never answers is stopped', async () => {
  const transcript = await played({ identities: await two() });
  const b = createLeaderboard({ file: ':memory:', library, limits: { refereeMs: 1 } });
  assert.match((await b.submit({ transcript, ticket: TICKETS[0], key: KEY, pubs: transcript.players.map((p) => p.pub) })).error, /too long/);
});
test('a ticket belongs to the two players it was given to', async () => {
  const b = board(), real = await two(), pubs = real.map((x) => x.pub);
  const decoys = [await played({ identities: await two(), winner: null }), await played({ identities: await two() })];
  for (const transcript of decoys) assert.match((await b.submit({ transcript, ticket: TICKETS[0], key: KEY, pubs })).error, /not the players/);
  const out = await b.submit({ transcript: await played({ identities: real }), ticket: TICKETS[0], key: KEY, pubs: pubs.toReversed() });
  assert.equal(out.counted, true);
  assert.deepEqual(b.top('shikaku').map((p) => p.unfinished), [0, 0]);
});
test('beating a stronger player is worth more', () => {
  assert.deepEqual([gain(1200, 1200, 1), gain(1200, 1600, 1), gain(1600, 1200, 1), gain(1200, 1200, 0.5)], [16, 29, 3, 0]);
});

/* ---- over the network */
const withServer = async (options, run) => { const s = await startMatchServer(options); try { await run(s, `http://127.0.0.1:${s.port}`); } finally { await s.close(); } };
async function ticketFrom(port, identities) {
  const open = (ask, pub) => new Promise((resolve) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}`), got = {};
    ws.onopen = () => ws.send(JSON.stringify({ ...ask, key: KEY, pub }));
    ws.onmessage = ({ data }) => { const m = JSON.parse(data); if (m.t === 'paired') { got.done({ ticket: m.ticket, pub: m.pub, ws }); } else resolve({ code: m.code, paired }); };
    const paired = new Promise((r) => { got.done = (x) => { resolve(x); r(x); }; });
  });
  const first = await open({ t: 'find' }, identities[0].pub), second = await open({ t: 'find' }, identities[1].pub), one = await first.paired;
  assert.equal(one.ticket, second.ticket);
  if (one.ticket) assert.deepEqual([one.pub, second.pub], [identities[1].pub, identities[0].pub]);
  return one.ticket;
}
test('a result travels to the leaderboard over HTTP, and everybody can read it', async () => {
  const leaderboard = board();
  await withServer({ leaderboard, limits: { rankSameAddress: true } }, async (s, url) => {
    const identities = await two(), ticket = await ticketFrom(s.port, identities), transcript = await played({ identities, ticket });
    const send = () => fetch(`${url}/result?ticket=${ticket}`, { method: 'POST', body: JSON.stringify(transcript) });
    assert.deepEqual(await (await send()).json(), { ok: true, finished: true, counted: true, points: [-16, 16] });
    const again = await Promise.all([send(), send()]);
    for (const r of again) assert.deepEqual(await r.json(), { ok: true, finished: true, counted: true, points: [-16, 16] });
    const { players } = await (await fetch(`${url}/leaderboard?game=shikaku`)).json();
    assert.deepEqual(players.map((p) => p.name), ['Bob', 'Ann']);
    assert.equal((await fetch(`${url}/health`)).status, 200);
  });
});
test('when both players send their match at once, both hear the outcome and it counts once', async () => {
  const leaderboard = board();
  await withServer({ leaderboard, limits: { rankSameAddress: true } }, async (s, url) => {
    const identities = await two(), ticket = await ticketFrom(s.port, identities), transcript = await played({ identities, ticket });
    const both = await Promise.all([1, 2].map(() => fetch(`${url}/result?ticket=${ticket}`, { method: 'POST', body: JSON.stringify(transcript) }).then((r) => r.json())));
    assert.deepEqual(both.map((x) => x.points), [[-16, 16], [-16, 16]]);
    assert.equal(leaderboard.top('shikaku')[0].wins, 1);
  });
});
test('bad requests are refused and cost little', async () => {
  await withServer({ leaderboard: board(), limits: { rankSameAddress: true, resultsPerMinute: 4, readsPerMinute: 3 } }, async (s, url) => {
    assert.equal((await fetch(`${url}/result?ticket=${TICKETS[0]}`, { method: 'POST', body: '{}' })).status, 404);
    const ticket = await ticketFrom(s.port, await two()), send = (body) => fetch(`${url}/result?ticket=${ticket}`, { method: 'POST', body });
    assert.equal((await send('{')).status, 400);
    assert.equal((await send('{}')).status, 422);
    assert.equal((await send('x'.repeat(5 * 1024 * 1024)).catch(() => ({ status: 413 }))).status, 413);
    assert.equal((await send('{}')).status, 429);
    assert.equal((await fetch(`${url}/leaderboard?game=../x`)).status, 400);
    assert.equal((await fetch(`${url}/nothing`)).status, 404);
    await fetch(`${url}/leaderboard?game=a`); await fetch(`${url}/leaderboard?game=a`);
    assert.equal((await fetch(`${url}/leaderboard?game=a`)).status, 429);
  });
});
test('two players in one home cannot rank against each other', () => withServer({ leaderboard: board() }, async (s) => assert.equal(await ticketFrom(s.port, await two()), null)));
test('a server without a leaderboard has no results', () => withServer({}, async (s, url) => assert.equal((await fetch(`${url}/leaderboard?game=shikaku`)).status, 404)));
test('no ticket without two different players', () => withServer({ leaderboard: board(), limits: { rankSameAddress: true } }, async (s) => {
  const [a] = await two();
  assert.equal(await ticketFrom(s.port, [a, a]), null);
  assert.equal(await ticketFrom(s.port, [a, { pub: 'x' }]), null);
}));
/* Sends text as it is, without the checks of a real browser. */
const rawHttp = (port, text) => new Promise((resolve) => {
  const socket = net.connect(port, '127.0.0.1', () => socket.write(text));
  let got = '';
  socket.on('data', (d) => { got += d; }).on('close', () => resolve(got)).on('error', () => resolve(got));
});
test('an address that cannot be read does not stop the server', async () => {
  for (const options of [{}, { leaderboard: board() }]) await withServer(options, async (s, url) => {
    for (const target of ['//[', '//', 'http://[', '*']) await rawHttp(s.port, `GET ${target} HTTP/1.1\r\nHost: x\r\nConnection: close\r\n\r\n`);
    assert.match(await rawHttp(s.port, 'GET //[ HTTP/1.1\r\nHost: x\r\nConnection: close\r\n\r\n'), /^HTTP\/1.1 400/);
    assert.equal((await fetch(`${url}/health`)).status, 200);
  });
});
test('a result that never finishes arriving does not hold up the other player', () => withServer({ leaderboard: board(), limits: { rankSameAddress: true, bodyMs: 300 } }, async (s, url) => {
  const identities = await two(), ticket = await ticketFrom(s.port, identities), transcript = await played({ identities, ticket });
  const held = rawHttp(s.port, `POST /result?ticket=${ticket} HTTP/1.1\r\nHost: x\r\nContent-Length: 9000\r\n\r\n{`);
  const at = Date.now(), out = await (await fetch(`${url}/result?ticket=${ticket}`, { method: 'POST', body: JSON.stringify(transcript) })).json();
  assert.equal(out.counted, true);
  assert.ok(Date.now() - at < 2000);
  await held;
}));
