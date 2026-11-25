import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { Match, createRandom } from '../kit/engine.js';
import { checkGame } from '../kit/check.js';
import * as av from '../games/avioane/rules.js';

const SEED = '0123456789abcdef'.repeat(4), SALT = 'ab'.repeat(16);
const FLEET = [{ kind: 'plane', r: 0, c: 2, dir: 0 }, { kind: 'plane', r: 5, c: 7, dir: 0 }, { kind: 'boat4', r: 9, c: 0, dir: 0 }, { kind: 'boat3', r: 5, c: 0, dir: 0 }, { kind: 'boat2', r: 0, c: 8, dir: 0 }];
const N = 10, HARD = { n: N, level: 'hard' }, OPTIONS = { size: '10', level: 'hard' };
const at = (r, c) => r * N + c;
const cellsOf = (p) => av.cellsOf(N, p), isFleet = (f) => av.isFleet(N, f), answer = (f, log, cell) => av.answer(HARD, f, log, cell);
const begin = (fleets = [FLEET, FLEET]) => {
  const m = new Match(av, { seed: SEED, players: 2, options: OPTIONS });
  fleets.forEach((f, p) => assert.ok(m.play(p, { type: 'commit', hash: av.seal(f, SALT) }).ok));
  return m;
};
/* One shot and its answer, as two honest players give them. */
const shoot = (m, player, cell, fleet = FLEET) => {
  assert.ok(m.play(player, { type: 'shoot', cell }).ok);
  const out = m.play(1 - player, { type: 'answer', ...answer(fleet, m.view(0).log[1 - player], cell) });
  assert.ok(out.ok, out.error);
  return out;
};
/* Player 0 brings down everything; player 1 keeps missing. */
const win = (m) => {
  const targets = FLEET.flatMap((p) => (p.kind === 'plane' ? [cellsOf(p)[0]] : cellsOf(p)));
  const misses = Array.from({ length: 100 }, (_, i) => i).filter((i) => answer(FLEET, [], i).says === 'miss');
  targets.forEach((cell, n) => { shoot(m, 0, cell); if (n < targets.length - 1) shoot(m, 1, misses[n]); });
};

