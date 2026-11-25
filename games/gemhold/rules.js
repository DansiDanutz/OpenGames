// SPDX-License-Identifier: MIT
/* Gemhold. Two players take turns placing blocks on a field of gems. The first
   block covers the player's own corner; every later block touches their own
   ground by a side. Each player has the same blocks. When nobody can place one,
   each gem colour goes to the player who holds more of it, and most colours
   win. If that is equal, most gems win, and then the player who went second. */
export const SIZE = 7;
export const GEMS = [1, 2, 3];
export const STOCK = { '1x1': 3, '1x2': 3, '1x3': 2, '2x2': 2, '2x3': 1 };
const CELLS = SIZE * SIZE, PAIRS_OF_EACH = 3;
const FIRST_MAX = 2;                                   // keeps going first from being an advantage
const CORNER = [0, CELLS - 1];

export function cells({ r0, c0, r1, c1 }) {
  const out = [];
  for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) out.push(r * SIZE + c);
  return out;
}
export function sizeOf({ r0, c0, r1, c1 }) {
  const h = r1 - r0 + 1, w = c1 - c0 + 1;
  return `${Math.min(h, w)}x${Math.max(h, w)}`;
}
const isRect = (x) => !!x && [x.r0, x.c0, x.r1, x.c1].every((v) => Number.isInteger(v) && v >= 0 && v < SIZE) && x.r0 <= x.r1 && x.c0 <= x.c1;
const sides = (i) => [i >= SIZE && i - SIZE, i < CELLS - SIZE && i + SIZE, i % SIZE > 0 && i - 1, i % SIZE < SIZE - 1 && i + 1].filter((x) => x !== false);

/* Why a player may not place this block, or '' when it is allowed. */
export function problem(state, player, rect) {
  if (!isRect(rect)) return 'that is not on the field';
  const size = sizeOf(rect), covered = cells(rect);
  if (!(size in STOCK)) return 'there is no block of that size';
  if (!state.stock[player][size]) return 'you have no more blocks of that size';
  if (covered.some((i) => state.owner[i] !== -1)) return 'a cell there is taken';
  if (!state.blocks.length && covered.length > FIRST_MAX) return 'the first block of the match covers at most two cells';
  if (!state.owner.includes(player)) return covered.includes(CORNER[player]) ? '' : 'your first block must cover your corner';
  return covered.some((i) => sides(i).some((j) => state.owner[j] === player)) ? '' : 'the block must touch your ground by a side';
}
export function choices(state, player) {
  const out = [];
  for (const size of Object.keys(STOCK)) {
    const [a, b] = size.split('x').map(Number);
    for (const [h, w] of a === b ? [[a, b]] : [[a, b], [b, a]]) {
      for (let r = 0; r + h <= SIZE; r++) for (let c = 0; c + w <= SIZE; c++) {
        const rect = { r0: r, c0: c, r1: r + h - 1, c1: c + w - 1 };
        if (!problem(state, player, rect)) out.push(rect);
      }
    }
  }
  return out;
}
export function score({ gems, owner }) {
  const held = [0, 1].map((p) => GEMS.map((kind) => gems.filter((g, i) => g === kind && owner[i] === p).length));
  return {
    gems: held,
    crowns: [0, 1].map((p) => GEMS.filter((_, k) => held[p][k] > held[1 - p][k]).length),
    total: held.map((list) => list.reduce((a, n) => a + n, 0)),
  };
}

/* The field looks the same from both corners, so nobody has the better half. */
export function setup({ random }) {
  const half = Array.from({ length: (CELLS - 1) / 2 - 1 }, (_, i) => i + 1);
  for (let i = half.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [half[i], half[j]] = [half[j], half[i]];
  }
  const gems = Array(CELLS).fill(0);
  GEMS.forEach((kind, k) => half.slice(k * PAIRS_OF_EACH, (k + 1) * PAIRS_OF_EACH).forEach((i) => { gems[i] = gems[CELLS - 1 - i] = kind; }));
  gems[(CELLS - 1) / 2] = GEMS[Math.floor(random() * GEMS.length)];
  return { gems, owner: Array(CELLS).fill(-1), stock: [{ ...STOCK }, { ...STOCK }], blocks: [], turn: 0 };
}
export function move(state, player, m) {
  if (m?.type !== 'place') throw new Error('unknown move');
  if (player !== state.turn) throw new Error('it is not your turn');
  const wrong = problem(state, player, m.rect);
  if (wrong) throw new Error(wrong);
  const { r0, c0, r1, c1 } = m.rect, rect = { r0, c0, r1, c1 }, size = sizeOf(rect), covered = cells(rect);
  const next = {
    ...state,
    owner: state.owner.map((o, i) => (covered.includes(i) ? player : o)),
    stock: state.stock.map((s, p) => (p === player ? { ...s, [size]: s[size] - 1 } : s)),
    blocks: [...state.blocks, { player, ...rect }],
  };
  return { ...next, turn: choices(next, 1 - player).length ? 1 - player : player };
}
export function result(state) {
  if (choices(state, 0).length || choices(state, 1).length) return null;
  const { crowns, total } = score(state);
  const lead = crowns[0] - crowns[1] || total[0] - total[1] || -1;
  return { winner: lead > 0 ? 0 : 1, reason: 'full' };
}
/* Takes gems, then ground that leaves it more places and the other player fewer. */
export function bot(state, player, random) {
  if (state.turn !== player) return null;
  let best = null, most = -Infinity;
  for (const rect of choices(state, player)) {
    const covered = cells(rect), owner = state.owner.map((o, i) => (covered.includes(i) ? player : o));
    const held = score({ gems: state.gems, owner });
    const open = (p) => owner.filter((o, i) => o === -1 && sides(i).some((j) => owner[j] === p)).length;
    const value = held.crowns[player] * 3 - held.crowns[1 - player] * 3 + held.total[player] * 2 + covered.length * 0.4 + open(player) * 0.5 - open(1 - player) * 0.6 + random();
    if (value > most) { most = value; best = rect; }
  }
  return best && { type: 'place', rect: best };
}
