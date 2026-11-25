/* Builds an installer: node tools/pack.js --server wss://play.example.org [--stun stun:play.example.org:3478] [--dir]
   The server is built in, so nothing on a player's computer can point the app at another one. */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { build, Platform } from 'electron-builder';

const ROOT = path.join(import.meta.dirname, '..');
const value = (name) => { const i = process.argv.indexOf(`--${name}`); return i < 0 ? null : process.argv[i + 1]; };
const server = value('server'), stun = value('stun');
if (!/^wss:\/\/[a-z0-9.-]+(:\d{1,5})?$/.test(server ?? '')) { console.error('Give the match server: --server wss://play.example.org'); process.exit(1); }
if (stun && !/^stun:[a-z0-9.-]+(:\d{1,5})?$/.test(stun)) { console.error('That is not a STUN address.'); process.exit(1); }

const made = fs.mkdtempSync(path.join(os.tmpdir(), 'opengames-pack-')), config = path.join(made, 'config.json');
fs.writeFileSync(config, JSON.stringify(stun ? { server, stun } : { server }));
try {
  await build({
    projectDir: ROOT,
    targets: process.argv.includes('--dir') ? Platform.current().createTarget('dir') : undefined,
    publish: 'never',
    config: {
      appId: 'org.opengames.app', productName: 'OpenGames', copyright: 'AGPL-3.0-only', asar: true, npmRebuild: false,
      directories: { output: 'dist', buildResources: 'packaging' },
      files: ['package.json', 'LICENSE*', 'app/**', '!app/config.json', { from: made, to: 'app', filter: ['config.json'] }, 'games/**', 'kit/**', 'packaging/icon.png', 'library.lock.json', '!node_modules'],
      mac: { category: 'public.app-category.games', icon: 'packaging/icon.png', target: ['dmg'], gatekeeperAssess: false, ...(process.env.CSC_NAME ? { hardenedRuntime: true } : { hardenedRuntime: false, identity: '-' }) },
      win: { target: ['nsis'], icon: 'packaging/icon.png' },
      linux: { target: ['AppImage'], category: 'Game', icon: 'packaging/icon.png' },
      electronFuses: { runAsNode: false, enableNodeOptionsEnvironmentVariable: false, enableNodeCliInspectArguments: false,
        enableEmbeddedAsarIntegrityValidation: true, onlyLoadAppFromAsar: true, grantFileProtocolExtraPrivileges: false },
    },
  });
} finally {
  fs.rmSync(made, { recursive: true, force: true });
}
