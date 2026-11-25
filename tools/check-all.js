/* Checks every game in games/, also one that was just added. */
import fs from 'node:fs';
import path from 'node:path';
import { checkGame } from '../kit/check.js';

export function checkAll(games) {
  let isOk = true;
  for (const entry of fs.readdirSync(games, { withFileTypes: true })) {
    const { name } = entry;
    try {
      if (!entry.isDirectory()) throw new Error('it is not a folder');
      const r = checkGame(path.join(games, name));
      if (r.id !== name) throw new Error('the folder must have the same name as the id');
      console.log(`${r.id} passed: ${r.matches} matches, won ${r.wins.join(' to ')}. Version ${r.hash.slice(0, 12)}.`);
    } catch (error) {
      console.error(`${name} was not accepted: ${error.message}`);
      isOk = false;
    }
  }
  return isOk;
}
if (process.argv[1] === import.meta.filename && !checkAll(path.join(import.meta.dirname, '..', 'games'))) process.exitCode = 1;
