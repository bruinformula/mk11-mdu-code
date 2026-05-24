'use strict';

const { contextBridge, ipcRenderer } = require('electron');

function subscribe(channel, callback) {
  const handler = (_event, payload) => callback(payload);
  ipcRenderer.on(channel, handler);
  return () => {
    ipcRenderer.removeListener(channel, handler);
  };
}

contextBridge.exposeInMainWorld('mduDebug', {
  getInitialState: () => ipcRenderer.invoke('app:get-initial-state'),
  listPorts: () => ipcRenderer.invoke('serial:list-ports'),
  connect: (options) => ipcRenderer.invoke('serial:connect', options),
  disconnect: () => ipcRenderer.invoke('serial:disconnect'),
  setAutoConnect: (enabled) => ipcRenderer.invoke('serial:set-auto-connect', enabled),
  clearSession: () => ipcRenderer.invoke('session:clear'),
  pickLogFile: () => ipcRenderer.invoke('log:pick-file'),
  startLogging: (filePath) => ipcRenderer.invoke('log:start', filePath),
  stopLogging: () => ipcRenderer.invoke('log:stop'),
  openLogFile: () => ipcRenderer.invoke('log:open-file'),
  exportFilteredLog: (rows) => ipcRenderer.invoke('log:export-filtered-log', rows),
  onPorts: (callback) => subscribe('device:ports', callback),
  onConnection: (callback) => subscribe('device:connection', callback),
  onDiagnostics: (callback) => subscribe('device:diagnostics', callback),
  onFrame: (callback) => subscribe('device:frame', callback),
  onRuntime: (callback) => subscribe('device:runtime', callback),
  onLogStatus: (callback) => subscribe('device:log-status', callback),
  getBfrConfig: () => ipcRenderer.invoke('bfr:get-config'),
  runSetupScript: () => ipcRenderer.invoke('bfr:run-setup'),
  selectDirectory: () => ipcRenderer.invoke('dialog:select-directory'),
  registerBoard: (boardKey, elf, name, aliases, boardIdVar, dirPath) => 
    ipcRenderer.invoke('bfr:register-board', boardKey, elf, name, aliases, boardIdVar, dirPath),
  deployBoard: (action, boardKey, boardId) => ipcRenderer.invoke('board:deploy', action, boardKey, boardId),
  onDeployLog: (callback) => subscribe('board:deploy-log', callback),
});
