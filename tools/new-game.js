/* Starts a new game from the starter: node tools/new-game.js <id> "<Name>" <github-name> */
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.join(import.meta.dirname, '..');
export function newGame({ id, name, author, games = path.join(ROOT, 'games') }) {
  if (!/^[a-z][a-z0-9-]{1,39}$/.test(id ?? '')) throw new Error('the id must be lower-case letters, numbers and dashes, and start with a letter');
  if (!/^[\p{L}\p{N}][\p{L}\p{N} '&!?.-]{0,39}$/u.test(name ?? '')) throw new Error('the name must be 1 to 40 letters, numbers and spaces');
  if (!/^[a-z\d](?:[a-z\d]|-(?=[a-z\d])){0,38}$/i.test(author ?? '')) throw new Error('the author must be a GitHub name');
  const dir = path.join(games, id);
  if (fs.existsSync(dir)) throw new Error(`games/${id} is already there`);
  fs.cpSync(path.join(ROOT, 'tools/starter'), dir, { recursive: true });
  const edit = (file, change) => { const at = path.join(dir, file); fs.writeFileSync(at, change(fs.readFileSync(at, 'utf8'))); };
  edit('game.json', (text) => `${JSON.stringify({ ...JSON.parse(text), id, name, author }, null, 2)}\n`);
  edit('index.html', (text) => text.replaceAll('Starter', () => name.replaceAll('&', '&amp;')));
  edit('LICENSE', (text) => text.replace('@AUTHOR@', () => author));
  return dir;
}

if (process.argv[1] === import.meta.filename) {
  try {
    const [id, name, author] = process.argv.slice(2);
    newGame({ id, name, author });
    console.log(`Made games/${id}. Change rules.js and page.js, then run: node kit/check.js games/${id}`);
  } catch (error) {
    console.error(`Not made: ${error.message}. Use: node tools/new-game.js <id> "<Name>" <github-name>`);
    process.exitCode = 1;
  }
}
