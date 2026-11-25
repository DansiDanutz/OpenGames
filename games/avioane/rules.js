// SPDX-License-Identifier: MIT
/* Avioane & Barcute, the old paper game. Each player hides two planes and three
   boats. Nobody sees the other fleet, not even the other computer: a player
   first sends only a seal (a hash) of the fleet, then answers every shot. The
   winner shows the fleet at the end. If it does not fit the seal and every
   answer, the winner cheated and loses. */
export const FLEETS = {
  8: ['plane', 'boat3', 'boat2', 'boat2'],
  10: ['plane', 'plane', 'boat4', 'boat3', 'boat2'],
  12: ['plane', 'plane', 'plane', 'boat4', 'boat3', 'boat3', 'boat2'],
};
/* Pointing up: head, wings, body, tail. The head comes first. */
const PLANE = [[0, 0], [1, -2], [1, -1], [1, 0], [1, 1], [1, 2], [2, 0], [3, -1], [3, 0], [3, 1]];
const DIRECTIONS = { plane: 4, boat4: 2, boat3: 2, boat2: 2 };
const isCell = (n, i) => Number.isInteger(i) && i >= 0 && i < n * n;

/* The cells of a piece, or null when it does not fit on the board. */
export function cellsOf(n, piece) {
  if (!piece || !Object.hasOwn(DIRECTIONS, piece.kind)) return null;
  const { kind, r, c, dir } = piece;
  if (![r, c, dir].every(Number.isInteger) || dir < 0 || dir >= DIRECTIONS[kind]) return null;
  let shape = kind === 'plane' ? PLANE : Array.from({ length: Number(kind.slice(4)) }, (_, k) => [0, k]);
  for (let k = 0; k < dir; k++) shape = shape.map(([y, x]) => [x, -y + 0]);
  const at = shape.map(([y, x]) => [r + y, c + x]);
  return at.every(([y, x]) => y >= 0 && y < n && x >= 0 && x < n) ? at.map(([y, x]) => y * n + x) : null;
}
export function isFleet(n, fleet) {
  const kinds = FLEETS[n];
  if (!Array.isArray(fleet) || fleet.length !== kinds.length) return false;
  const all = fleet.map((p, i) => (p?.kind === kinds[i] ? cellsOf(n, p) : null));
  return all.every(Boolean) && new Set(all.flat()).size === all.flat().length;
}
export function randomFleet(n, random) {
  const pick = (k) => Math.floor(random() * k);
  for (;;) {
    const fleet = [];
    for (const kind of FLEETS[n]) {
      for (let tries = 0; tries < 60; tries++) {
        const piece = { kind, r: pick(n), c: pick(n), dir: pick(DIRECTIONS[kind]) }, cells = cellsOf(n, piece);
        if (cells && !fleet.some((p) => cellsOf(n, p).some((i) => cells.includes(i)))) { fleet.push(piece); break; }
      }
    }
    if (isFleet(n, fleet)) return fleet;
  }
}

