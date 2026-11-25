// SPDX-License-Identifier: MIT
/* The rules engine. It runs the same way on both computers, so each player can
   check every move of the other. A game's rules.js exports pure functions:

     setup({ random, players, options }) -> state (plain JSON)
     move(state, player, move)         -> the next state, or throws when not allowed
     view(state, player)               -> what that player may see (optional)
     result(state)                     -> null, or { winner: 0 | 1 | null }
     bot(view, player, random, own)    -> a legal move, or null when it is not that player's turn. It plays
                                          against a person who is alone, and in the automatic check.
                                          own is { options, notes }; notes is its memory for one game
     pace(view, player, random)        -> milliseconds until the bot's next move (optional)

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

  constructor(rules, { seed, players, options = {} }) {
    this.#rules = rules;
    this.#players = players;
    this.#state = copy(rules.setup({ random: createRandom(seed), players, options: copy(options) }));
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

/* ---- what the host decides before a match */
export const ROUNDS = [1, 3, 5];                       // one game, best of three, best of five
const MAX_DRAWS = 2;

/* The host's choices, checked against what the game offers. Both computers do this. */
export function cleanTerms(declared, terms) {
  const { options = {}, rounds = 1, ticket = null, ranked = false } = terms ?? {};
  if (!ROUNDS.includes(rounds)) throw new Error('unknown number of games');
  if (ticket !== null && !/^[0-9a-f-]{36}$/.test(ticket)) throw new Error('bad ticket');
  if (typeof ranked !== 'boolean' || (ranked && !ticket)) throw new Error('only a match with a ticket can be ranked');
  if (Object.keys(options).some((id) => !declared.some((o) => o.id === id))) throw new Error('unknown option');
  const chosen = declared.map(({ id, choices, default: usual }) => {
    const value = Object.hasOwn(options, id) ? options[id] : usual;
    if (!choices.some((c) => c.id === value)) throw new Error(`unknown choice for ${id}`);
    return [id, value];
  });
  return { options: Object.fromEntries(chosen), rounds, ranked, ticket };
}
const roundSeed = (seed, round) => (round ? [0, 1, 2, 3].map((part) => fingerprint({ seed, round, part })).join('') : seed);

/* One to five games between the same two players. The players change seats after every game, so
   going first is shared. A move names its game: one that arrives late never counts in the next. */
export class Series {
  #rules; #seed; #terms; #match; #round = 0; #score = [0, 0]; #result = null;

  constructor(rules, { seed, terms = { options: {}, rounds: 1 } }) {
    this.#rules = rules; this.#seed = seed; this.#terms = copy(terms);
    this.#deal();
  }

  #deal() { this.#match = new Match(this.#rules, { seed: roundSeed(this.#seed, this.#round), players: 2, options: this.#terms.options }); }

  get round() { return this.#round; }
  get score() { return this.#score.slice(); }
  seat(player) { return (player + this.#round) % 2; }

  play(player, m) {
    if (this.#result) return { ok: false, error: 'the match is over' };
    if (![0, 1].includes(player)) return { ok: false, error: 'unknown player' };
    if (isResign(m)) {
      this.#result = { winner: 1 - player, reason: 'resigned', score: this.score };
      return { ok: true, result: this.result(), fingerprint: this.fingerprint() };
    }
    if (m?.round !== this.#round) return { ok: false, error: 'that game is over' };
    if (isResign(m.move)) return { ok: false, error: 'unknown move' };
    const out = this.#match.play(this.seat(player), m.move);
    if (!out.ok) return out;
    const ended = out.result ? this.#end(out.result) : undefined;
    return { ok: true, result: this.result(), fingerprint: this.fingerprint(), ...(ended ? { ended } : {}) };
  }

  #end({ winner, reason = '' }) {
    const player = winner === null ? null : this.seat(winner), { rounds } = this.#terms;
    if (player !== null) this.#score[player] += 1;
    const ended = { round: this.#round, seat: winner, winner: player, reason, score: this.score, view: [0, 1].map((seat) => this.#match.view(seat)) };
    const [a, b] = this.#score;
    if (Math.max(a, b) > rounds / 2 || this.#round + 1 >= rounds + MAX_DRAWS || (rounds === 1 && winner === null)) {
      this.#result = { winner: a === b ? null : a > b ? 0 : 1, reason, score: this.score };
    } else {
      this.#round += 1;
      this.#deal();
    }
    return ended;
  }

  result() { return this.#result ? copy(this.#result) : null; }
  view(player) { return this.#match.view(this.seat(player)); }
  fingerprint() { return fingerprint({ round: this.#round, score: this.#score, result: this.#result, match: this.#match.fingerprint() }); }
}
