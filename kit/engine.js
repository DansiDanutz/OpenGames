// SPDX-License-Identifier: MIT
/* The rules engine. It runs the same way on both computers, so each player can
   check every move of the other. A game's rules.js exports pure functions:

     setup({ random, players })        -> state (plain JSON)
     move(state, player, move)         -> the next state, or throws when not allowed
     view(state, player)               -> what that player may see (optional)
     result(state)                     -> null, or { winner: 0 | 1 | null }
     bot(view, player, random)         -> a legal move (used by the automatic check)

   Rules must not use time, Math.random or anything outside their arguments. */

export const MAX_MOVE_BYTES = 8192;
export const RESIGN = Object.freeze({ $: 'resign' });

/* sfc32, seeded with the first 128 bits of a hex seed. */
export function createRandom(seed) {
  if (!/^[0-9a-f]{32,}$/.test(seed)) throw new Error('seed must be hex');
  let [a, b, c, d] = [0, 8, 16, 24].map((i) => parseInt(seed.slice(i, i + 8), 16) | 0);
  const next = () => {
    const t = (((a + b) | 0) + d) | 0;
    d = (d + 1) | 0;
    a = b ^ (b >>> 9);
    b = (c + (c << 3)) | 0;
    c = (c << 21) | (c >>> 11);
    c = (c + t) | 0;
    return (t >>> 0) / 4294967296;
  };
  for (let i = 0; i < 12; i++) next();
  return next;
}

/* JSON with sorted keys, so equal values always give equal text. */
export function canonical(value) {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('only finite numbers are allowed');
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (typeof value === 'object' && [Object.prototype, null].includes(Object.getPrototypeOf(value))) {
    return `{${Object.keys(value).sort().map((k) => `${JSON.stringify(k)}:${canonical(value[k])}`).join(',')}}`;
  }
  throw new Error('only plain JSON values are allowed');
}

/* FNV-1a over 64 bits: finds two computers that disagree. It is not a signature. */
export function fingerprint(value) {
  let h = 0xcbf29ce484222325n;
  for (const ch of new TextEncoder().encode(canonical(value))) h = ((h ^ BigInt(ch)) * 0x100000001b3n) & 0xffffffffffffffffn;
  return h.toString(16).padStart(16, '0');
}

const copy = (value) => JSON.parse(canonical(value));
const isResign = (move) => !!move && typeof move === 'object' && move.$ === 'resign';

export class Match {
  #rules; #state; #resigned = null; #players;

  constructor(rules, { seed, players }) {
    this.#rules = rules;
    this.#players = players;
    this.#state = copy(rules.setup({ random: createRandom(seed), players }));
  }

  /* Plays a move for a player. Nothing changes when it is not allowed. */
  play(player, move) {
    if (this.result()) return { ok: false, error: 'the match is over' };
    if (!Number.isInteger(player) || player < 0 || player >= this.#players) return { ok: false, error: 'unknown player' };
    try {
      if (canonical(move).length > MAX_MOVE_BYTES) return { ok: false, error: 'the move is too large' };
      if (isResign(move)) this.#resigned = player;
      else this.#state = copy(this.#rules.move(copy(this.#state), player, copy(move)));
    } catch (error) {
      return { ok: false, error: String(error?.message ?? error).slice(0, 200) };
    }
    return { ok: true, result: this.result(), fingerprint: this.fingerprint() };
  }

  result() {
    if (this.#resigned !== null) return { winner: 1 - this.#resigned, reason: 'resigned' };
    const r = this.#rules.result(copy(this.#state));
    return r ? copy(r) : null;
  }

  view(player) { return copy(this.#rules.view ? this.#rules.view(copy(this.#state), player) : this.#state); }

  fingerprint() { return fingerprint({ state: this.#state, resigned: this.#resigned }); }
}
