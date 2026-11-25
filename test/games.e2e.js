/* Every other game, played to the end in two real app windows. */
import assert from 'node:assert/strict';
import { closeAll, enter, inGame, invite, open, row, shot, status } from './windows.js';

const press = `(board, r0, c0, r1, c1) => {
  const ev = (type, r, c) => { const { x, y } = board.pointOf(r, c); board.dispatchEvent(new PointerEvent(type, { bubbles: true, pointerId: 1, buttons: 1, clientX: x, clientY: y })); };
  board.setPointerCapture = () => {};
  ev('pointerdown', r0, c0); ev('pointermove', r1, c1); ev('pointerup', r1, c1);
}`;
const inspect = (p, id) => inGame(p, `document.getElementById('${id}').inspect()`);
const text = (p, id) => inGame(p, `document.getElementById('${id}').textContent`);
const over = async (p) => /You win|You lose/.test(await p.page.textContent('#status'));
async function until(what, check, ms = 8000) {
  const end = Date.now() + ms;
  while (!(await check())) { if (Date.now() > end) throw new Error(`waited for ${what}`); await new Promise((r) => setTimeout(r, 25)); }
}
async function widths(p, ids) {
  for (const width of [360, 1080]) {
    await p.app.evaluate(({ BrowserWindow }, w) => BrowserWindow.getAllWindows()[0].setContentSize(w, 760), width);
    await p.page.waitForTimeout(300);
    assert.ok(await inGame(p, `document.documentElement.scrollWidth <= innerWidth && ${JSON.stringify(ids)}.every((id) => document.getElementById(id).getBoundingClientRect().right <= innerWidth)`), `cut off at ${width}px`);
    await shot(p, `game-${ids[0]}-${width}`);
  }
}
/* Plays one block, chosen by the game's own bot from what the page shows. */
const block = `import('./rules.js').then((rules) => {
  const board = document.getElementById('board'), { view, me } = board.inspect(), { rect } = rules.bot(view, me, Math.random);
  (${press})(board, rect.r0, rect.c0, rect.r1, rect.c1);
})`;
const WIN = /^You (win|lose)\./;
async function gemhold(ann, bob) {
  await invite(ann, bob, 'gemhold', { options: { size: '7', level: 'hard' }, expect: /7 × 7.*Hard.*Rocks.*Heads-up/s });
  const count = async (p) => (await inspect(p, 'board')).view.blocks.length;
  await inGame(bob, `(${press})(document.getElementById('board'), 3, 3, 3, 3)`);
  assert.match(await text(bob, 'say'), /Not there|corner/);
  for (let n = 0; !(await over(ann)) && n < 60; n++) {
    const who = (await text(ann, 'whose')) === 'Your turn' ? ann : bob, before = await count(who);
    if (n === 8) { await ann.page.waitForTimeout(900); await shot(ann, 'gemhold'); await widths(ann, ['board', 'score', 'stock']); }
    await inGame(who, block);
    await until('the block on both screens', async () => (await count(ann)) > before && (await count(bob)) > before);
  }
  await Promise.all([ann, bob].map((p) => status(p, WIN)));
  assert.notEqual((await ann.page.textContent('#status')).slice(0, 8), (await bob.page.textContent('#status')).slice(0, 8));
  assert.match(await text(ann, 'say'), /gem colours to/);
  // A ranked result reaches the leaderboard, and the player sees the points.
  await status(ann, /points\./);
  await shot(ann, 'gemhold-over');
}
const SHOOT = `(cell, n) => { const b = document.getElementById('theirs'), { x, y } = b.pointOf(Math.floor(cell / n), cell % n);
  b.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerId: 1, button: 0, buttons: 1, clientX: x, clientY: y })); }`;
