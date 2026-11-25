// SPDX-License-Identifier: MIT
/* Plays a game's rules against themselves. Started by check.js as a program of its own that may only
   read the game and the engine: no writing, no network, no other programs. */
import fs from 'node:fs';
import { pathToFileURL } from 'node:url';
import { Match, createRandom, canonical } from './engine.js';

const MATCHES = 6, MAX_MOVES = 5000, MAX_STATE = 256 * 1024;
const randomHex = () => Array.from(crypto.getRandomValues(new Uint8Array(32)), (b) => b.toString(16).padStart(2, '0')).join('');

/* One match with the game's own bot, on two engines that only share moves. */
export function playMatch(rules, seed, options = {}) {
  const sides = [0, 1].map(() => new Match(rules, { seed, players: 2, options }));
  const chance = createRandom(randomHex());
  if (sides[0].fingerprint() !== sides[1].fingerprint()) throw new Error('two computers start with different positions');
  for (let n = 0; n < MAX_MOVES; n++) {
    let moved = false;
    for (const player of chance() < 0.5 ? [0, 1] : [1, 0]) {
      const move = rules.bot(sides[player].view(player), player, chance);
      if (move === null || move === undefined) continue;        // not this player's turn
      const out = sides.map((m) => m.play(player, move));
      if (!out[0].ok) throw new Error(`the bot made a move the rules refuse: ${out[0].error}`);
      if (out[0].fingerprint !== out[1]?.fingerprint) throw new Error('two computers disagree after the same move');
      if (canonical(sides[0].view(0)).length > MAX_STATE) throw new Error('the position is too large');
      if (out[0].result) return { moves: n + 1, winner: out[0].result.winner };
      moved = true;
    }
    if (!moved) throw new Error('no player can move and nobody has won');
  }
  throw new Error(`no result after ${MAX_MOVES} moves`);
}
/* Every combination of the choices a host may make. */
export function combinations(declared) {
  return declared.reduce((list, { id, choices }) => list.flatMap((x) => choices.map((c) => ({ ...x, [id]: c.id }))), [{}]);
}
export function checkRules(rules, declared) {
  for (const fn of ['setup', 'move', 'result', 'bot']) if (typeof rules[fn] !== 'function') throw new Error(`rules.js must export ${fn}`);
  const wins = [0, 0], all = combinations(declared);
  for (const options of all) {
    for (let n = 0; n < MATCHES; n++) { const { winner } = playMatch(rules, randomHex(), options); if (winner !== null) wins[winner] += 1; }
    for (const bad of [null, 0, '', {}, { type: '__proto__' }, [], { $: 'x' }]) {
      const m = new Match(rules, { seed: '00'.repeat(32), players: 2, options }), before = m.fingerprint();
      if (!m.play(0, bad).ok && m.fingerprint() !== before) throw new Error('a refused move changed the position');
    }
  }
  return { matches: all.length * MATCHES, wins };
}

if (process.argv[1] === import.meta.filename) {
  // Taken before the rules run, so that rules which print an answer of their own are noticed.
  const secret = fs.readFileSync(0, 'utf8'), write = fs.writeSync, text = JSON.stringify;
  const [, , file, declared] = process.argv, options = JSON.parse(declared);
  let out;
  try { out = { ok: true, ...checkRules(await import(pathToFileURL(file)), options) }; } catch (error) { out = { ok: false, error: String(error?.message ?? error).slice(0, 300) }; }
  write(1, `\n${secret}${text(out)}\n`);
}
