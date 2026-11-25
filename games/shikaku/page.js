// SPDX-License-Identifier: MIT
import * as rules from './rules.js';
import { connect } from '/kit/ui.js';

const $ = (id) => document.getElementById(id);
const { cells, isRight, isSolved } = rules;
let puzzle = [], rects = [], me = 0, playing = false, from = null, at = { r: 0, c: 0 }, sent = 0;

const box = (a, b) => ({ r0: Math.min(a.r, b.r), c0: Math.min(a.c, b.c), r1: Math.max(a.r, b.r), c1: Math.max(a.c, b.c) });
const overlap = (a, b) => !(a.c1 < b.c0 || a.c0 > b.c1 || a.r1 < b.r0 || a.r0 > b.r1);
const covered = () => rects.filter((x) => isRight(puzzle, x)).reduce((n, x) => n + cells(x).length, 0);
function place(node, { r0, c0, r1, c1 }) {
  const n = puzzle.length, pc = (v) => `${(v / n) * 100}%`;
  Object.assign(node.style, { left: pc(c0), top: pc(r0), width: pc(c1 - c0 + 1), height: pc(r1 - r0 + 1) });
  return node;
}
const layer = (name, rect) => place(Object.assign(document.createElement('div'), { className: name }), rect);
function draw() {
  $('board').querySelectorAll('.rect,.ghost,.cursor').forEach((x) => x.remove());
  $('board').append(...rects.map((x) => layer(`rect ${isRight(puzzle, x) ? 'right' : 'wrong'}`, x)),
    ...(from ? [layer('ghost', box(from, at))] : []), layer('cursor', box(at, at)));
  $('mine').value = (covered() / puzzle.length ** 2) * 100;
  for (const id of ['undo', 'clear']) $(id).disabled = !playing || !rects.length;
}
function changed() {
  draw();
  if (isSolved(puzzle, rects)) { table.play({ type: 'solve', rects }); return; }
  const n = covered();
  if (n !== sent) { sent = n; table.play({ type: 'cover', cells: n }); }
}
function add(rect) { rects = [...rects.filter((x) => !overlap(x, rect)), rect]; changed(); }
function remove(cell) {
  const kept = rects.filter((x) => !overlap(x, box(cell, cell)));
  if (kept.length === rects.length) return false;
  rects = kept; changed();
  return true;
}
function cellAt(e) {
  const b = $('board').getBoundingClientRect(), n = puzzle.length;
  const pick = (v, size) => Math.max(0, Math.min(n - 1, Math.floor((v / size) * n)));
  return { r: pick(e.clientY - b.top, b.height), c: pick(e.clientX - b.left, b.width) };
}
$('board').addEventListener('pointerdown', (e) => {
  if (!playing || e.button) return;
  $('board').setPointerCapture(e.pointerId);
  from = at = cellAt(e);
  draw();
});
$('board').addEventListener('pointermove', (e) => { if (from && e.buttons) { at = cellAt(e); draw(); } });
$('board').addEventListener('pointerup', () => {
  if (!from) return;
  const rect = box(from, at), tap = rect.r0 === rect.r1 && rect.c0 === rect.c1, cell = from;
  from = null;
  if (!tap || !remove(cell)) add(rect);
});
$('board').addEventListener('pointercancel', () => { from = null; draw(); });
$('board').addEventListener('keydown', (e) => {
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
$('undo').onclick = () => { rects = rects.slice(0, -1); changed(); };
$('clear').onclick = () => { rects = []; changed(); };

const table = await connect(rules, {
  start({ view, me: seat }) {
    me = seat; puzzle = view.puzzle; playing = true; rects = [];
    $('board').style.setProperty('--n', puzzle.length);
    $('board').replaceChildren(...puzzle.flat().map((v) => Object.assign(document.createElement('div'), { className: 'cell', textContent: v || '' })));
    draw();
    $('board').focus();
  },
  update({ view }) { $('theirs').value = (view.covered[1 - me] / puzzle.length ** 2) * 100; },
  refused() { $('say').textContent = 'That move was not accepted.'; },
  end({ result }) {
    playing = false; from = null; draw();
    $('say').textContent = result.winner === me ? 'Solved. You win.' : 'The match is over.';
  },
});
