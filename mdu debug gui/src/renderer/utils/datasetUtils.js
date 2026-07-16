import { ALL_SIGNALS, getSignalDefinition } from './signals';

export const CHART_TARGET_POINTS = 4000;
export const DERIVED_SIGNALS = [
  { id: 'derived.power_kw', name: 'Pack Power', unit: 'kW', color: '#f59e0b',
    compute: (row) => {
      const v = parseFloat(row['bms.v']);
      const i = parseFloat(row['bms.i']);
      if (isNaN(v) || isNaN(i)) return null;
      return (v * i) / 1000;
    }},
  { id: 'derived.tq_error', name: 'Torque Tracking Error', unit: 'Nm', color: '#ef4444',
    compute: (row) => {
      const cmd = parseFloat(row['inv.tq_cmd']);
      const fb = parseFloat(row['inv.tq_fb']);
      if (isNaN(cmd) || isNaN(fb)) return null;
      return cmd - fb;
    }},
  { id: 'derived.cell_imbalance_v', name: 'Cell Voltage Spread', unit: 'V', color: '#10b981',
    compute: (row) => {
      const hi = parseFloat(row['bms.hi_cv']);
      const lo = parseFloat(row['bms.lo_cv']);
      if (isNaN(hi) || isNaN(lo)) return null;
      return hi - lo;
    }},
  { id: 'derived.cell_imbalance_t', name: 'Cell Temp Spread', unit: '°C', color: '#fb923c',
    compute: (row) => {
      const hi = parseFloat(row['bms.hi_t']);
      const lo = parseFloat(row['bms.lo_t']);
      if (isNaN(hi) || isNaN(lo)) return null;
      return hi - lo;
    }},
  { id: 'derived.fl_fr_brake_delta', name: 'FL−FR Brake Delta', unit: '°C', color: '#f97316',
    compute: (row) => {
      const fl = parseFloat(row['sdu[0].brake']);
      const fr = parseFloat(row['sdu[1].brake']);
      if (isNaN(fl) || isNaN(fr)) return null;
      return fl - fr;
    }},
  { id: 'derived.rl_rr_brake_delta', name: 'RL−RR Brake Delta', unit: '°C', color: '#8b5cf6',
    compute: (row) => {
      const rl = parseFloat(row['sdu[2].brake']);
      const rr = parseFloat(row['sdu[3].brake']);
      if (isNaN(rl) || isNaN(rr)) return null;
      return rl - rr;
    }},
];

export const PLOT_PRESETS = {
  brakes: {
    label: 'Brakes',
    signals: ['sdu[0].brake', 'sdu[1].brake', 'sdu[2].brake', 'sdu[3].brake'],
  },
  suspension: {
    label: 'Suspension',
    signals: ['sdu[0].shock', 'sdu[1].shock', 'sdu[2].shock', 'sdu[3].shock'],
  },
  powertrain: {
    label: 'Powertrain',
    signals: ['inv.tq_cmd', 'inv.tq_fb', 'derived.tq_error', 'inv.rpm', 'inv.idc'],
  },
  gps_quality: {
    label: 'GPS Quality',
    signals: ['gps.sats', 'gps.hdop', 'gps.fix_quality', 'gps.vel'],
  },
  bms: {
    label: 'BMS',
    signals: ['bms.v', 'bms.i', 'bms.soc', 'derived.power_kw', 'derived.cell_imbalance_v'],
  },
  cooling: {
    label: 'Cooling',
    signals: ['tshmu.flow1', 'tshmu.flow2', 'tspmu[0].p1', 'inv.cool_t'],
  },
};

export function getDefaultDataFolder() {
  if (typeof window !== 'undefined' && window.mduDebug?.getDefaultDataFolder) {
    return window.mduDebug.getDefaultDataFolder();
  }
  return '';
}

export function downsampleData(data, targetPoints = CHART_TARGET_POINTS) {
  if (!data || data.length === 0) return [];
  const valid = data.filter((row) => !isNaN(parseFloat(row.ts)));
  if (valid.length <= targetPoints) return valid;
  const step = Math.ceil(valid.length / targetPoints);
  return valid.filter((_, idx) => idx % step === 0);
}

export function getDownsampleInfo(data, targetPoints = CHART_TARGET_POINTS) {
  const validCount = (data || []).filter((row) => !isNaN(parseFloat(row.ts))).length;
  if (validCount <= targetPoints) {
    return { shown: validCount, total: validCount, decimated: false, step: 1 };
  }
  const step = Math.ceil(validCount / targetPoints);
  return {
    shown: Math.ceil(validCount / step),
    total: validCount,
    decimated: true,
    step,
  };
}

export function getSignalValue(row, signalId) {
  const derived = DERIVED_SIGNALS.find((s) => s.id === signalId);
  if (derived) return derived.compute(row);
  const val = parseFloat(row[signalId]);
  return isNaN(val) ? null : val;
}

