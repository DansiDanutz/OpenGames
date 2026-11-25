// SPDX-License-Identifier: MIT
/* Sound effects, made on the spot: no files to load and nothing to license. */
let isOn = true, context = null, out = null;
export function setSound(on) { isOn = on; if (out) out.gain.value = on ? 0.5 : 0; }

function ready() {
  if (!isOn || typeof AudioContext === 'undefined') return false;
  if (!context) {
    context = new AudioContext();
    out = context.createGain();
    out.gain.value = 0.5;
    const soft = context.createDynamicsCompressor();
    out.connect(soft).connect(context.destination);
  }
  if (context.state === 'suspended') context.resume().catch(() => {});   // plays after the first click
  return true;
}
/* Rises at once and fades away. */
function shape(gain, at, length, peak) {
  gain.gain.setValueAtTime(0.0001, at);
  gain.gain.exponentialRampToValueAtTime(peak, at + Math.min(0.012, length / 4));
  gain.gain.exponentialRampToValueAtTime(0.0001, at + length);
}
function tone({ from, to = from, at = 0, length = 0.18, type = 'sine', peak = 0.4, pan = 0 }) {
  const start = context.currentTime + at, osc = context.createOscillator(), gain = context.createGain(), side = context.createStereoPanner();
  osc.type = type;
  osc.frequency.setValueAtTime(from, start);
  osc.frequency.exponentialRampToValueAtTime(Math.max(1, to), start + length);
  side.pan.value = pan;
  shape(gain, start, length, peak);
  osc.connect(gain).connect(side).connect(out);
  osc.start(start); osc.stop(start + length + 0.02);
}
let hiss = null;
function noise({ at = 0, length = 0.3, from = 2000, to = 200, peak = 0.5, q = 0.8, type = 'lowpass', pan = 0 }) {
  if (!hiss) {
    hiss = context.createBuffer(1, context.sampleRate, context.sampleRate);
    const data = hiss.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  }
  const start = context.currentTime + at, source = context.createBufferSource(), filter = context.createBiquadFilter(), gain = context.createGain(), side = context.createStereoPanner();
  source.buffer = hiss; source.loop = true;
  filter.type = type; filter.Q.value = q;
  filter.frequency.setValueAtTime(from, start);
  filter.frequency.exponentialRampToValueAtTime(to, start + length);
  side.pan.value = pan;
  shape(gain, start, length, peak);
  source.connect(filter).connect(gain).connect(side).connect(out);
  source.start(start); source.stop(start + length + 0.02);
}
const chord = (notes, step, length, type, peak) => notes.forEach((from, n) => tone({ from, at: n * step, length, type, peak }));

const EFFECTS = {
  tick: () => tone({ from: 1300, to: 900, length: 0.04, type: 'triangle', peak: 0.15 }),
  lift: () => tone({ from: 420, to: 620, length: 0.09, type: 'triangle', peak: 0.22 }),
  place: (pan) => { noise({ length: 0.12, from: 1400, to: 160, peak: 0.5, pan }); tone({ from: 190, to: 90, length: 0.16, peak: 0.5, pan }); },
  right: (pan) => chord([659, 988], 0.06, 0.28, 'sine', 0.28, pan),
  remove: () => { tone({ from: 520, to: 180, length: 0.14, type: 'triangle', peak: 0.25 }); noise({ length: 0.1, from: 3000, to: 900, peak: 0.12 }); },
  gem: (pan) => [1568, 2093, 2637].forEach((from, n) => tone({ from, at: n * 0.05, length: 0.5, peak: 0.16, pan })),
  no: () => tone({ from: 170, to: 120, length: 0.2, type: 'square', peak: 0.16 }),
  turn: () => chord([523, 784], 0.09, 0.2, 'triangle', 0.22),
  fire: (pan) => { noise({ length: 0.22, from: 5000, to: 300, peak: 0.5, pan }); tone({ from: 300, to: 60, length: 0.2, type: 'sawtooth', peak: 0.2, pan }); },
  splash: (pan) => { noise({ at: 0.12, length: 0.5, from: 900, to: 3200, peak: 0.35, type: 'bandpass', q: 0.7, pan }); tone({ at: 0.14, from: 260, to: 520, length: 0.18, peak: 0.16, pan }); },
  hit: (pan) => { noise({ at: 0.1, length: 0.6, from: 2600, to: 70, peak: 0.9, pan }); tone({ at: 0.1, from: 120, to: 38, length: 0.5, peak: 0.7, pan }); },
  down: (pan) => { noise({ at: 0.1, length: 1.5, from: 3200, to: 45, peak: 1, pan }); tone({ at: 0.1, from: 900, to: 60, length: 1.1, type: 'sawtooth', peak: 0.22, pan }); tone({ at: 0.1, from: 90, to: 28, length: 1.3, peak: 0.8, pan }); },
  begin: () => chord([392, 523, 659], 0.1, 0.35, 'triangle', 0.25),
  win: () => { chord([523, 659, 784, 1047], 0.13, 0.6, 'triangle', 0.32); chord([262, 330, 392], 0.13, 0.9, 'sine', 0.2); },
  lose: () => chord([440, 392, 330, 262], 0.17, 0.6, 'triangle', 0.24),
};
/* pan: where on the board it happened, -1 (left) to 1 (right). */
export function play(name, pan = 0) {
  if (Object.hasOwn(EFFECTS, name) && ready()) EFFECTS[name](Math.max(-1, Math.min(1, pan)));
}
