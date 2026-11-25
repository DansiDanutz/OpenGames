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
/* Every file of a folder, read once. What is hashed is what is served. */
export function readFiles(dir) {
  let bytes = 0;
  return new Map(listFiles(dir).map((f) => {
    const data = fs.readFileSync(path.join(dir, f));
    bytes += data.length;
    if (bytes > MAX_BYTES) throw new Error('the game is too large');
    return [f, data];
  }));
}
const hashFiles = (files) => sha256([...files].map(([f, data]) => `${f}\0${sha256(data)}`).join('\n'));
export const hashGame = (dir) => hashFiles(readFiles(dir));
const isOption = (o, text) => /^[a-z]{1,20}$/.test(o?.id ?? '') && text(o.label, 30) && Array.isArray(o.choices) && o.choices.length > 1 && o.choices.length <= 8
  && o.choices.every((c) => /^[a-z0-9]{1,20}$/.test(c?.id ?? '') && text(c.label, 30) && (c.note === undefined || text(c.note, 120)))
  && new Set(o.choices.map((c) => c.id)).size === o.choices.length && o.choices.some((c) => c.id === o.default);
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
    [Array.isArray(m.howto) && m.howto.length > 0 && m.howto.length <= 8 && m.howto.every((x) => text(x, 240)), 'howto must be 1 to 8 short rules'],
    [(m.options ?? []).length <= 4 && (m.options ?? []).every((o) => isOption(o, text)) && new Set((m.options ?? []).map((o) => o.id)).size === (m.options ?? []).length, 'options are not well formed'],
    [Number.isInteger(m.minutes) && m.minutes > 0 && m.minutes <= 240, 'minutes must be a whole number'],
    [/^[\w-]+\.html$/.test(m.page ?? '') && fs.existsSync(path.join(dir, m.page)), 'page is missing'],
    [/^[\w-]+\.(svg|png|webp)$/.test(m.icon ?? '') && fs.existsSync(path.join(dir, m.icon)), 'icon is missing (svg, png or webp)'],
    [/^[\w-]+\.js$/.test(m.rules ?? '') && fs.existsSync(path.join(dir, m.rules)), 'rules is missing'],
  ].filter(([ok]) => !ok).map(([, problem]) => problem);
  if (problems.length) throw new Error(problems.join('; '));
  return m;
}
/* Two computers only meet when the game and the shared kit are the same. `approved` (id -> hash of the
   game's files) names the only games that may be played; without it every game in the folder is listed. */
export function readLibrary(root, kit, approved = null) {
  const shared = readKit(kit);
  return fs.readdirSync(root, { withFileTypes: true }).filter((e) => e.isDirectory()).flatMap((e) => {
    const dir = path.join(root, e.name);
    try {
      const files = readFiles(dir), own = hashFiles(files);
      if (approved && approved[e.name] !== own) throw new Error('this version was not approved');
      const { id, name, version, author, license, summary, minutes, page, icon, rules, howto, options = [] } = readManifest(dir);
      if (id !== e.name) throw new Error('the folder must have the same name as the id');
      return [{ id, name, version, author, license, summary, minutes, howto, options, page, icon, rules, hash: sha256(`${own}|${shared.hash}`), dir, files }];
    } catch (error) {
      console.error(`The game in ${e.name} was left out: ${error.message}`);
      return [];
    }
  });
}
/* The part of the kit that game pages run. */
const PAGE_KIT = ['board3d.js', 'engine.js', 'sound.js', 'table.css', 'three.js', 'ui.js'];
export function readKit(kit) {
  const files = new Map(PAGE_KIT.map((f) => [f, fs.readFileSync(path.join(kit, f))]));
  return { files, hash: hashFiles(files) };
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
