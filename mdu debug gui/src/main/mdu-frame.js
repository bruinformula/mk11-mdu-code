'use strict';

const { parseSlcanFrame } = require('./slcan');

const ANSI_ESCAPE = /\x1B\[[0-9;?]*[ -/]*[@-~]/g;

const FAST_PATTERN = /^\[B(\d+)\s+ID\s+([0-9A-Fa-f]+)\s+Fast\]\s+dT:(\d+)ms\s*\|\s*SG\[mV\]:\s*(-?\d+),\s*(-?\d+),\s*(-?\d+),\s*(-?\d+),\s*(-?\d+),\s*(-?\d+)\s*\|\s*Shock:\s*(-?\d+)\.(\d{2})\s*mm$/;

const SLOW_PATTERN = /^\[B(\d+)\s+ID\s+([0-9A-Fa-f]+)\s+Slow\]\s+dT:(\d+)ms\s*\|\s*RPM:\s*(-?\d+)\s*\|\s*Tire\[Max:\s*(-?\d+)\.(\d+)\s+Min:\s*(-?\d+)\.(\d+)\s+Ctr:\s*(-?\d+)\.(\d+)\s+Amb:\s*(-?\d+)\.(\d+)\]\s+Brk:\s*(-?\d+)\.(\d+)\s+Amb:\s*(-?\d+)\.(\d+)$/;

const THERMAL_PATTERN = /^\[B(\d+)\s+ID\s+([0-9A-Fa-f]+)\s+Thermal\]\s+Px:\s+(.*)$/;

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

function parseThermal(match) {
  const board = Number.parseInt(match[1], 10);
  const id = buildIdMeta(match[2]);
  const pxStr = match[3].trim().split(/\s+/);
  const pixelsC = pxStr.map(s => {
    const parts = s.split('.');
    return combineSignedDecimal(parts[0], parts[1] || '0');
  });

  return {
    boardId: board,
    kind: 'thermal',
    ...id,
    pixelsC,
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

  const thermalMatch = cleaned.match(THERMAL_PATTERN);
  if (thermalMatch) {
    const board = parseThermal(thermalMatch);
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
