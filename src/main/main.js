// Electron main process: window, IPC, providers. All network calls happen here
// (Deezer sends no CORS headers, so renderer fetches would fail).
const path = require('path');
const { app, BrowserWindow, ipcMain, shell } = require('electron');

const deezer = require('./deezer');
const { JsonStore } = require('./store');
const { createResolver } = require('./stats');
const getsongbpm = require('./providers/getsongbpm');
const deezerProvider = require('./providers/deezer');
const localProvider = require('./providers/local');

let win = null;
let cache, settings, resolver, local;

function createWindow() {
  win = new BrowserWindow({
    width: 1180,
    height: 800,
    minWidth: 760,
    minHeight: 520,
    backgroundColor: '#111317',
    title: 'BPM Database',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  // External links (GetSongBPM backlink, Deezer pages) open in the default browser.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https:\/\//.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e, url) => {
    if (!url.startsWith('file://')) {
      e.preventDefault();
      if (/^https:\/\//.test(url)) shell.openExternal(url);
    }
  });

  win.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
}

function wireIpc() {
  const hasApiKey = () => !!settings.get('getsongbpmKey');

  local = localProvider.create();
  resolver = createResolver({
    cache,
    hasApiKey,
    providers: {
      getsongbpm: getsongbpm.create({ getApiKey: () => settings.get('getsongbpmKey') || '' }),
      deezer: deezerProvider.create(),
      local,
    },
  });

  ipcMain.handle('deezer:searchArtists', (_e, q) => deezer.searchArtists(q));
  ipcMain.handle('deezer:artistAlbums', (_e, id) => deezer.getArtistAlbums(id));
  ipcMain.handle('deezer:album', (_e, id) => deezer.getAlbum(id));

  ipcMain.handle('stats:cached', (_e, ids) => resolver.cached(ids));
  ipcMain.handle('stats:get', (_e, input) => resolver.get(input));

  ipcMain.handle('settings:get', () => ({ hasApiKey: hasApiKey() }));
  ipcMain.handle('settings:setApiKey', (_e, key) => {
    const k = String(key || '').trim();
    if (k) settings.set('getsongbpmKey', k);
    else settings.delete('getsongbpmKey');
    return { hasApiKey: hasApiKey() };
  });
  ipcMain.handle('cache:clear', () => {
    for (const k of Object.keys(cache.data)) cache.delete(k);
    return true;
  });
}

app.whenReady().then(() => {
  const dir = app.getPath('userData');
  cache = new JsonStore(path.join(dir, 'stats-cache.json'));
  settings = new JsonStore(path.join(dir, 'settings.json'));
  wireIpc();
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('before-quit', () => {
  cache && cache.flush();
  settings && settings.flush();
  local && local.dispose();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
