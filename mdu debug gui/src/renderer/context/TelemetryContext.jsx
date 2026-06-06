import React, { createContext, useContext, useState, useEffect, useRef } from 'react';

const TelemetryContext = createContext(null);

const initialSignalState = {
  // GPS
  'gps.lat': 0.0, 'gps.lon': 0.0, 'gps.alt': 0.0, 'gps.vel': 0.0, 'gps.hdg': 0.0,
  'gps.fix': 0, 'gps.fix_quality': 0, 'gps.rtk_state': 'no_fix', 'gps.sats': 0, 'gps.hdop': 99.99,
  'gps.heading_valid': 0, 'gps.heading_quality': 0, 'gps.heading_source': 'course_over_ground',
  'gps.heading_accuracy_deg': 0.0, 'gps.baseline_m': 0.0, 'gps.pitch_deg': 0.0, 'gps.error_flags': 0,

  // IMU
  'imu.ax': 0.0, 'imu.ay': 0.0, 'imu.az': 1.0,
  'imu.pitch': 0.0, 'imu.roll': 0.0, 'imu.yaw': 0.0,
  'imu[0].ax': 0.0, 'imu[0].ay': 0.0, 'imu[0].az': 1.0, 'imu[0].pitch': 0.0, 'imu[0].roll': 0.0, 'imu[0].yaw': 0.0,
  'imu[1].ax': 0.0, 'imu[1].ay': 0.0, 'imu[1].az': 1.0, 'imu[1].pitch': 0.0, 'imu[1].roll': 0.0, 'imu[1].yaw': 0.0,
  'imu[2].ax': 0.0, 'imu[2].ay': 0.0, 'imu[2].az': 1.0, 'imu[2].pitch': 0.0, 'imu[2].roll': 0.0, 'imu[2].yaw': 0.0,

  // SDU 0..3
  'sdu[0].shock': 0.0, 'sdu[0].brake': 0.0, 'sdu[0].wrpm': 0.0,
  'sdu[0].tire[0]': 0.0, 'sdu[0].tire[1]': 0.0, 'sdu[0].tire[2]': 0.0, 'sdu[0].tire[3]': 0.0,
  'sdu[1].shock': 0.0, 'sdu[1].brake': 0.0, 'sdu[1].wrpm': 0.0,
  'sdu[1].tire[0]': 0.0, 'sdu[1].tire[1]': 0.0, 'sdu[1].tire[2]': 0.0, 'sdu[1].tire[3]': 0.0,
  'sdu[2].shock': 0.0, 'sdu[2].brake': 0.0, 'sdu[2].wrpm': 0.0,
  'sdu[2].tire[0]': 0.0, 'sdu[2].tire[1]': 0.0, 'sdu[2].tire[2]': 0.0, 'sdu[2].tire[3]': 0.0,
  'sdu[3].shock': 0.0, 'sdu[3].brake': 0.0, 'sdu[3].wrpm': 0.0,
  'sdu[3].tire[0]': 0.0, 'sdu[3].tire[1]': 0.0, 'sdu[3].tire[2]': 0.0, 'sdu[3].tire[3]': 0.0,

  // TSPMU 0..1
  'tspmu[0].p1': 0.0, 'tspmu[0].p2': 0.0,
  'tspmu[0].temps[0]': 0.0, 'tspmu[0].temps[1]': 0.0, 'tspmu[0].temps[2]': 0.0, 'tspmu[0].temps[3]': 0.0,
  'tspmu[1].p1': 0.0, 'tspmu[1].p2': 0.0,
  'tspmu[1].temps[0]': 0.0, 'tspmu[1].temps[1]': 0.0, 'tspmu[1].temps[2]': 0.0, 'tspmu[1].temps[3]': 0.0,

  // TSHMU
  'tshmu.flow1': 0.0, 'tshmu.flow2': 0.0, 'tshmu.jitter_us': 0, 'tshmu.error_flags': 0,

  // BMS & Inverter
  'bms.v': 0.0, 'bms.i': 0.0, 'bms.soc': 0.0, 'bms.avg_t': 0.0, 'bms.hi_t': 0.0, 'bms.lo_t': 0.0,
  'bms.avg_cv': 0.0, 'bms.hi_cv': 0.0, 'bms.lo_cv': 0.0,
  'inv.mot_t': 0.0, 'inv.cool_t': 0.0, 'inv.tq_cmd': 0.0, 'inv.tq_fb': 0.0, 'inv.idc': 0.0, 'inv.rpm': 0.0,
  'inv.vdc': 0.0,
};