/* SHA-256 of plain text. Rules cannot use the computer's own functions. */
const K = [], START = [];
for (let n = 2; K.length < 64; n++) {
  let prime = true;
  for (let d = 2; d * d <= n; d++) if (n % d === 0) prime = false;
  if (!prime) continue;
  const part = (x) => Math.floor((x - Math.floor(x)) * 4294967296) | 0;
  if (START.length < 8) START.push(part(Math.sqrt(n)));
  K.push(part(Math.cbrt(n)));
}
export function sha256(text) {
  const bytes = [...text].map((ch) => ch.charCodeAt(0) & 255), bits = bytes.length * 8;
  bytes.push(128);
  while (bytes.length % 64 !== 56) bytes.push(0);
  for (let i = 7; i >= 0; i--) bytes.push(i > 3 ? 0 : (bits >>> (i * 8)) & 255);
  const turn = (x, n) => (x >>> n) | (x << (32 - n));
  let hash = [...START];
  for (let at = 0; at < bytes.length; at += 64) {
    const w = Array.from({ length: 16 }, (_, i) => (bytes[at + i * 4] << 24) | (bytes[at + i * 4 + 1] << 16) | (bytes[at + i * 4 + 2] << 8) | bytes[at + i * 4 + 3]);
    for (let i = 16; i < 64; i++) {
      const s0 = turn(w[i - 15], 7) ^ turn(w[i - 15], 18) ^ (w[i - 15] >>> 3), s1 = turn(w[i - 2], 17) ^ turn(w[i - 2], 19) ^ (w[i - 2] >>> 10);
      w.push((w[i - 16] + s0 + w[i - 7] + s1) | 0);
    }
    let [a, b, c, d, e, f, g, h] = hash;
    for (let i = 0; i < 64; i++) {
      const t1 = (h + (turn(e, 6) ^ turn(e, 11) ^ turn(e, 25)) + ((e & f) ^ (~e & g)) + K[i] + w[i]) | 0;
      const t2 = ((turn(a, 2) ^ turn(a, 13) ^ turn(a, 22)) + ((a & b) ^ (a & c) ^ (b & c))) | 0;
      [a, b, c, d, e, f, g, h] = [(t1 + t2) | 0, a, b, c, (d + t1) | 0, e, f, g];
    }
    hash = [a, b, c, d, e, f, g, h].map((v, i) => (v + hash[i]) | 0);
  }
  return hash.map((v) => (v >>> 0).toString(16).padStart(8, '0')).join('');
}
export const seal = (fleet, salt) => sha256(`${salt}|${fleet.map((p) => [p.kind, p.r, p.c, p.dir].join(',')).join(';')}`);

const around = (n, i) => {
  const out = [], r = Math.floor(i / n), c = i % n;
  for (let y = Math.max(0, r - 1); y <= Math.min(n - 1, r + 1); y++) for (let x = Math.max(0, c - 1); x <= Math.min(n - 1, c + 1); x++) if (y !== r || x !== c) out.push(y * n + x);
  return out;
};
/* The true answer to a shot, given the shots so far. On an easy board a miss beside a piece is near. */
export function answer({ n, level }, fleet, log, cell) {
  const piece = fleet.find((p) => cellsOf(n, p).includes(cell));
  if (!piece) {
    const taken = new Set(fleet.flatMap((p) => cellsOf(n, p)));
    return { says: level === 'easy' && around(n, cell).some((i) => taken.has(i)) ? 'near' : 'miss' };
  }
  const cells = cellsOf(n, piece);
  const isDown = piece.kind === 'plane' ? cells[0] === cell : cells.every((i) => i === cell || log.some((x) => x.cell === i));
  return isDown ? { says: 'down', piece } : { says: 'hit' };
}
const same = (a, b) => a.kind === b.kind && a.r === b.r && a.c === b.c && a.dir === b.dir;
function isHonest(state, player, { fleet, salt }) {
  if (typeof salt !== 'string' || !isFleet(state.n, fleet) || seal(fleet, salt) !== state.seals[player]) return false;
  return state.log[player].every((x, k) => {
    const truth = answer(state, fleet, state.log[player].slice(0, k), x.cell);
    return truth.says === x.says && (truth.says !== 'down' || same(truth.piece, x.piece));
  });
}

