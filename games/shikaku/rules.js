// SPDX-License-Identifier: MIT
/* Shikaku as a race. Both players get the same board; the first correct
   solution wins. Only how much is covered is shown to the other player, so
   nobody can copy a solution. */
const SIZE = 6, MAX_AREA = 8;

/* Covers the grid with random rectangles, then puts one number in each. */
export function generate(random, n = SIZE) {
  const ri = (k) => Math.floor(random() * k);
  const owner = Array.from({ length: n }, () => Array(n).fill(false));
  const puzzle = Array.from({ length: n }, () => Array(n).fill(0));
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) {
    if (owner[r][c]) continue;
    const fits = [];
    for (let h = 1; r + h <= n; h++) for (let w = 1; c + w <= n && h * w <= MAX_AREA; w++) {
      if (cells({ r0: r, c0: c, r1: r + h - 1, c1: c + w - 1 }).some(([i, j]) => owner[i][j])) break;
      fits.push({ h, w });
    }
    fits.sort((a, b) => a.h * a.w - b.h * b.w || a.h - b.h);
    const { h, w } = random() < 0.6 ? fits[fits.length - 1 - ri(Math.min(3, fits.length))] : fits[ri(fits.length)];
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
export function solve(puzzle) {
  const n = puzzle.length, used = Array.from({ length: n }, () => Array(n).fill(false)), out = [];
  const go = () => {
    const at = used.flat().indexOf(false);
    if (at < 0) return true;
    const r0 = Math.floor(at / n), c0 = at % n;
    for (let r1 = r0; r1 < n; r1++) for (let c1 = c0; c1 < n; c1++) {
      const rect = { r0, c0, r1, c1 };
      if (cells(rect).some(([r, c]) => used[r][c])) break;
      if (!isRight(puzzle, rect)) continue;
      for (const [r, c] of cells(rect)) used[r][c] = true;
      out.push(rect);
      if (go()) return true;
      out.pop();
      for (const [r, c] of cells(rect)) used[r][c] = false;
    }
    return false;
  };
  return go() ? out : null;
}

export function setup({ random }) { return { puzzle: generate(random), covered: [0, 0], winner: null }; }

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
export function bot(state, player, random) {
  const total = state.puzzle.length ** 2;
  const at = state.covered[player];
  return at < total - 6 ? { type: 'cover', cells: at + 1 + Math.floor(random() * 6) } : { type: 'solve', rects: solve(state.puzzle) };
}