function decodeStandardCan(id, dataBytes) {
  if (!dataBytes || dataBytes.length < 8) return null;
  
  function toSigned16(value) {
    return value > 32767 ? value - 65536 : value;
  }
  
  if (id === 1712) { // BMS Voltages
    return {
      'bms.avg_cv': (dataBytes[0] | (dataBytes[1] << 8)) / 100,
      'bms.lo_cv': (dataBytes[2] | (dataBytes[3] << 8)) / 100,
      'bms.hi_cv': (dataBytes[4] | (dataBytes[5] << 8)) / 100,
    };
  }
  if (id === 1713) { // BMS Temperatures
    return {
      'bms.avg_t': toSigned16(dataBytes[0] | (dataBytes[1] << 8)) / 100,
      'bms.hi_t': toSigned16(dataBytes[2] | (dataBytes[3] << 8)) / 100,
      'bms.lo_t': toSigned16(dataBytes[4] | (dataBytes[5] << 8)) / 100,
    };
  }
  if (id === 1714) { // BMS SOC, Current, Voltage
    return {
      'bms.soc': (dataBytes[0] | (dataBytes[1] << 8)) / 100,
      'bms.i': toSigned16(dataBytes[2] | (dataBytes[3] << 8)) / 100,
      'bms.v': (dataBytes[4] | (dataBytes[5] << 8)) / 100,
    };
  }
  if (id === 160) { // Inverter IGBT temps
    return {
      'inv.all.module_a_temp': toSigned16(dataBytes[0] | (dataBytes[1] << 8)) / 10,
      'inv.all.module_b_temp': toSigned16(dataBytes[2] | (dataBytes[3] << 8)) / 10,
      'inv.all.module_c_temp': toSigned16(dataBytes[4] | (dataBytes[5] << 8)) / 10,
      'inv.all.gate_driver_board_temp': toSigned16(dataBytes[6] | (dataBytes[7] << 8)) / 10,
    };
  }
  if (id === 162) { // Inverter coolant & motor temp
    return {
      'inv.cool_t': toSigned16(dataBytes[0] | (dataBytes[1] << 8)) / 10,
      'inv.mot_t': toSigned16(dataBytes[4] | (dataBytes[5] << 8)) / 10,
    };
  }
  if (id === 165) { // Inverter motor speed
    return {
      'inv.rpm': toSigned16(dataBytes[2] | (dataBytes[3] << 8)),
    };
  }
  if (id === 166) { // Inverter phase currents
    return {
      'inv.all.phase_a_current': toSigned16(dataBytes[0] | (dataBytes[1] << 8)) / 10,
      'inv.all.phase_b_current': toSigned16(dataBytes[2] | (dataBytes[3] << 8)) / 10,
      'inv.all.phase_c_current': toSigned16(dataBytes[4] | (dataBytes[5] << 8)) / 10,
      'inv.idc': toSigned16(dataBytes[6] | (dataBytes[7] << 8)) / 10,
    };
  }
  if (id === 167) { // Inverter DC bus voltage
    return {
      'inv.vdc': toSigned16(dataBytes[0] | (dataBytes[1] << 8)) / 10,
    };
  }
  if (id === 170) { // Inverter VSM state
    return {
      'inv.all.vsm_state': dataBytes[0] | (dataBytes[1] << 8),
      'inv.all.inverter_state': dataBytes[2] | (dataBytes[3] << 8),
    };
  }
  if (id === 172) { // Inverter torque CMD & feedback
    return {
      'inv.tq_cmd': toSigned16(dataBytes[0] | (dataBytes[1] << 8)) / 10,
      'inv.tq_fb': toSigned16(dataBytes[2] | (dataBytes[3] << 8)) / 10,
    };
  }
  if (id === 176) { // Inverter fast info
    return {
      'inv.rpm': toSigned16(dataBytes[0] | (dataBytes[1] << 8)),
      'inv.vdc': toSigned16(dataBytes[2] | (dataBytes[3] << 8)) / 10,
      'inv.tq_cmd': toSigned16(dataBytes[4] | (dataBytes[5] << 8)) / 10,
      'inv.tq_fb': toSigned16(dataBytes[6] | (dataBytes[7] << 8)) / 10,
    };
  }
  return null;
}

