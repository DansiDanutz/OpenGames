// SPDX-License-Identifier: MIT
import * as rules from './rules.js';
import { connect } from '/kit/ui.js';

const $ = (id) => document.getElementById(id);
const { SIZE, FLEET, cellsOf } = rules;
const NAMES = { plane: 'Plane', boat4: 'Boat of 4', boat3: 'Boat of 3', boat2: 'Boat of 2' };
let view = null, me = 0, playing = false, placing = false, chosen = 0, drag = null, at = 0, asked = -1;
let fleet = [], salt = '';                              // these never leave this page before the end

const chance = () => crypto.getRandomValues(new Uint32Array(1))[0] / 4294967296;
const newSalt = () => [...crypto.getRandomValues(new Uint8Array(16))].map((b) => b.toString(16).padStart(2, '0')).join('');
const where = (i) => `row ${Math.floor(i / SIZE) + 1}, column ${(i % SIZE) + 1}`;
const myTurn = () => playing && view.phase === 'play' && view.turn === me && view.shot === null;
function cellList(piece) {
  const cells = cellsOf(piece);
  return cells && !fleet.some((p) => p !== piece && cellsOf(p)?.some((i) => cells.includes(i))) ? { cells, ok: true } : { cells: cells ?? [], ok: false };
}
function paint(board, kinds) {
  if (board.children.length !== SIZE * SIZE) board.replaceChildren(...Array.from({ length: SIZE * SIZE }, () => document.createElement('div')));
  [...board.children].forEach((node, i) => {
    const name = ['cell', ...(kinds[i] ?? [])].join(' ');
    if (node.className !== name) { node.className = name; node.replaceChildren(...(/miss|hit|down|wait/.test(name) ? [document.createElement('i')] : [])); }
  });
}
const pieceNames = (piece, n, at) => [piece.kind === 'plane' ? 'plane' : 'boat', ...(piece.kind === 'plane' && n === 1 ? ['alt'] : []), ...(piece.kind === 'plane' && at === 0 ? ['head'] : [])];
function draw() {
  const mine = {}, theirs = {};
  const add = (map, i, ...names) => { map[i] = [...(map[i] ?? []), ...names]; };
  fleet.forEach((p, n) => {
    const { cells, ok } = cellList(p);
    cells.forEach((i, k) => add(mine, i, ...pieceNames(p, n, k), ...(ok ? [] : ['bad']), ...(placing && n === chosen ? ['chosen'] : [])));
  });
  if (!placing) {
    view.board[me].forEach((x, i) => x && add(mine, i, x));
    view.down[1 - me].forEach((p) => cellsOf(p).forEach((i, k) => add(theirs, i, ...pieceNames(p, 0, k))));
    view.board[1 - me].forEach((x, i) => x && add(theirs, i, x));
    if (view.shot !== null) add(view.turn === me ? theirs : mine, view.shot, 'wait');
    if (myTurn() && document.activeElement === $('theirs') && $('theirs').matches(':focus-visible')) add(theirs, at, 'at');
  }
  paint($('mine'), mine);
  paint($('theirs'), theirs);
  document.body.classList.toggle('place', placing);
  $('tools').hidden = !placing;
  $('go').disabled = !rules.isFleet(fleet);
  $('their').classList.toggle('turn', myTurn());
  const gone = view ? view.down[1 - me].map((p) => p.kind) : [];
  $('left').replaceChildren(...FLEET.map((kind) => {
    const li = Object.assign(document.createElement('li'), { textContent: NAMES[kind] }), hit = gone.indexOf(kind);
    if (hit >= 0) { gone.splice(hit, 1); li.className = 'gone'; }
    return li;
  }));
  if (placing) $('whose').textContent = 'Hide your fleet';
  else if (playing) $('whose').textContent = view.phase === 'seal' ? 'Waiting for the other player\u2019s fleet' : view.phase === 'reveal' ? 'Checking the winner\u2019s fleet' : view.turn === me ? (view.shot === null ? 'Your shot' : 'Waiting for the answer') : 'The other player\u2019s shot';
}
/* ---- hiding the fleet */
const change = (n, part) => { fleet = fleet.map((p, i) => (i === n ? { ...p, ...part } : p)); };
const inside = (piece) => cellsOf(piece) !== null;
function shift(n, dr, dc) { const p = fleet[n], moved = { ...p, r: p.r + dr, c: p.c + dc }; if (inside(moved)) change(n, moved); draw(); }
function turnPiece(n) {
  const p = fleet[n], dir = (p.dir + 1) % (p.kind === 'plane' ? 4 : 2);
  const tries = [[0, 0], [0, -1], [0, 1], [-1, 0], [1, 0], [0, -2], [0, 2], [-2, 0], [2, 0], [0, -3], [0, 3], [-3, 0], [3, 0]].map(([r, c]) => ({ ...p, dir, r: p.r + r, c: p.c + c }));
  const fits = tries.find(inside);
  if (fits) change(n, fits);
  draw();
}
function cellAt(board, e) {
  const b = board.getBoundingClientRect(), pick = (v, size) => Math.max(0, Math.min(SIZE - 1, Math.floor((v / size) * SIZE)));
  return { r: pick(e.clientY - b.top, b.height), c: pick(e.clientX - b.left, b.width) };
}
$('mine').addEventListener('pointerdown', (e) => {
  if (!placing || e.button) return;
  const cell = cellAt($('mine'), e), n = fleet.findIndex((p) => cellsOf(p)?.includes(cell.r * SIZE + cell.c));
  if (n < 0) return;
  $('mine').setPointerCapture(e.pointerId);
  chosen = n; drag = { last: cell, moved: false };
  draw();
});
$('mine').addEventListener('pointermove', (e) => {
  if (!drag || !e.buttons) return;
  const cell = cellAt($('mine'), e);
  if (cell.r === drag.last.r && cell.c === drag.last.c) return;
  shift(chosen, cell.r - drag.last.r, cell.c - drag.last.c);
  drag = { last: cell, moved: true };
});
$('mine').addEventListener('pointerup', () => { if (drag && !drag.moved) turnPiece(chosen); drag = null; });
$('mine').addEventListener('pointercancel', () => { drag = null; });
$('mine').addEventListener('keydown', (e) => {
  if (!placing) return;
  const step = { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] }[e.key];
  if (step) shift(chosen, ...step);
  else if (e.key === 'r' || e.key === 'R') turnPiece(chosen);
  else if (e.key === 'n' || e.key === 'N') { chosen = (chosen + 1) % fleet.length; draw(); }
  else return;
  e.preventDefault();
  $('say').textContent = `${NAMES[fleet[chosen].kind]}, ${where(fleet[chosen].r * SIZE + fleet[chosen].c)}. ${cellList(fleet[chosen]).ok ? '' : 'It covers another piece.'}`;
});
$('mix').onclick = () => { fleet = rules.randomFleet(chance); draw(); };
$('turn').onclick = () => turnPiece(chosen);
$('go').onclick = () => {
  if (!placing || !rules.isFleet(fleet)) return;
  placing = false;
  draw();
  $('say').textContent = 'Your fleet is sealed. Nobody can see it or change it now.';
  table.play({ type: 'commit', hash: rules.seal(fleet, salt) });
  $('theirs').focus();
};
/* ---- shooting */
function shoot(cell) {
  if (!myTurn()) return;
  if (view.board[1 - me][cell] !== '') { $('say').textContent = 'You already know that cell.'; return; }
  table.play({ type: 'shoot', cell });
}
$('theirs').addEventListener('pointerdown', (e) => { if (!e.button) { const { r, c } = cellAt($('theirs'), e); at = r * SIZE + c; shoot(at); } });
$('theirs').addEventListener('keydown', (e) => {
  const step = { ArrowUp: -SIZE, ArrowDown: SIZE, ArrowLeft: at % SIZE ? -1 : 0, ArrowRight: at % SIZE < SIZE - 1 ? 1 : 0 }[e.key];
  if (step !== undefined) { if (at + step >= 0 && at + step < SIZE * SIZE) at += step; $('say').textContent = `${where(at)}: ${view?.board[1 - me][at] || 'unknown'}`; }
  else if (e.key === ' ' || e.key === 'Enter') shoot(at);
  else return;
  e.preventDefault();
  if (view) draw();
});
$('theirs').addEventListener('focus', () => view && draw());
$('theirs').addEventListener('blur', () => view && draw());

