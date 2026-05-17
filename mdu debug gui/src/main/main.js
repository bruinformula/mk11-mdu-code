'use strict';

const path = require('path');
const { app, BrowserWindow, dialog, ipcMain } = require('electron');

const { DeviceMonitor } = require('./device-monitor');
const { registerReplayIpcHandlers } = require('./replay');

let mainWindow = null;
let monitor = null;

function broadcast(channel, payload) {
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) {
      window.webContents.send(channel, payload);
    }
  }
}

function buildDefaultLogFilePath() {
  const now = new Date();
  const compact = now.toISOString().replace(/[:]/g, '-').replace(/\.\d{3}Z$/, 'Z');
  return path.join(app.getPath('documents'), `mdu-debug-${compact}.jsonl`);
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 960,
    minWidth: 1180,
    minHeight: 760,
    show: false,
    backgroundColor: '#f4efe3',
    title: 'MDU Debug GUI',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  mainWindow.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });
}

function registerMonitorEvents() {
  monitor.on('ports', (ports) => broadcast('device:ports', ports));
  monitor.on('connection', (connection) => broadcast('device:connection', connection));
  monitor.on('diagnostics', (diagnostics) => broadcast('device:diagnostics', diagnostics));
  monitor.on('frame', (frame) => broadcast('device:frame', frame));
  monitor.on('runtime', (runtime) => broadcast('device:runtime', runtime));
  monitor.on('log-status', (status) => broadcast('device:log-status', status));
}

function registerIpcHandlers() {
  ipcMain.handle('app:get-initial-state', async () => monitor.getInitialState());
  ipcMain.handle('serial:list-ports', async () => monitor.listPorts());
  ipcMain.handle('serial:connect', async (_event, options) => monitor.connect(options));
  ipcMain.handle('serial:disconnect', async () => monitor.disconnect());
  ipcMain.handle('serial:set-auto-connect', async (_event, enabled) => monitor.setAutoConnect(enabled));
  ipcMain.handle('session:clear', async () => monitor.clearSession());
  ipcMain.handle('log:pick-file', async () => {
    const result = await dialog.showSaveDialog({
      title: 'Choose a log file',
      defaultPath: buildDefaultLogFilePath(),
      filters: [
        { name: 'JSON Lines', extensions: ['jsonl'] },
        { name: 'All Files', extensions: ['*'] },
      ],
      properties: ['createDirectory', 'showOverwriteConfirmation'],
    });

    if (result.canceled) {
      return null;
    }

    return result.filePath;
  });
  ipcMain.handle('log:start', async (_event, filePath) => monitor.startLogging(filePath));
  ipcMain.handle('log:stop', async () => monitor.stopLogging());
  
  registerReplayIpcHandlers(ipcMain, monitor, broadcast);
}

app.whenReady().then(async () => {
  monitor = new DeviceMonitor();
  registerMonitorEvents();
  registerIpcHandlers();
  await monitor.start();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('before-quit', async () => {
  if (monitor) {
    await monitor.dispose();
  }
});