function updateStateFromBoard(state, board, id, dataBytes) {
  if (board) {
    const bt = board.boardType;
    const bid = board.boardId;
    
    if (bt === 2) { // SDU
      if (board.shockMm !== undefined) state[`sdu[${bid}].shock`] = board.shockMm;
      if (board.brakeC !== undefined) state[`sdu[${bid}].brake`] = board.brakeC;
      if (board.rpm !== undefined) state[`sdu[${bid}].wrpm`] = board.rpm;
      if (board.tireC !== undefined) {
        state[`sdu[${bid}].tire[0]`] = board.tireC.max;
        state[`sdu[${bid}].tire[1]`] = board.tireC.min;
        state[`sdu[${bid}].tire[2]`] = board.tireC.center;
        state[`sdu[${bid}].tire[3]`] = board.tireC.ambient;
      }
    } else if (bt === 4) { // TSHMU
      if (board.flow1 !== undefined) state['tshmu.flow1'] = board.flow1;
      if (board.flow2 !== undefined) state['tshmu.flow2'] = board.flow2;
      if (board.jitter !== undefined) state['tshmu.jitter_us'] = board.jitter;
      if (board.errorFlags !== undefined) state['tshmu.error_flags'] = board.errorFlags;
    } else if (bt === 6) { // TSPMU
      if (board.pressure1 !== undefined) state[`tspmu[${bid}].p1`] = board.pressure1;
      if (board.pressure2 !== undefined) state[`tspmu[${bid}].p2`] = board.pressure2;
      if (board.tempBlocks && board.tempBlocks[0]) {
        state[`tspmu[${bid}].temps[0]`] = board.tempBlocks[0].temp1;
        state[`tspmu[${bid}].temps[1]`] = board.tempBlocks[0].temp2;
        state[`tspmu[${bid}].temps[2]`] = board.tempBlocks[0].temp3;
        state[`tspmu[${bid}].temps[3]`] = board.tempBlocks[0].temp4;
      } else if (board.tspmuTemp1 !== undefined) {
        state[`tspmu[${bid}].temps[0]`] = board.tspmuTemp1;
        state[`tspmu[${bid}].temps[1]`] = board.tspmuTemp2;
        state[`tspmu[${bid}].temps[2]`] = board.tspmuTemp3;
        state[`tspmu[${bid}].temps[3]`] = board.tspmuTemp4;
      }
    } else if (bt === 7 || bt === 1) { // GPS / SMU
      if (board.gpsPos) {
        state['gps.lat'] = board.gpsPos.latDeg;
        state['gps.lon'] = board.gpsPos.lonDeg;
        state['gps.alt'] = board.gpsPos.altM;
        state['gps.fix'] = board.gpsPos.fixValid;
        state['gps.fix_quality'] = board.gpsPos.fixQuality;
        state['gps.sats'] = board.gpsPos.satellites;
        state['gps.hdop'] = board.gpsPos.hdop;
        state['gps.error_flags'] = board.gpsPos.errorFlags;
      } else if (board.gpsNav) {
        state['gps.vel'] = board.gpsNav.velMps;
        state['gps.hdg'] = board.gpsNav.headingDeg;
        state['gps.heading_valid'] = board.gpsNav.headingValid;
        state['gps.heading_quality'] = board.gpsNav.headingQuality;
        state['gps.baseline_m'] = board.gpsNav.baselineM;
        state['gps.pitch_deg'] = board.gpsNav.pitchDeg;
        state['gps.error_flags'] = board.gpsNav.errorFlags;
      } else if (board.latitude_deg !== undefined) {
        state['gps.lat'] = board.latitude_deg;
        state['gps.lon'] = board.longitude_deg;
        state['gps.alt'] = board.altitude_m;
        state['gps.fix'] = board.fix_valid;
        state['gps.fix_quality'] = board.fix_quality;
        state['gps.sats'] = board.satellites;
        state['gps.hdop'] = board.hdop;
      } else if (board.velocity_mps !== undefined) {
        state['gps.vel'] = board.velocity_mps;
        state['gps.hdg'] = board.course_deg;
        state['gps.heading_valid'] = board.heading_valid;
        state['gps.heading_quality'] = board.heading_quality;
      }
      
      if (board.accelX !== undefined) {
        state['imu.ax'] = board.accelX / 1000.0;
        state['imu.ay'] = board.accelY / 1000.0;
        state['imu.az'] = board.accelZ / 1000.0;
        
        const stateIdx = `imu[${bid}]`;
        state[`${stateIdx}.ax`] = board.accelX / 1000.0;
        state[`${stateIdx}.ay`] = board.accelY / 1000.0;
        state[`${stateIdx}.az`] = board.accelZ / 1000.0;
        state[`${stateIdx}.pitch`] = board.veloX / 100.0;
        state[`${stateIdx}.roll`] = board.veloY / 100.0;
        state[`${stateIdx}.yaw`] = board.veloZ / 100.0;
      }
    }
  } else if (id !== undefined && dataBytes) {
    const dec = decodeStandardCan(id, dataBytes);
    if (dec) {
      for (const [k, v] of Object.entries(dec)) {
        state[k] = v;
      }
    }
  }
}