/* What this computer must say by itself: the true answer, and the fleet at the end. */
function reply() {
  if (view.phase === 'play' && view.shot !== null && view.turn !== me && asked !== view.log[me].length) {
    asked = view.log[me].length;
    table.play({ type: 'answer', ...rules.answer(fleet, view.log[me], view.shot) });
  }
  if (view.phase === 'reveal' && view.claim === me && asked !== 'shown') { asked = 'shown'; table.play({ type: 'reveal', fleet, salt }); }
}
function tell(by) {
  const said = view.log[1 - by]?.at(-1), answered = by !== undefined && view.shot === null && view.phase !== 'seal';
  const target = answered ? by : null, last = target === null ? null : view.log[target].at(-1);
  if (!last || said === undefined && !last) return;
  const mine = target === me, words = { miss: 'a miss', hit: 'a hit', down: last.piece ? `${NAMES[last.piece.kind]} ${last.piece.kind === 'plane' ? 'shot down' : 'sunk'}` : '' };
  $('say').textContent = `${mine ? 'They shot' : 'You shot'} ${where(last.cell)}: ${words[last.says]}.`;
}

const table = await connect(rules, {
  start({ view: v, me: seat }) {
    view = v; me = seat; playing = true; placing = true; chosen = 0; asked = -1; at = 0;
    fleet = rules.randomFleet(chance); salt = newSalt();
    $('mineTitle').textContent = 'Your fleet';
    $('say').textContent = 'Drag a piece to move it and tap it to turn it. The white dot is a plane\u2019s head: a hit there brings the plane down.';
    draw();
    $('mine').focus();
  },
  update({ view: v, by }) {
    const had = view; view = v;
    draw();
    if (v.log[0].length + v.log[1].length > had.log[0].length + had.log[1].length) tell(by);
    setTimeout(() => { if (playing) reply(); }, 0);
  },
  refused({ error }) { $('say').textContent = `Not accepted: ${error}.`; },
  end({ result }) {
    playing = false; placing = false; drag = null;
    draw();
    $('whose').textContent = 'The match is over';
    const won = result.winner === me;
    $('say').textContent = result.reason === 'fleet' ? (won ? 'You win. Your whole fleet was honest.' : 'You lose. The other fleet was checked and it was honest.')
      : result.reason === 'unfair' ? (won ? 'You win. The other player did not play by the rules.' : 'You lose. Your answers did not fit your fleet.') : 'The match is over.';
  },
});
