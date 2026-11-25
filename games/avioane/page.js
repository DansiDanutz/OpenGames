// SPDX-License-Identifier: MIT
import * as rules from './rules.js';
import { connect } from '/kit/ui.js';
import { createBoard } from '/kit/board3d.js';
import * as sound from '/kit/sound.js';
import { mark, piece, sea } from './fleet3d.js';

const $ = (id) => document.getElementById(id);
const cellsOf = (p) => rules.cellsOf(n, p), isFleet = (f) => rules.isFleet(n, f);
const NAMES = { plane: 'Plane', boat4: 'Boat of 4', boat3: 'Boat of 3', boat2: 'Boat of 2' };
let n = 10, view = null, me = 0, playing = false, placing = false, chosen = 0, drag = null, at = 0, asked = -1;
let fleet = [], salt = '';                              // these never leave this page before the end

const chance = () => crypto.getRandomValues(new Uint32Array(1))[0] / 4294967296;
const newSalt = () => [...crypto.getRandomValues(new Uint8Array(16))].map((b) => b.toString(16).padStart(2, '0')).join('');
const where = (i) => `row ${Math.floor(i / n) + 1}, column ${(i % n) + 1}`;
const myTurn = () => playing && view.phase === 'play' && view.turn === me && view.shot === null;
function cellList(piece) {
  const cells = cellsOf(piece);
  return cells && !fleet.some((p) => p !== piece && cellsOf(p)?.some((i) => cells.includes(i))) ? { cells, ok: true } : { cells: cells ?? [], ok: false };
}
/* ---- the two seas in 3D */
const boards = { mine: createBoard($('mine'), { floor: '#06283d', frame: '#c9a35a' }), theirs: createBoard($('theirs'), { floor: '#06283d', frame: '#c9a35a' }) };
const drawn = { mine: new Map(), theirs: new Map() };
let flames = [], waves = [];
for (const board of Object.values(boards)) {
  board.onFrame((t) => {
    for (const wave of waves) if (wave.board === board) wave.run(t);
    for (const f of flames) if (f.board === board) { f.node.scale.set(1, 0.85 + 0.25 * Math.sin(t * 9 + f.seed), 1); f.node.rotation.y = t * 2 + f.seed; }
  });
}
function buildSeas() {
  flames = []; waves = [];
  for (const [side, board] of Object.entries(boards)) {
    board.setSize(n);
    drawn[side].clear();
    waves.push({ board, run: sea(board) });
  }
}
/* Only what is new or different is built again. */
function show(side, wanted) {
  const have = drawn[side], board = boards[side];
  for (const [k, node] of have) {
    if (wanted.has(k)) continue;
    flames = flames.filter((f) => f.node !== node);
    board.remove(node); have.delete(k);
  }
  for (const [k, make] of wanted) {
    if (have.has(k)) continue;
    const node = board.add(make());
    if (node.userData.isFlame) flames.push({ board, node, seed: have.size });
    have.set(k, node);
  }
}
const spot = (board, cell, y = 0.2) => board.at(Math.floor(cell / n), cell % n, y);
const inCell = (cell) => ({ r0: Math.floor(cell / n), c0: cell % n, r1: Math.floor(cell / n), c1: cell % n });
function draw() {
  const mine = new Map(), theirs = new Map();
  const lost = view && !placing ? view.down[me] : [];
  const isLost = (p) => lost.some((x) => x.kind === p.kind && x.r === p.r && x.c === p.c && x.dir === p.dir);
  fleet.forEach((p, i) => {
    const state = { isBad: !cellList(p).ok, isChosen: placing && i === chosen, isDown: isLost(p) };
    mine.set(`p${i}|${JSON.stringify([p, state])}`, () => piece(boards.mine, p, i, state));
  });
  if (!placing && view) {
    view.board[me].forEach((x, i) => x && mine.set(`m${i}${x}`, () => mark(boards.mine, i, x)));
    view.down[1 - me].forEach((p, i) => theirs.set(`d${JSON.stringify(p)}`, () => piece(boards.theirs, p, i, { isDown: true })));
    view.board[1 - me].forEach((x, i) => x && theirs.set(`m${i}${x}`, () => mark(boards.theirs, i, x)));
    if (view.shot !== null) { const side = view.turn === me ? 'theirs' : 'mine'; (side === 'mine' ? mine : theirs).set(`w${view.shot}`, () => mark(boards[side], view.shot, 'wait')); }
    if (myTurn() && $('theirs').matches(':focus-visible')) theirs.set(`at${at}`, () => boards.theirs.outline(inCell(at), '#ffcf6b', 0.2));
  }
  show('mine', mine);
  show('theirs', theirs);
  document.body.classList.toggle('place', placing);
  $('tools').hidden = !placing;
  $('go').disabled = !isFleet(fleet);
  $('their').classList.toggle('turn', myTurn());
  const gone = view ? view.down[1 - me].map((p) => p.kind) : [];
  $('left').replaceChildren(...rules.FLEETS[n].map((kind) => {
    const li = Object.assign(document.createElement('li'), { textContent: NAMES[kind] }), hit = gone.indexOf(kind);
    if (hit >= 0) { gone.splice(hit, 1); li.className = 'gone'; }
    return li;
  }));
  if (placing) $('whose').textContent = 'Hide your fleet';
  else if (playing) $('whose').textContent = view.phase === 'seal' ? 'Waiting for the other player\u2019s fleet' : view.phase === 'reveal' ? 'Checking the winner\u2019s fleet' : view.turn === me ? (view.shot === null ? 'Your shot' : 'Waiting for the answer') : 'The other player\u2019s shot';
}
/* ---- hiding the fleet */
const change = (index, part) => { fleet = fleet.map((p, i) => (i === index ? { ...p, ...part } : p)); };
const inside = (piece) => cellsOf(piece) !== null;
function shift(i, dr, dc) { const p = fleet[i], moved = { ...p, r: p.r + dr, c: p.c + dc }; if (inside(moved)) change(i, moved); draw(); }
function turnPiece(index) {
  const p = fleet[index], dir = (p.dir + 1) % (p.kind === 'plane' ? 4 : 2);
  const tries = [[0, 0], [0, -1], [0, 1], [-1, 0], [1, 0], [0, -2], [0, 2], [-2, 0], [2, 0], [0, -3], [0, 3], [-3, 0], [3, 0]].map(([r, c]) => ({ ...p, dir, r: p.r + r, c: p.c + c }));
  const fits = tries.find(inside);
  if (fits) change(index, fits);
  sound.play(fits ? 'place' : 'no');
  draw();
}
$('mine').addEventListener('pointerdown', (e) => {
  if (!placing || e.button) return;
  const cell = boards.mine.cellAt(e, { isClamped: false });
  const index = cell ? fleet.findIndex((p) => cellsOf(p)?.includes(cell.r * n + cell.c)) : -1;
  if (index < 0) return;
  $('mine').setPointerCapture(e.pointerId);
  chosen = index; drag = { last: cell, moved: false };
  sound.play('lift');
  draw();
});
$('mine').addEventListener('pointermove', (e) => {
  if (!drag || !e.buttons) return;
  const cell = boards.mine.cellAt(e);
  if (!cell || (cell.r === drag.last.r && cell.c === drag.last.c)) return;
  sound.play('tick');
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
  $('say').textContent = `${NAMES[fleet[chosen].kind]}, ${where(fleet[chosen].r * n + fleet[chosen].c)}. ${cellList(fleet[chosen]).ok ? '' : 'It covers another piece.'}`;
});
$('mix').onclick = () => { fleet = rules.randomFleet(n, chance); sound.play('place'); draw(); };
$('turn').onclick = () => turnPiece(chosen);
$('go').onclick = () => {
  if (!placing || !isFleet(fleet)) return;
  placing = false;
  draw();
  $('say').textContent = 'Your fleet is sealed. Nobody can see it or change it now.';
  table.play({ type: 'commit', hash: rules.seal(fleet, salt) });
  $('theirs').focus();
};
/* ---- shooting */
function shoot(cell) {
  if (!myTurn()) return;
  if (view.board[1 - me][cell] !== '') { $('say').textContent = 'You already know that cell.'; sound.play('no'); return; }
  sound.play('fire', boards.theirs.pan(cell % n));
  table.play({ type: 'shoot', cell });
}
$('theirs').addEventListener('pointerdown', (e) => { if (e.button) return; const cell = boards.theirs.cellAt(e, { isClamped: false }); if (cell) { at = cell.r * n + cell.c; shoot(at); } });
$('theirs').addEventListener('keydown', (e) => {
  const step = { ArrowUp: -n, ArrowDown: n, ArrowLeft: at % n ? -1 : 0, ArrowRight: at % n < n - 1 ? 1 : 0 }[e.key];
  if (step !== undefined) { if (at + step >= 0 && at + step < n * n) at += step; $('say').textContent = `${where(at)}: ${view?.board[1 - me][at] || 'unknown'}`; }
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
    table.play({ type: 'answer', ...rules.answer({ n, level: view.level }, fleet, view.log[me], view.shot) });
  }
  if (view.phase === 'reveal' && view.claim === me && asked !== 'shown') { asked = 'shown'; table.play({ type: 'reveal', fleet, salt }); }
}
/* What a shot looks and sounds like. */
function boom(side, { cell, says }) {
  const board = boards[side], p = spot(board, cell), pan = board.pan(cell % n);
  if (says === 'miss' || says === 'near') {
    sound.play('splash', pan);
    board.burst(p, { color: '#bfe8ff', count: 34, speed: 2.4, size: 0.14, up: 1.3 });
    board.ripple(spot(board, cell, 0.1));
    return;
  }
  const isDown = says === 'down';
  sound.play(isDown ? 'down' : 'hit', pan);
  board.shake(isDown ? 0.5 : 0.22);
  board.flash(spot(board, cell, 1), '#ff9a3c', isDown ? 90 : 40);
  board.burst(p, { color: '#ff8a1f', count: isDown ? 120 : 56, speed: isDown ? 4.6 : 3, size: 0.24 });
  board.burst(p, { color: '#fff0b0', count: isDown ? 50 : 20, speed: 2, size: 0.18 });
  if (isDown) board.ripple(spot(board, cell, 0.1), '#ffb36b', 2.4);
}
function tell(by) {
  const said = view.log[1 - by]?.at(-1), answered = by !== undefined && view.shot === null && view.phase !== 'seal';
  const target = answered ? by : null, last = target === null ? null : view.log[target].at(-1);
  if (!last || said === undefined && !last) return;
  boom(target === me ? 'mine' : 'theirs', last);
  const mine = target === me, words = { miss: 'a miss', near: 'a miss, but near a piece', hit: 'a hit', down: last.piece ? `${NAMES[last.piece.kind]} ${last.piece.kind === 'plane' ? 'shot down' : 'sunk'}` : '' };
  $('say').textContent = `${mine ? 'They shot' : 'You shot'} ${where(last.cell)}: ${words[last.says]}.`;
}

