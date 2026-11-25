import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as avioane from '../games/avioane/rules.js';
import * as gemhold from '../games/gemhold/rules.js';
import * as shikaku from '../games/shikaku/rules.js';
import { Match, Series, createRandom } from '../kit/engine.js';
import { createComputer } from '../kit/computer.js';
import { Solo } from '../app/shell/solo.js';
import { createTable } from '../app/shell/table.js';
import { until } from './helpers.js';

const SEED = '5eed'.repeat(16);
const OPTIONS = { shikaku: [{ id: 'size', default: '6', choices: [{ id: '6' }] }, { id: 'level', default: 'easy', choices: [{ id: 'easy' }, { id: 'hard' }] }] };
const GAME = { id: 'shikaku', hash: 'a'.repeat(64), options: OPTIONS.shikaku };
/* The page's side of a match against the computer, as kit/ui.js does it. */
function tableOf(rules, { pace = 1, change = (x) => x } = {}) {
  const t = { refusals: [], series: null, asked: 0 };
  t.start = async ({ seed, terms, solo }) => { t.solo = solo; t.series = new Series(rules, { seed, terms }); t.computer = createComputer(rules, t.series, 1, { options: terms.options, seed: SEED }); return t.series.fingerprint(); };
  t.tryMove = async (player, move) => { const { ended, ...out } = t.series.play(player, move); return { ...out, ...(ended ? { score: ended.score } : {}) }; };
  t.think = async () => { t.asked++; return change({ move: t.computer.move(), ms: pace }); };
  t.refused = (error) => t.refusals.push(error);
  return t;
}
function soloFor(rules, { game = GAME, terms = {}, table = tableOf(rules) } = {}) {
  const s = { table, failed: null, over: null, scores: [], entries: [] };
  s.session = new Solo({ table, game, terms, name: 'Ann', pauseMs: 5, on: { started: (x) => { s.started = x; }, ended: ({ score }) => s.scores.push(score), entry: (e) => s.entries.push(e.player),
    over: (o) => { s.over = o; }, failed: (r) => { s.failed = r; } } });
  return s;
}
/* A person who plays well and quickly, for the tests. */
async function playWell(rules, s, limit = 4000) {
  const me = createComputer(rules, s.table.series, 0, { options: s.started.terms.options, seed: '0a'.repeat(32) });
  for (let n = 0; n < limit && !s.over && !s.failed; n++) {
    const move = me.move();
    if (move) s.session.play(move);
    await new Promise((r) => setTimeout(r, 1));
  }
}

test('a match alone starts without a server, is never ranked, and has no ticket', async () => {
  const s = soloFor(shikaku, { terms: { options: { size: '6', level: 'hard' }, rounds: 3, ranked: true } });
  await s.session.open();
  assert.deepEqual(s.started.terms, { options: { size: '6', level: 'hard' }, rounds: 3, ranked: false, ticket: null });
  assert.deepEqual([s.started.me, s.started.players.map((p) => p.name), s.table.solo], [0, ['Ann', 'Computer'], true]);
  s.session.close();
});
test('rules the game does not have are refused', () => {
  assert.throws(() => soloFor(shikaku, { terms: { options: { size: '99' } } }), /unknown choice/);
});
for (const [id, rules, options] of [['gemhold', gemhold, { size: '5', level: 'easy' }], ['avioane', avioane, { size: '8', level: 'hard' }], ['shikaku', shikaku, { size: '6', level: 'easy' }]]) {
  test(`${id}: a best of three against the computer reaches its end`, async () => {
    const declared = Object.entries(options).map(([key, value]) => ({ id: key, default: value, choices: [{ id: value }] }));
    const s = soloFor(rules, { game: { ...GAME, id, options: declared }, terms: { options, rounds: 3 } });
    await s.session.open();
    await playWell(rules, s);
    assert.equal(s.failed, null);
    assert.ok(s.over, 'the match did not end');
    assert.ok(s.scores.length >= 2 && Math.max(...s.over.result.score) === 2);
    assert.deepEqual(s.table.refusals, []);
  });
}
test('giving up ends the match, and nothing is played after it', async () => {
  const s = soloFor(gemhold, { game: { ...GAME, id: 'gemhold', options: [] } });
  await s.session.open();
  s.session.play({ $: 'resign' });
  await until(() => s.over);
  assert.deepEqual([s.over.result.winner, s.over.result.reason, s.over.me], [1, 'resigned', 0]);
  const asked = s.table.asked;
  await new Promise((r) => setTimeout(r, 30));
  assert.equal(s.table.asked, asked);
});
test('a closed match asks the computer for nothing more', async () => {
  const s = soloFor(shikaku);
  await s.session.open();
  await until(() => s.entries.length > 1);
  s.session.close();
  const n = s.entries.length;
  await new Promise((r) => setTimeout(r, 40));
  assert.ok(s.entries.length <= n + 1);
  assert.equal(s.over, null);
});
test('a busy player cannot keep the computer waiting', async () => {
  const s = soloFor(shikaku, { table: tableOf(shikaku, { pace: 20 }) });
  await s.session.open();
  const busy = setInterval(() => s.session.play({ round: 0, move: { type: 'cover', cells: 1 } }), 2);
  await until(() => s.entries.filter((p) => p === 1).length >= 3);
  clearInterval(busy); s.session.close();
});
test('a computer that breaks the rules or stops ends the match with a reason', async () => {
  const cheat = soloFor(shikaku, { table: tableOf(shikaku, { change: () => ({ move: { round: 0, move: { type: 'x' } }, ms: 1 }) }) });
  await cheat.session.open();
  await until(() => cheat.failed);
  assert.match(cheat.failed, /computer player/);
  const table = tableOf(shikaku);
  table.think = async () => { throw new Error('The game stopped answering.'); };
  const stuck = soloFor(shikaku, { table });
  await stuck.session.open();
  await until(() => stuck.failed);
  assert.match(stuck.failed, /stopped/);
});
test('a wrong move of the player is refused and the match goes on', async () => {
  const s = soloFor(gemhold, { game: { ...GAME, id: 'gemhold', options: [] } });
  await s.session.open();
  s.session.play({ round: 0, move: { type: 'place', rect: { r0: 3, c0: 3, r1: 3, c1: 3 } } });
  await until(() => s.table.refusals.length);
  assert.deepEqual([s.over, s.failed], [null, null]);
  s.session.close();
});
test('what a page answers about the computer is checked', async () => {
  const sent = [], table = createTable({ send: (m) => sent.push(m), answerMs: 60 });
  const ask = async (answer) => { const p = table.think(); table.receive({ t: 'thought', id: sent.at(-1).id, ...answer }); return p; };
  assert.deepEqual(await ask({ move: { a: 1 }, ms: 300 }), { move: { a: 1 }, ms: 300 });
  assert.deepEqual(await ask({ move: null, ms: 'x' }), { move: null, ms: 900 });
  assert.equal((await ask({ move: null, ms: -5 })).ms, 100);
  assert.equal((await ask({ move: null, ms: 1e9 })).ms, 20000);
  await assert.rejects(table.think(), /stopped answering/);
});

