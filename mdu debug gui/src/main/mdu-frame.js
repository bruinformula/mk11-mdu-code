'use strict';

const { parseSlcanFrame } = require('./slcan');

const ANSI_ESCAPE = /\x1B\[[0-9;?]*[ -/]*[@-~]/g;

const FAST_PATTERN = /^\[B(\d+)\s+ID\s+([0-9A-Fa-f]+)\s+Fast\]\s+dT:(\d+)ms\s*\|\s*SG\[mV\]:\s*(-?\d+),\s*(-?\d+),\s*(-?\d+),\s*(-?\d+),\s*(-?\d+),\s*(-?\d+)\s*\|\s*Shock:\s*(-?\d+)\.(\d{2})\s*mm$/;

const SLOW_PATTERN = /^\[B(\d+)\s+ID\s+([0-9A-Fa-f]+)\s+Slow\]\s+dT:(\d+)ms\s*\|\s*RPM:\s*(-?\d+)\s*\|\s*Tire\[Max:\s*(-?\d+)\.(\d+)\s+Min:\s*(-?\d+)\.(\d+)\s+Ctr:\s*(-?\d+)\.(\d+)\s+Amb:\s*(-?\d+)\.(\d+)\]\s+Brk:\s*(-?\d+)\.(\d+)\s+Amb:\s*(-?\d+)\.(\d+)$/;

function stripAnsiAndControl(text) {
  return String(text ?? '').replace(ANSI_ESCAPE, '').replace(/[\x00\x07\x08\x0B\x0C\x0E-\x1F]/g, '');
}

function normalizeMduLine(rawLine) {
  return stripAnsiAndControl(rawLine).trim();
}

function combineSignedDecimal(intText, fracText) {
  const intPart = Number.parseInt(intText, 10);
  const fracDigits = fracText.length;
  const fracMagnitude = Number.parseInt(fracText, 10) / Math.pow(10, fracDigits);
  if (intText.trim().startsWith('-')) {
    return intPart - fracMagnitude;
  }
  return intPart + fracMagnitude;
}

function buildIdMeta(idHex) {
  const upper = idHex.toUpperCase().padStart(3, '0');
  return {
    identifier: Number.parseInt(upper, 16),
    identifierHex: upper,
    idText: `0x${upper}`,
  };
}

function toSigned8(value) {
  return value > 127 ? value - 256 : value;
}

function toSigned16(value) {
  return value > 32767 ? value - 65536 : value;
}

function decodeStrainGaugeBlocks(data) {
  const blocks = [];
  for (let index = 0; index < 5; index += 1) {
    const offset = 6 + index * 10;
    const ch1_upper = data[offset];
    const ch2_upper = data[offset + 1];
    const ch1_ch2_lower = data[offset + 2];
    const ch3_upper = data[offset + 3];
    const ch4_upper = data[offset + 4];
    const ch3_ch4_lower = data[offset + 5];
    const ch5_upper = data[offset + 6];
    const ch6_upper = data[offset + 7];
    const ch5_ch6_lower = data[offset + 8];
    const jitterUs = toSigned8(data[offset + 9]);

    const val1 = (ch1_upper << 4) | (ch1_ch2_lower >> 4);
    const val2 = (ch2_upper << 4) | (ch1_ch2_lower & 0x0F);
    const val3 = (ch3_upper << 4) | (ch3_ch4_lower >> 4);
    const val4 = (ch4_upper << 4) | (ch3_ch4_lower & 0x0F);
    const val5 = (ch5_upper << 4) | (ch5_ch6_lower >> 4);
    const val6 = (ch6_upper << 4) | (ch5_ch6_lower & 0x0F);

    const strainGaugesMv = [val1, val2, val3, val4, val5, val6].map((v) => {
      return Math.round((v / 4095.0) * 6600.0 - 3300.0);
    });

    blocks.push({
      index,
      strainGaugesMv,
      jitterUs,
    });
  }
  return blocks;
}

function decodeSensorSamples(data, sampleCount, scaleFactor) {
  const samples = [];
  for (let index = 0; index < sampleCount; index += 1) {
    const offset = 6 + index * 3;
    if (offset + 2 >= data.length) {
      break;
    }
    const rawVal = data[offset] | (data[offset + 1] << 8);
    const value = rawVal / scaleFactor;
    const jitterUs = toSigned8(data[offset + 2]);
    samples.push({
      index,
      value,
      jitterUs,
    });
  }
  return samples;
}

function decodeTireHistoryBlocks(data) {
  const blocks = [];
  for (let index = 0; index < 11; index += 1) {
    const offset = 6 + index * 5;
    if (offset + 4 >= data.length) {
      break;
    }
    blocks.push({
      index,
      max: data[offset],
      min: data[offset + 1],
      center: data[offset + 2],
      ambient: data[offset + 3],
      jitterMs: toSigned8(data[offset + 4]),
    });
  }
  return blocks;
}

function decodeTspmuPressureBlocks(data) {
  const blocks = [];
  for (let index = 0; index < 11; index += 1) {
    const offset = 4 + index * 5;
    if (offset + 4 >= data.length) {
      break;
    }
    const rawP1 = data[offset] | (data[offset + 1] << 8);
    const rawP2 = data[offset + 2] | (data[offset + 3] << 8);
    const pressure1 = toSigned16(rawP1) / 100.0;
    const pressure2 = toSigned16(rawP2) / 100.0;
    const jitter = data[offset + 4];
    blocks.push({
      index,
      pressure1,
      pressure2,
      jitter,
    });
  }
  return blocks;
}

function decodeTspmuTempBlocks(data) {
  const blocks = [];
  for (let index = 0; index < 6; index += 1) {
    const offset = 4 + index * 9;
    if (offset + 8 >= data.length) {
      break;
    }
    const rawT1 = data[offset] | (data[offset + 1] << 8);
    const rawT2 = data[offset + 2] | (data[offset + 3] << 8);
    const rawT3 = data[offset + 4] | (data[offset + 5] << 8);
    const rawT4 = data[offset + 6] | (data[offset + 7] << 8);
    const temp1 = toSigned16(rawT1) / 10.0;
    const temp2 = toSigned16(rawT2) / 10.0;
    const temp3 = toSigned16(rawT3) / 10.0;
    const temp4 = toSigned16(rawT4) / 10.0;
    const jitterMs = toSigned8(data[offset + 8]);
    blocks.push({
      index,
      temp1,
      temp2,
      temp3,
      temp4,
      jitterMs,
    });
  }
  return blocks;
}

function parseFast(match) {
  const board = Number.parseInt(match[1], 10);
  const id = buildIdMeta(match[2]);
  const timeSinceLastMs = Number.parseInt(match[3], 10);
  const strainGaugesMv = [
    Number.parseInt(match[4], 10),
    Number.parseInt(match[5], 10),
    Number.parseInt(match[6], 10),
    Number.parseInt(match[7], 10),
    Number.parseInt(match[8], 10),
    Number.parseInt(match[9], 10),
  ];
  const shockMm = combineSignedDecimal(match[10], match[11]);

  return {
    boardType: 2,
    boardId: board,
    kind: 'fast',
    ...id,
    timeSinceLastMs,
    strainGaugesMv,
    shockMm,
  };
}

function parseSlow(match) {
  const board = Number.parseInt(match[1], 10);
  const id = buildIdMeta(match[2]);
  const timeSinceLastMs = Number.parseInt(match[3], 10);
  const rpm = Number.parseInt(match[4], 10);
  const tireC = {
    max: combineSignedDecimal(match[5], match[6]),
    min: combineSignedDecimal(match[7], match[8]),
    center: combineSignedDecimal(match[9], match[10]),
    ambient: combineSignedDecimal(match[11], match[12]),
  };
  const brakeC = combineSignedDecimal(match[13], match[14]);
  const brakeAmbientC = combineSignedDecimal(match[15], match[16]);

  return {
    boardType: 2,
    boardId: board,
    kind: 'slow',
    ...id,
    timeSinceLastMs,
    rpm,
    tireC,
    brakeC,
    brakeAmbientC,
  };
}

function parseMduLine(rawLine) {
  const cleaned = normalizeMduLine(rawLine);
  if (!cleaned) {
    return { ok: false, reason: 'empty-line', raw: cleaned };
  }

  const fastMatch = cleaned.match(FAST_PATTERN);
  if (fastMatch) {
    const board = parseFast(fastMatch);
    return {
      ok: true,
      source: 'board',
      raw: cleaned,
      idText: board.idText,
      idType: 'standard',
      identifier: board.identifier,
      identifierHex: board.identifierHex,
      dataLength: 64,
      dataHex: '',
      dataBytes: [],
      board,
    };
  }

  const slowMatch = cleaned.match(SLOW_PATTERN);
  if (slowMatch) {
    const board = parseSlow(slowMatch);
    return {
      ok: true,
      source: 'board',
      raw: cleaned,
      idText: board.idText,
      idType: 'standard',
      identifier: board.identifier,
      identifierHex: board.identifierHex,
      dataLength: 64,
      dataHex: '',
      dataBytes: [],
      board,
    };
  }

  const slcan = parseSlcanFrame(cleaned);
  if (slcan.ok) {
    const id = slcan.identifier;
    
    // Extract bit-packed fields from the 11-bit standard ID
    const boardType = (id >> 6) & 0x0F; // Bits 9-6   (Board Type: 2 for SDU)
    const boardId   = (id >> 3) & 0x07; // Bits 5-3   (Board Index: 0 to 3)
    const sensorNum = id & 0x07;        // Bits 2-0   (Sensor Index: 0 to 4 directly at LSB)

    if (boardType === 2 && boardId <= 3 && slcan.dataBytes.length >= 64) {
      const data = slcan.dataBytes;
      const err = data[4] | (data[5] << 8);

      // Sensor 0: Strain Gauges
      if (sensorNum === 0) {
        const strainBlocks = decodeStrainGaugeBlocks(data);
        return {
          ok: true,
          source: 'board',
          raw: cleaned,
          idText: slcan.idText,
          idType: slcan.idType,
          identifier: slcan.identifier,
          identifierHex: slcan.identifierHex,
          dataLength: slcan.dataLength,
          dataHex: slcan.dataHex,
          dataBytes: slcan.dataBytes,
          board: {
            boardType,
            boardId,
            kind: 'fast',
            identifier: slcan.identifier,
            identifierHex: slcan.identifierHex,
            idText: slcan.idText,
            timeSinceLastMs: 5,
            errorFlags: err,
            strainGaugesMv: strainBlocks[0]?.strainGaugesMv ?? [],
            strainBlocks,
          }
        };
      }

      // Sensor 1: Shock Pots
      if (sensorNum === 1) {
        const shockSamples = decodeSensorSamples(data, 19, 100);
        return {
          ok: true,
          source: 'board',
          raw: cleaned,
          idText: slcan.idText,
          idType: slcan.idType,
          identifier: slcan.identifier,
          identifierHex: slcan.identifierHex,
          dataLength: slcan.dataLength,
          dataHex: slcan.dataHex,
          dataBytes: slcan.dataBytes,
          board: {
            boardType,
            boardId,
            kind: 'fast',
            identifier: slcan.identifier,
            identifierHex: slcan.identifierHex,
            idText: slcan.idText,
            timeSinceLastMs: 5,
            errorFlags: err,
            shockMm: shockSamples[0]?.value ?? 0,
            shockSamples,
          }
        };
      }

      // Sensor 2: Brake Temp
      if (sensorNum === 2) {
        const brakeSamples = decodeSensorSamples(data, 19, 10);
        return {
          ok: true,
          source: 'board',
          raw: cleaned,
          idText: slcan.idText,
          idType: slcan.idType,
          identifier: slcan.identifier,
          identifierHex: slcan.identifierHex,
          dataLength: slcan.dataLength,
          dataHex: slcan.dataHex,
          dataBytes: slcan.dataBytes,
          board: {
            boardType,
            boardId,
            kind: 'slow',
            identifier: slcan.identifier,
            identifierHex: slcan.identifierHex,
            idText: slcan.idText,
            timeSinceLastMs: 100,
            errorFlags: err,
            brakeC: brakeSamples[0]?.value ?? 0,
            brakeAmbientC: 25.0,
            brakeSamples,
          }
        };
      }

      // Sensor 3: Tire Temp
      if (sensorNum === 3) {
        const tireBlocks = decodeTireHistoryBlocks(data);
        const latestTire = tireBlocks[0] ?? { max: 0, min: 0, center: 0, ambient: 0 };
        return {
          ok: true,
          source: 'board',
          raw: cleaned,
          idText: slcan.idText,
          idType: slcan.idType,
          identifier: slcan.identifier,
          identifierHex: slcan.identifierHex,
          dataLength: slcan.dataLength,
          dataHex: slcan.dataHex,
          dataBytes: slcan.dataBytes,
          board: {
            boardType,
            boardId,
            kind: 'slow',
            identifier: slcan.identifier,
            identifierHex: slcan.identifierHex,
            idText: slcan.idText,
            timeSinceLastMs: 100,
            errorFlags: err,
            tireC: {
              max: latestTire.max,
              min: latestTire.min,
              center: latestTire.center,
              ambient: latestTire.ambient,
            },
            tireBlocks,
          }
        };
      }

      // Sensor 4: Wheel Speed
      if (sensorNum === 4) {
        const wheelSamples = decodeSensorSamples(data, 19, 10);
        return {
          ok: true,
          source: 'board',
          raw: cleaned,
          idText: slcan.idText,
          idType: slcan.idType,
          identifier: slcan.identifier,
          identifierHex: slcan.identifierHex,
          dataLength: slcan.dataLength,
          dataHex: slcan.dataHex,
          dataBytes: slcan.dataBytes,
          board: {
            boardType,
            boardId,
            kind: 'slow',
            identifier: slcan.identifier,
            identifierHex: slcan.identifierHex,
            idText: slcan.idText,
            timeSinceLastMs: 100,
            errorFlags: err,
            rpm: wheelSamples[0]?.value ?? 0,
            wheelSamples,
          }
        };
      }
    }

    if (boardType === 6 && slcan.dataBytes.length >= 64) {
      const data = slcan.dataBytes;
      const err = data[62] | (data[63] << 8);

      // Sensor 0: Pressure
      if (sensorNum === 0) {
        const pressureBlocks = decodeTspmuPressureBlocks(data);
        return {
          ok: true,
          source: 'board',
          raw: cleaned,
          idText: slcan.idText,
          idType: slcan.idType,
          identifier: slcan.identifier,
          identifierHex: slcan.identifierHex,
          dataLength: slcan.dataLength,
          dataHex: slcan.dataHex,
          dataBytes: slcan.dataBytes,
          board: {
            boardType,
            boardId,
            kind: 'fast',
            identifier: slcan.identifier,
            identifierHex: slcan.identifierHex,
            idText: slcan.idText,
            timeSinceLastMs: 45,
            errorFlags: err,
            pressure1: pressureBlocks[0]?.pressure1 ?? 0,
            pressure2: pressureBlocks[0]?.pressure2 ?? 0,
            jitter: pressureBlocks[0]?.jitter ?? 0,
            pressureBlocks,
          }
        };
      }

      // Sensor 1: Temperature
      if (sensorNum === 1) {
        const tempBlocks = decodeTspmuTempBlocks(data);
        return {
          ok: true,
          source: 'board',
          raw: cleaned,
          idText: slcan.idText,
          idType: slcan.idType,
          identifier: slcan.identifier,
          identifierHex: slcan.identifierHex,
          dataLength: slcan.dataLength,
          dataHex: slcan.dataHex,
          dataBytes: slcan.dataBytes,
          board: {
            boardType,
            boardId,
            kind: 'slow',
            identifier: slcan.identifier,
            identifierHex: slcan.identifierHex,
            idText: slcan.idText,
            timeSinceLastMs: 1333,
            errorFlags: err,
            tspmuTemp1: tempBlocks[0]?.temp1 ?? 0,
            tspmuTemp2: tempBlocks[0]?.temp2 ?? 0,
            tspmuTemp3: tempBlocks[0]?.temp3 ?? 0,
            tspmuTemp4: tempBlocks[0]?.temp4 ?? 0,
            jitterMs: tempBlocks[0]?.jitterMs ?? 0,
            tempBlocks,
          }
        };
      }
    }

    return {
      ok: true,
      source: 'slcan',
      raw: cleaned,
      idText: slcan.idText,
      idType: slcan.idType,
      identifier: slcan.identifier,
      identifierHex: slcan.identifierHex,
      dataLength: slcan.dataLength,
      dataHex: slcan.dataHex,
      dataBytes: slcan.dataBytes,
      board: null,
    };
  }

  return {
    ok: false,
    reason: slcan.reason ?? 'unrecognized-line',
    raw: cleaned,
  };
}

module.exports = {
  parseMduLine,
  normalizeMduLine,
  stripAnsiAndControl,
};
