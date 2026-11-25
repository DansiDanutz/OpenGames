// SPDX-License-Identifier: MIT
import * as rules from './rules.js';
import { connect } from '/kit/ui.js';

const $ = (id) => document.getElementById(id);
const el = (className, text = '') => Object.assign(document.createElement('div'), { className, textContent: text });
const { SIZE, GEMS, STOCK } = rules;
const NAMES = ['round pink', 'green triangle', 'purple diamond'];
let view = null, me = 0, playing = false, from = null, at = { r: 0, c: 0 };

const box = (a, b) => ({ r0: Math.min(a.r, b.r), c0: Math.min(a.c, b.c), r1: Math.max(a.r, b.r), c1: Math.max(a.c, b.c) });
const myTurn = () => playing && view.turn === me;
function layer(name, { r0, c0, r1, c1 }) {
  const node = el(name), pc = (v) => `${(v / SIZE) * 100}%`;
  Object.assign(node.style, { left: pc(c0), top: pc(r0), width: pc(c1 - c0 + 1), height: pc(r1 - r0 + 1) });
  return node;
}
function drawField() {
  $('board').replaceChildren(...view.gems.map((g, i) => {
    const cell = el(`cell${i === 0 ? ' home0' : i === view.gems.length - 1 ? ' home1' : ''}`);
    cell.dataset.gem = g;
    if (g) cell.append(el(`gem g${g}`));
    return cell;
  }));
}
function drawBlocks(fresh = -1) {
  $('board').querySelectorAll('.rect,.ghost,.cursor').forEach((x) => x.remove());
  const want = from && box(from, at);
  $('board').append(...view.blocks.map((b, i) => layer(`rect p${b.player}${i === fresh ? ' fresh' : ''}`, b)),
    ...(want ? [layer(`ghost${rules.problem(view, me, want) ? ' no' : ''}`, want)] : []),
    ...(playing ? [layer('cursor', box(at, at))] : []));
}
function drawSides() {
  const { gems, crowns } = rules.score(view);
  $('score').replaceChildren(...GEMS.map((kind, k) => {
    const li = document.createElement('li'), [mine, theirs] = [gems[me][k], gems[1 - me][k]];
    li.className = mine === theirs ? '' : `p${mine > theirs ? me : 1 - me}`;
    const b = (n, p) => Object.assign(document.createElement('b'), { className: `p${p}`, textContent: n });
    li.append(el(`gem g${kind}`), b(mine, me), Object.assign(document.createElement('i'), { textContent: ':' }), b(theirs, 1 - me));
    li.setAttribute('aria-label', `${NAMES[k]}: you ${mine}, other player ${theirs}`);
    return li;
  }));
  $('stock').style.setProperty('--mine', me ? '#0a95ff' : '#ff9d00');
  $('stock').replaceChildren(...Object.keys(STOCK).map((size) => {
    const [h, w] = size.split('x').map(Number), left = view.stock[me][size], li = document.createElement('li'), shape = el('shape');
    shape.style.gridTemplateColumns = `repeat(${w}, 11px)`;
    shape.append(...Array.from({ length: h * w }, () => document.createElement('span')));
    li.className = left ? '' : 'none';
    li.append(shape, `\u00d7${left}`);
    li.setAttribute('aria-label', `${h} by ${w}: ${left} left`);
    return li;
  }));
  $('whose').textContent = !playing ? 'The match is over' : myTurn() ? 'Your turn' : 'The other player\u2019s turn';
  $('frame').classList.toggle('turn', myTurn());
  return crowns;
}
function place() {
  const rect = box(from, at), wrong = !myTurn() ? 'it is not your turn' : rules.problem(view, me, rect);
  from = null;
  drawBlocks();
  if (wrong) $('say').textContent = `Not there: ${wrong}.`;
  else { $('say').textContent = ''; table.play({ type: 'place', rect }); }
}
function cellAt(e) {
  const b = $('board').getBoundingClientRect(), pick = (v, size) => Math.max(0, Math.min(SIZE - 1, Math.floor((v / size) * SIZE)));
  return { r: pick(e.clientY - b.top, b.height), c: pick(e.clientX - b.left, b.width) };
}
$('board').addEventListener('pointerdown', (e) => {
  if (!playing || e.button) return;
  $('board').setPointerCapture(e.pointerId);
  from = at = cellAt(e);
  drawBlocks();
});
$('board').addEventListener('pointermove', (e) => { if (from && e.buttons) { at = cellAt(e); drawBlocks(); } });
$('board').addEventListener('pointerup', () => { if (from) place(); });
$('board').addEventListener('pointercancel', () => { from = null; drawBlocks(); });
$('board').addEventListener('keydown', (e) => {
  if (!playing) return;
  const step = { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] }[e.key];
  const keep = (v) => Math.max(0, Math.min(SIZE - 1, v));
  if (step) {
    at = { r: keep(at.r + step[0]), c: keep(at.c + step[1]) };
    const i = at.r * SIZE + at.c, owner = view.owner[i];
    $('say').textContent = `Row ${at.r + 1}, column ${at.c + 1}. ${view.gems[i] ? `${NAMES[view.gems[i] - 1]} gem` : 'no gem'}, ${owner === -1 ? 'free' : owner === me ? 'yours' : 'the other player\u2019s'}.`;
  } else if (e.key === ' ') { if (from) { e.preventDefault(); place(); return; } from = at; }
  else if (e.key === 'Escape') from = null;
  else return;
  e.preventDefault();
  drawBlocks();
});

const table = await connect(rules, {
  start({ view: v, me: seat }) {
    view = v; me = seat; playing = true; from = null;
    at = me ? { r: SIZE - 1, c: SIZE - 1 } : { r: 0, c: 0 };
    drawField(); drawBlocks(); drawSides();
    $('say').textContent = `Drag on the field to place a block. Start in your ${me ? 'blue corner, bottom right' : 'orange corner, top left'}${me ? '' : ', with one or two cells'}. Win by holding more of two gem colours.`;
    $('board').focus();
  },
  update({ view: v, by }) {
    view = v;
    drawBlocks(view.blocks.length - 1); drawSides();
    if (by !== me) $('say').textContent = myTurn() ? 'Your turn. Blocks must touch your own ground by a side.' : 'You have no room, so the other player goes on.';
  },
  refused({ error }) { $('say').textContent = `Not accepted: ${error}.`; },
  end({ result }) {
    playing = false; from = null;
    drawBlocks();
    const crowns = drawSides();
    $('say').textContent = result.reason === 'resigned' ? 'The match is over.' : `${result.winner === me ? 'You win' : 'You lose'}: ${crowns[me]} gem colours to ${crowns[1 - me]}${crowns[0] === crowns[1] ? ', decided by the number of gems' : ''}.`;
  },
});