async function avioane(ann, bob) {
  await invite(ann, bob, 'avioane', { options: { size: '10', level: 'easy' }, expect: /10 × 10.*Easy/s });
  await ann.page.waitForTimeout(1200);
  await shot(ann, 'avioane-hide');
  await widths(ann, ['mine', 'go']);
  const placed = (await inspect(bob, 'mine')).fleet;
  assert.equal(placed.length, 5);
  await inGame(bob, "document.getElementById('mix').click(); document.getElementById('turn').click(); document.getElementById('mix').click()");
  assert.notDeepEqual((await inspect(bob, 'mine')).fleet, placed);
  for (const p of [ann, bob]) await inGame(p, "document.getElementById('go').click()");
  await until('the first shot', async () => /shot/i.test(await text(ann, 'whose')) && /shot/i.test(await text(bob, 'whose')));
  // Nothing on Ann's computer shows where Bob's fleet is.
  assert.ok(!/plane|boat/.test(JSON.stringify((await inspect(ann, 'mine')).view)));
  const first = /^Your shot/.test(await text(ann, 'whose')) ? ann : bob, second = first === ann ? bob : ann;
  // The first player knows where to shoot only because this test looks at the other window.
  const cellsIn = (p) => inGame(p, "import('./rules.js').then((rules) => document.getElementById('mine').inspect().fleet.map((x) => ({ kind: x.kind, cells: rules.cellsOf(10, x) })))");
  const targets = (await cellsIn(second)).flatMap((x) => (x.kind === 'plane' ? [x.cells[0]] : x.cells));
  const own = new Set((await cellsIn(first)).flatMap((x) => x.cells)), empty = Array.from({ length: 100 }, (_, i) => i).filter((i) => !own.has(i));
  for (const [n, cell] of targets.entries()) {
    await until('the first player\u2019s turn', async () => /^Your shot/.test(await text(first, 'whose')));
    await inGame(first, `(${SHOOT})(${cell}, 10)`);
    if (n === targets.length - 1) break;
    await until('the second player\u2019s turn', async () => /^Your shot/.test(await text(second, 'whose')));
    await inGame(second, `(${SHOOT})(${empty[n * 5]}, 10)`);
    if (n === 4) { await until('a turn', async () => /^Your shot/.test(await text(first, 'whose'))); await first.page.waitForTimeout(250); await shot(first, 'avioane'); await widths(first, ['theirs', 'mine']); }
  }
  await Promise.all([status(first, /^You win\./), status(second, /^You lose\./)]);
  assert.match(await text(second, 'say'), /checked and it was honest/);
  await first.page.waitForTimeout(500);
  await shot(first, 'avioane-over');
}
/* Best of three on the largest board: the seats change, and two games decide it. */
async function shikakuSeries(ann, bob) {
  await invite(ann, bob, 'shikaku', { options: { size: '10', level: 'hard' }, rounds: 3, expect: /10 × 10.*Hard.*Best of three/s });
  const solve = (p) => inGame(p, `import('./rules.js').then(({ solve }) => { const b = document.getElementById('board'); for (const x of solve(b.inspect().puzzle)) (${press})(b, x.r0, x.c0, x.r1, x.c1); })`);
  for (const round of [0, 1]) {
    await until('the next board', async () => [ann, bob].length === (await Promise.all([ann, bob].map((p) => inspect(p, 'board')))).filter((x) => x.puzzle.length === 10 && x.rects.length === 0).length, 12000);
    if (!round) { await ann.page.waitForTimeout(1200); await shot(ann, 'shikaku-10'); await widths(ann, ['board', 'clear']); }
    await solve(bob);
    await until('the score', async () => (await ann.page.textContent('#score')) === `0 : ${round + 1}`);
    if (!round) await shot(bob, 'shikaku-round');
  }
  await Promise.all([status(bob, /^You win\./), status(ann, /^You lose\./)]);
  await shot(bob, 'shikaku-over');
}
async function boards(ann) {
  await row(ann, 'gemhold').getByText('Leaderboard').click();
  await ann.page.waitForSelector('#boardTable:not([hidden])');
  const rows = await ann.page.locator('#boardRows tr').allTextContents();
  assert.equal(rows.length, 2);
  assert.ok(rows.some((r) => /Ann \(you\)/.test(r)) && rows.some((r) => /1216/.test(r)));
  await shot(ann, 'leaderboard');
  await ann.page.click('#boardBack');
  await row(ann, 'avioane').getByText('Leaderboard').click();
  await ann.page.waitForSelector('#boardTable:not([hidden])');
  await ann.page.click('#boardBack');
}
async function declined(ann, bob) {
  await enter(ann, 'shikaku');
  await ann.page.click('#find');
  await enter(bob, 'shikaku');
  await bob.page.click('#find');
  const joiner = await Promise.race([ann, bob].map((p) => p.page.waitForSelector('#terms:not([hidden])').then(() => p)));
  await joiner.page.click('#termsNo');
  await Promise.all([ann, bob].map((p) => p.page.waitForSelector('#library:not([hidden])')));
}
try {
  const [ann, bob] = [await open('Ann'), await open('Bob')];
  await shot(ann, 'library');
  for (const game of [gemhold, avioane, shikakuSeries]) {
    await game(ann, bob);
    for (const p of [ann, bob]) await p.page.click('#leave');
    console.log(`${game.name} OK`);
  }
  await boards(ann);
  await declined(ann, bob);
  console.log('leaderboards and declined rules OK');
  assert.deepEqual([...ann.errors, ...bob.errors], []);
  console.log('GAMES OK');
} finally {
  await closeAll();
}
