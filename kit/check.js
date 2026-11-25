// SPDX-License-Identifier: MIT
/* Checks a game before it may join: node kit/check.js games/my-game
   Run this only on your own code: it runs the game's rules on your computer. */
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import fs from 'node:fs';
import { randomBytes } from 'node:crypto';
import { Match, createRandom, canonical } from './engine.js';
import { hashGame, readManifest } from '../app/library.js';

const MATCHES = 20, MAX_MOVES = 5000, MAX_STATE = 256 * 1024;
const BANNED = [/\bMath\s*\.\s*random\b/, /\bDate\b/, /\bperformance\b/, /\bfetch\b/, /\bimport\s*\(/, /^\s*import\b/m, /\beval\b/, /\bnew\s+Function\b/, /\bglobalThis\b/, /\bprocess\b/, /\bsetTimeout\b/];

/* Plays one match with the game's own bot, on two engines that only share moves. */
export function playMatch(rules, seed) {
  const sides = [0, 1].map(() => new Match(rules, { seed, players: 2 }));
  const chance = createRandom(randomBytes(16).toString('hex'));
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
export async function checkGame(dir) {
  const manifest = readManifest(dir);
  const source = fs.readFileSync(path.join(dir, manifest.rules), 'utf8');
  const found = BANNED.find((re) => re.test(source.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '')));
  if (found) throw new Error(`rules must not use ${found.source}`);
  const rules = await import(pathToFileURL(path.join(path.resolve(dir), manifest.rules)));
  for (const fn of ['setup', 'move', 'result', 'bot']) if (typeof rules[fn] !== 'function') throw new Error(`rules.js must export ${fn}`);
  const played = Array.from({ length: MATCHES }, () => playMatch(rules, randomBytes(32).toString('hex')));
  for (const bad of [null, 0, '', {}, { type: '__proto__' }, [], { $: 'x' }]) {
    const m = new Match(rules, { seed: '00'.repeat(32), players: 2 });
    const before = m.fingerprint();
    if (!m.play(0, bad).ok && m.fingerprint() !== before) throw new Error('a refused move changed the position');
  }
  return { id: manifest.id, hash: hashGame(dir), matches: played.length, wins: [0, 1].map((p) => played.filter((x) => x.winner === p).length) };
}

if (process.argv[1] === import.meta.filename) {
  try {
    const r = await checkGame(process.argv[2]);
    console.log(`${r.id} passed: ${r.matches} matches, won ${r.wins.join(' to ')}. Version ${r.hash.slice(0, 12)}.`);
  } catch (error) {
    console.error(`Not accepted: ${error.message}`);
    process.exitCode = 1;
  }
}
