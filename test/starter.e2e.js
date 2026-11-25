/* The starter, as a creator gets it, played alone in a real window. It is taken away again at the end. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { newGame } from '../tools/new-game.js';

const dir = newGame({ id: 'starter-try', name: 'Starter Try', author: 'some-one' });
try {
  const { open, closeAll, choose, row, status, inGame } = await import('./windows.js');
  try {
    const ann = await open('Ann');
    for (const size of ['5', '7']) {
      await row(ann, 'starter-try').getByText('Play alone').click();
      await choose(ann, { options: { size } });
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
    assert.deepEqual(ann.errors, []);
    console.log('STARTER OK');
  } finally { await closeAll(); }
} finally { fs.rmSync(dir, { recursive: true }); }
