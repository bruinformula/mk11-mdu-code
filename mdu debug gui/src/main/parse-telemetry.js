'use strict';

const fs = require('fs');
const path = require('path');
const readline = require('readline');
const Papa = require('papaparse');
const { parseMduLine, parseSlcanToBoard } = require('./mdu-frame');

const MAX_ROWS = 20000;

function parseCsvLine(line) {
  const result = Papa.parse(line, { header: false, skipEmptyLines: false });
  if (result.errors?.length) return line.split(',');
  return result.data[0] || [];
}

function decodeStandardCan(id, dataBytes) {
  if (!dataBytes || dataBytes.length < 8) return null;
  function toSigned16(value) {
    return value > 32767 ? value - 65536 : value;
  }
  if (id === 1712) {
    return {
      'bms.avg_cv': (dataBytes[0] | (dataBytes[1] << 8)) / 100,
      'bms.lo_cv': (dataBytes[2] | (dataBytes[3] << 8)) / 100,
      'bms.hi_cv': (dataBytes[4] | (dataBytes[5] << 8)) / 100,
    };
  }
  if (id === 1713) {
    return {
      'bms.avg_t': toSigned16(dataBytes[0] | (dataBytes[1] << 8)) / 100,
      'bms.hi_t': toSigned16(dataBytes[2] | (dataBytes[3] << 8)) / 100,
      'bms.lo_t': toSigned16(dataBytes[4] | (dataBytes[5] << 8)) / 100,
    };
  }
  if (id === 1714) {
    return {
      'bms.soc': (dataBytes[0] | (dataBytes[1] << 8)) / 100,
      'bms.i': toSigned16(dataBytes[2] | (dataBytes[3] << 8)) / 100,
      'bms.v': (dataBytes[4] | (dataBytes[5] << 8)) / 100,
    };
  }
  if (id === 160) {
    return {
      'inv.all.module_a_temp': toSigned16(dataBytes[0] | (dataBytes[1] << 8)) / 10,
      'inv.all.module_b_temp': toSigned16(dataBytes[2] | (dataBytes[3] << 8)) / 10,
      'inv.all.module_c_temp': toSigned16(dataBytes[4] | (dataBytes[5] << 8)) / 10,
      'inv.all.gate_driver_board_temp': toSigned16(dataBytes[6] | (dataBytes[7] << 8)) / 10,
    };
  }
  if (id === 162) {
    return {
      'inv.cool_t': toSigned16(dataBytes[0] | (dataBytes[1] << 8)) / 10,
      'inv.mot_t': toSigned16(dataBytes[4] | (dataBytes[5] << 8)) / 10,
    };
  }
  if (id === 165) return { 'inv.rpm': toSigned16(dataBytes[2] | (dataBytes[3] << 8)) };
  if (id === 166) {
    return {
      'inv.all.phase_a_current': toSigned16(dataBytes[0] | (dataBytes[1] << 8)) / 10,
      'inv.all.phase_b_current': toSigned16(dataBytes[2] | (dataBytes[3] << 8)) / 10,
      'inv.all.phase_c_current': toSigned16(dataBytes[4] | (dataBytes[5] << 8)) / 10,
      'inv.idc': toSigned16(dataBytes[6] | (dataBytes[7] << 8)) / 10,
    };
  }
  if (id === 167) return { 'inv.vdc': toSigned16(dataBytes[0] | (dataBytes[1] << 8)) / 10 };
  if (id === 170) {
    return {
      'inv.all.vsm_state': dataBytes[0] | (dataBytes[1] << 8),
      'inv.all.inverter_state': dataBytes[2] | (dataBytes[3] << 8),
    };
  }
  if (id === 172) {
    return {
      'inv.tq_cmd': toSigned16(dataBytes[0] | (dataBytes[1] << 8)) / 10,
      'inv.tq_fb': toSigned16(dataBytes[2] | (dataBytes[3] << 8)) / 10,
    };
  }
  if (id === 176) {
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
    if (bt === 2) {
      if (board.shockMm !== undefined) state[`sdu[${bid}].shock`] = board.shockMm;
      if (board.brakeC !== undefined) state[`sdu[${bid}].brake`] = board.brakeC;
      if (board.rpm !== undefined) state[`sdu[${bid}].wrpm`] = board.rpm;
      if (board.tireC !== undefined) {
        state[`sdu[${bid}].tire[0]`] = board.tireC.max;
        state[`sdu[${bid}].tire[1]`] = board.tireC.min;
        state[`sdu[${bid}].tire[2]`] = board.tireC.center;
        state[`sdu[${bid}].tire[3]`] = board.tireC.ambient;
      }
    } else if (bt === 4) {
      if (board.flow1 !== undefined) state['tshmu.flow1'] = board.flow1;
      if (board.flow2 !== undefined) state['tshmu.flow2'] = board.flow2;
      if (board.jitter !== undefined) state['tshmu.jitter_us'] = board.jitter;
      if (board.errorFlags !== undefined) state['tshmu.error_flags'] = board.errorFlags;
    } else if (bt === 6) {
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
    } else if (bt === 7 || bt === 1) {
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

function createInitialSignalState() {
  return {
    'gps.lat': 0.0, 'gps.lon': 0.0, 'gps.alt': 0.0, 'gps.vel': 0.0, 'gps.hdg': 0.0,
    'gps.fix': 0, 'gps.fix_quality': 0, 'gps.rtk_state': 'no_fix', 'gps.sats': 0, 'gps.hdop': 99.99,
    'gps.heading_valid': 0, 'gps.heading_quality': 0, 'gps.heading_source': 'course_over_ground',
    'gps.heading_accuracy_deg': 0.0, 'gps.baseline_m': 0.0, 'gps.pitch_deg': 0.0, 'gps.error_flags': 0,
    'imu.ax': 0.0, 'imu.ay': 0.0, 'imu.az': 1.0,
    'imu.pitch': 0.0, 'imu.roll': 0.0, 'imu.yaw': 0.0,
    'imu[0].ax': 0.0, 'imu[0].ay': 0.0, 'imu[0].az': 1.0, 'imu[0].pitch': 0.0, 'imu[0].roll': 0.0, 'imu[0].yaw': 0.0,
    'imu[1].ax': 0.0, 'imu[1].ay': 0.0, 'imu[1].az': 1.0, 'imu[1].pitch': 0.0, 'imu[1].roll': 0.0, 'imu[1].yaw': 0.0,
    'imu[2].ax': 0.0, 'imu[2].ay': 0.0, 'imu[2].az': 1.0, 'imu[2].pitch': 0.0, 'imu[2].roll': 0.0, 'imu[2].yaw': 0.0,
    'sdu[0].shock': 0.0, 'sdu[0].brake': 0.0, 'sdu[0].wrpm': 0.0,
    'sdu[0].tire[0]': 0.0, 'sdu[0].tire[1]': 0.0, 'sdu[0].tire[2]': 0.0, 'sdu[0].tire[3]': 0.0,
    'sdu[1].shock': 0.0, 'sdu[1].brake': 0.0, 'sdu[1].wrpm': 0.0,
    'sdu[1].tire[0]': 0.0, 'sdu[1].tire[1]': 0.0, 'sdu[1].tire[2]': 0.0, 'sdu[1].tire[3]': 0.0,
    'sdu[2].shock': 0.0, 'sdu[2].brake': 0.0, 'sdu[2].wrpm': 0.0,
    'sdu[2].tire[0]': 0.0, 'sdu[2].tire[1]': 0.0, 'sdu[2].tire[2]': 0.0, 'sdu[2].tire[3]': 0.0,
    'sdu[3].shock': 0.0, 'sdu[3].brake': 0.0, 'sdu[3].wrpm': 0.0,
    'sdu[3].tire[0]': 0.0, 'sdu[3].tire[1]': 0.0, 'sdu[3].tire[2]': 0.0, 'sdu[3].tire[3]': 0.0,
    'tspmu[0].p1': 0.0, 'tspmu[0].p2': 0.0,
    'tspmu[0].temps[0]': 0.0, 'tspmu[0].temps[1]': 0.0, 'tspmu[0].temps[2]': 0.0, 'tspmu[0].temps[3]': 0.0,
    'tspmu[1].p1': 0.0, 'tspmu[1].p2': 0.0,
    'tspmu[1].temps[0]': 0.0, 'tspmu[1].temps[1]': 0.0, 'tspmu[1].temps[2]': 0.0, 'tspmu[1].temps[3]': 0.0,
    'tshmu.flow1': 0.0, 'tshmu.flow2': 0.0, 'tshmu.jitter_us': 0, 'tshmu.error_flags': 0,
    'bms.v': 0.0, 'bms.i': 0.0, 'bms.soc': 0.0, 'bms.avg_t': 0.0, 'bms.hi_t': 0.0, 'bms.lo_t': 0.0,
    'bms.avg_cv': 0.0, 'bms.hi_cv': 0.0, 'bms.lo_cv': 0.0,
    'inv.mot_t': 0.0, 'inv.cool_t': 0.0, 'inv.tq_cmd': 0.0, 'inv.tq_fb': 0.0, 'inv.idc': 0.0, 'inv.rpm': 0.0,
    'inv.vdc': 0.0,
  };
}

class StreamTelemetryParser {
  constructor() {
    this.startMs = null;
    this.currentBinIdx = -1;
    this.latestState = createInitialSignalState();
    this.rows = [];
  }

  addFrame(tsMs, board, id, dataBytes) {
    if (this.startMs === null) this.startMs = tsMs;
    const binIdx = Math.floor((tsMs - this.startMs) / 100);
    if (binIdx > this.currentBinIdx) {
      if (this.currentBinIdx !== -1) {
        for (let b = this.currentBinIdx; b < binIdx; b++) {
          const tsSeconds = (this.startMs + b * 100) / 1000;
          this.rows.push({ ts: tsSeconds.toFixed(3), ...this.latestState });
        }
      }
      this.currentBinIdx = binIdx;
    }
    updateStateFromBoard(this.latestState, board, id, dataBytes);
  }

  finish() {
    if (this.currentBinIdx !== -1) {
      const tsSeconds = (this.startMs + this.currentBinIdx * 100) / 1000;
      this.rows.push({ ts: tsSeconds.toFixed(3), ...this.latestState });
    }
    return this.rows;
  }
}

function decimateRows(rows, maxRows = MAX_ROWS) {
  if (!rows || rows.length <= maxRows) {
    return { rows: rows || [], decimated: false, step: 1, rowCountBefore: rows?.length || 0 };
  }
  const step = Math.ceil(rows.length / maxRows);
  const decimated = [];
  for (let i = 0; i < rows.length; i += step) decimated.push(rows[i]);
  return { rows: decimated, decimated: true, step, rowCountBefore: rows.length };
}

function buildMeta(filePath, format, rowCountBefore, decResult, parseStats = null) {
  const rows = decResult.rows;
  let durationSec = null;
  let effectiveHz = null;
  if (rows.length >= 2) {
    const first = parseFloat(rows[0].ts);
    const last = parseFloat(rows[rows.length - 1].ts);
    if (!isNaN(first) && !isNaN(last)) {
      durationSec = last - first;
      if (durationSec > 0) effectiveHz = rows.length / durationSec;
    }
  }
  return {
    fileName: path.basename(filePath),
    filePath,
    format,
    rowCountBefore,
    rowCountAfter: rows.length,
    decimated: decResult.decimated,
    decimationStep: decResult.step,
    durationSec,
    effectiveHz,
    parseStats,
  };
}

function emptyResult(filePath, format) {
  return {
    rows: [],
    meta: buildMeta(filePath, format, 0, { rows: [], decimated: false, step: 1, rowCountBefore: 0 }),
  };
}

function processRawCanLine(parts, headers, parseStats) {
  const timeColIdx = headers.indexOf('ts');
  const idDecColIdx = headers.indexOf('id_dec');
  const idHexColIdx = headers.indexOf('id_hex');
  const dataHexColIdx = headers.indexOf('data_hex');
  const dlcColIdx = headers.indexOf('dlc');
  const idHexStr = parts[idHexColIdx];
  const dataHexStr = parts[dataHexColIdx];
  if (!idHexStr || !dataHexStr) return null;

  let tsMs = parseFloat(parts[timeColIdx]);
  if (isNaN(tsMs)) tsMs = Date.now();
  else tsMs = tsMs * 1000;

  const identifier = idDecColIdx !== -1 ? parseInt(parts[idDecColIdx], 10) : parseInt(idHexStr, 16);
  const identifierHex = idHexStr.replace(/^0x/i, '').toUpperCase();
  const dlcVal = dlcColIdx !== -1 ? parseInt(parts[dlcColIdx], 10) : dataHexStr.length / 2;
  const dataBytes = [];
  for (let i = 0; i < dataHexStr.length; i += 2) {
    dataBytes.push(parseInt(dataHexStr.substring(i, i + 2), 16));
  }
  const slcan = {
    ok: true, identifier, identifierHex,
    idText: '0x' + identifierHex,
    idType: identifier > 0x7FF ? 'extended' : 'standard',
    dataLength: dlcVal, dataHex: dataHexStr, dataBytes,
  };
  const rawLine = `t${identifierHex.padStart(3, '0')}${dlcVal}${dataHexStr}`;
  const parsedFrame = parseSlcanToBoard(slcan, rawLine);
  if (parsedFrame.ok) {
    parseStats.framesOk += 1;
    return { tsMs, board: parsedFrame.board, id: parsedFrame.identifier, dataBytes: parsedFrame.dataBytes,
      frame: { tsMs, idHex: identifierHex, idDec: identifier, dataHex: dataHexStr, decodeOk: true } };
  }
  parseStats.framesFailed += 1;
  return { frame: { tsMs, idHex: identifierHex, idDec: identifier, dataHex: dataHexStr, decodeOk: false } };
}

function processRawTextLine(parts, headers, rawColName, parseStats) {
  const rawColIdx = headers.indexOf(rawColName);
  const timeColIdx = headers.findIndex((h) => h === 'ts' || h.toLowerCase().includes('time'));
  const rawStr = parts[rawColIdx];
  if (!rawStr) return null;
  let tsMs = timeColIdx !== -1 ? parseFloat(parts[timeColIdx]) : NaN;
  if (isNaN(tsMs)) tsMs = Date.now();
  else if (tsMs < 1000000000) tsMs = tsMs * 1000;
  const parsedFrame = parseMduLine(rawStr);
  if (parsedFrame.ok) {
    parseStats.framesOk += 1;
    return {
      tsMs, board: parsedFrame.board, id: parsedFrame.identifier, dataBytes: parsedFrame.dataBytes,
      frame: { tsMs, idHex: parsedFrame.identifierHex, idDec: parsedFrame.identifier, dataHex: parsedFrame.dataHex, decodeOk: true, raw: rawStr },
    };
  }
  parseStats.framesFailed += 1;
  return { frame: { tsMs, decodeOk: false, raw: rawStr } };
}

async function parseTelemetryFile(filePath) {
  const ext = path.extname(filePath).toLowerCase();

  if (ext === '.csv') {
    const inStreamHeader = fs.createReadStream(filePath);
    const rlHeader = readline.createInterface({ input: inStreamHeader });
    let firstLine = '';
    for await (const line of rlHeader) { firstLine = line; break; }
    rlHeader.close();
    inStreamHeader.destroy();
    if (!firstLine) return emptyResult(filePath, 'csv-empty');

    const headerResult = Papa.parse(firstLine, { header: false });
    const headers = (headerResult.data[0] || []).map((h) => String(h).trim().replace(/^["']|["']$/g, ''));
    const isRawCanCsv = headers.includes('id_hex') && headers.includes('data_hex');
    const rawColName = headers.find((h) => h === 'raw' || h === 'message');
    const parseStats = { framesOk: 0, framesFailed: 0 };

    if (isRawCanCsv || rawColName) {
      const parser = new StreamTelemetryParser();
      const format = isRawCanCsv ? 'raw-can-csv' : 'raw-text-csv';
      const inStream = fs.createReadStream(filePath);
      const rl = readline.createInterface({ input: inStream });
      let isFirst = true;
      for await (const line of rl) {
        if (isFirst) { isFirst = false; continue; }
        if (!line.trim()) continue;
        const parts = parseCsvLine(line);
        const result = isRawCanCsv
          ? processRawCanLine(parts, headers, parseStats)
          : processRawTextLine(parts, headers, rawColName, parseStats);
        if (!result) continue;
        if (result.board) {
          parser.addFrame(result.tsMs, result.board, result.id, result.dataBytes);
        }
      }
      const finished = parser.finish();
      const decResult = decimateRows(finished);
      return { rows: decResult.rows, meta: buildMeta(filePath, format, finished.length, decResult, parseStats) };
    }

    const stats = await fs.promises.stat(filePath);
    const fileSize = stats.size;
    const inStream = fs.createReadStream(filePath);
    const rl = readline.createInterface({ input: inStream });
    let step = 1;
    let lineIndex = 0;
    let isFirst = true;
    const rows = [];
    for await (const line of rl) {
      if (isFirst) { isFirst = false; continue; }
      if (!line.trim()) continue;
      if (lineIndex === 0) {
        const avgLineSize = line.length + 1;
        const estimatedLines = Math.ceil(fileSize / avgLineSize);
        step = Math.ceil(estimatedLines / MAX_ROWS);
        if (step < 1) step = 1;
      }
      if (lineIndex % step === 0) {
        const parts = parseCsvLine(line);
        const rowObj = {};
        for (let i = 0; i < headers.length; i++) rowObj[headers[i]] = parts[i] ?? '';
        rows.push(rowObj);
      }
      lineIndex++;
    }
    const decResult = decimateRows(rows);
    return { rows: decResult.rows, meta: buildMeta(filePath, 'pre-parsed-csv', lineIndex, decResult) };
  }

  if (ext === '.jsonl') {
    const parser = new StreamTelemetryParser();
    const parseStats = { framesOk: 0, framesFailed: 0 };
    const inStream = fs.createReadStream(filePath);
    const rl = readline.createInterface({ input: inStream });
    for await (const line of rl) {
      if (!line.trim()) continue;
      try {
        const data = JSON.parse(line);
        let tsMs = data.timestamp ? new Date(data.timestamp).getTime() : Date.now();
        if (data.type === 'frame' && data.board) {
          parser.addFrame(tsMs, data.board, data.frame?.identifier || data.board?.identifier, data.frame?.dataBytes || data.board?.dataBytes);
          parseStats.framesOk += 1;
        } else if (data.raw) {
          const parsedFrame = parseMduLine(data.raw);
          if (parsedFrame.ok) {
            parser.addFrame(tsMs, parsedFrame.board, parsedFrame.identifier, parsedFrame.dataBytes);
            parseStats.framesOk += 1;
          } else parseStats.framesFailed += 1;
        }
      } catch (_e) { /* ignore */ }
    }
    const finished = parser.finish();
    const decResult = decimateRows(finished);
    return { rows: decResult.rows, meta: buildMeta(filePath, 'jsonl', finished.length, decResult, parseStats) };
  }

  return emptyResult(filePath, 'unsupported');
}

async function parseTelemetryWindow(filePath, startSec, endSec) {
  const ext = path.extname(filePath).toLowerCase();
  const frames = [];
  if (ext !== '.csv' && ext !== '.jsonl') return { frames };

  const startMs = startSec * 1000;
  const endMs = endSec * 1000;

  const pushFrame = (frame) => {
    if (!frame || frame.tsMs == null) return;
    if (frame.tsMs >= startMs && frame.tsMs <= endMs) frames.push(frame);
  };

  if (ext === '.csv') {
    const inStreamHeader = fs.createReadStream(filePath);
    const rlHeader = readline.createInterface({ input: inStreamHeader });
    let firstLine = '';
    for await (const line of rlHeader) { firstLine = line; break; }
    rlHeader.close();
    inStreamHeader.destroy();
    if (!firstLine) return { frames };

    const headers = (Papa.parse(firstLine).data[0] || []).map((h) => String(h).trim());
    const isRawCanCsv = headers.includes('id_hex') && headers.includes('data_hex');
    const rawColName = headers.find((h) => h === 'raw' || h === 'message');
    if (!isRawCanCsv && !rawColName) return { frames };

    const parseStats = { framesOk: 0, framesFailed: 0 };
    const inStream = fs.createReadStream(filePath);
    const rl = readline.createInterface({ input: inStream });
    let isFirst = true;
    for await (const line of rl) {
      if (isFirst) { isFirst = false; continue; }
      if (!line.trim()) continue;
      const parts = parseCsvLine(line);
      const result = isRawCanCsv
        ? processRawCanLine(parts, headers, parseStats)
        : processRawTextLine(parts, headers, rawColName, parseStats);
      if (result?.frame) pushFrame(result.frame);
    }
    return { frames };
  }

  const inStream = fs.createReadStream(filePath);
  const rl = readline.createInterface({ input: inStream });
  for await (const line of rl) {
    if (!line.trim()) continue;
    try {
      const data = JSON.parse(line);
      const tsMs = data.timestamp ? new Date(data.timestamp).getTime() : Date.now();
      if (tsMs < startMs || tsMs > endMs) continue;
      if (data.type === 'frame') {
        pushFrame({
          tsMs,
          idHex: data.frame?.identifierHex,
          idDec: data.frame?.identifier,
          dataHex: data.frame?.dataHex,
          decodeOk: Boolean(data.ok),
          raw: data.raw,
        });
      } else if (data.raw) {
        const parsed = parseMduLine(data.raw);
        pushFrame({
          tsMs,
          idHex: parsed.identifierHex,
          idDec: parsed.identifier,
          dataHex: parsed.dataHex,
          decodeOk: parsed.ok,
          raw: data.raw,
        });
      }
    } catch (_e) { /* ignore */ }
  }
  return { frames };
}

function getDefaultDataFolder(app) {
  const docs = app.getPath('documents');
  return path.join(docs, 'mk11-data');
}

module.exports = {
  parseTelemetryFile,
  parseTelemetryWindow,
  getDefaultDataFolder,
  MAX_ROWS,
};