export function setup({ options }) {
  const n = Number(options.size ?? 10);
  return { n, level: options.level ?? 'easy', phase: 'seal', seals: [null, null], board: [0, 1].map(() => Array(n * n).fill('')), down: [[], []], log: [[], []], turn: 0, shot: null, claim: null, winner: null, reason: '' };
}
const put = (list, i, value) => list.map((x, n) => (n === i ? value : x));
const moves = {
  commit(state, player, { hash }) {
    if (state.seals[player]) throw new Error('your fleet is already sealed');
    if (!/^[0-9a-f]{64}$/.test(hash)) throw new Error('that is not a seal');
    const seals = put(state.seals, player, hash);
    return { ...state, seals, phase: seals.every(Boolean) ? 'play' : 'seal' };
  },
  shoot(state, player, { cell }) {
    if (player !== state.turn) throw new Error('it is not your turn');
    if (state.shot !== null) throw new Error('wait for the answer');
    if (!isCell(state.n, cell)) throw new Error('that is not on the board');
    if (state.board[1 - player][cell] !== '') throw new Error('that cell is already known');
    return { ...state, shot: cell };
  },
  answer(state, player, { says, piece }) {
    if (state.shot === null) throw new Error('nobody has shot');
    if (player === state.turn) throw new Error('the other player answers');
    const { shot, n } = state, kinds = FLEETS[n], entry = { cell: shot, says }, shooter = state.turn;
    let board = put(state.board[player], shot, says), down = state.down[player];
    if (says === 'down') {
      const cells = cellsOf(n, piece);
      const left = kinds.filter((k) => k === piece?.kind).length - down.filter((p) => p.kind === piece?.kind).length;
      if (!cells?.includes(shot) || left < 1) throw new Error('that piece cannot be there');
      const was = cells.filter((i) => i !== shot).map((i) => state.board[player][i]);
      if (was.some((x) => x === 'miss' || x === 'near' || x === 'down')) throw new Error('that piece cannot be there');
      if (piece.kind === 'plane' ? cells[0] !== shot : was.includes('')) throw new Error('that piece is not down yet');
      entry.piece = { kind: piece.kind, r: piece.r, c: piece.c, dir: piece.dir };
      board = board.map((x, i) => (cells.includes(i) ? 'down' : x));
      down = [...down, entry.piece];
    } else if (says !== 'miss' && says !== 'hit' && !(says === 'near' && state.level === 'easy')) throw new Error('unknown answer');
    const next = { ...state, shot: null, board: put(state.board, player, board), down: put(state.down, player, down), log: put(state.log, player, [...state.log[player], entry]), turn: 1 - shooter };
    if (down.length === kinds.length) return { ...next, phase: 'reveal', claim: shooter };
    if (!board.includes('')) return { ...next, phase: 'over', winner: shooter, reason: 'unfair' };   // a fleet that is nowhere
    return next;
  },
  reveal(state, player, proof) {
    if (player !== state.claim) throw new Error('the other player shows the fleet');
    const honest = isHonest(state, player, proof);
    return { ...state, phase: 'over', winner: honest ? player : 1 - player, reason: honest ? 'fleet' : 'unfair' };
  },
};
const PHASE = { commit: 'seal', shoot: 'play', answer: 'play', reveal: 'reveal' };
export function move(state, player, m) {
  if (!Object.hasOwn(moves, m?.type ?? '')) throw new Error('unknown move');
  if (state.phase !== PHASE[m.type]) throw new Error('not now');
  return moves[m.type](state, player, m);
}
export const result = (state) => (state.winner === null ? null : { winner: state.winner, reason: state.reason });

/* Only for the automatic check: the bots use fleets and salts that are no secret. */
const BOT_SALT = '00'.repeat(16);
const PLANES = [{ kind: 'plane', r: 0, c: 2, dir: 0 }, { kind: 'plane', r: 5, c: 7, dir: 0 }];
const BOT_FLEETS = {
  8: [PLANES[0], { kind: 'boat3', r: 5, c: 0, dir: 0 }, { kind: 'boat2', r: 6, c: 0, dir: 0 }, { kind: 'boat2', r: 7, c: 0, dir: 0 }],
  10: [...PLANES, { kind: 'boat4', r: 9, c: 0, dir: 0 }, { kind: 'boat3', r: 5, c: 0, dir: 0 }, { kind: 'boat2', r: 0, c: 8, dir: 0 }],
  12: [...PLANES, { kind: 'plane', r: 6, c: 2, dir: 0 }, { kind: 'boat4', r: 11, c: 0, dir: 0 }, { kind: 'boat3', r: 10, c: 8, dir: 0 }, { kind: 'boat3', r: 11, c: 8, dir: 0 }, { kind: 'boat2', r: 0, c: 8, dir: 0 }],
};
export function bot(state, player, random) {
  const BOT_FLEET = BOT_FLEETS[state.n];
  if (state.phase === 'seal') return state.seals[player] ? null : { type: 'commit', hash: seal(BOT_FLEET, BOT_SALT) };
  if (state.phase === 'reveal') return state.claim === player ? { type: 'reveal', fleet: BOT_FLEET, salt: BOT_SALT } : null;
  if (state.shot !== null) return state.turn === player ? null : { type: 'answer', ...answer(state, BOT_FLEET, state.log[player], state.shot) };
  if (state.turn !== player) return null;
  const open = state.board[1 - player].flatMap((x, i) => (x === '' ? [i] : []));
  return { type: 'shoot', cell: open[Math.floor(random() * open.length)] };
}
