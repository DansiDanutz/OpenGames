const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('desk', {
  games: () => ipcRenderer.invoke('games'),
  openGame: (id) => ipcRenderer.invoke('game:open', id),
  closeGame: () => ipcRenderer.invoke('game:close'),
  placeGame: (bounds) => ipcRenderer.invoke('game:bounds', bounds),
  toGame: (msg) => ipcRenderer.invoke('game:send', msg),
  onGame: (fn) => ipcRenderer.on('game:message', (_event, msg) => fn(msg)),
  onGameGone: (fn) => ipcRenderer.on('game:gone', () => fn()),
});
