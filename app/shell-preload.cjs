const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('desk', {
  games: () => ipcRenderer.invoke('games'),
  openGame: (id, token) => ipcRenderer.invoke('game:open', { id, token }),
  closeGame: () => ipcRenderer.invoke('game:close'),
  placeGame: (bounds) => ipcRenderer.invoke('game:bounds', bounds),
  toGame: (token, msg) => ipcRenderer.invoke('game:send', { token, msg }),
  submitResult: (value) => ipcRenderer.invoke('result', value),
  leaderboard: (game) => ipcRenderer.invoke('leaderboard', game),
  onGame: (fn) => ipcRenderer.on('game:message', (_event, { token, msg }) => fn(token, msg)),
  onGameGone: (fn) => ipcRenderer.on('game:gone', () => fn()),
});
