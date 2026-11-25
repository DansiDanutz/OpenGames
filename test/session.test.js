import test from 'node:test';
import assert from 'node:assert/strict';
import { Series } from '../kit/engine.js';
import * as shikaku from '../games/shikaku/rules.js';
import { Session, cleanName, createIdentity, verifyTranscript } from '../app/shell/session.js';
import { GAME, pair, solution, tableFor, until, wires, inRound } from './helpers.js';

const referee = (t) => verifyTranscript(t, (seed, terms) => new Series(shikaku, { seed, terms }));

const TICKET = '01234567-89ab-cdef-0123-456789000000';
test('two players get the same board, and both learn the result', async () => {
  const { host, guest } = await pair();
  assert.deepEqual(host.table.view().puzzle, guest.table.view().puzzle);
  assert.equal(host.session.seed, guest.session.seed);
  await guest.session.play({ round: 0, move: { type: 'cover', cells: 9 } });
  await until(() => host.table.view().covered[1] === 9 && guest.table.view().covered[1] === 9);
  await guest.session.play(solution(guest));
  await until(() => host.over && guest.over);
  assert.deepEqual([host.over.result.winner, guest.over.result.winner], [1, 1]);
});
test('when both solve at once, exactly one wins and both computers agree', async () => {
  const { host, guest } = await pair();
  await Promise.all([guest.session.play(solution(guest)), host.session.play(solution(host))]);
  await until(() => host.over && guest.over);
  assert.equal(host.over.result.winner, guest.over.result.winner);
  assert.equal(host.failed ?? guest.failed, null);
});
test('a move that is not allowed is refused and the match goes on', async () => {
  const { host, guest } = await pair();
  await guest.session.play({ round: 0, move: { type: 'solve', rects: [] } });
  await until(() => guest.table.refusals.length === 1);
  await host.session.play(solution(host));
  await until(() => guest.over);
  assert.equal(guest.over.result.winner, 0);
});
test('a referee can replay a finished match, and notices every change', async () => {
  const { host, guest } = await pair();
  await guest.session.play({ round: 0, move: { type: 'cover', cells: 5 } });
  await host.session.play({ round: 0, move: { type: 'cover', cells: 7 } });
  await guest.session.play(solution(guest));
  await until(() => host.over && guest.over);
  for (const side of [host, guest]) assert.deepEqual(await referee(side.over.transcript), { ok: true, result: { winner: 1, reason: 'solved', score: [0, 1] } });
  const change = (fn) => { const t = structuredClone(host.over.transcript); fn(t); return referee(t); };
  for (const fn of [
    (t) => t.entries.pop(), (t) => t.entries.shift(), (t) => t.entries.reverse(), (t) => { t.entries.at(-1).player = 0; },
    (t) => { t.entries[0].move.move.cells = 6; }, (t) => { t.seed = 'f'.repeat(64); }, (t) => { t.terms.rounds = 3; }, (t) => { t.players[0].name = 'Eve'; }, (t) => t.players.reverse(), (t) => { t.entries[0].hsig = '0'.repeat(128); },
  ]) assert.equal((await change(fn)).ok, false);
});
test('a host that invents a move for the guest is caught', async () => {
  const { host, guest } = await pair({ tamper: (m) => (m.t === 'entry' ? { ...m, entry: { ...m.entry, player: 1 } } : m) });
  await host.session.play(solution(host));
  await until(() => guest.failed);
  assert.match(guest.failed, /not signed/);
  assert.equal(guest.over, null);
});
test('a host that changes or skips a move is caught', async () => {
  const changed = await pair({ tamper: (m) => (m.t === 'entry' ? { ...m, entry: { ...m.entry, move: { round: 0, move: { type: 'cover', cells: 1 } } } } : m) });
  await changed.guest.session.play({ round: 0, move: { type: 'cover', cells: 9 } });
  await until(() => changed.guest.failed);
  let first = true;
  const skipped = await pair({ tamper: (m) => { if (m.t === 'entry' && first) { first = false; return null; } return m; } });
  await skipped.host.session.play({ round: 0, move: { type: 'cover', cells: 2 } });
  await skipped.host.session.play({ round: 0, move: { type: 'cover', cells: 3 } });
  await until(() => skipped.guest.failed);
  assert.match(skipped.guest.failed, /wrong order/);
});
test('a host running easier rules cannot win with them', async () => {
  const easy = { ...shikaku, move: (s, p, m) => (m.type === 'solve' ? { ...s, winner: p } : shikaku.move(s, p, m)) };
  const { host, guest } = await pair({ hostRules: easy });
  await host.session.play({ round: 0, move: { type: 'solve', rects: [] } });
  await until(() => guest.failed);
  assert.match(guest.failed, /rules do not allow/);
});
test('neither player can choose the board: a changed secret is caught', async () => {
  const { guest } = await pair({ tamper: (m) => (m.t === 'reveal' ? { ...m, secret: 'b'.repeat(64) } : m) });
  assert.match(guest.failed, /did not keep its word/);
});
test('a guest cannot copy the greeting of the host', async () => {
  const { guest } = await pair({ tamper: (m) => (m.t === 'hello' ? { ...m, commit: 'zz' } : m) });
  assert.match(guest.failed, /bad greeting/);
});
test('different versions of a game do not play each other', async () => {
  const { host } = await pair({ guestGame: { ...GAME, hash: 'b'.repeat(64) } });
  assert.match(host.failed, /different version/);
});
test('a repeated or unknown message ends the match for both, without a result', async () => {
  for (const msg of [{ t: 'entry', entry: {} }, { t: 'nonsense' }, null, { t: 'hello' }]) {
    const { host } = await pair();
    host.wire.onMessage(msg);
    await until(() => host.failed);
    assert.equal(host.over, null);
  }
  let saved = null;
  const { host, guest } = await pair();
  const send = guest.wire.send;
  guest.wire.send = (m) => { saved = m; send(m); };
  await guest.session.play({ round: 0, move: { type: 'cover', cells: 4 } });
  await until(() => host.table.view().covered[1] === 4);
  send(saved);
  await until(() => host.failed);
  assert.match(host.failed, /repeated/);
});
test('a lost connection ends a match, but not one that is already decided', async () => {
  const a = await pair();
  a.host.wire.onClose();
  await until(() => a.host.failed);
  assert.match(a.host.failed, /connection was lost/);
  const b = await pair();
  await b.host.session.play({ $: 'resign' });
  await until(() => b.host.over && b.guest.over);
  b.guest.wire.onClose();
  assert.equal(b.guest.failed, null);
  assert.equal(b.guest.over.result.winner, 1);
});
test('a flood of messages ends the match', async () => {
  const { host } = await pair();
  for (let i = 0; i < 200; i++) host.wire.onMessage({ t: 'propose', n: i, move: {}, sig: 'x' });
  assert.match(host.failed, /too much/);
});
test('a player whose game opens later still starts the match', async () => {
  const { guest, host } = await pair({ lateGuest: true });
  assert.equal(host.failed ?? guest.failed, null);
  await guest.session.play(solution(guest));
  await until(() => host.over && guest.over);
});
test('moves made at the same moment arrive in order', async () => {
  const { host, guest } = await pair();
  await Promise.all([1, 2, 3, 4, 5, 6].flatMap((cells) => [guest, host].map((s) => s.session.play({ round: 0, move: { type: 'cover', cells } }))));
  await until(() => host.table.view().covered.join() === '6,6' && guest.table.view().covered.join() === '6,6');
  assert.equal(host.failed ?? guest.failed, null);
});
test('a move that cannot be sent is refused and the match goes on', async () => {
  const { host, guest } = await pair();
  await guest.session.play({ cells: NaN });
  assert.equal(guest.table.refusals.length, 1);
  await guest.session.play(solution(guest));
  await until(() => host.over);
});
test('an opponent who never answers the greeting does not keep you waiting', async () => {
  const [wire] = wires();
  let failed = null;
  const s = new Session({ wire, table: tableFor(shikaku), identity: await createIdentity(), host: true, game: GAME, name: 'Ann', handshakeMs: 30, on: { failed: (r) => { failed = r; } } });
  s.open();
  await until(() => failed);
  assert.match(failed, /did not start/);
});
test('a stream of moves ends the match', async () => {
  const { host, guest } = await pair();
  // Many more than a slow computer can sign within the seconds the limit counts.
  for (let i = 0; i < 1000; i++) guest.session.play({ round: 0, move: { type: 'cover', cells: i % 30 } });
  await until(() => host.failed);
  assert.match(host.failed, /too much/);
});
test('names carry no markup', () => {
  assert.equal(cleanName('<img src=x onerror="a()">'), 'img src=x onerror= a()');
  assert.equal(cleanName("O'Neil\u202e"), 'O’Neil');
  assert.equal(cleanName('<>'), 'Player');
});
test('a host cannot swell the record of a match', async () => {
  const extra = await pair({ tamper: (m) => (m.t === 'entry' ? { ...m, entry: { ...m.entry, junk: 'x'.repeat(20_000) } } : m) });
  await extra.host.session.play(inRound(extra.host, { type: 'cover', cells: 3 }));
  await until(() => extra.guest.session.transcript().entries.length === 1);
  assert.ok(JSON.stringify(extra.guest.session.transcript()).length < 3000);
  const big = await pair();
  await big.host.session.play(inRound(big.host, { type: 'cover', cells: 3, junk: 'x'.repeat(20_000) }));
  assert.equal(big.host.session.transcript().entries.length, 0);
  assert.equal(big.host.table.refusals.length, 1);
  await big.guest.session.play(inRound(big.guest, { type: 'cover', cells: 3, junk: 'x'.repeat(20_000) }));
  assert.equal(big.guest.table.refusals.length, 1);
});
test('in a ranked match the other player is the one the server named', async () => {
  assert.equal((await pair({ ticket: TICKET, namedPub: 'right' })).guest.failed, null);
  assert.match((await pair({ ticket: TICKET, namedPub: 'c'.repeat(64) })).guest.failed, /not the player/);
});

