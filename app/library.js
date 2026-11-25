/* The games that come with the app, and safe access to their files. */
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';

export const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.webp': 'image/webp', '.woff2': 'font/woff2', '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg' };
const MAX_FILES = 400, MAX_BYTES = 50 * 1024 * 1024;
const sha256 = (data) => createHash('sha256').update(data).digest('hex');

/* Every file of a game in a fixed order. Links and unknown file types are refused. */
export function listFiles(dir) {
  const out = [];
  const walk = (at, rel) => {
    for (const entry of fs.readdirSync(at, { withFileTypes: true })) {
      if (entry.name.startsWith('.')) throw new Error(`hidden file: ${rel}${entry.name}`);
      if (entry.isDirectory()) walk(path.join(at, entry.name), `${rel}${entry.name}/`);
      else if (!entry.isFile()) throw new Error(`not a plain file: ${rel}${entry.name}`);
      else if (entry.name !== 'LICENSE' && !TYPES[path.extname(entry.name)]) throw new Error(`file type not allowed: ${rel}${entry.name}`);
      else out.push(`${rel}${entry.name}`);
      if (out.length > MAX_FILES) throw new Error(`more than ${MAX_FILES} files`);
    }
  };
  walk(dir, '');
  return out.sort();
}
export function hashGame(dir) {
  let bytes = 0;
  const lines = listFiles(dir).map((f) => {
    const data = fs.readFileSync(path.join(dir, f));
    bytes += data.length;
    if (bytes > MAX_BYTES) throw new Error('the game is too large');
    return `${f}\0${sha256(data)}`;
  });
  return sha256(lines.join('\n'));
}
export function readManifest(dir) {
  const m = JSON.parse(fs.readFileSync(path.join(dir, 'game.json'), 'utf8'));
  const text = (v, max) => typeof v === 'string' && v.trim().length > 0 && v.length <= max;
  const problems = [
    [/^[a-z0-9-]{1,40}$/.test(m.id ?? ''), 'id must be lower-case letters, numbers and dashes'],
    [text(m.name, 40), 'name is missing or longer than 40 characters'],
    [/^\d+\.\d+\.\d+$/.test(m.version ?? ''), 'version must look like 1.0.0'],
    [text(m.author, 60), 'author is missing'],
    [text(m.license, 40), 'license is missing'],
    [text(m.summary, 160), 'summary is missing or longer than 160 characters'],
    [m.players?.min === 2 && m.players?.max === 2, 'every game must be for two players'],
    [Number.isInteger(m.minutes) && m.minutes > 0 && m.minutes <= 240, 'minutes must be a whole number'],
    [/^[\w-]+\.html$/.test(m.page ?? '') && fs.existsSync(path.join(dir, m.page)), 'page is missing'],
    [/^[\w-]+\.(svg|png|webp)$/.test(m.icon ?? '') && fs.existsSync(path.join(dir, m.icon)), 'icon is missing (svg, png or webp)'],
    [/^[\w-]+\.js$/.test(m.rules ?? '') && fs.existsSync(path.join(dir, m.rules)), 'rules is missing'],
  ].filter(([ok]) => !ok).map(([, problem]) => problem);
  if (problems.length) throw new Error(problems.join('; '));
  return m;
}
/* Two computers only meet when the game and the shared kit are the same. */
export function readLibrary(root, kit) {
  const shared = ['engine.js', 'ui.js'].map((f) => sha256(fs.readFileSync(path.join(kit, f)))).join('|');
  return fs.readdirSync(root, { withFileTypes: true }).filter((e) => e.isDirectory()).flatMap((e) => {
    const dir = path.join(root, e.name);
    try {
      const { id, name, version, author, license, summary, minutes, page, icon } = readManifest(dir);
      if (id !== e.name) throw new Error('the folder must have the same name as the id');
      return [{ id, name, version, author, license, summary, minutes, page, icon, hash: sha256(`${hashGame(dir)}|${shared}`), dir }];
    } catch (error) {
      console.error(`The game in ${e.name} was left out: ${error.message}`);
      return [];
    }
  });
}
/* The file behind a URL path, or null. It can never be outside `root`. */
export function resolveFile(root, urlPath) {
  let rel;
  try { rel = decodeURIComponent(urlPath); } catch { return null; }
  if (rel.includes('\0') || rel.includes('\\') || !TYPES[path.extname(rel)]) return null;
  try {
    const base = fs.realpathSync(root);
    const file = fs.realpathSync(path.join(base, rel));
    return file.startsWith(base + path.sep) && fs.statSync(file).isFile() ? file : null;
  } catch { return null; }
}
