// SPDX-License-Identifier: MIT
import * as rules from './rules.js';
import { connect } from '/kit/ui.js';
import * as sound from '/kit/sound.js';

const $ = (id) => document.getElementById(id);
const { cells, isRight, isSolved } = rules;
let puzzle = [], rects = [], me = 0, playing = false, level = 'easy', from = null, at = { r: 0, c: 0 }, sent = 0;

const box = (a, b) => ({ r0: Math.min(a.r, b.r), c0: Math.min(a.c, b.c), r1: Math.max(a.r, b.r), c1: Math.max(a.c, b.c) });
const overlap = (a, b) => !(a.c1 < b.c0 || a.c0 > b.c1 || a.r1 < b.r0 || a.r0 > b.r1);
const covered = () => rects.filter((x) => isRight(puzzle, x)).reduce((n, x) => n + cells(x).length, 0);
/* ---- the board: light on glass */
const board = $('board'), shown = new Map();            // key -> element of a rectangle
const isCalm = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
const key = (x) => [x.r0, x.c0, x.r1, x.c1].join();
const pan = (c) => (c / Math.max(1, puzzle.length - 1)) * 2 - 1;
let marks = [], began = 0, taken = 0;
/* An element over some cells. */
function over(className, rect, gap = 0) {
  const part = 100 / puzzle.length, element = document.createElement('div');
  element.className = className;
  Object.assign(element.style, { left: `calc(${rect.c0 * part}% + ${gap}px)`, top: `calc(${rect.r0 * part}% + ${gap}px)`, width: `calc(${(rect.c1 - rect.c0 + 1) * part}% - ${gap * 2}px)`, height: `calc(${(rect.r1 - rect.r0 + 1) * part}% - ${gap * 2}px)` });
  return board.appendChild(element);
}
const pop = (element, frames, options) => { if (!isCalm()) element.animate(frames, { duration: 220, easing: 'cubic-bezier(.2,1.4,.4,1)', ...options }); };
function buildField() {
  board.replaceChildren();
  shown.clear(); marks = []; taken = 0; began = Date.now();
  puzzle.forEach((row, r) => row.forEach((v, c) => {
    const here = { r0: r, c0: c, r1: r, c1: c };
    over('cell', here);
    if (!v) return;
    const number = over('num', here);
    number.textContent = v;
    number.style.fontSize = `${46 / puzzle.length}cqmin`;
    pop(number, [{ transform: 'scale(0)', opacity: 0 }, { transform: 'scale(1)', opacity: 1 }], { duration: 420, delay: (r + c) * 35, fill: 'backwards' });
  }));
}
/* Where a finger is. Outside the board it is the nearest cell, or none. */
function cellAt(e, { isClamped = true } = {}) {
  const { left, top, width } = board.getBoundingClientRect(), n = puzzle.length;
  const r = Math.floor(((e.clientY - top) / width) * n), c = Math.floor(((e.clientX - left) / width) * n);
  if (!isClamped && (r < 0 || c < 0 || r >= n || c >= n)) return null;
  const keep = (v) => Math.max(0, Math.min(n - 1, v));
  return { r: keep(r), c: keep(c) };
}
/* On a hard board nothing tells a wrong block from a right one. */
const look = (rect) => (level === 'easy' ? (isRight(puzzle, rect) ? 'rect ok' : 'rect bad') : 'rect');
function draw() {
  const now = new Set(rects.map(key));
  for (const [k, element] of shown) if (!now.has(k)) { element.remove(); shown.delete(k); }
  for (const rect of rects) if (!shown.has(key(rect))) { const element = over(look(rect), rect, 2); shown.set(key(rect), element); pop(element, [{ transform: 'scale(.82)', opacity: 0.2 }, { transform: 'scale(1)', opacity: 1 }]); }
  marks.forEach((x) => x.remove());
  marks = [...(from ? [over('preview', box(from, at), 2)] : []), ...(playing && board.matches(':focus-visible') ? [over('at', box(at, at), 4)] : [])];
  // A hard board shows how much is covered, right or wrong.
  const done = rects.filter((x) => level !== 'easy' || isRight(puzzle, x)), part = done.reduce((sum, x) => sum + cells(x).length, 0);
  $('mine').value = (part / puzzle.length ** 2) * 100;
  $('moves').textContent = taken;
  $('left').textContent = puzzle.flat().filter(Boolean).length - done.reduce((sum, x) => sum + cells(x).filter(([r, c]) => puzzle[r][c]).length, 0);
  for (const id of ['undo', 'clear']) $(id).disabled = !playing || !rects.length;
}
setInterval(() => {
  if (!playing) return;
  const s = Math.floor((Date.now() - began) / 1000), two = (v) => String(v).padStart(2, '0');
  $('time').textContent = `${two(Math.floor(s / 60))}:${two(s % 60)}`;
}, 250);
function celebrate() {
  if (isCalm()) return;
  const { left, top, width } = board.getBoundingClientRect();
  for (let i = 0; i < 60; i++) {
    const spark = document.body.appendChild(document.createElement('div')), x = (Math.random() - 0.5) * width * 1.3;
    spark.className = 'spark';
    Object.assign(spark.style, { left: `${left + width / 2}px`, top: `${top + width / 2}px`, background: ['#39e6ff', '#b14bff', '#ffcf4d', '#4dffa1', '#ff5d73'][i % 5] });
    spark.animate([{ transform: 'none', opacity: 1 }, { transform: `translate(${x}px,${-width * (0.2 + Math.random() * 0.5)}px) rotate(${x}deg)`, opacity: 1, offset: 0.35, easing: 'ease-in' }, { transform: `translate(${x * 1.3}px,${width * 0.7}px) rotate(${x * 4}deg)`, opacity: 0 }], { duration: 1500 + Math.random() * 900, easing: 'ease-out' }).onfinish = () => spark.remove();
  }
}
function changed() {
  draw();
  if (isSolved(puzzle, rects)) { table.play({ type: 'solve', rects }); return; }
  const n = covered();
  if (n !== sent) { sent = n; table.play({ type: 'cover', cells: n }); }
}
function add(rect) {
  rects = [...rects.filter((x) => !overlap(x, rect)), rect];
  taken += 1;
  sound.play(level === 'easy' && isRight(puzzle, rect) ? 'right' : 'place', pan((rect.c0 + rect.c1) / 2));
  changed();
}
function remove(cell) {
  const kept = rects.filter((x) => !overlap(x, box(cell, cell)));
  if (kept.length === rects.length) return false;
  rects = kept; sound.play('remove'); changed();
  return true;
}
board.addEventListener('pointerdown', (e) => {
  if (!playing || e.button) return;
  board.setPointerCapture(e.pointerId);
  const cell = cellAt(e, { isClamped: false });
  if (!cell) return;
  from = at = cell;
  sound.play('lift');
  draw();
});
board.addEventListener('pointermove', (e) => { if (!from || !e.buttons) return; const cell = cellAt(e); if (cell && (cell.r !== at.r || cell.c !== at.c)) { at = cell; sound.play('tick'); draw(); } });
board.addEventListener('pointerup', () => {
  if (!from) return;
  const rect = box(from, at), tap = rect.r0 === rect.r1 && rect.c0 === rect.c1, cell = from;
  from = null;
  if (!tap || !remove(cell)) add(rect);
});
board.addEventListener('pointercancel', () => { from = null; draw(); });
board.addEventListener('keydown', (e) => {
  if (!playing) return;
  const step = { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] }[e.key];
  const keep = (v) => Math.max(0, Math.min(puzzle.length - 1, v));
  if (step) at = { r: keep(at.r + step[0]), c: keep(at.c + step[1]) };
  else if (e.key === ' ') { if (from) { const rect = box(from, at); from = null; add(rect); } else from = at; }
  else if (e.key === 'Escape') from = null;
  else if (e.key === 'Backspace' || e.key === 'Delete') remove(at);
  else return;
  e.preventDefault();
  draw();
  $('say').textContent = `Row ${at.r + 1}, column ${at.c + 1}${puzzle[at.r][at.c] ? `, number ${puzzle[at.r][at.c]}` : ''}.`;
});
$('undo').onclick = () => { rects = rects.slice(0, -1); sound.play('remove'); changed(); };
$('clear').onclick = () => { rects = []; sound.play('remove'); changed(); };
for (const type of ['focus', 'blur']) board.addEventListener(type, () => puzzle.length && draw());
/* What is on the board and where its cells are, for tests. */
board.pointOf = (r, c) => { const { left, top, width } = board.getBoundingClientRect(), part = width / puzzle.length; return { x: left + (c + 0.5) * part, y: top + (r + 0.5) * part }; };
board.inspect = () => ({ puzzle, rects, level, me });

const table = await connect(rules, {
  start({ view, me: seat, players, options, round, rounds }) {
    me = seat; puzzle = view.puzzle; level = options.level; playing = true; rects = []; from = null; sent = 0; at = { r: 0, c: 0 };
    $('mineName').textContent = `${players[me].name} (you)`; $('theirName').textContent = players[1 - me].name;
    $('theirs').value = 0;
    buildField(); draw();
    sound.play('begin');
    $('say').textContent = `${rounds > 1 ? `Game ${round + 1}. ` : ''}Drag to make a rectangle. It holds one number, and that number is its size.`;
    board.focus();
  },
  update({ view }) { $('theirs').value = (view.covered[1 - me] / puzzle.length ** 2) * 100; },
  refused() { $('say').textContent = 'That is not the solution yet.'; sound.play('no'); },
  end({ result, isLast }) {
    playing = false; from = null; draw();
    const won = result.winner === me;
    sound.play(won ? 'win' : 'lose');
    if (won) celebrate();
    $('say').textContent = `${won ? (result.reason === 'solved' ? 'Solved. You win' : 'You win') : 'You lose'} this game.${isLast ? '' : ' The next game starts in a moment.'}`;
  },
});
