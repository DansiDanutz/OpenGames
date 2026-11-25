// SPDX-License-Identifier: MIT
/* Shikaku as a race. Both players get the same board; the first correct
   solution wins. Only how much is covered is shown to the other player, so
   nobody can copy a solution. */
const MAX_AREA = { easy: 8, hard: 14 };
const BIG = { easy: 0.6, hard: 0.85 };                  // how often a big block is taken

/* Covers the grid with random rectangles, then puts one number in each. */
export function generate(random, n = 6, level = 'easy') {
  const ri = (k) => Math.floor(random() * k);
  const owner = Array.from({ length: n }, () => Array(n).fill(false));
  const puzzle = Array.from({ length: n }, () => Array(n).fill(0));
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) {
    if (owner[r][c]) continue;
    const fits = [];
    for (let h = 1; r + h <= n; h++) for (let w = 1; c + w <= n && h * w <= MAX_AREA[level]; w++) {
      if (cells({ r0: r, c0: c, r1: r + h - 1, c1: c + w - 1 }).some(([i, j]) => owner[i][j])) break;
      fits.push({ h, w });
    }
    fits.sort((a, b) => a.h * a.w - b.h * b.w || a.h - b.h);
    const { h, w } = random() < BIG[level] ? fits[fits.length - 1 - ri(Math.min(3, fits.length))] : fits[ri(fits.length)];
    for (const [i, j] of cells({ r0: r, c0: c, r1: r + h - 1, c1: c + w - 1 })) owner[i][j] = true;
    puzzle[r + ri(h)][c + ri(w)] = h * w;
  }
  return puzzle;
}
export function cells({ r0, c0, r1, c1 }) {
  const out = [];
  for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) out.push([r, c]);
  return out;
}
export function isRect(n, x) {
  return !!x && [x.r0, x.c0, x.r1, x.c1].every((v) => Number.isInteger(v) && v >= 0 && v < n) && x.r0 <= x.r1 && x.c0 <= x.c1;
}
/* A rectangle is right when it holds exactly one number and that is its size. */
export function isRight(puzzle, rect) {
  const found = cells(rect).map(([r, c]) => puzzle[r][c]).filter(Boolean);
  return found.length === 1 && found[0] === cells(rect).length;
}
export function isSolved(puzzle, rects) {
  const n = puzzle.length;
  if (!Array.isArray(rects) || rects.length > n * n || !rects.every((x) => isRect(n, x) && isRight(puzzle, x))) return false;
  const seen = new Set(rects.flatMap((x) => cells(x).map(([r, c]) => r * n + c)));
  return seen.size === n * n && rects.reduce((a, x) => a + cells(x).length, 0) === n * n;
}
/* Takes the number with the fewest blocks left, so large boards are quick too. */
export function solve(puzzle) {
  const n = puzzle.length, total = n * n, used = Array(total).fill(false);
  const rects = puzzle.flatMap((row, r) => row.flatMap((v, c) => {
    if (!v) return [];
    const out = [];
    for (let h = 1; h <= v; h++) {
      if (v % h) continue;
      const w = v / h;
      for (let r0 = Math.max(0, r - h + 1); r0 <= r && r0 + h <= n; r0++) for (let c0 = Math.max(0, c - w + 1); c0 <= c && c0 + w <= n; c0++) {
        const rect = { r0, c0, r1: r0 + h - 1, c1: c0 + w - 1 };
        if (isRight(puzzle, rect)) out.push({ rect, at: cells(rect).map(([i, j]) => i * n + j) });
      }
    }
    return [out];
  }));
  const chosen = Array(rects.length).fill(null);
  const isFree = (x) => x.at.every((i) => !used[i]);
  const go = (left) => {
    if (!left) return true;
    let best = -1, options = null;
    for (let k = 0; k < rects.length; k++) {
      if (chosen[k]) continue;
      const free = rects[k].filter(isFree);
      if (!options || free.length < options.length) { best = k; options = free; }
      if (!free.length) return false;
    }
    // A cell nobody can reach any more ends this way early.
    const reach = new Set(rects.flatMap((list, k) => (chosen[k] ? [] : list.filter(isFree).flatMap((x) => x.at))));
    for (let i = 0; i < total; i++) if (!used[i] && !reach.has(i)) return false;
    for (const x of options) {
      for (const i of x.at) used[i] = true;
      chosen[best] = x.rect;
      if (go(left - 1)) return true;
      chosen[best] = null;
      for (const i of x.at) used[i] = false;
    }
    return false;
  };
  return go(rects.length) ? chosen : null;
}

export function setup({ random, options }) {
  const level = options.level ?? 'easy';
  return { puzzle: generate(random, Number(options.size ?? 6), level), level, covered: [0, 0], winner: null };
}

export function move(state, player, m) {
  const total = state.puzzle.length ** 2;
  if (m?.type === 'cover') {
    if (!Number.isInteger(m.cells) || m.cells < 0 || m.cells > total) throw new Error('not a count of cells');
    return { ...state, covered: state.covered.map((v, i) => (i === player ? m.cells : v)) };
  }
  if (m?.type === 'solve') {
    if (!isSolved(state.puzzle, m.rects)) throw new Error('the board is not solved');
    return { ...state, covered: state.covered.map((v, i) => (i === player ? total : v)), winner: player };
  }
  throw new Error('unknown move');
}
export const result = (state) => (state.winner === null ? null : { winner: state.winner, reason: 'solved' });
export const view = (state) => state;
/* About as fast as a person: this many milliseconds for each step of the bot, which is 1 to 6 cells. */
const STEP_MS = [5000, 12500];
export const pace = (state, player, random) => STEP_MS[0] + Math.floor(random() * (STEP_MS[1] - STEP_MS[0]));
export function bot(state, player, random) {
  const total = state.puzzle.length ** 2;
  const at = state.covered[player];
  return at < total - 6 ? { type: 'cover', cells: at + 1 + Math.floor(random() * 6) } : { type: 'solve', rects: solve(state.puzzle) };
}
