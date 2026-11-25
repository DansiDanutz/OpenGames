import test from 'node:test';
import assert from 'node:assert/strict';
import { Match, createRandom } from '../kit/engine.js';
import { checkGame } from '../kit/check.js';
import * as gemhold from '../games/gemhold/rules.js';

const SEED = '0123456789abcdef'.repeat(4);
const OPTIONS = { size: '7', level: 'easy' };
const fresh = (seed = SEED, options = OPTIONS) => new Match(gemhold, { seed, players: 2, options });
const rect = (r0, c0, r1 = r0, c1 = c0) => ({ r0, c0, r1, c1 });
const place = (...at) => ({ type: 'place', rect: rect(...at) });
const N = 7, END = N - 1;

test('Gemhold fields are the same from both corners and every colour is there', () => {
  for (let i = 0; i < 100; i++) {
    const { gems } = gemhold.setup({ random: createRandom(i.toString(16).padStart(32, '0')), options: OPTIONS });
    assert.deepEqual(gems, [...gems].reverse());
    assert.equal(gems.length, N * N);
    for (const kind of gemhold.GEMS) assert.ok(gems.filter((g) => g === kind).length >= 4);
    assert.equal(gems[0], 0);
  }
});
test('a player starts in their own corner', () => {
  const m = fresh();
  assert.match(m.play(0, place(3, 3)).error, /corner/);
  assert.match(m.play(0, place(END, END)).error, /corner/);
  assert.match(m.play(0, place(0, 0, 1, 1)).error, /at most 2/);
  assert.ok(m.play(0, place(0, 0, 1, 0)).ok);
  assert.match(m.play(1, place(0, 2)).error, /corner/);
  assert.ok(m.play(1, place(END - 1, END - 1, END, END)).ok);
});
test('players take turns', () => {
  const m = fresh();
  assert.match(m.play(1, place(END, END)).error, /turn/);
  assert.ok(m.play(0, place(0, 0)).ok);
  assert.match(m.play(0, place(0, 1)).error, /turn/);
});
test('a block must touch its owner by a side, not a corner, and must not cover a taken cell', () => {
  const m = fresh();
  m.play(0, place(0, 0)); m.play(1, place(END, END));
  assert.match(m.play(0, place(1, 1)).error, /touch/);
  assert.match(m.play(0, place(0, 0, 0, 1)).error, /taken/);
  assert.ok(m.play(0, place(0, 1, 0, 2)).ok);
});
test('each block can only be used as often as the player has it, in either direction', () => {
  const m = fresh();
  assert.match(m.play(0, place(0, 0, 3, 3)).error, /size/);
  m.play(0, place(0, 0)); m.play(1, place(END, END));
  assert.ok(m.play(0, place(1, 0, 2, 2)).ok); m.play(1, place(END - 1, END));
  assert.match(m.play(0, place(3, 0, 5, 1)).error, /no more/);
  assert.equal(m.view(0).stock[0]['2x3'], 0);
  assert.equal(m.view(0).stock[1]['1x1'], gemhold.BOARDS[7].stock['1x1'] - 2);
});
test('moves that are not rectangles on the field are refused and change nothing', () => {
  const m = fresh(), before = m.fingerprint();
  for (const move of [null, 1, {}, { type: 'place' }, { type: 'pass' }, place(0, 0, -1, 0), place(0.5, 0), place(0, 0, N, 0), place(1, 0, 0, 0), { type: 'place', rect: [0, 0, 0, 0] }]) {
    assert.equal(m.play(0, move).ok, false);
    assert.equal(m.fingerprint(), before);
  }
});
test('the score counts gems, and a colour goes to the player who holds more of it', () => {
  const owner = Array(N * N).fill(-1), gems = Array(N * N).fill(0);
  Object.assign(gems, { 0: 1, 1: 1, 2: 2, 48: 1, 47: 3, 46: 2 });
  for (const i of [0, 1, 2]) owner[i] = 0;
  for (const i of [46, 47, 48]) owner[i] = 1;
  const score = gemhold.score({ gems, owner });
  assert.deepEqual(score.gems, [[2, 1, 0], [1, 1, 1]]);
  assert.deepEqual(score.crowns, [1, 1]);
  assert.deepEqual(score.total, [3, 3]);
});
test('the match ends when nobody can place a block, and then one player has won', () => {
  const chance = createRandom('7'.repeat(32));
  for (let i = 0; i < 30; i++) {
    const m = fresh(i.toString(16).padStart(64, '0'));
    let moves = 0;
    while (!m.result()) {
      const { turn } = m.view(0);
      assert.equal(gemhold.bot(m.view(1 - turn), 1 - turn, chance), null);
      assert.ok(m.play(turn, gemhold.bot(m.view(turn), turn, chance)).ok);
      assert.ok(++moves < 60);
    }
    const v = m.view(0), { crowns, total } = gemhold.score(v), w = m.result().winner, ground = [0, 1].map((p) => v.owner.filter((o) => o === p).length);
    assert.ok([0, 1].every((p) => gemhold.choices(v, p).length === 0));
    assert.ok(crowns[w] > crowns[1 - w] || (crowns[w] === crowns[1 - w] && (total[w] > total[1 - w] || (total[w] === total[1 - w] && (ground[w] > ground[1 - w] || (ground[w] === ground[1 - w] && w === 1))))));
  }
});
test('a player who cannot move is skipped', () => {
  const s = gemhold.setup({ random: createRandom('1'.repeat(32)), options: OPTIONS });
  const owner = s.owner.map((_, i) => (i === 0 ? 0 : i === 1 || i === N ? 1 : -1));
  const next = gemhold.move({ ...s, owner, turn: 1 }, 1, place(0, 2));
  assert.equal(gemhold.choices(next, 0).length, 0);
  assert.equal(next.turn, 1);
});
test('every board is fair on paper: the same from both corners, with rocks only on a hard one', () => {
  for (const size of Object.keys(gemhold.BOARDS)) for (const level of ['easy', 'hard']) for (let i = 0; i < 20; i++) {
    const { n, owner, gems } = gemhold.setup({ random: createRandom(i.toString(16).padStart(32, '0')), options: { size, level } });
    const rocks = owner.filter((o) => o === gemhold.ROCK).length;
    assert.equal(n, Number(size));
    assert.deepEqual(owner.map((o) => o === gemhold.ROCK), owner.map((o) => o === gemhold.ROCK).reverse());
    assert.equal(rocks, level === 'hard' ? 2 * gemhold.BOARDS[size].rocks : 0);
    assert.ok(owner.every((o, k) => o !== gemhold.ROCK || gems[k] === 0));
    assert.equal(owner[0], -1);
  }
});
test('no block covers a rock, and nobody owns a rock', () => {
  const m = fresh(SEED, { size: '7', level: 'hard' }), v = m.view(0), i = v.owner.indexOf(gemhold.ROCK);
  const at = { r0: Math.floor(i / 7), c0: i % 7, r1: Math.floor(i / 7), c1: i % 7 };
  assert.equal(gemhold.problem(v, 0, at), 'a rock is in the way');
  assert.deepEqual(gemhold.score(v).total, [0, 0]);
});
test('Gemhold passes the automatic check', async () => {
  assert.equal((await checkGame(new URL('../games/gemhold', import.meta.url).pathname)).matches, 48);
});
