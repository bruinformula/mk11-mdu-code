import React, { useState } from 'react';
import { useTelemetry } from '../context/TelemetryContext';
import { Wifi, WifiOff, FolderOpen, Play, Square, RefreshCw, Trash2, ArrowLeftRight, Activity } from 'lucide-react';

export default function ConnectionBar() {
  const {
    isLiveMode,
    currentFilePath,
    folderPath,
    folderFiles,
    availablePorts,
    connectionState,
    diagnostics,
    logStatus,
    loadRunFile,
    selectDataFolder,
    scanFolder,
    connectSerial,
    disconnectSerial,
    startLogging,
    stopLogging,
    clearLiveSession,
    toggleLiveMode
  } = useTelemetry();

  const [selectedPort, setSelectedPort] = useState('');
  const [baudRate, setBaudRate] = useState('115200');

  const handleConnect = async () => {
    const port = selectedPort || (availablePorts[0] && availablePorts[0].path);
    if (!port) return;
    try {
      await connectSerial(port, baudRate);
    } catch (e) {
      alert(`Connection failed: ${e.message}`);
    }
  };

  const handleToggleLog = async () => {
    if (logStatus.active) {
      await stopLogging();
    } else {
      const result = await window.mduDebug.pickLogFile();
      if (result) {
        await startLogging(result);
      }
    }
  };

  // Format bytes
  const formatBytes = (bytes) => {
    if (!bytes) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  return (
    <header className="glass-panel" style={{
      margin: '0 0 1rem 0',
      padding: '0.75rem 1rem',
      borderRadius: '12px',
      display: 'flex',
      flexWrap: 'wrap',
      gap: '1rem',
      alignItems: 'center',
      justifyContent: 'space-between',
      border: '1px solid var(--border-color)',
      backgroundColor: 'rgba(25, 30, 45, 0.85)',
      backdropFilter: 'blur(10px)',
      position: 'sticky',
      top: 0,
      zIndex: 100
    }}>
      {/* Port connection & auto-connect */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          {connectionState.connected ? (
            <Wifi className="text-emerald-500 animate-pulse" size={18} />
          ) : (
            <WifiOff className="text-slate-500" size={18} />
          )}
          <span style={{ fontSize: '0.85rem', fontWeight: 'bold' }}>
            {connectionState.connected ? 'Connected' : 'Offline'}
          </span>
        </div>

        <select
          className="select-input"
          value={selectedPort || (connectionState.port || '')}
          onChange={(e) => setSelectedPort(e.target.value)}
          disabled={connectionState.connected}
          style={{ padding: '0.25rem 0.5rem', fontSize: '0.8rem' }}
        >
          {availablePorts.length === 0 && <option value="">No Ports Detected</option>}
          {availablePorts.map((p) => (
            <option key={p.path} value={p.path}>
              {p.displayName || p.path} {p.matchesTarget ? '★' : ''}
            </option>
          ))}
        </select>

        <select
          className="select-input"
          value={baudRate}
          onChange={(e) => setBaudRate(e.target.value)}
          disabled={connectionState.connected}
          style={{ padding: '0.25rem 0.5rem', fontSize: '0.8rem', width: '90px' }}
        >
          <option value="9600">9600</option>
          <option value="115200">115200</option>
          <option value="230400">230400</option>
          <option value="460800">460800</option>
          <option value="921600">921600</option>
        </select>

        {connectionState.connected ? (
          <button className="button button-danger" onClick={disconnectSerial} style={{ padding: '0.25rem 0.75rem', fontSize: '0.8rem' }}>
            Disconnect
          </button>
        ) : (
          <button className="button button-success" onClick={handleConnect} disabled={availablePorts.length === 0} style={{ padding: '0.25rem 0.75rem', fontSize: '0.8rem' }}>
            Connect
          </button>
        )}

        <button className="button" onClick={clearLiveSession} title="Clear Live History" style={{ padding: '0.25rem', display: 'flex', alignItems: 'center' }}>
          <Trash2 size={14} />
        </button>
      </div>

      {/* Directory Scanner & Run Selector */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
        <button className="button" onClick={selectDataFolder} style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', padding: '0.25rem 0.5rem', fontSize: '0.8rem' }}>
          <FolderOpen size={14} />
          <span>{folderPath ? 'Change Folder...' : 'Set Data Folder...'}</span>
        </button>

        {folderPath && (
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <select
              className="select-input"
              value={!isLiveMode ? currentFilePath : ''}
              onChange={(e) => {
                if (e.target.value) {
                  loadRunFile(e.target.value);
                }
              }}
              style={{ padding: '0.25rem 0.5rem', fontSize: '0.8rem', maxW: '200px' }}
            >
              <option value="">-- Select Saved Run --</option>
              {folderFiles.map((file) => (
                <option key={file.path} value={file.path}>
                  {file.name} ({(file.size / 1024 / 1024).toFixed(1)}MB)
                </option>
              ))}
            </select>
            <button className="button" onClick={scanFolder} title="Rescan Folder" style={{ padding: '0.25rem', display: 'flex', alignItems: 'center' }}>
              <RefreshCw size={14} />
            </button>
          </div>
        )}

        {/* Playback mode indicators */}
        {!isLiveMode && (
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <span style={{
              backgroundColor: 'var(--color-info)',
              color: '#000',
              padding: '0.15rem 0.5rem',
              borderRadius: '4px',
              fontSize: '0.7rem',
              fontWeight: 'bold'
            }}>
              PLAYBACK
            </span>
            <button className="button button-success" onClick={toggleLiveMode} style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', padding: '0.25rem 0.5rem', fontSize: '0.8rem' }}>
              <ArrowLeftRight size={14} />
              <span>Go Live</span>
            </button>
          </div>
        )}
      </div>

      {/* Logging controller */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
        <button
          className={`button ${logStatus.active ? 'button-danger' : ''}`}
          onClick={handleToggleLog}
          style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', padding: '0.25rem 0.5rem', fontSize: '0.8rem' }}
        >
          {logStatus.active ? <Square size={12} fill="currentColor" /> : <Play size={12} fill="currentColor" />}
          <span>{logStatus.active ? 'Stop Log' : 'Start Log'}</span>
        </button>

        {/* Stats */}
        <div style={{ display: 'flex', gap: '0.75rem', fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
          <div>
            Bytes: <span style={{ color: 'var(--text-primary)', fontWeight: 'bold' }}>{formatBytes(diagnostics.totalBytes || 0)}</span>
          </div>
          <div>
            Frames: <span style={{ color: 'var(--text-primary)', fontWeight: 'bold' }}>{diagnostics.totalFrames || 0}</span>
          </div>
          {logStatus.active && (
            <div style={{ color: '#ef4444', animation: 'pulse 2s infinite' }}>
              REC: <span style={{ fontWeight: 'bold' }}>{logStatus.linesWritten} lines</span>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