export function TelemetryProvider({ children }) {
  const [isLiveMode, setIsLiveMode] = useState(true);
  const [activeDataset, setActiveDataset] = useState([]);
  const [currentFilePath, setCurrentFilePath] = useState('');
  
  // Folder loading state
  const [folderPath, setFolderPath] = useState('');
  const [folderFiles, setFolderFiles] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  // Live monitor statistics
  const [availablePorts, setAvailablePorts] = useState([]);
  const [connectionState, setConnectionState] = useState({ connected: false, port: null, baudRate: 115200 });
  const [diagnostics, setDiagnostics] = useState({});
  const [logStatus, setLogStatus] = useState({ active: false, filePath: null, linesWritten: 0, bytesWritten: 0 });

  // Refs for tracking live state
  const latestStateRef = useRef({ ...initialSignalState });
  const liveBufferRef = useRef([]);
  const liveStartMsRef = useRef(0);
  const liveIntervalRef = useRef(null);

  // Load a file for playback
  const loadRunFile = async (filePath) => {
    setLoading(true);
    setError(null);
    try {
      const data = await window.mduDebug.parseTelemetryFile(filePath);
      if (data && data.length > 0) {
        // Filter out dummy/initialization rows with zero or very low timestamps
        const cleanedData = data.filter(row => {
          const ts = parseFloat(row.ts);
          return !isNaN(ts) && ts > 1000000.0;
        });
        setActiveDataset(cleanedData.length > 0 ? cleanedData : data);
        setCurrentFilePath(filePath);
        setIsLiveMode(false);
      } else {
        setError('Parsed file was empty.');
      }
    } catch (e) {
      setError(`Failed to parse telemetry file: ${e.message}`);
    } finally {
      setLoading(false);
    }
  };

  // Select a local folder to scan
  const selectDataFolder = async () => {
    try {
      const selected = await window.mduDebug.selectDataFolder();
      if (selected) {
        setFolderPath(selected);
        localStorage.setItem('mdu_data_folder', selected);
        await scanFolder(selected);
      }
    } catch (e) {
      setError(`Error selecting folder: ${e.message}`);
    }
  };

  const scanFolder = async (path) => {
    setLoading(true);
    try {
      const files = await window.mduDebug.scanFolder(path);
      setFolderFiles(files || []);
    } catch (e) {
      setError(`Error scanning folder: ${e.message}`);
    } finally {
      setLoading(false);
    }
  };

  // Auto load folder on mount
  useEffect(() => {
    const savedFolder = localStorage.getItem('mdu_data_folder') || '/Users/larry/mk11-data-visualization/data';
    setFolderPath(savedFolder);
    scanFolder(savedFolder);
  }, []);

  // Set up live listeners
  useEffect(() => {
    // Initial states
    window.mduDebug.getInitialState().then(state => {
      setConnectionState(state.connection || { connected: false, port: null, baudRate: 115200 });
      setDiagnostics(state.diagnostics || {});
      setLogStatus(state.logStatus || { active: false, filePath: null, linesWritten: 0, bytesWritten: 0 });
    });

    const unsubPorts = window.mduDebug.onPorts((ports) => {
      setAvailablePorts(ports || []);
    });

    const unsubConnection = window.mduDebug.onConnection((conn) => {
      setConnectionState(conn || { connected: false, port: null, baudRate: 115200 });
      
      // If connected, start the live binning loop
      if (conn.connected) {
        setIsLiveMode(true);
        liveStartMsRef.current = Date.now();
        liveBufferRef.current = [];
        latestStateRef.current = { ...initialSignalState };
        
        if (liveIntervalRef.current) clearInterval(liveIntervalRef.current);
        let renderCounter = 0;
        liveIntervalRef.current = setInterval(() => {
          const nowMs = Date.now();
          const tsSeconds = (nowMs - liveStartMsRef.current) / 1000;
          
          const row = {
            ts: tsSeconds.toFixed(3),
            ...latestStateRef.current
          };
          
          liveBufferRef.current.push(row);
          // Limit buffer size to 2000 points (200 seconds of history)
          if (liveBufferRef.current.length > 2000) {
            liveBufferRef.current.shift();
          }
          
          // Only update React state every 5 ticks (500ms) to reduce render churn
          renderCounter++;
          if (renderCounter >= 5) {
            renderCounter = 0;
            setActiveDataset([...liveBufferRef.current]);
          }
        }, 100);
      } else {
        if (liveIntervalRef.current) {
          clearInterval(liveIntervalRef.current);
          liveIntervalRef.current = null;
        }
      }
    });

    const unsubDiagnostics = window.mduDebug.onDiagnostics((diag) => {
      setDiagnostics(diag || {});
    });

    const unsubLogStatus = window.mduDebug.onLogStatus((status) => {
      setLogStatus(status || { active: false, filePath: null, linesWritten: 0, bytesWritten: 0 });
    });

    const unsubFrame = window.mduDebug.onFrame((frame) => {
      if (frame && frame.ok) {
        updateStateFromBoard(
          latestStateRef.current,
          frame.board,
          frame.identifier || frame.board?.identifier,
          frame.dataBytes || frame.board?.dataBytes
        );
      }
    });

    // Check for standard listing refresh
    window.mduDebug.listPorts();

    return () => {
      unsubPorts();
      unsubConnection();
      unsubDiagnostics();
      unsubLogStatus();
      unsubFrame();
      if (liveIntervalRef.current) clearInterval(liveIntervalRef.current);
    };
  }, []);

  const connectSerial = async (portPath, baudRate) => {
    return await window.mduDebug.connect({ path: portPath, baudRate: parseInt(baudRate, 10) });
  };

  const disconnectSerial = async () => {
    return await window.mduDebug.disconnect();
  };

  const startLogging = async (filePath) => {
    return await window.mduDebug.startLogging(filePath);
  };

  const stopLogging = async () => {
    return await window.mduDebug.stopLogging();
  };

  const clearLiveSession = () => {
    window.mduDebug.clearSession();
    liveBufferRef.current = [];
    setActiveDataset([]);
    liveStartMsRef.current = Date.now();
  };

  const toggleLiveMode = () => {
    setIsLiveMode(true);
    setActiveDataset([...liveBufferRef.current]);
    setCurrentFilePath('');
  };

  return (
    <TelemetryContext.Provider
      value={{
        isLiveMode,
        activeDataset,
        currentFilePath,
        folderPath,
        folderFiles,
        loading,
        error,
        availablePorts,
        connectionState,
        diagnostics,
        logStatus,
        loadRunFile,
        selectDataFolder,
        scanFolder: () => scanFolder(folderPath),
        connectSerial,
        disconnectSerial,
        startLogging,
        stopLogging,
        clearLiveSession,
        toggleLiveMode
      }}
    >
      {children}
    </TelemetryContext.Provider>
  );
}

export function useTelemetry() {
  const context = useContext(TelemetryContext);
  if (!context) {
    throw new Error('useTelemetry must be used within a TelemetryProvider');
  }
  return context;
}
