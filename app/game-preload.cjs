/* The only thing a game can reach: one message port to the app. */
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('opengames', {
  send: (msg) => ipcRenderer.send('game:message', msg),
  onMessage: (fn) => ipcRenderer.on('app:message', (_event, msg) => fn(msg)),
});
// Games have no network. This also removes the one API that works below the browser's network rules.
contextBridge.executeInMainWorld({ func: () => {
  for (const name of ['RTCPeerConnection', 'webkitRTCPeerConnection', 'WebTransport']) delete globalThis[name];
} });
