'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn } = require('child_process');
const { app, BrowserWindow, dialog, ipcMain, shell } = require('electron');

const { DeviceMonitor } = require('./device-monitor');

let mainWindow = null;
let monitor = null;
let activeDeployProcess = null;

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

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://') || url.startsWith('http://')) {
      shell.openExternal(url);
      return { action: 'deny' };
    }
    return { action: 'allow' };
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
  ipcMain.handle('log:open-file', async () => {
    const result = await dialog.showOpenDialog({
      title: 'Open saved log file',
      properties: ['openFile'],
      filters: [
        { name: 'JSON Lines', extensions: ['jsonl'] },
        { name: 'All Files', extensions: ['*'] },
      ],
    });

    if (result.canceled || !result.filePaths?.length) {
      return null;
    }

    const filePath = result.filePaths[0];
    const content = await fs.promises.readFile(filePath, 'utf8');
    const entries = content
      .split(/\r?\n/)
      .filter((line) => line.trim().length > 0)
      .map((line) => JSON.parse(line));

    return { filePath, entries };
  });
  ipcMain.handle('log:export-filtered-log', async (_event, rows) => {
    const result = await dialog.showSaveDialog({
      title: 'Export filtered log rows',
      defaultPath: buildDefaultLogFilePath(),
      filters: [
        { name: 'JSON Lines', extensions: ['jsonl'] },
        { name: 'All Files', extensions: ['*'] },
      ],
      properties: ['createDirectory', 'showOverwriteConfirmation'],
    });

    if (result.canceled || !result.filePath) {
      return null;
    }

    const filePath = result.filePath;
    await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
    const data = rows.map((row) => JSON.stringify(row)).join('\n') + '\n';
    await fs.promises.writeFile(filePath, data, 'utf8');
    return filePath;
  });

  function locateBfr() {
    const home = os.homedir();
    const searchPaths = [
      path.join(home, 'bfr-cli', 'bfr'),
      path.join(home, 'workspace', 'bfr-cli', 'bfr'),
      '/Users/larry/bfr-cli/bfr'
    ];
    
    try {
      const zshrcPath = path.join(home, '.zshrc');
      if (fs.existsSync(zshrcPath)) {
        const content = fs.readFileSync(zshrcPath, 'utf8');
        const match = content.match(/alias\s+bfr=['"]([^'"]+)['"]/);
        if (match && match[1]) {
          searchPaths.push(match[1]);
        }
      }
    } catch (e) {
      // Ignore
    }
    
    for (const p of searchPaths) {
      const resolved = p.replace(/^~/, home);
      if (fs.existsSync(resolved)) {
        return resolved;
      }
    }
    
    return 'bfr';
  }

  function getSpawnConfig(bfrPath, args) {
    if (process.platform === 'win32') {
      return {
        command: 'python',
        args: [bfrPath, ...args]
      };
    }
    return {
      command: bfrPath,
      args: args
    };
  }

  ipcMain.handle('bfr:get-config', async () => {
    const bfrPath = locateBfr();
    const detected = bfrPath !== 'bfr' && fs.existsSync(bfrPath);
    
    const boards = {
      sdu: { name: 'SDU (Sensor Data Unit)', board_id_var: 'SDU_BOARD_ID', ids: ['FL', 'FR', 'RL', 'RR'] },
      mdu: { name: 'MDU (Master Data Unit)' },
      tspmu: { name: 'TSPMU (Tire System Pressure Monitoring Unit)', board_id_var: 'TSPMU_BOARD_ID', ids: ['0', '1'] }
    };
    
    try {
      const home = os.homedir();
      const configPath = path.join(home, '.bfr_config.json');
      if (fs.existsSync(configPath)) {
        const data = await fs.promises.readFile(configPath, 'utf8');
        const parsed = JSON.parse(data);
        if (parsed.custom_boards) {
          for (const [key, info] of Object.entries(parsed.custom_boards)) {
            boards[key] = {
              name: info.name || key.toUpperCase(),
              board_id_var: info.board_id_var,
              ids: info.ids || []
            };
          }
        }
      }
    } catch (e) {
      // Ignore
    }
    
    return { bfrPath, detected, boards };
  });

  ipcMain.handle('bfr:run-setup', async () => {
    const bfrPath = locateBfr();
    let scriptPath = '';
    if (bfrPath !== 'bfr') {
      scriptPath = path.join(path.dirname(bfrPath), 'setup.sh');
    } else {
      scriptPath = '/Users/larry/bfr-cli/setup.sh';
    }
    
    if (!fs.existsSync(scriptPath)) {
      throw new Error(`Setup script not found at ${scriptPath}`);
    }
    
    return new Promise((resolve, reject) => {
      const child = spawn(scriptPath, [], { shell: true });
      let stdout = '';
      let stderr = '';
      
      child.stdout.on('data', (data) => {
        const text = data.toString();
        stdout += text;
        broadcast('board:deploy-log', { type: 'stdout', text });
      });
      
      child.stderr.on('data', (data) => {
        const text = data.toString();
        stderr += text;
        broadcast('board:deploy-log', { type: 'stderr', text });
      });
      
      child.on('close', (code) => {
        if (code === 0) {
          resolve({ success: true, stdout });
        } else {
          reject(new Error(`Setup script exited with code ${code}. Stderr: ${stderr}`));
        }
      });
    });
  });

  ipcMain.handle('dialog:select-directory', async () => {
    const result = await dialog.showOpenDialog({
      title: 'Select Board Repository Directory',
      properties: ['openDirectory', 'createDirectory']
    });
    
    if (result.canceled || !result.filePaths?.length) {
      return null;
    }
    
    return result.filePaths[0];
  });

  ipcMain.handle('bfr:register-board', async (_event, boardKey, elf, name, aliases, boardIdVar, dirPath) => {
    const bfrPath = locateBfr();
    const args = ['register', boardKey];
    if (elf) args.push('--elf', elf);
    if (name) args.push('--name', name);
    if (aliases) args.push('--alias', aliases);
    if (boardIdVar) args.push('--board-id-var', boardIdVar);
    
    const spawnConf = getSpawnConfig(bfrPath, args);
    
    return new Promise((resolve, reject) => {
      const child = spawn(spawnConf.command, spawnConf.args, { cwd: dirPath, env: process.env });
      let stdout = '';
      let stderr = '';
      
      child.stdout.on('data', (data) => {
        stdout += data.toString();
      });
      
      child.stderr.on('data', (data) => {
        stderr += data.toString();
      });
      
      child.on('close', (code) => {
        if (code === 0) {
          resolve({ success: true, stdout });
        } else {
          reject(new Error(`bfr register failed with code ${code}. Stderr: ${stderr}`));
        }
      });
    });
  });

  ipcMain.handle('board:deploy', async (_event, action, boardKey, boardId) => {
    if (monitor && typeof monitor.disconnect === 'function') {
      try {
        const state = monitor.getInitialState ? monitor.getInitialState() : {};
        const isConnected = state.connected || (monitor.serial && monitor.serial.isOpen);
        if (isConnected) {
          broadcast('board:deploy-log', { type: 'stdout', text: `\x1B[1;33m[GUI] Auto-disconnecting serial port before ${action} to free SWD interface...\x1B[0m\n` });
          await monitor.disconnect();
        }
      } catch (e) {
        broadcast('board:deploy-log', { type: 'stderr', text: `[GUI] Warning: Failed to disconnect serial port: ${e.message}\n` });
      }
    }
    
    const bfrPath = locateBfr();
    const args = [action, boardKey];
    if (boardId) {
      args.push(boardId);
    }
    
    const spawnConf = getSpawnConfig(bfrPath, args);
    const cmdStr = process.platform === 'win32' ? `python ${bfrPath} ${args.join(' ')}` : `${bfrPath} ${args.join(' ')}`;
    broadcast('board:deploy-log', { type: 'stdout', text: `\x1B[1;36m>>> Executing: ${cmdStr}\x1B[0m\n` });
    
    return new Promise((resolve) => {
      const child = spawn(spawnConf.command, spawnConf.args, { env: process.env });
      activeDeployProcess = child;
      
      child.on('error', (err) => {
        broadcast('board:deploy-log', { type: 'stderr', text: `[GUI] Failed to start process: ${err.message}\n` });
        activeDeployProcess = null;
        resolve({ success: false, code: -1 });
      });

      child.stdout.on('data', (data) => {
        broadcast('board:deploy-log', { type: 'stdout', text: data.toString() });
      });
      
      child.stderr.on('data', (data) => {
        broadcast('board:deploy-log', { type: 'stderr', text: data.toString() });
      });
      
      child.on('close', (code) => {
        activeDeployProcess = null;
        if (code === 0) {
          resolve({ success: true });
        } else {
          resolve({ success: false, code });
        }
      });
    });
  });

  ipcMain.handle('board:deploy-kill', async () => {
    if (activeDeployProcess) {
      broadcast('board:deploy-log', { type: 'stdout', text: `\n\x1B[1;31m[GUI] Stop button clicked. Terminating build/flash process (PID ${activeDeployProcess.pid})...\x1B[0m\n` });
      activeDeployProcess.kill('SIGINT');
      const proc = activeDeployProcess;
      setTimeout(() => {
        try {
          if (proc) proc.kill('SIGKILL');
        } catch (e) {
          // ignore
        }
      }, 1000);
      return true;
    }
    return false;
  });
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
