/* Runs first in a game's page in the browser: one way to talk to the app, the same as app/game-preload.cjs. */
(() => {
  const app = parent;
  globalThis.opengames = Object.freeze({
    send: (msg) => {
      const text = JSON.stringify(msg);
      if (typeof text !== 'string' || text.length > 32 * 1024) throw new Error('the message is too large');
      app.postMessage(text, '*');
    },
    onMessage: (fn) => addEventListener('message', (event) => { if (event.source === app) fn(event.data); }),
  });
  for (const name of ['RTCPeerConnection', 'webkitRTCPeerConnection', 'WebTransport']) delete globalThis[name];
  for (const name of ['alert', 'confirm', 'prompt', 'print']) Object.defineProperty(globalThis, name, { value: () => undefined });
})();
