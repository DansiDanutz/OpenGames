// SPDX-License-Identifier: MIT
import * as rules from './rules.js';
import { connect } from '/kit/ui.js';
import { THREE, bounce, createBoard, gloss } from '/kit/board3d.js';
import * as sound from '/kit/sound.js';

const $ = (id) => document.getElementById(id);
const el = (className, text = '') => Object.assign(document.createElement('div'), { className, textContent: text });
const { GEMS, ROCK } = rules;
const NAMES = ['round pink', 'green triangle', 'purple diamond'];
let view = null, me = 0, playing = false, from = null, at = { r: 0, c: 0 }, told = '';

const box = (a, b) => ({ r0: Math.min(a.r, b.r), c0: Math.min(a.c, b.c), r1: Math.max(a.r, b.r), c1: Math.max(a.c, b.c) });
const myTurn = () => playing && view.turn === me;
/* ---- the field in 3D */
const REPEAT = THREE.RepeatWrapping;
const PLAYERS = ['#ff8a00', '#0a7dff'];
const board = createBoard($('board'), { floor: '#120c22' });
let gemMeshes = [], drawn = 0, marks = [];
/* Three gems that differ in shape, not only in colour. */
const GEM = {
  1: () => new THREE.Mesh(new THREE.IcosahedronGeometry(0.23, 1), gem('#ff2f9e')),
  2: () => { const m = new THREE.Mesh(new THREE.ConeGeometry(0.28, 0.42, 3), gem('#63c800')); return m; },
  3: () => { const m = new THREE.Mesh(new THREE.OctahedronGeometry(0.27), gem('#9a35ff')); m.scale.y = 1.25; return m; },
};
const gem = (color) => new THREE.MeshPhysicalMaterial({ color, emissive: color, emissiveIntensity: 0.28, roughness: 0.05, metalness: 0.05, clearcoat: 1, iridescence: 0.7, iridescenceIOR: 1.6, flatShading: true, envMapIntensity: 1.8 });
function pattern(player) {
  const c = Object.assign(document.createElement('canvas'), { width: 64, height: 64 }), g = c.getContext('2d');
  g.fillStyle = '#fff'; g.fillRect(0, 0, 64, 64);
  g.strokeStyle = '#c9c9c9'; g.lineWidth = 9;
  g.beginPath();
  if (player) for (const x of [-32, 0, 32, 64]) { g.moveTo(x, 64); g.lineTo(x + 64, 0); } else g.arc(32, 32, 18, 0, 7);
  g.stroke();
  const map = new THREE.CanvasTexture(c);
  map.colorSpace = THREE.SRGBColorSpace;
  return map;
}
function buildField() {
  const { n, gems, owner } = view;
  board.setSize(n);
  drawn = 0; marks = [];
  gemMeshes = gems.map((kind, i) => {
    const r = Math.floor(i / n), c = i % n, home = i === 0 ? 0 : i === n * n - 1 ? 1 : -1;
    const tile = board.slab({ r0: r, c0: c, r1: r, c1: c }, { height: 0.14, gap: 0.06, radius: 0.05,
      material: new THREE.MeshPhysicalMaterial({ color: home < 0 ? '#35285c' : PLAYERS[home], roughness: 0.5, clearcoat: 0.4, emissive: home < 0 ? '#000' : PLAYERS[home], emissiveIntensity: 0.25 }) });
    board.add(tile);
    if (owner[i] === ROCK) {
      const rock = new THREE.Mesh(new THREE.IcosahedronGeometry(0.42, 1), new THREE.MeshStandardMaterial({ color: '#8d8798', roughness: 0.95, flatShading: true }));
      const p = rock.geometry.attributes.position;
      for (let k = 0; k < p.count; k++) { const f = 0.85 + 0.3 * Math.abs(Math.sin(p.getX(k) * 31 + p.getY(k) * 17 + p.getZ(k) * 23 + i)); p.setXYZ(k, p.getX(k) * f, p.getY(k) * f, p.getZ(k) * f); }
      rock.geometry.computeVertexNormals();
      rock.position.copy(board.at(r, c, 0.2)); rock.castShadow = rock.receiveShadow = true;
      board.add(rock);
    }
    if (!kind) return null;
    const mesh = GEM[kind]();
    mesh.position.copy(board.at(r, c, 0.36)); mesh.castShadow = true;
    return board.add(mesh);
  });
}
board.onFrame((time) => gemMeshes.forEach((m, i) => { if (m) { m.rotation.y = time * 0.6 + i; m.position.y = 0.36 + (m.userData.lift ?? 0) + Math.sin(time * 1.4 + i) * 0.035; } }));
function buildBlock(b) {
  const { n } = view, map = pattern(b.player), w = b.c1 - b.c0 + 1, d = b.r1 - b.r0 + 1;
  map.wrapS = map.wrapT = REPEAT;
  map.repeat.set(w, d);
  const mesh = board.slab(b, { height: 0.26, radius: 0.1, material: gloss(PLAYERS[b.player], { map, emissive: PLAYERS[b.player], emissiveIntensity: 0.12 }) }), y = mesh.position.y;
  board.add(mesh);
  const held = rules.cells(n, b).map((i) => gemMeshes[i]).filter(Boolean);
  for (const m of held) m.userData.lift = 0.2;
  const middle = board.at((b.r0 + b.r1) / 2, (b.c0 + b.c1) / 2, 0.3), pan = board.pan((b.c0 + b.c1) / 2);
  board.tween(300, (t) => { mesh.position.y = y + (1 - t) * 1.6; mesh.scale.setScalar(0.85 + 0.15 * t); }, { curve: bounce });
  sound.play('place', pan);
  board.burst(middle, { color: PLAYERS[b.player], count: 16 + w * d * 4, speed: 2.2 });
  if (held.length) sound.play('gem', pan);
  for (const m of held) board.burst(m.position.clone(), { color: '#ffffff', count: 14, speed: 1.6, size: 0.12 });
}
function drawBlocks() {
  for (; drawn < view.blocks.length; drawn++) buildBlock(view.blocks[drawn]);
  marks.forEach(board.remove);
  const want = from && box(from, at), isFocused = $('board').matches(':focus-visible');
  marks = [...(want ? [board.outline(want, rules.problem(view, me, want) ? '#ff6a5e' : '#ffcf6b', 0.46)] : []), ...(playing && isFocused ? [board.outline(box(at, at), '#fff', 0.44)] : [])].map(board.add);
  board.redraw();
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
  $('stock').style.setProperty('--mine', PLAYERS[me]);
  $('stock').replaceChildren(...Object.keys(view.stock[me]).map((size) => {
    const [h, w] = size.split('x').map(Number), left = view.stock[me][size], li = document.createElement('li'), shape = el('shape');
    shape.style.gridTemplateColumns = `repeat(${w}, 11px)`;
    shape.append(...Array.from({ length: h * w }, () => document.createElement('span')));
    li.className = left ? '' : 'none';
    li.append(shape, `\u00d7${left}`);
    li.setAttribute('aria-label', `${h} by ${w}: ${left} left`);
    return li;
  }));
  $('whose').textContent = !playing ? 'The match is over' : myTurn() ? 'Your turn' : 'The other player\u2019s turn';
  if (playing && told !== `${view.blocks.length}` && myTurn()) sound.play('turn');
  told = `${view.blocks.length}`;
  return crowns;
}
function place() {
  const rect = box(from, at), wrong = !myTurn() ? 'it is not your turn' : rules.problem(view, me, rect);
  from = null;
  drawBlocks();
  if (wrong) { $('say').textContent = `Not there: ${wrong}.`; sound.play('no'); }
  else { $('say').textContent = ''; table.play({ type: 'place', rect }); }
}
$('board').addEventListener('pointerdown', (e) => {
  if (!playing || e.button) return;
  $('board').setPointerCapture(e.pointerId);
  const cell = board.cellAt(e, { isClamped: false });
  if (!cell) return;
  from = at = cell;
  sound.play('lift');
  drawBlocks();
});
$('board').addEventListener('pointermove', (e) => { if (!from || !e.buttons) return; const cell = board.cellAt(e); if (cell && (cell.r !== at.r || cell.c !== at.c)) { at = cell; sound.play('tick'); drawBlocks(); } });
$('board').addEventListener('pointerup', () => { if (from) place(); });
$('board').addEventListener('pointercancel', () => { from = null; drawBlocks(); });
$('board').addEventListener('keydown', (e) => {
  if (!playing) return;
  const step = { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] }[e.key];
  const keep = (v) => Math.max(0, Math.min(view.n - 1, v));
  if (step) {
    at = { r: keep(at.r + step[0]), c: keep(at.c + step[1]) };
    const i = at.r * view.n + at.c, owner = view.owner[i];
    $('say').textContent = `Row ${at.r + 1}, column ${at.c + 1}. ${view.gems[i] ? `${NAMES[view.gems[i] - 1]} gem` : 'no gem'}, ${owner === -1 ? 'free' : owner === ROCK ? 'a rock' : owner === me ? 'yours' : 'the other player\u2019s'}.`;
  } else if (e.key === ' ') { if (from) { e.preventDefault(); place(); return; } from = at; }
  else if (e.key === 'Escape') from = null;
  else return;
  e.preventDefault();
  drawBlocks();
});