/* ---- a line that is lost and comes back */
const cutOff = (p) => { p.guest.wire.close(); p.guest.wire.onClose(); };
async function again(p, change) {
  const [a, b] = wires(change);
  await Promise.all([p.host.session.resume(a), p.guest.session.resume(b)]);
  Object.assign(p.host, { wire: a }); Object.assign(p.guest, { wire: b });
}
test('a match goes on over a new line: nothing is lost, nothing happens twice', async () => {
  const p = await pair({ stays: true });
  await p.guest.session.play(inRound(p.guest, { type: 'cover', cells: 4 }));
  await until(() => p.host.session.transcript().entries.length === 1);
  cutOff(p);
  await until(() => p.host.lost && p.guest.lost);
  // Both play on while there is no line.
  await p.guest.session.play(inRound(p.guest, { type: 'cover', cells: 8 }));
  await p.host.session.play(inRound(p.host, { type: 'cover', cells: 3 }));
  assert.equal(p.guest.session.transcript().entries.length, 1);
  await again(p);
  await until(() => p.host.session.transcript().entries.length === 3 && p.guest.session.transcript().entries.length === 3);
  await p.guest.session.play(solution(p.guest));
  await until(() => p.host.over && p.guest.over);
  assert.deepEqual([p.host.failed, p.guest.failed, p.guest.over.result.winner], [null, null, 1]);
  assert.deepEqual(p.host.over.transcript, p.guest.over.transcript);
});
test('a winning move that was on its way when the line was lost still counts', async () => {
  let drop = false;
  const p = await pair({ stays: true, tamper: (m) => (drop ? null : m) });
  drop = true;
  await p.host.session.play(solution(p.host));
  await until(() => p.host.over);
  cutOff(p);
  await again(p);
  await until(() => p.guest.over);
  assert.equal(p.guest.over.result.winner, 0);
});
test('a refusal that got lost is told again', async () => {
  let drop = false;
  const p = await pair({ stays: true, tamper: (m) => (drop && m.t === 'refused' ? null : m) });
  drop = true;
  await p.guest.session.play(inRound(p.guest, { type: 'nonsense' }));
  await new Promise((r) => { setTimeout(r, 50); });
  cutOff(p);
  await until(() => p.guest.lost);
  assert.deepEqual(p.guest.table.refusals, []);
  await again(p);
  await until(() => p.guest.table.refusals.length === 1);
});
test('odd messages about coming back end the match, and cost little', async () => {
  for (const msg of [{ t: 'resume' }, { t: 'resume', match: 'x', seq: 0 }]) {
    const p = await pair({ stays: true });
    p.guest.wire.send(msg);
    await until(() => p.host.failed);
  }
  for (const seq of [-1, 5, 1.5, '0', null]) {
    const p = await pair({ stays: true }), { match } = p.host.session;
    cutOff(p);
    const [a, b] = wires();
    await p.host.session.resume(a);
    b.onMessage = () => {};
    b.send({ t: 'resume', match, seq });
    await until(() => p.host.failed);
  }
  // Asking twice over one line does not send the match twice.
  const p = await pair({ stays: true }), { match } = p.host.session;
  cutOff(p);
  const [a, b] = wires();
  await p.host.session.resume(a);
  b.onMessage = () => {};
  b.send({ t: 'resume', match, seq: 0 });
  b.send({ t: 'resume', match, seq: 0 });
  await until(() => p.host.failed);
  const q = await pair({ stays: true });
  q.host.wire.send({ t: 'caught', n: 0 });
  await until(() => q.guest.failed);
});
