import { app, BrowserWindow, WebContentsView, ipcMain, net, protocol, session } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { TYPES, readKit, readLibrary, resolveFile } from './library.js';

const ROOT = path.join(import.meta.dirname, '..');
/* Built into the installer (tools/pack.js); a developer may point at another server. */
const config = JSON.parse(fs.readFileSync(path.join(ROOT, 'app/config.json'), 'utf8'));
const SERVER = (!app.isPackaged && process.env.OPENGAMES_SERVER) || config.server;
const SHELL = 'og://platform/app/shell/index.html';
const MAX_MESSAGE = 32 * 1024, MAX_PER_SECOND = 200;
const NO_NETWORK_PROXY = '127.0.0.1:9';                   // nothing listens there
const SHELL_CSP = "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self'; font-src 'self'; connect-src ws://127.0.0.1:* ws://localhost:* wss:; base-uri 'none'; form-action 'none'";
const GAME_CSP = "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; media-src 'self'; connect-src 'none'; frame-src 'none'; worker-src 'none'; webrtc 'block'; base-uri 'none'; form-action 'none'";

if (process.env.OPENGAMES_DATA) app.setPath('userData', process.env.OPENGAMES_DATA);
app.enableSandbox();
// Names are only looked up for the match server and, for direct matches, on the local network.
app.commandLine.appendSwitch('host-resolver-rules', `MAP * ~NOTFOUND, EXCLUDE ${new URL(SERVER).hostname}, EXCLUDE 127.0.0.1, EXCLUDE localhost, EXCLUDE *.local`);
const privileges = { standard: true, secure: true, supportFetchAPI: true };
protocol.registerSchemesAsPrivileged([{ scheme: 'og', privileges }, { scheme: 'og-game', privileges }]);

const approved = app.isPackaged ? JSON.parse(fs.readFileSync(path.join(ROOT, 'library.lock.json'), 'utf8')) : null;
const games = readLibrary(path.join(ROOT, 'games'), path.join(ROOT, 'kit'), approved);
const kit = readKit(path.join(ROOT, 'kit')).files;
let win = null, gameView = null, gameToken = null, opening = 0;

const answer = (data, name, csp) => (data
  ? new Response(data, { headers: { 'content-type': TYPES[path.extname(name)], 'content-security-policy': csp,
    'x-content-type-options': 'nosniff', 'x-dns-prefetch-control': 'off', 'referrer-policy': 'no-referrer', 'cache-control': 'no-store' } })
  : new Response('Not found', { status: 404 }));
/* Games and the kit are answered from memory: what was checked at the start is what runs. */
const fromMap = (files, name, csp) => answer(files.get(name), name, csp);
const fromDisk = (file, csp) => answer(file && fs.readFileSync(file), file ?? '', csp);

function serveShell(request) {
  const { host, pathname } = new URL(request.url);
  if (host !== 'platform') return answer(null, '', '');
  const game = pathname.startsWith('/icons/') && games.find((g) => g.id === pathname.slice('/icons/'.length));
  if (game) return fromMap(game.files, game.icon, GAME_CSP);
  if (pathname.startsWith('/kit/')) return fromMap(kit, pathname.slice('/kit/'.length), SHELL_CSP);
  if (pathname.startsWith('/app/shell/')) return fromDisk(resolveFile(path.join(ROOT, 'app/shell'), pathname.slice('/app/shell/'.length)), SHELL_CSP);
  return answer(null, '', '');
}
/* A game gets its own empty session with no network, no files and no permissions. */
function gameSession(game) {
  const ses = session.fromPartition(`game-${game.id}-${randomUUID()}`);
  ses.protocol.handle('og-game', (request) => {
    const { host, pathname } = new URL(request.url);
    if (host !== game.id) return answer(null, '', '');
    return pathname.startsWith('/kit/') ? fromMap(kit, pathname.slice('/kit/'.length), GAME_CSP) : fromMap(game.files, pathname.slice(1), GAME_CSP);
  });
  ses.webRequest.onBeforeRequest((d, done) => done({ cancel: !d.url.startsWith(`og-game://${game.id}/`) }));
  lockDown(ses);
  return ses.setProxy({ mode: 'fixed_servers', proxyRules: NO_NETWORK_PROXY, proxyBypassRules: '<-loopback>' }).then(() => ses);
}
function lockDown(ses) {
  ses.setPermissionRequestHandler((_wc, _permission, done) => done(false));
  ses.setPermissionCheckHandler(() => false);
  ses.setDevicePermissionHandler(() => false);
  ses.on('will-download', (event) => event.preventDefault());
}
function lockPage(contents) {
  contents.setWindowOpenHandler(() => ({ action: 'deny' }));
  contents.on('will-navigate', (event) => event.preventDefault());
  contents.on('will-frame-navigate', (event) => event.preventDefault());
  contents.on('will-attach-webview', (event) => event.preventDefault());
}
const safePage = { nodeIntegration: false, contextIsolation: true, sandbox: true, webviewTag: false, spellcheck: false };

