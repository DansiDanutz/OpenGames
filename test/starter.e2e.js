/* The starter, as a creator gets it, played alone in a real window. It is taken away again at the end. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { newGame } from '../tools/new-game.js';

import path from 'node:path';

const dir = newGame({ id: 'starter-try', name: 'Starter Try', author: 'some-one' });
fs.writeFileSync(path.join(dir, 'creator.json'), JSON.stringify({ support: 'https://ko-fi.com/some_one', sponsor: { name: 'Puzzle Shop', text: 'Wooden puzzles made by hand', url: 'https://puzzles.example.com/' } }));
try {
  const { open, closeAll, enter, row, status, inGame, shot } = await import('./windows.js');
  try {
    const ann = await open('Ann');
    for (const size of ['5', '7']) {
      await enter(ann, 'starter-try', { options: { size } });
      await ann.page.click('#solo');
      await status(ann, /^Playing$/);
      const isOver = async () => /You (win|lose)/.test(await ann.page.textContent('#status'));
      for (const end = Date.now() + 60_000; !(await isOver()) && Date.now() < end;) {
        assert.match(await inGame(ann, "document.getElementById('whose').textContent"), /^(Your turn|Computer: their turn|You win|You lose)$/);
        await inGame(ann, "document.querySelector('#cells button[aria-disabled=false]')?.click()");
        await new Promise((r) => setTimeout(r, 120));
      }
      assert.ok(await isOver(), `the ${size} board did not end`);
      await ann.page.click('#leave');
    }
    // Support and sponsor: nothing opens without a yes, and only the approved address.
    await ann.app.evaluate(({ dialog, shell }) => {
      globalThis.said = []; globalThis.opened = []; globalThis.answer = 1;
      dialog.showMessageBox = async (_win, box) => { globalThis.said.push(`${box.message} ${box.detail}`); return { response: globalThis.answer }; };
      shell.openExternal = async (url) => { globalThis.opened.push(url); };
    });
    const opened = () => ann.app.evaluate(() => globalThis.opened), card = row(ann, 'starter-try');
    assert.match(await card.textContent(), /Sponsor\s*Puzzle Shop: Wooden puzzles made by hand/);
    await card.getByText('Support the creator').click();
    await ann.page.waitForTimeout(300);
    assert.deepEqual(await opened(), []);
    await ann.app.evaluate(() => { globalThis.answer = 0; });
    await card.getByText('Support the creator').click();
    await ann.page.waitForTimeout(300);
    await card.getByText('Puzzle Shop').click();
    await ann.page.waitForTimeout(300);
    assert.deepEqual(await opened(), ['https://ko-fi.com/some_one', 'https://puzzles.example.com/']);
    assert.match((await ann.app.evaluate(() => globalThis.said))[0], /Open ko-fi\.com\?.*does not belong to OpenGames/s);
    for (const [id, kind] of [['starter-try', 'https://evil.example'], ['nothing', 'support'], ['shikaku', 'support'], ['__proto__', 'sponsor']]) {
      assert.equal(await ann.page.evaluate(([i, k]) => globalThis.desk.openLink(i, k).then(() => 'opened', () => 'refused'), [id, kind]), 'refused');
    }
    assert.equal((await opened()).length, 2);
    await shot(ann, 'sponsor');
    assert.deepEqual(ann.errors, []);
    console.log('STARTER OK');
  } finally { await closeAll(); }
} finally { fs.rmSync(dir, { recursive: true }); }
