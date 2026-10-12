'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('notchman', {
  // The player pill.
  onState: (callback) => ipcRenderer.on('state', (_event, state) => callback(state)),
  piece: (id, index) => ipcRenderer.invoke('piece', id, index),
  control: (command) => ipcRenderer.send('control', command),
  setSpeed: (speed) => ipcRenderer.invoke('settings:set', { speed }),
  // Settings.
  getSettings: () => ipcRenderer.invoke('settings:get'),
  setSettings: (changes) => ipcRenderer.invoke('settings:set', changes),
  previewVoice: (voiceId) => ipcRenderer.invoke('voice:preview', voiceId),
  // The Notchman window (dashboard).
  usage: () => ipcRenderer.invoke('dashboard:usage'),
  history: () => ipcRenderer.invoke('dashboard:history'),
  removeHistory: (id) => ipcRenderer.invoke('dashboard:history-remove', id),
  clearHistory: () => ipcRenderer.invoke('dashboard:history-clear'),
  replay: (id) => ipcRenderer.send('dashboard:replay', id),
  upgrade: (plan) => ipcRenderer.invoke('dashboard:upgrade', plan),
  dashboardAction: (action) => ipcRenderer.send('dashboard:action', action),
  checkUpdate: () => ipcRenderer.invoke('dashboard:check-update'),
  installUpdate: () => ipcRenderer.invoke('dashboard:install-update'),
  uninstallInfo: () => ipcRenderer.invoke('uninstall:info'),
  uninstall: () => ipcRenderer.invoke('uninstall:run'),
  onDashboard: (callback) => {
    ipcRenderer.on('dashboard:tab', (_event, tab) => callback({ tab }));
    ipcRenderer.on('dashboard:changed', () => callback({ changed: true }));
  },
  // The agreement shown before first use.
  agreementInfo: () => ipcRenderer.invoke('agree:info'),
  agree: () => ipcRenderer.invoke('agree:accept'),
  quitApp: () => ipcRenderer.send('agree:quit'),
  openLink: (url) => ipcRenderer.send('open-link', url),
  // The floating Shiba.
  buddy: (command) => ipcRenderer.send('buddy', command),
  onBuddy: (callback) => ipcRenderer.on('buddy', (_event, state) => callback(state)),
  // The paragraph picker.
  select: (command, ids) => ipcRenderer.send('select', command, ids),
  onSelect: (callback) => ipcRenderer.on('select', (_event, state) => callback(state)),
});
