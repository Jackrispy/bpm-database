const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  searchArtists: (q) => ipcRenderer.invoke('deezer:searchArtists', q),
  artistAlbums: (id) => ipcRenderer.invoke('deezer:artistAlbums', id),
  album: (id) => ipcRenderer.invoke('deezer:album', id),
  cachedStats: (ids) => ipcRenderer.invoke('stats:cached', ids),
  getStats: (input) => ipcRenderer.invoke('stats:get', input),
  getSettings: () => ipcRenderer.invoke('settings:get'),
  setApiKey: (key) => ipcRenderer.invoke('settings:setApiKey', key),
  clearCache: () => ipcRenderer.invoke('cache:clear'),
});
