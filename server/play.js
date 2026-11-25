/* The app in a browser: the same window, the same games, the same match server. A game runs in a sandboxed frame
   with an origin of its own, so it reaches neither the player's key nor the network. */
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { TYPES, readKit } from '../app/library.js';

const ROOT = path.join(import.meta.dirname, '..');
const SHELL_POLICY = "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self'; font-src 'self'; connect-src 'self' HOST; frame-src 'self'; manifest-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";
const GAME_POLICY = "sandbox allow-scripts; default-src 'none'; script-src 'self' HOST; style-src 'self' HOST 'unsafe-inline'; img-src 'self' HOST data:; font-src 'self' HOST; media-src 'self' HOST; connect-src 'none'; frame-src 'none'; worker-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'self'";
const FILE_POLICY = "default-src 'none'; style-src 'unsafe-inline'; sandbox";   // a picture opened as a page runs nothing
const MANIFEST = { name: 'OpenGames', short_name: 'OpenGames', description: 'Open-source games for two players.', id: '/play', start_url: '/play', scope: '/', display: 'standalone', background_color: '#100a20', theme_color: '#100a20',
  icons: [192, 512].map((n) => ({ src: `/web/icon-${n}.png`, sizes: `${n}x${n}`, type: 'image/png' })) };
const HOST = /^[a-z0-9.-]{1,253}(:\d{1,5})?$/i;
const MIN_GZIP = 1024;
const read = (file) => fs.readFileSync(path.join(ROOT, file));

/* Replaces one piece of text that has to be there exactly once. */
export function swap(text, from, to) {
  if (text.split(from).length !== 2) throw new Error(`expected once: ${from}`);
  return text.replace(from, () => to);
}
function shellPage() {
  let html = read('app/shell/index.html').toString();
  html = swap(html, '<link rel="stylesheet" href="shell.css">', '<link rel="stylesheet" href="/app/shell/shell.css"><link rel="stylesheet" href="/web/web.css"><link rel="manifest" href="/web/manifest.json"><link rel="icon" href="/web/icon-192.png"><link rel="apple-touch-icon" href="/web/icon-192.png"><meta name="theme-color" content="#100a20">');
  html = swap(html, '<div class="right">', '<div class="right"><button id="install" type="button" class="go" hidden>Install the app</button>');
  html = swap(html, '<main id="library">', '<p id="installHelp" hidden>Tap the Share button of your browser, then “Add to Home Screen”.</p>\n<main id="library">');
  return swap(html, '<script type="module" src="shell.js"></script>', '<script type="module" src="/web/desk.js"></script><script type="module" src="/app/shell/shell.js"></script>');
}
/* Before anything of the game: what is first in the page runs first. */
export function gamePage(data) {
  const html = data.toString(), doctype = /^\s*<!doctype html>/i.exec(html)?.[0] ?? '';
  return `${doctype}<script src="/web/game.js"></script>${html.slice(doctype.length)}`;
}

function asset(name, data, policy = null, headers = {}) {
  const body = Buffer.from(data), type = TYPES[path.extname(name)];
  const isText = !/^(image\/(png|webp)|font|audio)/.test(type);
  return { body, gzip: isText && body.length >= MIN_GZIP ? gzipSync(body, { level: 9 }) : null, policy, tag: `"${createHash('sha256').update(body).digest('hex').slice(0, 32)}"`,
    headers: { 'content-type': type, 'cache-control': 'no-cache', vary: 'accept-encoding, host', 'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer', ...headers } };
}
/* Every file there is, read once, by its address. Nothing else can be asked for. */
function collect(games, kit, stunPort) {
  const OPEN = { 'access-control-allow-origin': '*' };       // a game's frame has no origin, so its own files count as foreign
  const all = new Map([
    ['/play', asset('play.html', shellPage(), SHELL_POLICY)],
    ['/app/invite.js', asset('invite.js', read('app/invite.js'))],
    ['/web/manifest.json', asset('manifest.json', JSON.stringify(MANIFEST))],
    ['/web/games.json', asset('games.json', JSON.stringify({ stunPort, games: games.map(({ dir, icon, rules, files, ...rest }) => rest) }))],
    ['/web/game.js', asset('game.js', read('web/game.js'), null, OPEN)],
  ]);
  for (const f of ['desk.js', 'web.css', 'icon-192.png', 'icon-512.png']) all.set(`/web/${f}`, asset(f, read(`web/${f}`)));
  for (const f of fs.readdirSync(path.join(ROOT, 'app/shell'))) if (f.endsWith('.js') || f.endsWith('.css')) all.set(`/app/shell/${f}`, asset(f, read(`app/shell/${f}`)));
  for (const [f, data] of kit) all.set(`/kit/${f}`, asset(f, data, null, OPEN));
  for (const g of games) {
    all.set(`/icons/${g.id}`, asset(g.icon, g.files.get(g.icon), FILE_POLICY));
    for (const [f, data] of g.files) {
      if (!TYPES[path.extname(f)]) continue;
      const isPage = path.extname(f) === '.html';         // every page a game could go to is locked the same way
      all.set(`/table/${g.id}/${f}`, isPage ? asset(f, gamePage(data), GAME_POLICY, OPEN) : asset(f, data, FILE_POLICY, OPEN));
    }
  }
  return all;
}

/* games: from readLibrary. Answers like createSite. */
export function createPlay({ games, stunPort = null }) {
  const all = collect(games, readKit(path.join(ROOT, 'kit')).files, stunPort);
  const play = (pathname, headers = {}) => {
    const a = all.get(pathname);
    if (!a) return null;
    const host = HOST.test(headers.host ?? '') ? headers.host : '';
    const own = { ...a.headers, etag: a.tag, ...(a.policy ? { 'content-security-policy': a.policy.replaceAll(' HOST', a.policy === SHELL_POLICY ? (host && ` wss://${host} ws://${host}`) : (host && ` ${host}`)) } : {}) };
    if (headers['if-none-match'] === a.tag) return { status: 304, headers: own, body: '' };
    if (a.gzip && /\bgzip\b/.test(headers['accept-encoding'] ?? '')) return { status: 200, headers: { ...own, 'content-encoding': 'gzip' }, body: a.gzip };
    return { status: 200, headers: own, body: a.body };
  };
  play.has = (pathname) => all.has(pathname);
  return play;
}
/* Several sets of pages as one. */
export function joinPages(...sets) {
  const pages = (pathname, headers) => sets.find((s) => s.has(pathname))?.(pathname, headers) ?? null;
  pages.has = (pathname) => sets.some((s) => s.has(pathname));
  return pages;
}
