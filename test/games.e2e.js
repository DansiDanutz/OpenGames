/* Every other game, played to the end in two real app windows. */
import assert from 'node:assert/strict';
import { closeAll, inGame, invite, open, shot, status } from './windows.js';

const press = `(board, r0, c0, r1, c1, n) => {
  const box = board.getBoundingClientRect(), s = box.width / n;
  const ev = (type, r, c) => board.dispatchEvent(new PointerEvent(type, { bubbles: true, pointerId: 1, buttons: 1, clientX: box.left + (c + .5) * s, clientY: box.top + (r + .5) * s }));
  board.setPointerCapture = () => {};
  ev('pointerdown', r0, c0); ev('pointermove', r1, c1); ev('pointerup', r1, c1);
}`;
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
  const board = document.getElementById('board'), n = rules.SIZE, size = board.getBoundingClientRect().width / n;
  const gems = [...board.querySelectorAll('.cell')].map((c) => Number(c.dataset.gem)), owner = gems.map(() => -1);
  const blocks = [...board.querySelectorAll('.rect')].map((b) => {
    const at = (v) => Math.round(parseFloat(v) / 100 * n), r0 = at(b.style.top), c0 = at(b.style.left);
    return { player: b.classList.contains('p1') ? 1 : 0, r0, c0, r1: r0 + at(b.style.height) - 1, c1: c0 + at(b.style.width) - 1 };
  });
  const stock = [0, 1].map(() => ({ ...rules.STOCK }));
  for (const b of blocks) { rules.cells(b).forEach((i) => { owner[i] = b.player; }); stock[b.player][rules.sizeOf(b)]--; }
  const me = /orange/.test(document.getElementById('stock').dataset.side) ? 0 : 1;
  const { rect } = rules.bot({ gems, owner, stock, blocks, turn: me }, me, Math.random);
  (${press})(board, rect.r0, rect.c0, rect.r1, rect.c1, n);
  return blocks.length;
})`;
async function gemhold(ann, bob) {
  await invite(ann, bob, 'gemhold');
  for (const p of [ann, bob]) await inGame(p, "document.getElementById('stock').dataset.side = /orange/.test(document.getElementById('say').textContent) ? 'orange' : 'blue'");
  const count = (p) => inGame(p, "document.querySelectorAll('.rect').length");
  await inGame(bob, `(${press})(document.getElementById('board'), 3, 3, 3, 3, 7)`);
  assert.match(await text(bob, 'say'), /Not there|corner/);
  for (let n = 0; !(await over(ann)) && n < 60; n++) {
    const who = (await text(ann, 'whose')) === 'Your turn' ? ann : bob;
    const before = await count(who);
    if (n === 8) { await shot(ann, 'gemhold'); await widths(ann, ['board', 'score', 'stock']); }
    await inGame(who, block);
    await until('the block on both screens', async () => (await count(ann)) > before && (await count(bob)) > before);
  }
  await Promise.all([ann, bob].map((p) => status(p, /^You (win|lose)\.$/)));
  assert.notEqual(await ann.page.textContent('#status'), await bob.page.textContent('#status'));
  assert.match(await text(ann, 'say'), /gem colours to/);
  await shot(ann, 'gemhold-over');
}
const SHOOT = `(cell) => { const b = document.getElementById('theirs'), box = b.getBoundingClientRect(), s = box.width / 10;
  b.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerId: 1, button: 0, buttons: 1, clientX: box.left + (cell % 10 + .5) * s, clientY: box.top + (Math.floor(cell / 10) + .5) * s })); }`;
async function avioane(ann, bob) {
  await invite(ann, bob, 'avioane');
  await shot(ann, 'avioane-hide');
  await widths(ann, ['mine', 'go']);
  const mine = (p) => inGame(p, "[...document.querySelectorAll('#mine .cell')].map((c) => c.className)");
  const placed = await mine(bob);
  assert.equal(placed.filter((c) => /plane|boat/.test(c)).length, 29);
  await inGame(bob, "document.getElementById('mix').click(); document.getElementById('turn').click(); document.getElementById('mix').click()");
  assert.notDeepEqual(await mine(bob), placed);
  for (const p of [ann, bob]) await inGame(p, "document.getElementById('go').click()");
  await until('the first shot', async () => /shot/i.test(await text(ann, 'whose')) && /shot/i.test(await text(bob, 'whose')));
  // Nothing on Ann's computer shows where Bob's fleet is.
  assert.equal(await inGame(ann, "document.querySelectorAll('#theirs .plane, #theirs .boat').length"), 0);
  const first = /^Your shot/.test(await text(ann, 'whose')) ? ann : bob, second = first === ann ? bob : ann;
  // The first player knows where to shoot only because this test looks at the other window.
  const fleet = await mine(second);
  const targets = fleet.flatMap((c, i) => (/head/.test(c) || /boat/.test(c) ? [i] : []));
  const own = await mine(first), empty = own.flatMap((c, i) => (/plane|boat/.test(c) ? [] : [i]));
  for (const [n, cell] of targets.entries()) {
    await until('the first player\u2019s turn', async () => /^Your shot/.test(await text(first, 'whose')));
    await inGame(first, `(${SHOOT})(${cell})`);
    if (n === targets.length - 1) break;
    await until('the second player\u2019s turn', async () => /^Your shot/.test(await text(second, 'whose')));
    await inGame(second, `(${SHOOT})(${empty[n]})`);
    if (n === 4) { await until('a turn', async () => /^Your shot/.test(await text(first, 'whose'))); await shot(first, 'avioane'); await widths(first, ['theirs', 'mine']); }
  }
  await Promise.all([status(first, /^You win\.$/), status(second, /^You lose\.$/)]);
  assert.match(await text(second, 'say'), /checked and it was honest/);
  await shot(first, 'avioane-over');
}
try {
  const [ann, bob] = [await open('Ann'), await open('Bob')];
  await shot(ann, 'library');
  for (const game of [gemhold, avioane]) {
    await game(ann, bob);
    for (const p of [ann, bob]) await p.page.click('#leave');
    console.log(`${game.name} OK`);
  }
  assert.deepEqual([...ann.errors, ...bob.errors], []);
  console.log('GAMES OK');
} finally {
  await closeAll();
}
