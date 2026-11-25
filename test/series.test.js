import test from 'node:test';
import assert from 'node:assert/strict';
import { Series, cleanTerms } from '../kit/engine.js';
import * as shikaku from '../games/shikaku/rules.js';
import { GAME, pair, until } from './helpers.js';

const SEED = '0123456789abcdef'.repeat(4), TICKET = '01234567-89ab-cdef-0123-456789abcdef';
const OPTIONS = [{ id: 'size', label: 'Board', default: '6', choices: [{ id: '5', label: '5' }, { id: '6', label: '6' }] }];
const series = (rounds, options = {}) => new Series(shikaku, { seed: SEED, terms: { options, rounds } });
const solve = (s, player) => s.play(player, { round: s.round, move: { type: 'solve', rects: shikaku.solve(s.view(player).puzzle) } });

test('best of three ends as soon as one player has two games', () => {
  const s = series(3);
  const first = solve(s, 1);
  assert.deepEqual([first.result, first.ended.score, first.ended.winner], [null, [0, 1], 1]);
  assert.equal(s.round, 1);
  assert.deepEqual(solve(s, 1).result, { winner: 1, reason: 'solved', score: [0, 2] });
  assert.equal(solve(s, 0).error, 'the match is over');
});
test('best of five goes to the player with three games, whoever sits where', () => {
  const s = series(5);
  for (const p of [0, 1, 0, 1]) assert.equal(solve(s, p).result, null);
  assert.deepEqual(solve(s, 0).result, { winner: 0, reason: 'solved', score: [3, 2] });
});
test('heads-up is one game', () => assert.deepEqual(solve(series(1), 0).result, { winner: 0, reason: 'solved', score: [1, 0] }));
test('players change seats and get a new board in every game', () => {
  const s = series(3), board = s.view(0).puzzle;
  assert.deepEqual([s.seat(0), s.seat(1)], [0, 1]);
  solve(s, 0);
  assert.deepEqual([s.seat(0), s.seat(1)], [1, 0]);
  assert.notDeepEqual(s.view(0).puzzle, board);
});
test('a move that arrives after its game has ended does not count in the next one', () => {
  const s = series(3), late = { round: 0, move: { type: 'cover', cells: 4 } };
  solve(s, 0);
  const before = s.fingerprint();
  assert.equal(s.play(1, late).error, 'that game is over');
  assert.equal(s.fingerprint(), before);
  assert.equal(s.play(1, { round: 1, move: { $: 'resign' } }).ok, false);
});
test('giving up ends the whole match', () => {
  const s = series(5);
  solve(s, 0);
  assert.deepEqual(s.play(0, { $: 'resign' }).result, { winner: 1, reason: 'resigned', score: [1, 0] });
});
test('drawn games are played again, but not for ever', () => {
  const draws = { setup: () => ({ over: false }), move: () => ({ over: true }), result: (x) => (x.over ? { winner: null } : null) };
  const s = new Series(draws, { seed: SEED, terms: { options: {}, rounds: 3 } });
  let out;
  for (let i = 0; i < 5; i++) { assert.equal(s.result(), null); out = s.play(0, { round: s.round, move: 1 }); }
  assert.deepEqual(out.result, { winner: null, reason: '', score: [0, 0] });
});
test('the rules of a match are only what the game offers', () => {
  assert.deepEqual(cleanTerms(OPTIONS, {}), { options: { size: '6' }, rounds: 1, ranked: false, ticket: null });
  assert.deepEqual(cleanTerms(OPTIONS, { options: { size: '5' }, rounds: 5, ranked: true, ticket: TICKET }), { options: { size: '5' }, rounds: 5, ranked: true, ticket: TICKET });
  for (const bad of [{ rounds: 2 }, { rounds: '3' }, { options: { size: '9' } }, { options: { other: '1' } }, { options: { size: ['5'] } }, { ranked: true }, { ranked: 1, ticket: TICKET }, { ticket: 'x' }]) assert.throws(() => cleanTerms(OPTIONS, bad));
});
const game = { ...GAME, options: OPTIONS };
test('the host chooses, the other player sees the rules and both play by them', async () => {
  let seen = null;
  const { host, guest } = await pair({ game, terms: { options: { size: '5' }, rounds: 3 }, onTerms: (offer) => { seen = offer; return true; } });
  assert.deepEqual([seen.name, seen.terms.options.size, seen.terms.rounds], ['Ann', '5', 3]);
  for (const side of [host, guest]) assert.equal(side.table.view().puzzle.length, 5);
});
test('a player who does not accept the rules leaves before the board is known', async () => {
  const { host, guest } = await pair({ game, onTerms: () => false });
  await until(() => host.failed);
  assert.match(host.failed, /did not accept/);
  assert.equal(guest.session.seed, undefined);
});
test('rules the game does not have, and a foreign ticket, are refused', async () => {
  const change = (terms) => ({ game, tamper: (m) => (m.t === 'hello' ? { ...m, terms: { ...m.terms, ...terms } } : m) });
  assert.match((await pair(change({ rounds: 99 }))).guest.failed, /does not have/);
  assert.match((await pair(change({ ticket: TICKET }))).guest.failed, /bad greeting/);
});
test('a host that changes the rules after they were accepted is caught', async () => {
  const { host, guest } = await pair({ game, terms: { options: { size: '6' } }, tamper: (m) => (m.t === 'hello' ? { ...m, terms: { ...m.terms, options: { size: '5' } } } : m) });
  host.session.play({ round: 0, move: { type: 'cover', cells: 3 } });
  await until(() => guest.failed);
  assert.match(guest.failed, /order|signed|disagree/);
});