test('Avioane: the computer hides a new legal fleet each time, and never learns the other one', () => {
  const fleets = new Set();
  for (let i = 0; i < 12; i++) {
    const own = { options: { size: '10', level: 'hard' }, notes: {} }, state = avioane.setup({ options: own.options });
    const m = avioane.bot(state, 1, createRandom(`${i.toString(16).padStart(2, '0')}`.repeat(16)), own);
    assert.match(m.hash, /^[0-9a-f]{64}$/);
    assert.ok(avioane.isFleet(10, own.notes.fleet));
    fleets.add(JSON.stringify(own.notes.fleet));
  }
  assert.ok(fleets.size > 10);
});
/* Shots the computer needs to find a whole fleet. */
function shots(level, seed, size = 10) {
  const random = createRandom(seed), fleet = avioane.randomFleet(size, random), own = { options: { size: String(size), level }, notes: {} };
  let state = { ...avioane.setup({ options: own.options }), phase: 'play', seals: ['x', 'y'], turn: 1 };
  for (let n = 1; ; n++) {
    const m = avioane.bot(state, 1, random, own);
    state = avioane.move(state, 1, m);
    state = avioane.move(state, 0, { type: 'answer', ...avioane.answer(state, fleet, state.log[0], state.shot) });
    if (state.phase !== 'play') return n;
    state = { ...state, turn: 1 };
  }
}
test('Avioane: the computer aims, and better on a hard board', () => {
  const mean = (level) => { let sum = 0; for (let i = 0; i < 30; i++) sum += shots(level, (i + 10).toString(16).repeat(32).slice(0, 64)); return sum / 30; };
  const easy = mean('easy'), hard = mean('hard');
  assert.ok(hard < 50, `hard needs ${hard}`);
  assert.ok(easy > hard + 4 && easy < 85, `easy ${easy}, hard ${hard}`);
});
test('Gemhold: the hard computer beats the easy one', () => {
  let won = 0;
  for (let i = 0; i < 40; i++) {
    const m = new Match(gemhold, { seed: (i + 20).toString(16).repeat(32).slice(0, 64), players: 2, options: { size: '7', level: 'easy' } }), random = createRandom(SEED), hard = i % 2;
    for (let n = 0; n < 200 && !m.result(); n++) for (const p of [0, 1]) { const move = gemhold.bot(m.view(p), p, random, { options: { level: p === hard ? 'hard' : 'easy' }, notes: {} }); if (move) m.play(p, move); }
    if (m.result().winner === hard) won++;
  }
  assert.ok(won >= 26, `hard won ${won} of 40`);
});
test('Shikaku: the computer takes about as long as a person, and solves at the end', () => {
  const random = createRandom(SEED);
  for (const [size, low, high] of [['6', 45, 150], ['8', 80, 260], ['10', 130, 420]]) {
    const m = new Match(shikaku, { seed: SEED, players: 2, options: { size, level: 'easy' } });
    let ms = 0;
    for (let n = 0; n < 400 && !m.result(); n++) { ms += shikaku.pace(m.view(1), 1, random); m.play(1, shikaku.bot(m.view(1), 1, random)); }
    assert.equal(m.result().winner, 1);
    assert.ok(ms / 1000 > low && ms / 1000 < high, `${size}: ${ms / 1000} s`);
  }
});
