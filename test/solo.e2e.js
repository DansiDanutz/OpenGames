/* Every game alone against the computer, in a real window, with the match server switched off. */
import assert from 'node:assert/strict';
import { choose, closeAll, inGame, open, row, server, shot, status } from './windows.js';

const press = `(board, r0, c0, r1, c1) => {
  const ev = (type, r, c) => { const { x, y } = board.pointOf(r, c); board.dispatchEvent(new PointerEvent(type, { bubbles: true, pointerId: 1, buttons: 1, clientX: x, clientY: y })); };
  board.setPointerCapture = () => {};
  ev('pointerdown', r0, c0); ev('pointermove', r1, c1); ev('pointerup', r1, c1);
}`;
const SHOOT = `(cell, n) => { const b = document.getElementById('theirs'), { x, y } = b.pointOf(Math.floor(cell / n), cell % n);
  b.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerId: 1, button: 0, buttons: 1, clientX: x, clientY: y })); }`;
const text = (p, id) => inGame(p, `document.getElementById('${id}').textContent`);
const over = async (p) => /You win|You lose/.test(await p.page.textContent('#status'));
async function until(what, check, ms = 9000) {
  const end = Date.now() + ms;
  while (!(await check())) { if (Date.now() > end) throw new Error(`waited for ${what}`); await new Promise((r) => setTimeout(r, 40)); }
}
async function begin(p, game, rules) {
  await row(p, game).getByText('Play alone').click();
  await p.page.waitForSelector('#setup:not([hidden])');
  assert.equal(await p.page.isVisible('#rankedPart'), false);
  await choose(p, rules);
  await status(p, /^Playing$/);
  assert.equal(await p.page.textContent('#mode'), 'Against the computer');
  assert.ok(!/[Rr]anked/.test(await p.page.textContent('#rules')));
  assert.deepEqual(await Promise.all(['#p0', '#p1'].map((id) => p.page.textContent(id))), ['Ann (you)', 'Computer']);
}
const back = async (p) => { await p.page.click('#leave'); await p.page.waitForSelector('#library:not([hidden])'); };

/* Best of three: the seats change, so the computer also starts a game. */
async function shikaku(p) {
  await begin(p, 'shikaku', { options: { size: '5', level: 'easy' }, rounds: 3 });
  for (const round of [1, 2]) {
    await until('the next board', async () => { const b = await inGame(p, "document.getElementById('board').inspect()"); return b.puzzle.length === 5 && !b.rects.length; }, 12000);
    await inGame(p, `import('./rules.js').then(({ solve }) => { const b = document.getElementById('board'); for (const x of solve(b.inspect().puzzle)) (${press})(b, x.r0, x.c0, x.r1, x.c1); })`);
    await until('the score', async () => (await p.page.textContent('#score')) === `${round} : 0`);
  }
  await status(p, /^You win\./);
}
async function gemhold(p) {
  await begin(p, 'gemhold', { options: { size: '5', level: 'easy' } });
  for (let n = 0; n < 40 && !(await over(p)); n++) {
    await until('my turn', async () => (await over(p)) || (await text(p, 'whose')) === 'Your turn');
    if (await over(p)) break;
    const before = (await inGame(p, "document.getElementById('board').inspect()")).view.blocks.length;
    await inGame(p, `import('./rules.js').then((rules) => { const board = document.getElementById('board'), { view, me } = board.inspect(), { rect } = rules.bot(view, me, Math.random); (${press})(board, rect.r0, rect.c0, rect.r1, rect.c1); })`);
    await until('my block', async () => (await over(p)) || (await inGame(p, "document.getElementById('board').inspect()")).view.blocks.length > before);
    if (n === 2) { await p.page.waitForTimeout(1200); await shot(p, 'solo-gemhold'); }
  }
  await status(p, /^You (win|lose)\./);
}
async function avioane(p) {
  await begin(p, 'avioane', { options: { size: '8', level: 'easy' } });
  await inGame(p, "document.getElementById('go').click()");
  let shots = 0;
  for (; shots < 64 && !(await over(p)); shots++) {
    await until('my shot', async () => (await over(p)) || /^Your shot/.test(await text(p, 'whose')));
    if (await over(p)) break;
    const { view, me } = await inGame(p, "document.getElementById('mine').inspect()");
    await inGame(p, `(${SHOOT})(${view.board[1 - me].indexOf('')}, 8)`);
    if (shots === 6) await shot(p, 'solo-avioane');
  }
  await status(p, /^You (win|lose)\./);
  assert.ok(shots > 5);
  // The computer's fleet was shown and checked when it won; when it lost, mine was.
  assert.match(await text(p, 'say'), /honest|fleet/i);
}
try {
  const ann = await open('Ann');
  await server.close();                                 // no server: alone means without internet
  for (const game of [shikaku, gemhold, avioane]) { await game(ann); await back(ann); console.log(`${game.name} alone OK`); }
  await begin(ann, 'gemhold', { options: { size: '5', level: 'hard' } });
  await ann.page.click('#leave');
  await status(ann, /^You gave up\./);
  await back(ann);
  for (const game of ['shikaku', 'gemhold', 'avioane']) assert.match(await row(ann, game).textContent(), /against the computer/);
  assert.ok(!/on this computer/.test(await ann.page.textContent('#games')));
  await ann.page.setViewportSize?.({ width: 360, height: 760 }).catch(() => {});
  await shot(ann, 'solo-library');
  await row(ann, 'shikaku').getByText('Find a player').click();
  await choose(ann);
  await ann.page.waitForSelector('#library:not([hidden])');
  assert.match(await ann.page.textContent('#notice'), /cannot be reached/);
  assert.deepEqual(ann.errors.filter((e) => !/ERR_CONNECTION_REFUSED|WebSocket/.test(e)), []);
  console.log('SOLO OK');
} finally {
  await closeAll();
}
