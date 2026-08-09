const { execSync } = require('child_process');
const os = require('os');
const path = require('path');

console.log('Running electron-builder install-app-deps...');
try {
  execSync('npx electron-builder install-app-deps', { stdio: 'inherit' });
} catch (err) {
  console.error('Failed to run electron-builder install-app-deps:', err);
}

if (os.platform() === 'darwin') {
  console.log('macOS detected: Clearing quarantine flag from Electron to prevent Gatekeeper deletion...');
  try {
    const electronAppPath = path.join(__dirname, '..', 'node_modules', 'electron', 'dist', 'Electron.app');
    execSync(`xattr -cr "${electronAppPath}"`);
    console.log('Quarantine flag cleared successfully.');
  } catch (err) {
    console.log('Failed to clear quarantine flag (it might already be cleared or path not found).');
  }
}