for (const type of ['focus', 'blur']) $('board').addEventListener(type, () => view && drawBlocks());
/* What is on the board, for tests. */
$('board').inspect = () => ({ view, me });

const table = await connect(rules, {
  start({ view: v, me: seat, round, rounds }) {
    view = v; me = seat; playing = true; from = null; told = '';
    at = me ? { r: v.n - 1, c: v.n - 1 } : { r: 0, c: 0 };
    buildField(); drawBlocks(); drawSides();
    board.intro();
    sound.play('begin');
    const first = v.first === 1 ? 'one cell' : `at most ${v.first} cells`;
    $('say').textContent = `${rounds > 1 ? `Game ${round + 1}. ` : ''}Drag to place a block. Start in your ${me ? 'blue corner, at the bottom right' : `orange corner, at the top left, with ${first}`}.`;
    $('board').focus();
  },
  update({ view: v, by }) {
    view = v;
    drawBlocks(); drawSides();
    if (by !== me) $('say').textContent = myTurn() ? 'Your turn. Blocks must touch your own ground by a side.' : 'You have no room, so the other player goes on.';
    else $('say').textContent = '';
  },
  refused({ error }) { $('say').textContent = `Not accepted: ${error}.`; sound.play('no'); },
  end({ result, isLast }) {
    playing = false; from = null;
    drawBlocks();
    const { crowns, total } = rules.score(view), won = result.winner === me;
    drawSides();
    sound.play(won ? 'win' : 'lose');
    if (won) board.celebrate();
    const how = crowns[0] !== crowns[1] ? '' : total[0] !== total[1] ? ', decided by the number of gems' : ', decided by the ground';
    $('say').textContent = `${result.reason === 'resigned' ? 'The match is over.' : `${won ? 'You win' : 'You lose'}: ${crowns[me]} gem colours to ${crowns[1 - me]}${how}.`}${isLast ? '' : ' The next game starts in a moment.'}`;
  },
});
