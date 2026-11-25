// SPDX-License-Identifier: MIT
/* Checks a game before it may join: node kit/check.js games/my-game
   The game's rules run in a program of their own without rights (check-run.js). The words below only
   catch mistakes; a person still reads every game before it is approved. */
import path from 'node:path';
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { hashGame, readManifest } from '../app/library.js';

const LIMIT_MS = 120_000, MEMORY_MB = 256, MATCHES = 6;
const BANNED = [/\bMath\s*\.\s*random\b/, /\bDate\b/, /\bperformance\b/, /\bfetch\b/, /\bimport\s*\(/, /^\s*import\b/m, /\beval\b/, /\bFunction\b/, /\bconstructor\b/, /\bglobalThis\b/, /\bprocess\b/, /\bsetTimeout\b/];

export function checkGame(dir) {
  const manifest = readManifest(dir), root = fs.realpathSync(dir), file = path.join(root, manifest.rules);
  const source = fs.readFileSync(file, 'utf8');
  const found = BANNED.find((re) => re.test(source.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '')));
  if (found) throw new Error(`rules must not use ${found.source}`);
  const kit = fs.realpathSync(import.meta.dirname);
  const secret = randomBytes(16).toString('hex');
  const run = spawnSync(process.execPath, ['--permission', `--allow-fs-read=${root}/*`, `--allow-fs-read=${kit}/*`, `--allow-fs-read=${path.dirname(kit)}/package.json`,
    `--max-old-space-size=${MEMORY_MB}`, '--disable-proto=delete', '--frozen-intrinsics', path.join(kit, 'check-run.js'), file, JSON.stringify(manifest.options ?? [])],
  { input: secret, env: {}, cwd: kit, timeout: LIMIT_MS, killSignal: 'SIGKILL', encoding: 'utf8', maxBuffer: 1024 * 1024 });
  if (run.error) throw new Error(run.error.code === 'ETIMEDOUT' ? 'the rules took too long' : run.error.message);
  let out;
  const line = run.stdout.trim().split('\n').at(-1);
  try { if (!line.startsWith(secret)) throw new Error('not our answer'); out = JSON.parse(line.slice(secret.length)); } catch { throw new Error('the rules stopped the check'); }
  if (out.ok !== true) throw new Error(String(out.error).slice(0, 300));
  const expected = (manifest.options ?? []).reduce((n, o) => n * o.choices.length, 1) * MATCHES;
  if (out.matches !== expected || out.wins?.length !== 2) throw new Error('the rules did not play every match of the check');
  return { id: manifest.id, hash: hashGame(dir), matches: out.matches, wins: out.wins };
}

if (process.argv[1] === import.meta.filename) {
  try {
    const r = checkGame(process.argv[2]);
    console.log(`${r.id} passed: ${r.matches} matches, won ${r.wins.join(' to ')}. Version ${r.hash.slice(0, 12)}.`);
  } catch (error) {
    console.error(`Not accepted: ${error.message}`);
    process.exitCode = 1;
  }
}
