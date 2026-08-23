'use strict';

const { contextBridge, ipcRenderer } = require('electron');

// Safe bridge shared by every page in the window (the harness GUI, the offline
// page, and the injected settings overlay). Pages stay fully sandboxed: they
// only ever reach these narrow, JSON-only methods.
contextBridge.exposeInMainWorld('dsh', {
  getStatus: () => ipcRenderer.invoke('dsh:status'),
  retry: () => ipcRenderer.invoke('dsh:retry'),
  openExternal: (url) => ipcRenderer.invoke('dsh:open-external', url),
  platform: process.platform,
  version: () => ipcRenderer.invoke('app:version'),
  server: {
    getStatus: () => ipcRenderer.invoke('server:status'),
    start: () => ipcRenderer.invoke('server:start'),
    stop: () => ipcRenderer.invoke('server:stop'),
  },
  config: {
    get: () => ipcRenderer.invoke('config:get'),
    set: (patch) => ipcRenderer.invoke('config:set', patch),
  },
  voice: {
    transcribe: (data) => ipcRenderer.invoke('voice:transcribe', data),
    getStatus: () => ipcRenderer.invoke('voice:status'),
  },
  harness: {
    checkUpdate: () => ipcRenderer.invoke('harness:check-update'),
    onProgress: (cb) => {
      const listener = (_event, data) => cb(data);
      ipcRenderer.on('harness:update-progress', listener);
      return () => ipcRenderer.removeListener('harness:update-progress', listener);
    },
  },
});
