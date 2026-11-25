/* Optional accounts: one person, several devices, the same points. An account is an email address and a name.
   A device signs in with a code sent to that address or with Google (google.js), and proves with its own key that it is the device. There are
   no passwords and no cookies: the key of a device is what keeps it signed in. */
import { DatabaseSync } from 'node:sqlite';
import { createHmac, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';
import { cleanName, verified } from '../app/shell/session.js';

const MINUTE = 60_000, HOUR = 60 * MINUTE, DAY = 24 * HOUR;
const LIMITS = { codeMs: 10 * MINUTE, ticketMs: 2 * MINUTE, tries: 5, codesPerHour: 3, codesPerDay: 6, mailsPerDay: 90, waiting: 5000, startsPerHour: 6, googlesPerHour: 60, signatures: 50_000, devices: 10, skewMs: 5 * MINUTE };
/* What a request may say, besides who, when and the signature. */
const FIELDS = { start: ['email'], finish: ['email', 'code', 'name'], google: [], enter: ['ticket', 'name'], me: [], name: ['name'], leave: [], remove: [] };
const PUB = /^[0-9a-f]{64}$/;
/* Simple addresses only: no display names, quotes, spaces or lists. */
const EMAIL = /^[a-z0-9._+-]{1,64}@(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,24}$/;
export const cleanEmail = (v) => {
  const email = typeof v === 'string' && v.length <= 200 ? v.trim().toLowerCase() : '';
  return EMAIL.test(email) ? email : null;
};
const newId = () => randomBytes(32).toString('hex');

/* mail: async ({ to, code }) => void. google: see google.js. Both are optional. host: () => the name this server is asked by. moved: ({ from, to }) joins the points of a device to an account. */
export function createAccounts({ file, mail = null, google = null, host, limits = {}, clock = Date.now, moved = () => {}, removed = () => {} }) {
  const L = { ...LIMITS, ...limits };
  const db = new DatabaseSync(file);
  db.exec(`PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 3000; PRAGMA foreign_keys = ON; PRAGMA secure_delete = ON;
    CREATE TABLE IF NOT EXISTS accounts (id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE, name TEXT NOT NULL, made INTEGER NOT NULL) STRICT;
    CREATE TABLE IF NOT EXISTS devices (pub TEXT PRIMARY KEY, account TEXT NOT NULL REFERENCES accounts (id) ON DELETE CASCADE, added INTEGER NOT NULL) STRICT;
    CREATE INDEX IF NOT EXISTS devices_account ON devices (account, added);`);
  const q = {
    byEmail: db.prepare('SELECT id, name FROM accounts WHERE email = ?'),
    byPub: db.prepare('SELECT a.id, a.email, a.name FROM devices d JOIN accounts a ON a.id = d.account WHERE d.pub = ?'),
    make: db.prepare('INSERT INTO accounts (id, email, name, made) VALUES (?, ?, ?, ?)'),
    rename: db.prepare('UPDATE accounts SET name = ? WHERE id = ?'),
    add: db.prepare('INSERT INTO devices (pub, account, added) VALUES (?, ?, ?) ON CONFLICT (pub) DO UPDATE SET account = excluded.account, added = excluded.added'),
    drop: db.prepare('DELETE FROM devices WHERE pub = ?'),
    oldest: db.prepare('DELETE FROM devices WHERE account = ? AND pub NOT IN (SELECT pub FROM devices WHERE account = ? ORDER BY added DESC, pub LIMIT ?)'),
    remove: db.prepare('DELETE FROM accounts WHERE id = ?'),
  };
  const secret = randomBytes(32);
  const codes = new Map();                             // email and device -> { mac, until, tries }
  const leaving = new Map();                           // state -> { pub, verifier, nonce, until }: on the way to Google
  const tickets = new Map();                           // ticket -> { pub, email, until }: back from Google
  const used = new Map();                              // signature -> when it may be forgotten
  const starts = new Map();                            // internet address -> times of the last hour, in memory only
  const sent = new Map();                              // email -> times; kept in memory for a day
  let mails = [];
  const macOf = (email, pub, code) => createHmac('sha256', secret).update(`${email}\0${pub}\0${code}`).digest();
  const keyOf = (email, pub) => `${email} ${pub}`;
  const no = (error, status = 400) => ({ status, body: { error } });
  const yes = (body) => ({ status: 200, body });
  const view = (a) => ({ signedIn: true, id: a.id, email: a.email, name: a.name });

  function sweep(now) {
    for (const [sig, until] of used) { if (until > now) break; used.delete(sig); }   // oldest first
    for (const all of [codes, leaving, tickets]) for (const [key, x] of all) if (x.until <= now) all.delete(key);
    for (const [email, times] of sent) {
      const recent = times.filter((t) => t > now - DAY);
      if (recent.length) sent.set(email, recent); else sent.delete(email);
    }
    for (const [address, times] of starts) if (times.at(-1) <= now - HOUR) starts.delete(address);
    mails = mails.filter((t) => t > now - DAY);
  }
  /* The device signs what it asks for, for this server and this moment. */
  async function isSigned(action, b) {
    const { sig, ...said } = b;
    if (typeof b.at !== 'number' || Math.abs(clock() - b.at) > L.skewMs || typeof sig !== 'string' || used.has(sig)) return false;
    // What this server decides comes last, and nothing else may be in the request, so nothing can be put in its place.
    if (!(await verified(b.pub, sig, { ...said, opengames: 'account', host: host(), action })) || used.has(sig)) return false;
    used.set(sig, clock() + 2 * L.skewMs);               // a request works once
    return true;
  }
  /* Nobody starts signing in too often. */
  function mayStart(who, most, now) {
    const mine = (starts.get(who) ?? []).filter((t) => t > now - HOUR);
    if (mine.length >= most) return false;
    starts.set(who, [...mine, now]);
    return true;
  }
  function enter(pub, email, name, now) {
    const known = q.byEmail.get(email), account = known ?? { id: newId(), name: cleanName(name) };
    db.exec('BEGIN IMMEDIATE');
    try {
      if (!known) q.make.run(account.id, email, account.name, now);
      q.add.run(pub, account.id, now);
      q.oldest.run(account.id, account.id, L.devices);
      db.exec('COMMIT');
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
    moved({ from: pub, to: account.id });
    return yes(view({ ...account, email }));
  }
  const actions = {
    /* The answer is the same whether the address is known or not. */
    async start(b, address) {
      const email = cleanEmail(b.email), now = clock();
      if (!email) return no('bad_email');
      if (!mayStart(address, L.startsPerHour, now)) return no('too_many', 429);
      const times = sent.get(email) ?? [];
      if (times.filter((t) => t > now - HOUR).length >= L.codesPerHour || times.length >= L.codesPerDay) return no('too_many', 429);
      if (mails.length >= L.mailsPerDay || (codes.size >= L.waiting)) return no('busy', 503);
      const code = String(randomInt(1_000_000)).padStart(6, '0');
      sent.set(email, [...times, now]);
      mails = [...mails, now];
      codes.set(keyOf(email, b.pub), { mac: macOf(email, b.pub, code), until: now + L.codeMs, tries: 0 });
      try { await mail({ to: email, code }); } catch (error) {
        console.error('A code was not sent:', error.message);
        codes.delete(keyOf(email, b.pub));               // nothing was sent, so it does not count
        sent.set(email, (sent.get(email) ?? []).filter((t) => t !== now));
        mails = mails.filter((t) => t !== now);
        return no('not_sent', 502);
      }
      return yes({ sent: true });
    },
    async finish(b) {
      const email = cleanEmail(b.email), now = clock(), key = keyOf(email, b.pub), c = email && codes.get(key);
      if (!c || c.until <= now || !/^\d{6}$/.test(String(b.code))) return no('wrong_code');
      if (++c.tries > L.tries) { codes.delete(key); return no('wrong_code'); }
      if (!timingSafeEqual(c.mac, macOf(email, b.pub, String(b.code)))) return no('wrong_code');
      codes.delete(key);
      return enter(b.pub, email, b.name, now);
    },
    async google(b, address) {
      const now = clock();
      // Many phones share an address, and this sends nothing to anybody.
      if (!mayStart(`google ${address}`, L.googlesPerHour, now)) return no('too_many', 429);
      if (leaving.size >= L.waiting) return no('busy', 503);
      const { state, verifier, nonce, url } = google.begin();
      leaving.set(state, { pub: b.pub, verifier, nonce, until: now + L.codeMs });
      return yes({ url });
    },
    /* Only the device that left for Google can use what came back: a link sent to somebody else signs nobody in. */
    async enter(b) {
      const t = typeof b.ticket === 'string' ? tickets.get(b.ticket) : null, now = clock();
      if (!t || t.until <= now || t.pub !== b.pub) return no('wrong_device');
      tickets.delete(b.ticket);
      return enter(b.pub, t.email, b.name, now);
    },
    async me(b) {
      const a = q.byPub.get(b.pub);
      return yes(a ? view(a) : { signedIn: false });
    },
    async name(b) {
      const a = q.byPub.get(b.pub);
      if (!a) return no('not_signed_in', 401);
      q.rename.run(cleanName(b.name), a.id);
      return yes(view({ ...a, name: cleanName(b.name) }));
    },
    async leave(b) {
      q.drop.run(b.pub);
      return yes({ signedIn: false });
    },
    /* Everything: the address, the devices and the points. */
    async remove(b) {
      const a = q.byPub.get(b.pub);
      if (!a) return no('not_signed_in', 401);
      q.remove.run(a.id);
      db.exec('PRAGMA wal_checkpoint(TRUNCATE)');        // so that no old copy of the address stays in the log
      sent.delete(a.email);
      removed(a.id);
      return yes({ signedIn: false });
    },
  };
  const OF = { start: mail, finish: mail, google, enter: google };
  return {
    ways: { email: !!mail, google: !!google },
    has: (action) => Object.hasOwn(actions, action) && (!Object.hasOwn(OF, action) || !!OF[action]),
    /* Back from Google, in a browser. Resolves to a ticket for the device that left, or null. */
    async cameBack({ state, code }) {
      sweep(clock());
      const now = clock(), left = typeof state === 'string' ? leaving.get(state) : null;
      leaving.delete(state);
      if (!left || left.until <= now || typeof code !== 'string' || !code || code.length > 2048 || tickets.size >= L.waiting) return null;
      const email = cleanEmail(await google.finish({ code, verifier: left.verifier, nonce: left.nonce }));
      if (!email) return null;
      const ticket = newId();
      tickets.set(ticket, { pub: left.pub, email, until: clock() + L.ticketMs });
      return ticket;
    },
    async ask(action, body, address = '') {
      if (!body || typeof body !== 'object' || Array.isArray(body) || typeof body.pub !== 'string' || !PUB.test(body.pub)) return no('bad_request');
      if (!Object.keys(body).every((k) => ['pub', 'at', 'sig', ...FIELDS[action]].includes(k))) return no('bad_request');
      sweep(clock());
      if (used.size >= L.signatures) return no('busy', 503);
      if (!(await isSigned(action, body))) return no('not_signed', 401);
      return actions[action](body, address);
    },
    /* Who plays with this key: the account, or the device itself. */
    owner: (pub) => q.byPub.get(pub)?.id ?? pub,
    close: () => db.close(),
  };
}
