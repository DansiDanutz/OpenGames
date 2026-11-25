import { app, BrowserWindow, WebContentsView, ipcMain, protocol, session } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { TYPES, readLibrary, resolveFile } from './library.js';

const ROOT = path.join(import.meta.dirname, '..');
const SERVER = process.env.OPENGAMES_SERVER || 'ws://127.0.0.1:4310';
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

const games = readLibrary(path.join(ROOT, 'games'), path.join(ROOT, 'kit'));
let win = null, gameView = null, gameToken = null, opening = 0;

const answer = (file, csp) => (file
  ? new Response(fs.readFileSync(file), { headers: { 'content-type': TYPES[path.extname(file)], 'content-security-policy': csp,
    'x-content-type-options': 'nosniff', 'x-dns-prefetch-control': 'off', 'referrer-policy': 'no-referrer', 'cache-control': 'no-store' } })
  : new Response('Not found', { status: 404 }));
const kitFile = (p) => resolveFile(path.join(ROOT, 'kit'), p.slice('/kit/'.length));

function serveShell(request) {
  const { host, pathname } = new URL(request.url);
  if (host !== 'platform') return answer(null);
  if (pathname.startsWith('/kit/')) return answer(kitFile(pathname), SHELL_CSP);
  if (pathname.startsWith('/app/shell/')) return answer(resolveFile(path.join(ROOT, 'app/shell'), pathname.slice('/app/shell/'.length)), SHELL_CSP);
  return answer(null);
}
/* A game gets its own empty session with no network, no files and no permissions. */
function gameSession(game) {
  const ses = session.fromPartition(`game-${game.id}-${randomUUID()}`);
  ses.protocol.handle('og-game', (request) => {
    const { host, pathname } = new URL(request.url);
    if (host !== game.id) return answer(null);
    return answer(pathname.startsWith('/kit/') ? kitFile(pathname) : resolveFile(game.dir, pathname.slice(1)), GAME_CSP);
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
  view.webContents.close();
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

shellCall('games', () => ({ server: SERVER, games: games.map(({ dir, page, ...rest }) => rest) }));
shellCall('game:open', openGame);
shellCall('game:close', closeGame);
shellCall('game:bounds', (b) => {
  if (!gameView || ![b?.x, b?.y, b?.width, b?.height].every((n) => Number.isFinite(n) && n >= 0)) return;
  gameView.setBounds({ x: Math.round(b.x), y: Math.round(b.y), width: Math.round(b.width), height: Math.round(b.height) });
});
shellCall('game:send', ({ token, msg } = {}) => { if (gameView && token === gameToken && small(msg)) gameView.webContents.send('app:message', msg); });
ipcMain.on('game:message', (event, text) => { if (fromGame(event)) fromGameText(text); });

function createWindow() {
  win = new BrowserWindow({ width: 1080, height: 800, minWidth: 360, minHeight: 560, show: false, backgroundColor: '#12211f', title: 'OpenGames',
    webPreferences: { ...safePage, preload: path.join(import.meta.dirname, 'shell-preload.cjs') } });
  lockPage(win.webContents);
  win.once('ready-to-show', () => (process.env.OPENGAMES_QUIET ? win.showInactive() : win.show()));
  win.on('closed', () => { closeGame(); win = null; });
  win.webContents.on('did-start-navigation', (e) => { if (e.isMainFrame && !e.isSameDocument) closeGame(); });
  return win.loadURL(SHELL);
}

// Not awaited at the top level: Electron only becomes ready once this file has loaded.
app.whenReady().then(() => {
  protocol.handle('og', serveShell);
  lockDown(session.defaultSession);
  return createWindow();
}).catch((error) => { console.error(error); app.exit(1); });
app.on('window-all-closed', () => app.quit());
