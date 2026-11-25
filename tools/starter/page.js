// SPDX-License-Identifier: MIT
import * as rules from './rules.js';
import { connect } from '/kit/ui.js';
import * as sound from '/kit/sound.js';

const $ = (id) => document.getElementById(id);
let view = null, me = 0, isPlaying = false, names = [];

const isMine = () => isPlaying && view.turn === me;
const label = (owner, i) => `Row ${Math.floor(i / view.n) + 1}, column ${i % view.n + 1}: ${owner === -1 ? 'free' : owner === rules.ROCK ? 'a rock' : owner === me ? 'yours' : 'theirs'}`;
function build() {
  $('cells').className = `n${view.n}`;
  $('cells').replaceChildren(...view.cells.map((_, i) => {
    const cell = document.createElement('button');
    cell.type = 'button';
    cell.onclick = () => { if (isMine() && rules.isFree(view, me, i)) table.play({ cell: i }); else sound.play('no'); };
    return cell;
  }));
}
function draw() {
  [...$('cells').children].forEach((cell, i) => {
    cell.className = view.cells[i] === -1 ? '' : `p${view.cells[i]}`;
    cell.setAttribute('aria-label', label(view.cells[i], i));
    cell.setAttribute('aria-disabled', String(!isMine() || !rules.isFree(view, me, i)));
  });
  if (isPlaying) $('whose').textContent = isMine() ? 'Your turn' : `${names[1 - me].name}: their turn`;
}
const table = await connect(rules, {
  start(game) { view = game.view; me = game.me; names = game.players; isPlaying = true; $('say').textContent = ''; build(); draw(); },
  update(next) { view = next.view; sound.play('place'); draw(); },
  end({ result, me: seat, view: last }) {
    isPlaying = false;
    if (last) view = last;
    draw();
    $('whose').textContent = result.winner === seat ? 'You win' : 'You lose';
  },
  refused({ error }) { $('say').textContent = error; },
});
