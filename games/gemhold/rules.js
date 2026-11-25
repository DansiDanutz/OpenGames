// SPDX-License-Identifier: MIT
/* Gemhold. Two players take turns placing blocks on a field of gems. The first
   block covers the player's own corner; every later block touches their own
   ground by a side. Each player has the same blocks. When nobody can place one,
   each gem colour goes to the player who holds more of it, and most colours
   win. If that is equal, most gems win, then most ground, and then the player who went second. */
export const GEMS = [1, 2, 3];
/* What each board is played with. `first` is how many cells the first block may cover: it keeps going
   first from being an advantage. The rest: gem pairs of each colour, pairs of rocks, and the blocks of each player. */
export const BOARDS = {
  5: { pairs: 3, rocks: 1, first: 1, stock: { '1x1': 3, '1x2': 2, '1x3': 2 } },
  6: { pairs: 2, rocks: 2, first: 3, stock: { '1x1': 3, '1x2': 3, '1x3': 1, '2x2': 2 } },
  7: { pairs: 3, rocks: 2, first: 2, stock: { '1x1': 3, '1x2': 3, '1x3': 2, '2x2': 2, '2x3': 1 } },
  10: { pairs: 6, rocks: 5, first: 2, stock: { '1x1': 4, '1x2': 5, '1x3': 4, '2x2': 4, '2x3': 3, '3x3': 1 } },
};
export const ROCK = 9;                                 // the owner of a cell nobody may cover

const cornerOf = (n, player) => (player ? n * n - 1 : 0);
export function cells(n, { r0, c0, r1, c1 }) {
  const out = [];
  for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) out.push(r * n + c);
  return out;
}
export function sizeOf({ r0, c0, r1, c1 }) {
  const h = r1 - r0 + 1, w = c1 - c0 + 1;
  return `${Math.min(h, w)}x${Math.max(h, w)}`;
}
const isRect = (n, x) => !!x && [x.r0, x.c0, x.r1, x.c1].every((v) => Number.isInteger(v) && v >= 0 && v < n) && x.r0 <= x.r1 && x.c0 <= x.c1;
const sides = (n, i) => [i >= n && i - n, i < n * n - n && i + n, i % n > 0 && i - 1, i % n < n - 1 && i + 1].filter((x) => x !== false);

/* Why a player may not place this block, or '' when it is allowed. */
export function problem(state, player, rect) {
  const { n } = state;
  if (!isRect(n, rect)) return 'that is not on the field';
  const size = sizeOf(rect), covered = cells(n, rect);
  if (!Object.hasOwn(state.stock[player], size)) return 'there is no block of that size';
  if (!state.stock[player][size]) return 'you have no more blocks of that size';
  if (covered.some((i) => state.owner[i] === ROCK)) return 'a rock is in the way';
  if (covered.some((i) => state.owner[i] !== -1)) return 'a cell there is taken';
  if (!state.blocks.length && covered.length > state.first) return `the first block covers at most ${state.first} cell${state.first > 1 ? 's' : ''}`;
  if (!state.owner.includes(player)) return covered.includes(cornerOf(n, player)) ? '' : 'your first block must cover your corner';
  return covered.some((i) => sides(n, i).some((j) => state.owner[j] === player)) ? '' : 'the block must touch your ground by a side';
}
export function choices(state, player) {
  const out = [], { n } = state;
  for (const size of Object.keys(state.stock[player])) {
    const [a, b] = size.split('x').map(Number);
    for (const [h, w] of a === b ? [[a, b]] : [[a, b], [b, a]]) {
      for (let r = 0; r + h <= n; r++) for (let c = 0; c + w <= n; c++) {
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
export function setup({ random, options }) {
  const n = Number(options.size ?? 7), total = n * n, { pairs, rocks, first, stock } = BOARDS[n];
  const half = Array.from({ length: Math.floor(total / 2) - 1 }, (_, i) => i + 1);
  for (let i = half.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [half[i], half[j]] = [half[j], half[i]];
  }
  // Rocks come first, and never beside a corner, where one could lock a player in.
  const isOpen = (i) => [0, total - 1].every((c) => Math.abs(Math.floor(i / n) - Math.floor(c / n)) + Math.abs((i % n) - (c % n)) > 2);
  const stones = options.level === 'hard' ? half.filter(isOpen).slice(0, rocks) : [];
  const free = half.filter((i) => !stones.includes(i)), gems = Array(total).fill(0), owner = Array(total).fill(-1);
  stones.forEach((i) => { owner[i] = owner[total - 1 - i] = ROCK; });
  GEMS.forEach((kind, k) => free.slice(k * pairs, (k + 1) * pairs).forEach((i) => { gems[i] = gems[total - 1 - i] = kind; }));
  if (total % 2) gems[(total - 1) / 2] = GEMS[Math.floor(random() * GEMS.length)];
  return { n, first, gems, owner, stock: [{ ...stock }, { ...stock }], blocks: [], turn: 0 };
}
export function move(state, player, m) {
  if (m?.type !== 'place') throw new Error('unknown move');
  if (player !== state.turn) throw new Error('it is not your turn');
  const wrong = problem(state, player, m.rect);
  if (wrong) throw new Error(wrong);
  const { r0, c0, r1, c1 } = m.rect, rect = { r0, c0, r1, c1 }, size = sizeOf(rect), covered = cells(state.n, rect);
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
  const { crowns, total } = score(state), ground = [0, 1].map((p) => state.owner.filter((o) => o === p).length);
  const lead = crowns[0] - crowns[1] || total[0] - total[1] || ground[0] - ground[1] || -1;
  return { winner: lead > 0 ? 0 : 1, reason: 'full' };
}
/* Takes gems, then ground that leaves it more places and the other player fewer. */
export function bot(state, player, random) {
  if (state.turn !== player) return null;
  let best = null, most = -Infinity;
  for (const rect of choices(state, player)) {
    const covered = cells(state.n, rect), owner = state.owner.map((o, i) => (covered.includes(i) ? player : o));
    const held = score({ gems: state.gems, owner });
    const open = (p) => owner.filter((o, i) => o === -1 && sides(state.n, i).some((j) => owner[j] === p)).length;
    const value = held.crowns[player] * 3 - held.crowns[1 - player] * 3 + held.total[player] * 2 + covered.length * 0.4 + open(player) * 0.5 - open(1 - player) * 0.6 + random();
    if (value > most) { most = value; best = rect; }
  }
  return best && { type: 'place', rect: best };
}
