import test from 'node:test';
import assert from 'node:assert/strict';
import { inviteText, isCode, whatsappUrl } from '../app/invite.js';

const game = { id: 'avioane', name: 'Avioane & Bărcuțe' }, code = 'ABCD2345';
test('an invite names the game, the code and the page of the game', () => {
  const text = inviteText({ game, code, server: 'wss://play.example.org' });
  for (const part of ['Avioane & Bărcuțe', code, '10 minutes', 'https://play.example.org/play#avioane=ABCD2345']) assert.ok(text.includes(part), part);
});
test('the browser version sends the same link', () => {
  assert.equal(inviteText({ game, code, server: 'https://play.example.org' }), inviteText({ game, code, server: 'wss://play.example.org' }));
});
test('a server without a secure address is not named', () => {
  assert.doesNotMatch(inviteText({ game, code, server: 'ws://127.0.0.1:4310' }), /https?:/);
});
test('only a code of the match server can be sent', () => {
  for (const bad of [undefined, null, 1, '', 'ABCD234', 'ABCD23456', 'abcd2345', 'ABCD234O', 'ABCD 345', 'ABCD2345\n', { toString: () => code }]) {
    assert.equal(isCode(bad), false);
    assert.throws(() => inviteText({ game, code: bad, server: 'wss://play.example.org' }), /not a code/);
  }
});
test('WhatsApp gets the whole text and nothing else', () => {
  const text = inviteText({ game, code, server: 'wss://play.example.org' }), url = new URL(whatsappUrl(text));
  assert.deepEqual([url.origin, url.pathname, [...url.searchParams.keys()], url.hash], ['https://wa.me', '/', ['text'], '']);
  assert.equal(url.searchParams.get('text'), text);
});
