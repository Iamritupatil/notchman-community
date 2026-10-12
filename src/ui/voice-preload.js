'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('kokoro', {
  onSpeak: (callback) => ipcRenderer.on('kokoro:speak', (_event, request) => callback(request)),
  onWarmUp: (callback) => ipcRenderer.on('kokoro:warm', () => callback()),
  answer: (result) => ipcRenderer.send('kokoro:answer', result),
  ready: () => ipcRenderer.send('kokoro:ready'),
});
