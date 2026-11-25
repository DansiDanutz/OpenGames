import test from 'node:test';
import assert from 'node:assert/strict';
import { inviteLink, inviteText, isCode, readInvite, whatsappUrl } from '../app/shell/invite.js';

const options = [{ id: 'size', default: '10', choices: [{ id: '8' }, { id: '10' }] }, { id: 'level', default: 'easy', choices: [{ id: 'easy' }, { id: 'hard' }] }];
const game = { id: 'avioane', name: 'Avioane & Bărcuțe', options }, code = 'ABCD2345', server = 'wss://play.example.org';
const terms = { options: { size: '8', level: 'hard' }, rounds: 3, ranked: true };
test('an invite names the game and the code, and its link carries the rules and the name', () => {
  const text = inviteText({ game, code, server, terms, name: 'Ann & <Bo>' });
  for (const part of ['Avioane & Bărcuțe', code, 'https://play.example.org/play#avioane=ABCD2345&size=8&level=hard&games=3&ranked=1&by=Ann']) assert.ok(text.includes(part), part);
  const read = readInvite(new URL(inviteLink({ game, code, server, terms, name: 'Ann & <Bo>' })).hash, [game]);
  assert.deepEqual([read.game.id, read.code, read.by, read.terms.options, read.terms.rounds, read.terms.ranked], ['avioane', code, 'Ann Bo', terms.options, 3, true]);
});
test('the browser version sends the same link', () => {
  assert.equal(inviteText({ game, code, server: 'https://play.example.org' }), inviteText({ game, code, server }));
});
test('a server without a secure address is not named', () => {
  assert.doesNotMatch(inviteText({ game, code, server: 'ws://127.0.0.1:4310' }), /https?:/);
});
test('only a code of the match server and rules of the game can be sent', () => {
  for (const bad of [undefined, null, 1, '', 'ABCD234', 'ABCD23456', 'abcd2345', 'ABCD234O', 'ABCD 345', 'ABCD2345\n', { toString: () => code }]) {
    assert.equal(isCode(bad), false);
    assert.throws(() => inviteText({ game, code: bad, server }), /not a code/);
  }
  for (const bad of [{ options: { size: '99' } }, { options: { other: '1' } }, { rounds: 2 }]) assert.throws(() => inviteText({ game, code, server, terms: bad }));
});
test('a link with odd text is no invite, or one without rules', () => {
  for (const bad of ['', '#', '#x=1', '#avioane', '#avioane=abc', '#shikaku=ABCD2345', `#avioane=ABCD2345&by=${'x'.repeat(700)}`, null, undefined, 1]) assert.equal(readInvite(bad, [game]), null, String(bad));
  assert.equal(readInvite('#avioane=ABCD2345', [game]).terms, null);
  for (const odd of ['size=99&games=1', 'games=9', 'games=x']) assert.equal(readInvite(`#avioane=ABCD2345&${odd}`, [game]).terms, null, odd);
  assert.equal(readInvite('#avioane=ABCD2345&by=<b>', [game]).by, 'b');
});
test('WhatsApp gets the whole text and nothing else', () => {
  const text = inviteText({ game, code, server }), url = new URL(whatsappUrl(text));
  assert.deepEqual([url.origin, url.pathname, [...url.searchParams.keys()], url.hash], ['https://wa.me', '/', ['text'], '']);
  assert.equal(url.searchParams.get('text'), text);
});
