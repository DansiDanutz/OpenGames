/* What this computer remembers: the player's name, settings, results and keys. */
import { createIdentity, cleanName } from './session.js';

const read = (key, fallback) => { try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; } };
const write = (key, value) => localStorage.setItem(key, JSON.stringify(value));

export const settings = {
  get name() { return read('name', ''); },
  set name(v) { write('name', cleanName(v)); },
  get hideAddress() { return read('hideAddress', false); },
  set hideAddress(v) { write('hideAddress', !!v); },
  get sound() { return read('sound', true); },
  set sound(v) { write('sound', !!v); },
};
/* The last rules a player chose for a game. */
export const lastTerms = (gameId) => read(`terms:${gameId}`, {});
export const saveTerms = (gameId, terms) => write(`terms:${gameId}`, terms);

export function record(gameId) { return read(`record:${gameId}`, { wins: 0, losses: 0, draws: 0 }); }
export function addResult(gameId, outcome) {
  const r = record(gameId);
  write(`record:${gameId}`, { ...r, [outcome]: r[outcome] + 1 });
}

const done = (request) => new Promise((resolve, reject) => { request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
/* The private key never leaves the browser's key store. */
export async function identity() {
  const open = indexedDB.open('opengames', 1);
  open.onupgradeneeded = () => open.result.createObjectStore('keys');
  const db = await done(open);
  const saved = await done(db.transaction('keys').objectStore('keys').get('me'));
  if (saved) return saved;
  const made = await createIdentity();
  await done(db.transaction('keys', 'readwrite').objectStore('keys').put(made, 'me'));
  return made;
}
