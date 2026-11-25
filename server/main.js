import fs from 'node:fs';
import path from 'node:path';
import { readLibrary } from '../app/library.js';
import { createAccounts } from './accounts.js';
import { createLeaderboard } from './leaderboard.js';
import { createMail } from './mail.js';
import { startMatchServer } from './match-server.js';
import { createPlay, joinPages } from './play.js';
import { createSite } from './site.js';
import { createStats } from './stats.js';
import { startStun } from './stun.js';

const ROOT = path.join(import.meta.dirname, '..');
const { PORT = '4310', HOST = '127.0.0.1', TRUST_PROXY = '0', DATA_DIR, STUN_PORT, PLAY_DOMAIN, RESEND_API_KEY, MAIL_FROM, PRIVACY_CONTACT } = process.env;
const number = (name, text, max) => {
  const n = Number(text);
  if (!Number.isInteger(n) || n < 0 || n > max) throw new Error(`${name} must be a whole number up to ${max}`);
  return n;
};
const approved = JSON.parse(fs.readFileSync(path.join(ROOT, 'library.lock.json'), 'utf8'));
const games = readLibrary(path.join(ROOT, 'games'), path.join(ROOT, 'kit'), approved);
const library = games.map(({ id, hash, options, dir, rules }) => ({ id, hash, options, rulesPath: path.join(dir, rules) }));
let leaderboard = null, stats = null, accounts = null;
if (DATA_DIR) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  // Sign-in is on only when codes can be sent and somebody answers for the addresses.
  if (RESEND_API_KEY && MAIL_FROM && PRIVACY_CONTACT && PLAY_DOMAIN) {
    accounts = createAccounts({ file: path.join(DATA_DIR, 'accounts.db'), host: () => PLAY_DOMAIN, mail: createMail({ key: RESEND_API_KEY, from: MAIL_FROM }),
      moved: (m) => leaderboard.move(m), removed: (id) => leaderboard.remove(id) });
  }
  leaderboard = createLeaderboard({ file: path.join(DATA_DIR, 'leaderboard.db'), library, ...(accounts ? { owner: accounts.owner } : {}) });
  stats = createStats({ file: path.join(DATA_DIR, 'stats.db'), library });
}
const site = joinPages(createSite({ games, stats, ranked: leaderboard?.players, contact: accounts ? PRIVACY_CONTACT : null }), createPlay({ games, stunPort: STUN_PORT ? number('STUN_PORT', STUN_PORT, 65535) : null }));
const server = await startMatchServer({ port: number('PORT', PORT, 65535), host: HOST, proxies: number('TRUST_PROXY', TRUST_PROXY, 5), leaderboard, stats, site, accounts });
const stun = STUN_PORT ? await startStun({ port: number('STUN_PORT', STUN_PORT, 65535), host: HOST }) : null;
console.log(`OpenGames match server on port ${server.port}. Leaderboards: ${leaderboard ? 'on' : 'off (set DATA_DIR)'}. Sign-in: ${accounts ? 'on' : 'off'}. STUN: ${stun ? `port ${stun.port}` : 'off (set STUN_PORT)'}.`);

const stop = async () => {
  await Promise.all([server.close(), stun?.close()]);
  leaderboard?.close();
  stats?.close();
  accounts?.close();
  process.exit(0);
};
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, stop);
