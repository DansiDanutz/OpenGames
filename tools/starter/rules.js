// SPDX-License-Identifier: MIT
/* The rules of the game, the same on both computers: no time, no random numbers of their own, no imports.
   kit/engine.js says what each function is for. */
const sides = (n, i) => [i >= n && i - n, i < n * n - n && i + n, i % n > 0 && i - 1, i % n < n - 1 && i + 1].filter((x) => x !== false);
export const isFree = (state, player, cell) => state.cells[cell] === -1 && !sides(state.n, cell).some((j) => state.cells[j] === player);
export const choices = (state, player) => state.cells.map((_, i) => i).filter((i) => isFree(state, player, i));

export const ROCK = 2;                                 // nobody may claim it
/* Rocks in other places every game keep either seat from always winning. */
export function setup({ random, options }) {
  const n = Number(options.size ?? 5), order = Array.from({ length: n * n }, (_, i) => ({ i, at: random() })).sort((a, b) => a.at - b.at || a.i - b.i);
  const rocks = order.slice(0, n + 2).map((x) => x.i);
  return { n, cells: Array.from({ length: n * n }, (_, i) => (rocks.includes(i) ? ROCK : -1)), turn: 0 };
}
export function move(state, player, m) {
  if (player !== state.turn) throw new Error('it is not your turn');
  if (!Number.isInteger(m?.cell) || m.cell < 0 || m.cell >= state.cells.length) throw new Error('that is not on the board');
  if (!isFree(state, player, m.cell)) throw new Error('you may not claim that cell');
  return { ...state, cells: state.cells.map((x, i) => (i === m.cell ? player : x)), turn: 1 - player };
}
export function result(state) {
  return choices(state, state.turn).length ? null : { winner: 1 - state.turn };
}
/* Leaves the other player as few cells as it can. */
export function bot(view, player, random) {
  if (view.turn !== player) return null;
  const left = (cell) => choices(move(view, player, { cell }), 1 - player).length - choices(move(view, player, { cell }), player).length;
  const scored = choices(view, player).map((cell) => ({ cell, score: left(cell) + random() }));
  return { cell: scored.reduce((a, b) => (b.score < a.score ? b : a)).cell };
}
