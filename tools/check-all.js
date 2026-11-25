/* Checks every game in games/, also one that was just added. */
import fs from 'node:fs';
import path from 'node:path';
import { checkGame } from '../kit/check.js';

const GAMES = path.join(import.meta.dirname, '..', 'games');
for (const { name } of fs.readdirSync(GAMES, { withFileTypes: true }).filter((e) => e.isDirectory())) {
  try {
    const r = checkGame(path.join(GAMES, name));
    if (r.id !== name) throw new Error('the folder must have the same name as the id');
    console.log(`${r.id} passed: ${r.matches} matches, won ${r.wins.join(' to ')}. Version ${r.hash.slice(0, 12)}.`);
  } catch (error) {
    console.error(`${name} was not accepted: ${error.message}`);
    process.exitCode = 1;
  }
}