/* What this player knows, for tests. */
$('mine').inspect = () => ({ view, me, fleet, n, placing });

const table = await connect(rules, {
  start({ view: v, me: seat, players, round, rounds }) {
    view = v; me = seat; n = v.n; playing = true; placing = true; chosen = 0; asked = -1; at = 0; drag = null;
    fleet = rules.randomFleet(n, chance); salt = newSalt();
    $('mineTitle').textContent = 'Your fleet';
    $('theirTitle').textContent = players[1 - me].name;
    buildSeas();
    $('say').textContent = `${rounds > 1 ? `Game ${round + 1}. ` : ''}Drag a piece to move it and tap it to turn it. The white nose is a plane\u2019s head: a hit there brings the plane down.`;
    draw();
    boards.mine.intro();
    sound.play('begin');
    $('mine').focus();
  },
  update({ view: v, by }) {
    const had = view; view = v;
    draw();
    if (v.log[0].length + v.log[1].length > had.log[0].length + had.log[1].length) tell(by);
    else if (v.phase === 'play' && had.phase === 'seal' && myTurn()) sound.play('turn');
    setTimeout(() => { if (playing && view === v) reply(); }, 0);
  },
  refused({ error }) { $('say').textContent = `Not accepted: ${error}.`; sound.play('no'); },
  end({ result, isLast }) {
    playing = false; placing = false; drag = null;
    draw();
    $('whose').textContent = 'The game is over';
    const won = result.winner === me;
    sound.play(won ? 'win' : 'lose');
    if (won) boards.theirs.celebrate();
    $('say').textContent = `${result.reason === 'fleet' ? (won ? 'You win. Your whole fleet was honest.' : 'You lose. The other fleet was checked and it was honest.')
      : result.reason === 'unfair' ? (won ? 'You win. The other player did not play by the rules.' : 'You lose. Your answers did not fit your fleet.') : 'The match is over.'}${isLast ? '' : ' The next game starts in a moment.'}`;
  },
});