function closeGame() {
  opening++;                                              // a game that is still opening is dropped too
  gameToken = null;
  if (!gameView) return;
  const view = gameView;
  gameView = null;
  if (win && !win.isDestroyed()) win.contentView.removeChildView(view);
  const { session: used } = view.webContents;
  view.webContents.close();
  used.clearStorageData().then(() => used.clearCache()).catch((error) => console.error('The data of a closed game was not cleared:', error));
}
async function openGame({ id, token } = {}) {
  const game = games.find((g) => g.id === id);
  if (typeof token !== 'string' || token.length !== 36) throw new Error('bad token');
  if (!game) throw new Error('unknown game');
  closeGame();
  const mine = opening;
  const ses = await gameSession(game);
  if (mine !== opening || !win) throw new Error('The game was closed.');
  const view = new WebContentsView({ webPreferences: { ...safePage, nodeIntegrationInSubFrames: true, disableDialogs: true, session: ses, devTools: !app.isPackaged, preload: path.join(import.meta.dirname, 'game-preload.cjs') } });
  lockPage(view.webContents);
  view.webContents.setWebRTCIPHandlingPolicy('disable_non_proxied_udp');
  view.webContents.on('render-process-gone', () => { if (view === gameView) toShell('game:gone'); });
  gameView = view;
  gameToken = token;
  win.contentView.addChildView(view);
  await view.webContents.loadURL(`og-game://${game.id}/${game.page}`);
}
const toShell = (channel, value) => { if (win && !win.isDestroyed()) win.webContents.send(channel, value); };
const small = (msg) => { try { return JSON.stringify(msg).length <= MAX_MESSAGE; } catch { return false; } };
let second = 0, used = 0;
/* A game sends text only, so nothing large is built here. One that floods is closed. */
function fromGameText(text) {
  const now = Math.floor(Date.now() / 1000);
  if (now !== second) { second = now; used = 0; }
  if (++used > MAX_PER_SECOND) { closeGame(); toShell('game:gone'); return; }
  if (typeof text !== 'string' || text.length > MAX_MESSAGE) return;
  let msg;
  try { msg = JSON.parse(text); } catch { return; }
  toShell('game:message', { token: gameToken, msg });
}
const fromShell = (event) => win && event.senderFrame === win.webContents.mainFrame && event.senderFrame.url.startsWith('og://platform/');
const fromGame = (event) => gameView && event.senderFrame === gameView.webContents.mainFrame;
const shellCall = (channel, fn) => ipcMain.handle(channel, (event, value) => {
  if (!fromShell(event)) throw new Error('not allowed');
  return fn(value);
});

shellCall('games', () => ({ server: SERVER, stun: config.stun ?? null, games: games.map(({ dir, page, icon, rules, files, ...rest }) => rest) }));
shellCall('game:open', openGame);
shellCall('game:close', closeGame);
shellCall('game:bounds', (b) => {
  if (!gameView || ![b?.x, b?.y, b?.width, b?.height].every((n) => Number.isFinite(n) && n >= 0)) return;
  gameView.setBounds({ x: Math.round(b.x), y: Math.round(b.y), width: Math.round(b.width), height: Math.round(b.height) });
});
/* Leaderboards live on the match server. The window itself never opens a web address. */
const HTTP = SERVER.replace(/^ws/, 'http'), ASK_MS = 15_000, MAX_RESULT = 4 * 1024 * 1024;
async function ask(where, init = {}) {
  const res = await net.fetch(`${HTTP}${where}`, { ...init, signal: AbortSignal.timeout(ASK_MS), credentials: 'omit', redirect: 'error', bypassCustomProtocolHandlers: true });
  if (!res.ok && res.status !== 422) throw new Error(`the server answered ${res.status}`);
  return res.json();
}
shellCall('leaderboard', (game) => {
  if (!games.some((g) => g.id === game)) throw new Error('unknown game');
  return ask(`/leaderboard?game=${game}`);
});
shellCall('result', (transcript) => {
  const ticket = transcript?.terms?.ticket, body = JSON.stringify(transcript);
  if (!/^[0-9a-f-]{36}$/.test(ticket ?? '') || body.length > MAX_RESULT) throw new Error('not a ranked match');
  return ask(`/result?ticket=${ticket}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body });
});
shellCall('game:send', ({ token, msg } = {}) => { if (gameView && token === gameToken && small(msg)) gameView.webContents.send('app:message', msg); });
ipcMain.on('game:message', (event, text) => { if (fromGame(event)) fromGameText(text); });

function createWindow() {
  win = new BrowserWindow({ width: 1080, height: 800, minWidth: 360, minHeight: 560, show: false, icon: path.join(ROOT, 'build/icon.png'), backgroundColor: '#100a20', title: 'OpenGames',
    webPreferences: { ...safePage, preload: path.join(import.meta.dirname, 'shell-preload.cjs') } });
  lockPage(win.webContents);
  win.once('ready-to-show', () => (process.env.OPENGAMES_QUIET ? win.showInactive() : win.show()));
  win.on('closed', () => { closeGame(); win = null; });
  win.webContents.on('did-start-navigation', (e) => { if (e.isMainFrame && !e.isSameDocument) closeGame(); });
  return win.loadURL(SHELL);
}

const isFirst = app.requestSingleInstanceLock() || !app.isPackaged;
if (!isFirst) app.quit();
app.on('second-instance', () => { if (win) { if (win.isMinimized()) win.restore(); win.focus(); } });
app.on('web-contents-created', (_event, contents) => lockPage(contents));
// Not awaited at the top level: Electron only becomes ready once this file has loaded.
app.whenReady().then(() => {
  if (!isFirst) return undefined;
  protocol.handle('og', serveShell);
  lockDown(session.defaultSession);
  return createWindow();
}).catch((error) => { console.error(error); app.exit(1); });
app.on('window-all-closed', () => app.quit());