test('the seal is SHA-256, so a fleet cannot be changed or guessed', () => {
  for (const text of ['', 'abc', 'x'.repeat(55), 'x'.repeat(56), 'x'.repeat(64), 'y'.repeat(300)]) assert.equal(av.sha256(text), createHash('sha256').update(text).digest('hex'));
  assert.notEqual(av.seal(FLEET, SALT), av.seal(FLEET, 'ac'.repeat(16)));
  assert.notEqual(av.seal(FLEET, SALT), av.seal([{ ...FLEET[0], c: 3 }, ...FLEET.slice(1)], SALT));
});
test('a plane has ten cells with its head first, in all four directions', () => {
  const up = cellsOf({ kind: 'plane', r: 0, c: 2, dir: 0 });
  assert.deepEqual([...up].sort((a, b) => a - b), [at(0, 2), at(1, 0), at(1, 1), at(1, 2), at(1, 3), at(1, 4), at(2, 2), at(3, 1), at(3, 2), at(3, 3)]);
  for (let dir = 0; dir < 4; dir++) {
    const cells = cellsOf({ kind: 'plane', r: 5, c: 5, dir });
    assert.equal(new Set(cells).size, 10);
    assert.equal(cells[0], at(5, 5));
  }
  assert.equal(cellsOf({ kind: 'plane', r: 0, c: 0, dir: 0 }), null);
});
test('a fleet must be complete, on the board and without overlaps', () => {
  assert.equal(isFleet(FLEET), true);
  const swap = (i, change) => FLEET.map((p, n) => (n === i ? { ...p, ...change } : p));
  for (const bad of [null, [], FLEET.slice(1), [...FLEET, FLEET[4]], swap(0, { c: 0 }), swap(0, { dir: 4 }), swap(2, { dir: 2 }), swap(3, { r: 1, c: 0 }), swap(4, { kind: 'boat4' }), swap(1, { r: 0.5 })]) assert.equal(isFleet(bad), false);
});
test('random fleets are always allowed and differ', () => {
  const random = createRandom('3'.repeat(32)), seen = new Set();
  for (let i = 0; i < 300; i++) { const f = av.randomFleet(N, random); assert.ok(isFleet(f)); seen.add(JSON.stringify(f)); }
  assert.ok(seen.size > 290);
});
test('nobody shoots before both fleets are sealed, and a seal is final', () => {
  const m = new Match(av, { seed: SEED, players: 2, options: OPTIONS });
  assert.match(m.play(0, { type: 'shoot', cell: 0 }).error, /not now/);
  assert.equal(m.play(0, { type: 'commit', hash: 'x' }).ok, false);
  assert.ok(m.play(0, { type: 'commit', hash: av.seal(FLEET, SALT) }).ok);
  assert.match(m.play(0, { type: 'commit', hash: av.seal(FLEET, SALT) }).error, /already/);
});
test('the match never shows where a fleet is', () => {
  const text = JSON.stringify(begin().view(1));
  assert.ok(!/plane|boat/.test(text));
});
test('players take turns, and a shot must be answered by the other player', () => {
  const m = begin();
  assert.match(m.play(1, { type: 'shoot', cell: 0 }).error, /turn/);
  assert.ok(m.play(0, { type: 'shoot', cell: at(9, 9) }).ok);
  assert.match(m.play(0, { type: 'shoot', cell: 1 }).error, /answer/);
  assert.match(m.play(0, { type: 'answer', says: 'miss' }).error, /other player/);
  assert.ok(m.play(1, { type: 'answer', says: 'miss' }).ok);
  assert.equal(m.view(0).turn, 1);
});
test('a hit on the head brings a plane down, and its other cells are marked', () => {
  const m = begin();
  shoot(m, 0, at(2, 2));
  assert.equal(m.view(0).board[1][at(2, 2)], 'hit');
  shoot(m, 1, at(9, 9));
  shoot(m, 0, at(0, 2));
  assert.deepEqual(m.view(0).down[1], [FLEET[0]]);
  assert.equal(m.view(0).board[1][at(3, 3)], 'down');
  shoot(m, 1, at(9, 8));
  assert.match(m.play(0, { type: 'shoot', cell: at(3, 3) }).error, /already/);
});
test('a boat sinks with its last cell', () => {
  const m = begin();
  shoot(m, 0, at(0, 8));
  assert.equal(m.view(0).down[1].length, 0);
  shoot(m, 1, at(9, 9));
  shoot(m, 0, at(0, 9));
  assert.deepEqual(m.view(0).down[1], [FLEET[4]]);
});
test('answers that cannot be true are refused', () => {
  const m = begin();
  shoot(m, 0, at(0, 1));                          // a miss next to the first plane's head
  shoot(m, 1, at(9, 9));
  m.play(0, { type: 'shoot', cell: at(0, 2) });
  for (const move of [{ says: 'sunk' }, { says: 'down' }, { says: 'down', piece: { kind: 'plane', r: 9, c: 2, dir: 0 } }, { says: 'down', piece: FLEET[1] }, { says: 'down', piece: { kind: 'boat2', r: 0, c: 1, dir: 0 } }, { says: 'down', piece: { kind: 'boat2', r: 0, c: 2, dir: 0 } }]) {
    assert.equal(m.play(1, { type: 'answer', ...move }).ok, false, JSON.stringify(move));
  }
  assert.ok(m.play(1, { type: 'answer', says: 'down', piece: FLEET[0] }).ok);
});
test('the winner shows the fleet, and an honest one wins', () => {
  const m = begin();
  win(m);
  assert.equal(m.view(0).phase, 'reveal');
  assert.equal(m.result(), null);
  assert.match(m.play(1, { type: 'reveal', fleet: FLEET, salt: SALT }).error, /other player/);
  assert.deepEqual(m.play(0, { type: 'reveal', fleet: FLEET, salt: SALT }).result, { winner: 0, reason: 'fleet' });
});
test('a winner who changed the fleet, the salt or an answer loses', () => {
  const other = [{ ...FLEET[0], c: 3 }, ...FLEET.slice(1)];
  for (const reveal of [{ fleet: other, salt: SALT }, { fleet: FLEET, salt: 'cd'.repeat(16) }, { fleet: null, salt: 1 }]) {
    const m = begin();
    win(m);
    assert.deepEqual(m.play(0, { type: 'reveal', ...reveal }).result, { winner: 1, reason: 'unfair' });
  }
  const m = begin();
  shoot(m, 0, at(9, 9));
  m.play(1, { type: 'shoot', cell: at(0, 2) });
  m.play(0, { type: 'answer', says: 'miss' });    // a lie: that was the head
  const targets = FLEET.flatMap((p) => (p.kind === 'plane' ? [cellsOf(p)[0]] : cellsOf(p)));
  const misses = [at(9, 9), at(8, 1), at(9, 8), at(6, 9), at(6, 0), at(7, 0), at(4, 4), at(3, 9), at(2, 9), at(4, 0), at(4, 2), at(8, 2)];
  targets.forEach((cell, n) => { shoot(m, 0, cell); if (n < targets.length - 1) shoot(m, 1, misses[n]); });
  assert.deepEqual(m.play(0, { type: 'reveal', fleet: FLEET, salt: SALT }).result, { winner: 1, reason: 'unfair' });
});
test('a fleet that breaks the rules loses when it is shown', () => {
  const bad = FLEET.map((p, i) => (i === 1 ? FLEET[0] : p));
  const m = begin([bad, FLEET]);
  const targets = FLEET.flatMap((p) => (p.kind === 'plane' ? [cellsOf(p)[0]] : cellsOf(p)));
  const misses = Array.from({ length: 100 }, (_, i) => i).filter((i) => answer(bad, [], i).says === 'miss');
  targets.forEach((cell, n) => { shoot(m, 0, cell); if (n < targets.length - 1) shoot(m, 1, misses[n], bad); });
  assert.equal(m.play(0, { type: 'reveal', fleet: bad, salt: SALT }).result.winner, 1);
});
test('a player who always says miss loses when the whole board was shot', () => {
  const m = begin();
  let out;
  const mine = Array.from({ length: 100 }, (_, i) => i).filter((i) => answer(FLEET, [], i).says === 'miss');
  for (let i = 0; i < 100 && !m.result(); i++) {
    m.play(0, { type: 'shoot', cell: i });
    out = m.play(1, { type: 'answer', says: 'miss' });
    if (m.result()) break;
    const cell = mine[i] ?? i - 1;
    if (m.view(0).board[0][cell] !== '') { m.play(1, { $: 'resign' }); break; }
    shoot(m, 1, cell);
  }
  assert.equal(out.ok, true);
  assert.equal(m.result().winner, 0);
});
test('moves of the wrong shape are refused and change nothing', () => {
  const m = begin(), before = m.fingerprint();
  for (const move of [null, 4, {}, { type: 'shoot' }, { type: 'shoot', cell: 100 }, { type: 'shoot', cell: -1 }, { type: 'shoot', cell: '4' }, { type: 'answer', says: 'miss' }, { type: 'reveal', fleet: FLEET, salt: SALT }]) {
    assert.equal(m.play(0, move).ok, false);
    assert.equal(m.fingerprint(), before);
  }
});
test('on an easy board a miss beside a piece is near, and a hard board never says so', () => {
  for (const [level, says] of [['easy', 'near'], ['hard', 'miss']]) {
    const m = new Match(av, { seed: SEED, players: 2, options: { size: '10', level } });
    for (const p of [0, 1]) m.play(p, { type: 'commit', hash: av.seal(FLEET, SALT) });
    m.play(0, { type: 'shoot', cell: at(0, 1) });
    assert.equal(av.answer({ n: N, level }, FLEET, [], at(0, 1)).says, says);
    assert.equal(m.play(1, { type: 'answer', says: 'near' }).ok, level === 'easy');
  }
});
test('every board has fleets that fit', () => {
  const random = createRandom('5'.repeat(32));
  for (const n of Object.keys(av.FLEETS).map(Number)) for (let i = 0; i < 30; i++) assert.ok(av.isFleet(n, av.randomFleet(n, random)));
});
test('Avioane passes the automatic check', async () => {
  assert.equal((await checkGame(new URL('../games/avioane', import.meta.url).pathname)).matches, 36);
});
