import test from 'node:test';
import assert from 'node:assert/strict';
import { Match, canonical, createRandom, fingerprint } from '../kit/engine.js';
import * as shikaku from '../games/shikaku/rules.js';
import { checkGame } from '../kit/check.js';
import { playMatch } from '../kit/check-run.js';

const SEED = '0123456789abcdef'.repeat(4);
test('the same seed always gives the same board, and another seed another board', () => {
  const at = (seed) => new Match(shikaku, { seed, players: 2 }).fingerprint();
  assert.equal(at(SEED), at(SEED));
  assert.notEqual(at(SEED), at('f'.repeat(64)));
});
test('random numbers stay between 0 and 1 and are spread out', () => {
  const r = createRandom(SEED), all = Array.from({ length: 2000 }, r);
  assert.ok(all.every((x) => x >= 0 && x < 1));
  assert.ok(Math.abs(all.reduce((a, x) => a + x) / 2000 - 0.5) < 0.03);
});
test('equal values have equal text whatever the key order, and odd values are refused', () => {
  assert.equal(fingerprint({ a: 1, b: [2] }), fingerprint({ b: [2], a: 1 }));
  for (const bad of [NaN, Infinity, undefined, () => 1, new Date(), 1n, { x: undefined }]) assert.throws(() => canonical(bad));
});
test('every generated Shikaku board has a solution', () => {
  for (let i = 0; i < 200; i++) {
    const puzzle = shikaku.generate(createRandom(i.toString(16).padStart(32, '0')));
    assert.ok(shikaku.isSolved(puzzle, shikaku.solve(puzzle)));
  }
});
test('a wrong, partial or overlapping solution is refused and changes nothing', () => {
  const m = new Match(shikaku, { seed: SEED, players: 2 }), before = m.fingerprint();
  const right = shikaku.solve(m.view(0).puzzle);
  for (const rects of [[], right.slice(1), [...right, right[0]], [{ r0: 0, c0: 0, r1: 5, c1: 5 }], 'all', [{ r0: -1, c0: 0, r1: 9, c1: 9 }], [null]]) {
    assert.equal(m.play(0, { type: 'solve', rects }).ok, false);
    assert.equal(m.fingerprint(), before);
  }
  assert.deepEqual(m.play(1, { type: 'solve', rects: right }).result, { winner: 1, reason: 'solved' });
  assert.equal(m.play(0, { type: 'solve', rects: right }).error, 'the match is over');
});
test('giving up ends the match for the other player', () => {
  const m = new Match(shikaku, { seed: SEED, players: 2 });
  assert.equal(m.play(0, { $: 'resign' }).result.winner, 1);
  assert.equal(m.play(7, { $: 'resign' }).ok, false);
});
test('a huge move and an unknown player are refused', () => {
  const m = new Match(shikaku, { seed: SEED, players: 2 });
  assert.match(m.play(0, { type: 'x', pad: 'y'.repeat(9000) }).error, /too large/);
  assert.match(m.play(2, {}).error, /unknown player/);
});
test('rules cannot change the state a page was given', () => {
  const m = new Match(shikaku, { seed: SEED, players: 2 }), before = m.fingerprint();
  m.view(0).puzzle[0][0] = 99;
  assert.equal(m.fingerprint(), before);
});
test('Shikaku passes the automatic check', async () => {
  assert.equal((await checkGame(`${import.meta.dirname}/../games/shikaku`)).matches, 48);
});
test('the check refuses rules that differ between computers, and games nobody can finish', () => {
  let n = 0;
  const base = { setup: () => ({ v: 0 }), move: (s) => s, result: () => null, bot: () => ({}) };
  assert.throws(() => playMatch({ ...base, setup: () => ({ v: n++ }) }, SEED), /different positions/);
  assert.throws(() => playMatch({ ...base, move: () => ({ v: n++ }) }, SEED), /disagree/);
  assert.throws(() => playMatch(base, SEED), /no result/);
  assert.throws(() => playMatch({ ...base, bot: () => null }, SEED), /no player can move/);
});
