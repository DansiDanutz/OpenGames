/* One match, replayed from its signed moves. Runs in a worker thread. */
import { parentPort, workerData } from 'node:worker_threads';
import { pathToFileURL } from 'node:url';
import { Series } from '../kit/engine.js';
import { verifyTranscript } from '../app/shell/session.js';

const { transcript, rules } = workerData;
const module = await import(pathToFileURL(rules));
parentPort.postMessage(await verifyTranscript(transcript, (seed, terms) => new Series(module, { seed, terms })));
