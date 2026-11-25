/* The rules of a match, as the host chooses them and as the other player reads them. */
import { ROUNDS } from '/kit/engine.js';

const ROUND_NAMES = { 1: 'Heads-up, one game', 3: 'Best of three, first to two', 5: 'Best of five, first to three' };
const el = (tag, props = {}, ...kids) => { const node = Object.assign(document.createElement(tag), props); node.append(...kids); return node; };

function group(name, label, choices, chosen) {
  return el('fieldset', { className: 'pick' }, el('legend', { textContent: label }), ...choices.map((c) => el('label', {},
    el('input', { type: 'radio', name, value: c.id, checked: c.id === chosen }), el('span', {}, c.label, ...(c.note ? [el('small', { textContent: c.note })] : [])))));
}
export function drawChoices(box, game, last) {
  const usual = (o) => (o.choices.some((c) => c.id === last.options?.[o.id]) ? last.options[o.id] : o.default);
  box.replaceChildren(...game.options.map((o) => group(`option-${o.id}`, o.label, o.choices, usual(o))),
    group('rounds', 'Match', ROUNDS.map((n) => ({ id: String(n), label: ROUND_NAMES[n] })), String(ROUNDS.includes(last.rounds) ? last.rounds : 1)));
}
export function readChoices(box) {
  const chosen = [...box.querySelectorAll('input:checked')];
  return { rounds: Number(chosen.find((x) => x.name === 'rounds').value),
    options: Object.fromEntries(chosen.filter((x) => x.name.startsWith('option-')).map((x) => [x.name.slice('option-'.length), x.value])) };
}
const parts = (game, terms) => [...game.options.map((o) => [o.label, o.choices.find((c) => c.id === terms.options[o.id])]), ['Match', { label: ROUND_NAMES[terms.rounds] }]];

export const describe = (game, terms, isSolo = false) => [...parts(game, terms).map(([, c]) => c.label), ...(isSolo ? [] : [terms.ranked ? 'Ranked' : 'Not ranked'])].join('. ');
export function drawTerms(list, rules, game, terms) {
  const row = (name, label, note) => [el('dt', { textContent: name }), el('dd', { textContent: label }, ...(note ? [el('small', { textContent: note })] : []))];
  list.replaceChildren(...parts(game, terms).flatMap(([name, c]) => row(name, c.label, c.note)),
    ...row('Leaderboard', terms.ranked ? 'This match counts' : 'This match does not count', terms.ranked ? 'Your name and the signed moves go to the match server.' : ''));
  rules.replaceChildren(...game.howto.map((text) => el('li', { textContent: text })));
}
export function drawLeaderboard(body, players, mine) {
  body.replaceChildren(...players.map((p, i) => el('tr', { className: p.pub === mine ? 'me' : '' },
    el('td', { textContent: i + 1 }), el('th', { scope: 'row', textContent: `${p.name}${p.pub === mine ? ' (you)' : ''}` }),
    ...[p.rating, p.wins, p.losses, p.draws].map((v) => el('td', { textContent: v })))));
}
