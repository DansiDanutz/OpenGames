// SPDX-License-Identifier: MIT
import * as rules from './rules.js';
import { connect } from '/kit/ui.js';
import { THREE, bounce, createBoard } from '/kit/board3d.js';
import * as sound from '/kit/sound.js';

const $ = (id) => document.getElementById(id);
const { cells, isRight, isSolved } = rules;
let puzzle = [], rects = [], me = 0, playing = false, level = 'easy', from = null, at = { r: 0, c: 0 }, sent = 0;

const box = (a, b) => ({ r0: Math.min(a.r, b.r), c0: Math.min(a.c, b.c), r1: Math.max(a.r, b.r), c1: Math.max(a.c, b.c) });
const overlap = (a, b) => !(a.c1 < b.c0 || a.c0 > b.c1 || a.r1 < b.r0 || a.r0 > b.r1);
const covered = () => rects.filter((x) => isRight(puzzle, x)).reduce((n, x) => n + cells(x).length, 0);
/* ---- the board in 3D */
const COLOURS = ['#ff8a00', '#8f2bff', '#5fb800', '#ff2f8e', '#0a86ff', '#00b894', '#ff4a30'];
const board = createBoard($('board')), shown = new Map();   // key -> { mesh, rect }
let marks = [];
const key = (x) => [x.r0, x.c0, x.r1, x.c1].join();
const colours = new Map();
const touching = (a, b) => !(a.c1 + 1 < b.c0 || a.c0 > b.c1 + 1 || a.r1 + 1 < b.r0 || a.r0 > b.r1 + 1);
/* Each block keeps its colour, and neighbours never share one while there is another. */
function colourOf(rect) {
  if (!colours.has(key(rect))) {
    const others = rects.filter((x) => x !== rect), taken = new Set(others.filter((x) => touching(x, rect)).map((x) => colours.get(key(x))));
    const uses = (c) => others.filter((x) => colours.get(key(x)) === c).length, free = COLOURS.filter((c) => !taken.has(c));
    colours.set(key(rect), (free.length ? free : COLOURS).reduce((best, c) => (uses(c) < uses(best) ? c : best)));
  }
  return colours.get(key(rect));
}
function buildField() {
  board.setSize(puzzle.length);
  shown.clear(); colours.clear(); marks = [];
  puzzle.forEach((row, r) => row.forEach((v, c) => {
    const tile = board.slab({ r0: r, c0: c, r1: r, c1: c }, { height: 0.14, gap: 0.06, radius: 0.06, material: new THREE.MeshPhysicalMaterial({ color: '#3a2d63', roughness: 0.42, clearcoat: 0.5 }) });
    board.add(tile);
    if (!v) return;
    const number = board.label(v, { color: '#fff' });
    number.position.copy(board.at(r, c, 0.32));
    board.add(number);
  }));
}
/* On a hard board nothing tells a wrong block from a right one. */
const isMarked = (rect) => level === 'easy' && !isRight(puzzle, rect);
function buildBlock(rect) {
  const mesh = board.slab(rect, { height: 0.36, color: colourOf(rect) }), y = mesh.position.y;
  if (isMarked(rect)) {
    mesh.material.color.lerp(new THREE.Color('#30202c'), 0.62);
    const edge = board.outline({ r0: 0, c0: 0, r1: rect.r1 - rect.r0, c1: rect.c1 - rect.c0 }, '#ff6a5e');
    edge.position.set(0, 0.2, 0);
    mesh.add(edge);
  }
  board.add(mesh);
  board.tween(260, (t) => { mesh.position.y = y + (1 - t) * 0.9; mesh.scale.setScalar(0.8 + 0.2 * t); }, { curve: bounce });
  return mesh;
}
function draw() {
  const now = new Set(rects.map(key));
  for (const [k, mesh] of shown) if (!now.has(k)) { board.remove(mesh); shown.delete(k); colours.delete(k); }
  for (const rect of rects) if (!shown.has(key(rect))) shown.set(key(rect), buildBlock(rect));
  marks.forEach(board.remove);
  marks = [...(from ? [board.outline(box(from, at), '#ffcf6b', 0.42)] : []), ...(playing && $('board').matches(':focus-visible') ? [board.outline(box(at, at), '#ffffff', 0.4)] : [])].map(board.add);
  // A hard board shows how much is covered, right or wrong.
  const part = level === 'easy' ? covered() : rects.reduce((sum, x) => sum + cells(x).length, 0);
  $('mine').value = (part / puzzle.length ** 2) * 100;
  for (const id of ['undo', 'clear']) $(id).disabled = !playing || !rects.length;
  board.redraw();
}
function changed() {
  draw();
  if (isSolved(puzzle, rects)) { table.play({ type: 'solve', rects }); return; }
  const n = covered();
  if (n !== sent) { sent = n; table.play({ type: 'cover', cells: n }); }
}
function add(rect) {
  rects = [...rects.filter((x) => !overlap(x, rect)), rect];
  sound.play(level === 'easy' && isRight(puzzle, rect) ? 'right' : 'place', board.pan((rect.c0 + rect.c1) / 2));
  changed();
}
function remove(cell) {
  const kept = rects.filter((x) => !overlap(x, box(cell, cell)));
  if (kept.length === rects.length) return false;
  rects = kept; sound.play('remove'); changed();
  return true;
}
$('board').addEventListener('pointerdown', (e) => {
  if (!playing || e.button) return;
  $('board').setPointerCapture(e.pointerId);
  const cell = board.cellAt(e, { isClamped: false });
  if (!cell) return;
  from = at = cell;
  sound.play('lift');
  draw();
});
$('board').addEventListener('pointermove', (e) => { if (!from || !e.buttons) return; const cell = board.cellAt(e); if (cell && (cell.r !== at.r || cell.c !== at.c)) { at = cell; sound.play('tick'); draw(); } });
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
$('undo').onclick = () => { rects = rects.slice(0, -1); sound.play('remove'); changed(); };
$('clear').onclick = () => { rects = []; sound.play('remove'); changed(); };
for (const type of ['focus', 'blur']) $('board').addEventListener(type, () => puzzle.length && draw());
/* What is on the board, for tests. */
$('board').inspect = () => ({ puzzle, rects, level, me });

const table = await connect(rules, {
  start({ view, me: seat, players, options, round, rounds }) {
    me = seat; puzzle = view.puzzle; level = options.level; playing = true; rects = []; from = null; sent = 0; at = { r: 0, c: 0 };
    $('mineName').textContent = `${players[me].name} (you)`; $('theirName').textContent = players[1 - me].name;
    $('theirs').value = 0;
    buildField(); draw();
    board.intro();
    sound.play('begin');
    $('say').textContent = `${rounds > 1 ? `Game ${round + 1}. ` : ''}Drag to make a rectangle. It holds one number, and that number is its size.`;
    $('board').focus();
  },
  update({ view }) { $('theirs').value = (view.covered[1 - me] / puzzle.length ** 2) * 100; },
  refused() { $('say').textContent = 'That is not the solution yet.'; sound.play('no'); },
  end({ result, isLast }) {
    playing = false; from = null; draw();
    const won = result.winner === me;
    sound.play(won ? 'win' : 'lose');
    if (won) board.celebrate();
    $('say').textContent = `${won ? (result.reason === 'solved' ? 'Solved. You win' : 'You win') : 'You lose'} this game.${isLast ? '' : ' The next game starts in a moment.'}`;
  },
});
