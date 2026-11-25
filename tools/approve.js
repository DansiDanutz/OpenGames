/* Approves the games in games/ after a person has read them: node tools/approve.js <id> ...
   An installed app plays only what library.lock.json names. `--check` says whether every game is approved; the
   pull request of a creator stays red there until a person has read the game. */
import fs from 'node:fs';
import path from 'node:path';
import { hashGame } from '../app/library.js';
import { checkGame } from '../kit/check.js';

const ROOT = path.join(import.meta.dirname, '..'), LOCK = path.join(ROOT, 'library.lock.json');
const ids = process.argv.slice(2);
if (ids[0] === '--check') {
  const lock = JSON.parse(fs.readFileSync(LOCK, 'utf8')), here = fs.readdirSync(path.join(ROOT, 'games'));
  const wrong = [...here.filter((id) => lock[id] !== hashGame(path.join(ROOT, 'games', id))), ...Object.keys(lock).filter((id) => !here.includes(id))];
  console.log(wrong.length ? `Not approved yet: ${wrong.join(', ')}.` : 'Every game is approved.');
  process.exit(wrong.length ? 1 : 0);
}
if (!ids.length) { console.error('Name the games you have read.'); process.exit(1); }
const checked = ids.map((id) => {
  if (!/^[a-z0-9-]{1,40}$/.test(id)) throw new Error(`not a game: ${id}`);
  return [id, checkGame(path.join(ROOT, 'games', id)).hash];
});
const old = fs.existsSync(LOCK) ? JSON.parse(fs.readFileSync(LOCK, 'utf8')) : {};
const next = Object.fromEntries(Object.entries({ ...old, ...Object.fromEntries(checked) }).sort());
fs.writeFileSync(LOCK, `${JSON.stringify(next, null, 2)}\n`);
console.log(`Approved: ${ids.join(', ')}.`);