export function getSignalLabel(signalId) {
  const derived = DERIVED_SIGNALS.find((s) => s.id === signalId);
  if (derived) return `${derived.name} (${derived.unit})`;
  const def = getSignalDefinition(signalId);
  if (def) return def.unit ? `${def.name} (${def.unit})` : def.name;
  return signalId;
}

export function getAvailableSignals(data) {
  if (!data || data.length === 0) return [];
  const keys = new Set(Object.keys(data[0]).filter((k) => k !== 'ts'));
  DERIVED_SIGNALS.forEach((s) => {
    if (data.some((row) => getSignalValue(row, s.id) != null)) keys.add(s.id);
  });
  return [...keys];
}

export function computeSignalStats(data, signalIds) {
  if (!data || data.length === 0) return [];
  return signalIds.map((id) => {
    const values = [];
    data.forEach((row) => {
      const v = getSignalValue(row, id);
      if (v != null && !isNaN(v)) values.push(v);
    });
    if (values.length === 0) {
      return { id, label: getSignalLabel(id), count: 0, min: null, max: null, mean: null, std: null };
    }
    const min = Math.min(...values);
    const max = Math.max(...values);
    const mean = values.reduce((a, b) => a + b, 0) / values.length;
    const variance = values.reduce((a, b) => a + (b - mean) ** 2, 0) / values.length;
    return {
      id,
      label: getSignalLabel(id),
      count: values.length,
      min,
      max,
      mean,
      std: Math.sqrt(variance),
    };
  });
}

export function findIndexByRelativeTime(data, relativeSec, startTs) {
  if (!data || data.length === 0) return 0;
  const target = startTs + relativeSec;
  let best = 0;
  let bestDiff = Infinity;
  for (let i = 0; i < data.length; i++) {
    const ts = parseFloat(data[i].ts);
    if (isNaN(ts)) continue;
    const diff = Math.abs(ts - target);
    if (diff < bestDiff) {
      bestDiff = diff;
      best = i;
    }
  }
  return best;
}

export function findIndexAtOrAfterTime(data, absoluteTs) {
  if (!data || data.length === 0) return 0;
  for (let i = 0; i < data.length; i++) {
    const ts = parseFloat(data[i].ts);
    if (!isNaN(ts) && ts >= absoluteTs) return i;
  }
  return data.length - 1;
}

export function gapsOverlap(gapA, gapB, tolerance = 0.15) {
  return gapA.startTime <= gapB.endTime + tolerance && gapB.startTime <= gapA.endTime + tolerance;
}

export function collectBoardStaleGaps(boardDropouts) {
  const boardLabels = {
    sdu0: 'FL', sdu1: 'FR', sdu2: 'RL', sdu3: 'RR',
    gps: 'GPS', inverter: 'INV', bms: 'BMS',
    tspmu0: 'TSPMU0', tspmu1: 'TSPMU1', tshmu: 'TSHMU', imu: 'IMU',
  };
  const rows = [];
  Object.entries(boardDropouts || {}).forEach(([boardKey, gaps]) => {
    (gaps || []).forEach((gap) => {
      if (gap.label === 'LOG DROP') return;
      rows.push({ ...gap, boardKey, boardLabel: boardLabels[boardKey] || boardKey });
    });
  });
  return rows.sort((a, b) => a.startTime - b.startTime);
}

export function getAffectedBoardsForGap(globalGap, boardDropouts) {
  const labels = [];
  Object.entries(boardDropouts || {}).forEach(([boardKey, gaps]) => {
    const stale = (gaps || []).some((g) => g.label !== 'LOG DROP' && gapsOverlap(globalGap, g));
    if (stale) {
      labels.push(boardKey.toUpperCase());
    }
  });
  return labels;
}

export function filterTimestampRows(rows) {
  if (!rows || rows.length === 0) return rows;
  const timestamps = rows.map((r) => parseFloat(r.ts)).filter((t) => !isNaN(t));
  if (timestamps.length === 0) return rows;
  const maxTs = Math.max(...timestamps);
  const minTs = Math.min(...timestamps);
  const span = maxTs - minTs;
  if (maxTs > 1_000_000) {
    return rows.filter((row) => {
      const ts = parseFloat(row.ts);
      return !isNaN(ts) && ts > 1_000_000;
    });
  }
  if (span > 0 && span < 86400 * 7) return rows;
  return rows;
}

export const KEY_STATS_SIGNALS = [
  'gps.vel', 'sdu[0].brake', 'sdu[1].brake', 'sdu[2].brake', 'sdu[3].brake',
  'inv.tq_fb', 'bms.v', 'bms.i', 'bms.soc', 'tshmu.flow1',
];

export function listPlottableMetrics(data) {
  const available = getAvailableSignals(data);
  return [...ALL_SIGNALS.map((s) => s.id), ...DERIVED_SIGNALS.map((s) => s.id)]
    .filter((id, idx, arr) => arr.indexOf(id) === idx && available.includes(id));
}
