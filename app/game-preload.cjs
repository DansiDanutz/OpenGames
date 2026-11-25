/* The only thing a game can reach: one message port to the app. */
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('opengames', {
  send: (msg) => {
    const text = JSON.stringify(msg);
    if (typeof text !== 'string' || text.length > 32 * 1024) throw new Error('the message is too large');
    ipcRenderer.send('game:message', text);
  },
  onMessage: (fn) => ipcRenderer.on('app:message', (_event, msg) => fn(msg)),
});
// Games have no network. This also removes the one API that works below the browser's network rules.
contextBridge.executeInMainWorld({ func: () => {
  for (const name of ['RTCPeerConnection', 'webkitRTCPeerConnection', 'WebTransport']) delete globalThis[name];
  // No dialogs, printing or clipboard.
  for (const name of ['alert', 'confirm', 'prompt', 'print']) Object.defineProperty(globalThis, name, { value: () => undefined });
  Object.defineProperty(Document.prototype, 'execCommand', { value: () => false });
} });
