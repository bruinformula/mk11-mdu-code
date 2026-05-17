'use strict';

const MAX_LOG_ROWS = 400;
const MAX_CHART_POINTS = 60;
const MAX_GRAPH_HISTORY_MS = 700_000;
const MAX_POINTS_PER_SERIES = 200_000;
const RENDER_POINT_LIMIT = 1500;
const GRAPH_FAVORITES_KEY = 'mdu-graph-favorites';
const GRAPH_ORDER_KEY = 'mdu-graph-order';

const SG_COLORS = ['#f7a35c', '#6ce0e6', '#b9c47a', '#e6b657', '#9badd9', '#ef7457'];
const TIRE_COLORS = {
  max: '#ef7457',
  min: '#6ce0e6',
  center: '#f7a35c',
  ambient: '#b9c47a',
};
const BRAKE_COLORS = {
  brakeC: '#ef7457',
  brakeAmbientC: '#9badd9',
};
const SHOCK_COLOR = '#f7a35c';
const RPM_COLOR = '#6ce0e6';
const FPS_COLOR = '#f7a35c';
const BPS_COLOR = '#6ce0e6';

const api = window.mduDebug;

const state = {
  ports: [],
  connection: null,
  diagnostics: null,
  logStatus: null,
  selectedLogFile: '',
  logRows: [],
  charts: {
    frames: [],
    bytes: [],
  },
  graphs: {
    activeTab: 'dashboard',
    windowSeconds: 60,
    boards: new Map(),
    throughput: {
      fps: [],
      bps: [],
    },
    favorites: new Set(),
    order: {
      favorites: [],
      throughput: [],
      board: {},
    },
    dragging: false,
    hover: { plotId: null, fraction: null },
  },
};

const pendingRenders = {
  log: false,
  diagnostics: false,
  boards: false,
  topIds: false,
  graphs: false,
};

function scheduleRender(kind, fn) {
  if (pendingRenders[kind]) {
    return;
  }
  pendingRenders[kind] = true;
  requestAnimationFrame(() => {
    pendingRenders[kind] = false;
    fn();
  });
}

const elements = {
  portSelect: document.getElementById('port-select'),
  baudInput: document.getElementById('baud-input'),
  autoConnectToggle: document.getElementById('auto-connect-toggle'),
  refreshButton: document.getElementById('refresh-button'),
  connectButton: document.getElementById('connect-button'),
  disconnectButton: document.getElementById('disconnect-button'),
  clearSessionButton: document.getElementById('clear-session-button'),
  clearLogButton: document.getElementById('clear-log-button'),
  chooseLogButton: document.getElementById('choose-log-button'),
  startLogButton: document.getElementById('start-log-button'),
  stopLogButton: document.getElementById('stop-log-button'),
  logPath: document.getElementById('log-path'),
  statusLine: document.getElementById('status-line'),
  connectionChip: document.getElementById('connection-chip'),
  targetChip: document.getElementById('target-chip'),
  metricFps: document.getElementById('metric-fps'),
  metricFpsSub: document.getElementById('metric-fps-sub'),
  metricBps: document.getElementById('metric-bps'),
  metricBpsSub: document.getElementById('metric-bps-sub'),
  metricTotalFrames: document.getElementById('metric-total-frames'),
  metricTotalLines: document.getElementById('metric-total-lines'),
  metricBoardsSeen: document.getElementById('metric-boards-seen'),
  metricBoardFrames: document.getElementById('metric-board-frames'),
  metricParseErrors: document.getElementById('metric-parse-errors'),
  metricLastFrameAge: document.getElementById('metric-last-frame-age'),
  metricPayloadSize: document.getElementById('metric-payload-size'),
  metricTotalBytes: document.getElementById('metric-total-bytes'),
  metricUptime: document.getElementById('metric-uptime'),
  metricPortLabel: document.getElementById('metric-port-label'),
  metricLogStatus: document.getElementById('metric-log-status'),
  metricLogDetail: document.getElementById('metric-log-detail'),
  chartFpsCurrent: document.getElementById('chart-fps-current'),
  chartBpsCurrent: document.getElementById('chart-bps-current'),
  framesChart: document.getElementById('frames-chart'),
  bytesChart: document.getElementById('bytes-chart'),
  topIdsBody: document.getElementById('top-ids-body'),
  boardsGrid: document.getElementById('boards-grid'),
  logBody: document.getElementById('log-body'),
  themeToggle: document.getElementById('theme-toggle'),
  themeToggleLabel: document.querySelector('#theme-toggle .theme-toggle-label'),
  tabButtons: Array.from(document.querySelectorAll('.tab-button')),
  tabPanes: {
    dashboard: document.getElementById('tab-dashboard'),
    graphs: document.getElementById('tab-graphs'),
  },
  graphsWindowSelect: document.getElementById('graphs-window-select'),
  graphsClearButton: document.getElementById('graphs-clear-button'),
  graphsStatusLine: document.getElementById('graphs-status-line'),
  favoritesGrid: document.getElementById('favorites-grid'),
  throughputGrid: document.getElementById('throughput-grid'),
  boardGraphs: document.getElementById('board-graphs'),
};

function applyTheme(theme) {
  const next = theme === 'light' ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', next);
  try {
    localStorage.setItem('mdu-theme', next);
  } catch (error) {
    // ignore — storage may be unavailable
  }
  if (elements.themeToggleLabel) {
    elements.themeToggleLabel.textContent = next === 'dark' ? 'Dark' : 'Light';
  }
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatBytes(value) {
  const number = Number(value) || 0;
  if (number < 1024) {
    return `${number.toFixed(number < 10 ? 1 : 0)} B`;
  }

  if (number < 1024 * 1024) {
    return `${(number / 1024).toFixed(1)} KB`;
  }

  return `${(number / (1024 * 1024)).toFixed(2)} MB`;
}

function formatRate(value) {
  const number = Number(value) || 0;
  return number.toFixed(number >= 100 ? 0 : 1);
}

function formatDuration(milliseconds) {
  if (milliseconds == null) {
    return '--:--';
  }

  const totalSeconds = Math.max(0, Math.floor(milliseconds / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) {
    return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  }

  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

function formatAge(milliseconds) {
  if (milliseconds == null) {
    return 'No activity yet';
  }

  if (milliseconds < 1000) {
    return 'Active now';
  }

  if (milliseconds < 60000) {
    return `${Math.floor(milliseconds / 1000)}s ago`;
  }

  return `${Math.floor(milliseconds / 60000)}m ago`;
}

function formatTimestamp(isoString) {
  if (!isoString) {
    return '--';
  }

  return new Date(isoString).toLocaleTimeString();
}

function describePort(port) {
  if (!port) {
    return 'No USB CDC endpoint selected';
  }

  const usbTag = port.vendorId && port.productId ? `${port.vendorId}:${port.productId}` : 'USB ID unavailable';
  const hubPath = port.locationId ? `hub path ${port.locationId}` : null;
  const extras = [port.manufacturer, hubPath].filter(Boolean).join(' | ');
  return extras ? `${port.path} · ${usbTag} · ${extras}` : `${port.path} · ${usbTag}`;
}

function describeHub(hub) {
  if (!hub) {
    return 'USB2514 hub not detected';
  }

  const usbTag = hub.vendorId && hub.productId ? `${hub.vendorId}:${hub.productId}` : 'USB ID unavailable';
  const extras = [hub.name, hub.locationId].filter(Boolean).join(' | ');
  return extras ? `${usbTag} · ${extras}` : usbTag;
}

function appendChartValue(list, value) {
  list.push(Number(value) || 0);
  if (list.length > MAX_CHART_POINTS) {
    list.shift();
  }
}

function renderSparkline(svgElement, points, color) {
  const width = 360;
  const height = 120;
  const safePoints = points.length > 0 ? points : [0];
  const max = Math.max(...safePoints, 1);
  const stepX = safePoints.length === 1 ? width : width / (safePoints.length - 1);
  const polyline = safePoints
    .map((value, index) => {
      const x = index * stepX;
      const y = height - (value / max) * (height - 12) - 6;
      return `${x.toFixed(2)},${y.toFixed(2)}`;
    })
    .join(' ');

  const area = [`0,${height}`, polyline, `${width},${height}`].join(' ');

  svgElement.innerHTML = `
    <defs>
      <linearGradient id="${svgElement.id}-fill" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="${color}" stop-opacity="0.45"></stop>
        <stop offset="100%" stop-color="${color}" stop-opacity="0.02"></stop>
      </linearGradient>
    </defs>
    <rect x="0" y="0" width="360" height="120" rx="18" fill="rgba(255,255,255,0.035)"></rect>
    <path d="M0 30 H360 M0 60 H360 M0 90 H360" stroke="rgba(255,255,255,0.08)" stroke-width="1"></path>
    <polygon points="${area}" fill="url(#${svgElement.id}-fill)"></polygon>
    <polyline points="${polyline}" fill="none" stroke="${color}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"></polyline>
  `;
}

function updateStatusLine(message) {
  elements.statusLine.textContent = message;
}

function renderPorts() {
  const selectedPath = state.connection?.port?.path ?? state.connection?.preferredPortPath ?? '';
  const options = [];
  const hub = state.connection?.hub;

  if (state.ports.length === 0) {
    options.push(
      `<option value="">${hub?.detected ? 'USB2514 detected, no USB CDC child endpoint' : 'No USB CDC endpoints detected'}</option>`
    );
  }

  for (const port of state.ports) {
    const labelParts = [port.path];
    if (port.matchesTarget) {
      labelParts.push('STM32 USB CDC');
    }
    if (port.locationId) {
      labelParts.push(`hub ${port.locationId}`);
    }

    options.push(
      `<option value="${escapeHtml(port.path)}" ${selectedPath === port.path ? 'selected' : ''}>${escapeHtml(labelParts.join(' · '))}</option>`
    );
  }

  elements.portSelect.innerHTML = options.join('');
}

function renderConnection() {
  const connection = state.connection ?? {};
  const connected = Boolean(connection.connected);
  const hub = connection.hub;
  elements.autoConnectToggle.checked = Boolean(connection.autoConnect);
  elements.baudInput.value = connection.baudRate ?? 115200;
  elements.connectButton.disabled = connected || state.ports.length === 0;
  elements.disconnectButton.disabled = !connected && !connection.connecting;
  elements.connectionChip.textContent = connection.connecting
    ? 'Connecting'
    : connected
      ? 'Connected'
      : 'Disconnected';
  elements.connectionChip.className = `status-chip ${connected ? '' : 'warning'}`.trim();
  elements.targetChip.textContent = hub?.detected
    ? `Hub detected: ${describeHub(hub.info)}`
    : `Looking for USB2514 hub ${hub?.targetVendorId ?? '0424'}:${hub?.targetProductId ?? '2514'}`;

  const currentPort = connection.port;
  if (connected && currentPort) {
    updateStatusLine(`Connected to ${describePort(currentPort)}.`);
  } else if (connection.connecting) {
    updateStatusLine('Opening the selected USB CDC endpoint.');
  } else if (hub?.detected && state.ports.length === 0) {
    updateStatusLine(
      `USB2514 hub detected at ${hub.info?.locationId ?? 'unknown location'}, but macOS has not enumerated a USB CDC child endpoint yet, so there is nothing to mirror.`
    );
  } else if (connection.lastError) {
    updateStatusLine(`Last USB mirror error: ${connection.lastError}`);
  } else if (hub?.lastError) {
    updateStatusLine(`USB topology scan error: ${hub.lastError}`);
  } else {
    updateStatusLine('Waiting for the USB2514 hub and its STM32 USB CDC child endpoint. Bluetooth-style pseudo ports are ignored.');
  }

  renderPorts();
}

function renderDiagnostics() {
  const diagnostics = state.diagnostics ?? {};
  const logging = state.logStatus ?? diagnostics.logging ?? { active: false, linesWritten: 0, bytesWritten: 0 };

  elements.metricFps.textContent = formatRate(diagnostics.framesPerSecond);
  elements.metricFpsSub.textContent = `Average ${formatRate(diagnostics.averageFramesPerSecond)} fps`;
  elements.metricBps.textContent = `${formatBytes(diagnostics.bytesPerSecond)}/s`;
  elements.metricBpsSub.textContent = `Average ${formatBytes(diagnostics.averageBytesPerSecond)}/s`;
  elements.metricTotalFrames.textContent = String(diagnostics.totalFrames ?? 0);
  elements.metricTotalLines.textContent = `${diagnostics.totalLines ?? 0} raw lines`;
  const boards = diagnostics.boards ?? [];
  elements.metricBoardsSeen.textContent = String(boards.length);
  elements.metricBoardFrames.textContent = `${diagnostics.boardFrames ?? 0} board / ${diagnostics.slcanFrames ?? 0} SLCAN`;
  elements.metricParseErrors.textContent = String(diagnostics.parseErrors ?? 0);
  elements.metricLastFrameAge.textContent = diagnostics.timeSinceLastFrameMs == null
    ? 'No frames yet'
    : `Last frame ${formatAge(diagnostics.timeSinceLastFrameMs)}`;
  elements.metricPayloadSize.textContent = `${(diagnostics.averagePayloadBytes ?? 0).toFixed(1)} B`;
  elements.metricTotalBytes.textContent = `${formatBytes(diagnostics.totalBytes ?? 0)} received`;
  elements.metricUptime.textContent = formatDuration(diagnostics.connectionUptimeMs);
  elements.metricPortLabel.textContent = state.connection?.port
    ? describePort(state.connection.port)
    : state.connection?.hub?.detected
      ? `Hub present: ${describeHub(state.connection.hub.info)}`
      : 'No port connected';
  elements.metricLogStatus.textContent = logging.active ? 'Recording' : 'Idle';
  elements.metricLogDetail.textContent = logging.active
    ? `${logging.linesWritten} lines · ${formatBytes(logging.bytesWritten)}`
    : 'No active capture';

  elements.chartFpsCurrent.textContent = `${formatRate(diagnostics.framesPerSecond)} fps`;
  elements.chartBpsCurrent.textContent = `${formatBytes(diagnostics.bytesPerSecond)}/s`;
  renderSparkline(elements.framesChart, state.charts.frames, '#f7a35c');
  renderSparkline(elements.bytesChart, state.charts.bytes, '#6ce0e6');
}

function renderTopIds() {
  const topIds = state.diagnostics?.topIds ?? [];
  if (topIds.length === 0) {
    elements.topIdsBody.innerHTML = '<tr><td class="empty-state" colspan="6">No frames decoded yet.</td></tr>';
    return;
  }

  elements.topIdsBody.innerHTML = topIds
    .map((entry) => {
      const sourceLabel = entry.source === 'board' ? 'Board' : 'SLCAN';
      return `
        <tr>
          <td class="mono">${escapeHtml(entry.idText)}</td>
          <td><span class="pill ${entry.source === 'board' ? 'ok' : 'info'}">${escapeHtml(sourceLabel)}</span></td>
          <td>${entry.count}</td>
          <td>${formatRate(entry.recentHz)}</td>
          <td>${entry.lastDataLength}</td>
          <td class="mono">${escapeHtml(entry.lastDataHex || '--')}</td>
        </tr>
      `;
    })
    .join('');
}

function formatSigned(value, digits) {
  if (value == null || Number.isNaN(value)) {
    return '--';
  }
  return value.toFixed(digits);
}

function formatBoardAge(ageMs) {
  if (ageMs == null) {
    return 'never';
  }
  if (ageMs < 1000) {
    return 'just now';
  }
  if (ageMs < 60000) {
    return `${Math.floor(ageMs / 1000)}s ago`;
  }
  return `${Math.floor(ageMs / 60000)}m ago`;
}

function renderFastBlock(fast) {
  if (!fast) {
    return '<p class="board-empty">Waiting for fast frame...</p>';
  }

  const sgRows = fast.strainGaugesMv
    .map((mv, index) => `<dt>SG${index + 1}</dt><dd>${mv} mV</dd>`)
    .join('');

  return `
    <p class="board-meta">${escapeHtml(fast.idText)} · Δt ${fast.timeSinceLastMs} ms · ${escapeHtml(formatBoardAge(fast.ageMs))}</p>
    <dl class="board-readings">
      ${sgRows}
      <dt>Shock</dt><dd>${formatSigned(fast.shockMm, 2)} mm</dd>
    </dl>
  `;
}

function renderSlowBlock(slow) {
  if (!slow) {
    return '<p class="board-empty">Waiting for slow frame...</p>';
  }

  return `
    <p class="board-meta">${escapeHtml(slow.idText)} · Δt ${slow.timeSinceLastMs} ms · ${escapeHtml(formatBoardAge(slow.ageMs))}</p>
    <dl class="board-readings">
      <dt>RPM</dt><dd>${slow.rpm}</dd>
      <dt>Tire max</dt><dd>${formatSigned(slow.tireC?.max, 1)} &deg;C</dd>
      <dt>Tire min</dt><dd>${formatSigned(slow.tireC?.min, 1)} &deg;C</dd>
      <dt>Tire ctr</dt><dd>${formatSigned(slow.tireC?.center, 1)} &deg;C</dd>
      <dt>Tire amb</dt><dd>${formatSigned(slow.tireC?.ambient, 1)} &deg;C</dd>
      <dt>Brake</dt><dd>${formatSigned(slow.brakeC, 1)} &deg;C</dd>
      <dt>Brake amb</dt><dd>${formatSigned(slow.brakeAmbientC, 1)} &deg;C</dd>
    </dl>
  `;
}

function renderBoards() {
  const boards = state.diagnostics?.boards ?? [];
  if (boards.length === 0) {
    elements.boardsGrid.innerHTML = '<p class="empty-state">No board telemetry frames decoded yet.</p>';
    return;
  }

  elements.boardsGrid.innerHTML = boards
    .map((board) => {
      return `
        <article class="board-card">
          <header class="board-card-header">
            <strong>Board ${board.boardId}</strong>
            <span class="board-age">${escapeHtml(formatBoardAge(board.lastSeenAgeMs))}</span>
          </header>
          <div class="board-cols">
            <div class="board-col">
              <h3>Fast (0x${(0x100 + board.boardId).toString(16).toUpperCase().padStart(3, '0')})</h3>
              ${renderFastBlock(board.fast)}
            </div>
            <div class="board-col">
              <h3>Slow (0x${(0x200 + board.boardId).toString(16).toUpperCase().padStart(3, '0')})</h3>
              ${renderSlowBlock(board.slow)}
            </div>
          </div>
        </article>
      `;
    })
    .join('');
}

function renderLog() {
  if (state.logRows.length === 0) {
    elements.logBody.innerHTML = '<tr><td class="empty-state" colspan="6">No log entries yet.</td></tr>';
    return;
  }

  elements.logBody.innerHTML = state.logRows
    .map((entry) => {
      if (entry.kind === 'runtime') {
        return `
          <tr>
            <td>${escapeHtml(formatTimestamp(entry.timestamp))}</td>
            <td><span class="pill ${entry.level === 'error' ? 'error' : 'info'}">${escapeHtml(entry.level)}</span></td>
            <td>${escapeHtml(entry.message)}</td>
            <td>--</td>
            <td>${escapeHtml(JSON.stringify(entry.details ?? {}))}</td>
            <td class="mono">--</td>
          </tr>
        `;
      }

      if (!entry.ok) {
        return `
          <tr>
            <td>${escapeHtml(formatTimestamp(entry.timestamp))}</td>
            <td><span class="pill error">parse error</span></td>
            <td>${escapeHtml(entry.reason ?? 'decode failed')}</td>
            <td>--</td>
            <td>--</td>
            <td class="mono">${escapeHtml(entry.raw)}</td>
          </tr>
        `;
      }

      if (entry.source === 'board' && entry.board) {
        const idLabel = `B${entry.board.boardId} · ${entry.board.kind === 'fast' ? 'Fast' : 'Slow'} · ${entry.frame.idText}`;
        const summary = entry.board.kind === 'fast'
          ? `SG ${entry.board.strainGaugesMv.join('/')} mV · Shock ${formatSigned(entry.board.shockMm, 2)} mm`
          : `RPM ${entry.board.rpm} · Tire ${formatSigned(entry.board.tireC?.max, 1)}/${formatSigned(entry.board.tireC?.min, 1)}/${formatSigned(entry.board.tireC?.center, 1)}/${formatSigned(entry.board.tireC?.ambient, 1)} · Brk ${formatSigned(entry.board.brakeC, 1)}/${formatSigned(entry.board.brakeAmbientC, 1)}`;
        return `
          <tr>
            <td>${escapeHtml(formatTimestamp(entry.timestamp))}</td>
            <td><span class="pill ok">${escapeHtml(entry.board.kind)}</span></td>
            <td class="mono">${escapeHtml(idLabel)}</td>
            <td>${entry.board.timeSinceLastMs} ms</td>
            <td>${escapeHtml(summary)}</td>
            <td class="mono">${escapeHtml(entry.raw)}</td>
          </tr>
        `;
      }

      return `
        <tr>
          <td>${escapeHtml(formatTimestamp(entry.timestamp))}</td>
          <td><span class="pill info">slcan</span></td>
          <td class="mono">${escapeHtml(entry.frame.idText)}</td>
          <td>${entry.frame.dataLength}</td>
          <td class="mono">${escapeHtml(entry.frame.dataHex)}</td>
          <td class="mono">${escapeHtml(entry.raw)}</td>
        </tr>
      `;
    })
    .join('');
}

function renderLoggingControls() {
  const logStatus = state.logStatus ?? { active: false, filePath: null };
  const activePath = logStatus.filePath || state.selectedLogFile || '';
  elements.logPath.value = activePath;
  elements.startLogButton.disabled = logStatus.active || (!activePath && state.ports.length === 0);
  elements.stopLogButton.disabled = !logStatus.active;
}

function pruneSeries(series, cutoff) {
  let removeCount = 0;
  while (removeCount < series.length && series[removeCount].t < cutoff) {
    removeCount += 1;
  }
  if (removeCount > 0) {
    series.splice(0, removeCount);
  }
}

function recordThroughputSample(now, diagnostics) {
  const cutoff = now - MAX_GRAPH_HISTORY_MS;
  state.graphs.throughput.fps.push({ t: now, v: Number(diagnostics?.framesPerSecond) || 0 });
  state.graphs.throughput.bps.push({ t: now, v: Number(diagnostics?.bytesPerSecond) || 0 });
  pruneSeries(state.graphs.throughput.fps, cutoff);
  pruneSeries(state.graphs.throughput.bps, cutoff);
  if (state.graphs.throughput.fps.length > MAX_POINTS_PER_SERIES) {
    state.graphs.throughput.fps.splice(0, state.graphs.throughput.fps.length - MAX_POINTS_PER_SERIES);
  }
  if (state.graphs.throughput.bps.length > MAX_POINTS_PER_SERIES) {
    state.graphs.throughput.bps.splice(0, state.graphs.throughput.bps.length - MAX_POINTS_PER_SERIES);
  }
}

function getOrCreateBoardHistory(boardId) {
  let entry = state.graphs.boards.get(boardId);
  if (!entry) {
    entry = { fast: [], slow: [], lastSeenAt: 0 };
    state.graphs.boards.set(boardId, entry);
  }
  return entry;
}

function appendBoardSample(frameEvent) {
  if (!frameEvent || !frameEvent.ok || frameEvent.source !== 'board' || !frameEvent.board) {
    return;
  }
  const board = frameEvent.board;
  const now = frameEvent.timestamp ? Date.parse(frameEvent.timestamp) : Date.now();
  if (!Number.isFinite(now)) {
    return;
  }
  const entry = getOrCreateBoardHistory(board.boardId);
  entry.lastSeenAt = now;
  const cutoff = now - MAX_GRAPH_HISTORY_MS;

  if (board.kind === 'fast') {
    entry.fast.push({
      t: now,
      sg: Array.isArray(board.strainGaugesMv) ? board.strainGaugesMv.slice() : [],
      shockMm: Number(board.shockMm),
    });
    pruneSeries(entry.fast, cutoff);
    if (entry.fast.length > MAX_POINTS_PER_SERIES) {
      entry.fast.splice(0, entry.fast.length - MAX_POINTS_PER_SERIES);
    }
  } else if (board.kind === 'slow') {
    entry.slow.push({
      t: now,
      rpm: Number(board.rpm),
      tireMax: Number(board.tireC?.max),
      tireMin: Number(board.tireC?.min),
      tireCtr: Number(board.tireC?.center),
      tireAmb: Number(board.tireC?.ambient),
      brakeC: Number(board.brakeC),
      brakeAmbientC: Number(board.brakeAmbientC),
    });
    pruneSeries(entry.slow, cutoff);
    if (entry.slow.length > MAX_POINTS_PER_SERIES) {
      entry.slow.splice(0, entry.slow.length - MAX_POINTS_PER_SERIES);
    }
  }
}

function activeWindowSeconds() {
  const value = Number(state.graphs.windowSeconds);
  return Number.isFinite(value) && value > 0 ? value : 60;
}

function setActiveTab(tab) {
  const next = tab === 'graphs' ? 'graphs' : 'dashboard';
  state.graphs.activeTab = next;
  for (const button of elements.tabButtons) {
    const isActive = button.dataset.tab === next;
    button.classList.toggle('active', isActive);
    button.setAttribute('aria-selected', isActive ? 'true' : 'false');
  }
  for (const [name, pane] of Object.entries(elements.tabPanes)) {
    if (!pane) continue;
    const isActive = name === next;
    pane.classList.toggle('active', isActive);
    if (isActive) {
      pane.removeAttribute('hidden');
    } else {
      pane.setAttribute('hidden', '');
    }
  }
  if (next === 'graphs') {
    renderGraphs();
  }
}

function pickWindowedPoints(series, now, windowMs) {
  if (!series.length) return [];
  const cutoff = now - windowMs;
  let startIdx = 0;
  while (startIdx < series.length && series[startIdx].t < cutoff) {
    startIdx += 1;
  }
  const sliceStart = startIdx > 0 ? startIdx - 1 : 0;
  return series.slice(sliceStart);
}

function renderMultiLinePlot(svgElement, lines, options) {
  const width = 720;
  const height = 220;
  const padLeft = 44;
  const padRight = 12;
  const padTop = 14;
  const padBottom = 26;
  const plotWidth = width - padLeft - padRight;
  const plotHeight = height - padTop - padBottom;

  const now = options.now;
  const windowMs = options.windowMs;
  const start = now - windowMs;

  const hasData = lines.some((line) => line.points && line.points.length > 0);
  if (!hasData) {
    svgElement.innerHTML = `
      <rect x="0" y="0" width="${width}" height="${height}" rx="14" fill="rgba(255,255,255,0.02)"></rect>
      <text x="${width / 2}" y="${height / 2}" text-anchor="middle" fill="rgba(255,255,255,0.45)" font-size="14" font-family="Avenir Next, sans-serif">${escapeHtml(options.emptyText || 'No samples yet')}</text>
    `;
    return;
  }

  let yMin = Infinity;
  let yMax = -Infinity;
  for (const line of lines) {
    for (const point of line.points) {
      if (point.t < start) continue;
      if (!Number.isFinite(point.v)) continue;
      if (point.v < yMin) yMin = point.v;
      if (point.v > yMax) yMax = point.v;
    }
  }
  if (!Number.isFinite(yMin) || !Number.isFinite(yMax)) {
    yMin = 0;
    yMax = 1;
  }
  if (options.yMinClamp != null && yMin > options.yMinClamp) {
    yMin = options.yMinClamp;
  }
  if (yMin === yMax) {
    const pad = Math.max(1, Math.abs(yMin) * 0.1);
    yMin -= pad;
    yMax += pad;
  } else {
    const pad = (yMax - yMin) * 0.08;
    yMin -= pad;
    yMax += pad;
  }

  const xScale = (t) => padLeft + ((t - start) / windowMs) * plotWidth;
  const yScale = (v) => padTop + (1 - (v - yMin) / (yMax - yMin)) * plotHeight;

  const tickCount = 4;
  const yTicks = [];
  for (let i = 0; i <= tickCount; i += 1) {
    const value = yMin + ((yMax - yMin) * i) / tickCount;
    yTicks.push({ value, y: yScale(value) });
  }

  const yTickLines = yTicks
    .map(({ y }) => `<line x1="${padLeft}" y1="${y.toFixed(1)}" x2="${(width - padRight).toFixed(1)}" y2="${y.toFixed(1)}" stroke="rgba(255,255,255,0.07)" stroke-width="1"></line>`)
    .join('');

  const yTickLabels = yTicks
    .map(({ value, y }) => {
      const label = options.formatY ? options.formatY(value) : value.toFixed(1);
      return `<text x="${padLeft - 6}" y="${(y + 4).toFixed(1)}" text-anchor="end" fill="rgba(255,255,255,0.55)" font-size="10" font-family="SF Mono, Menlo, monospace">${escapeHtml(label)}</text>`;
    })
    .join('');

  const windowSec = windowMs / 1000;
  const xLabels = [`-${windowSec.toFixed(0)}s`, `-${(windowSec / 2).toFixed(0)}s`, 'now'];
  const xLabelMarkup = xLabels
    .map((label, idx) => {
      const x = padLeft + (idx / (xLabels.length - 1)) * plotWidth;
      return `<text x="${x.toFixed(1)}" y="${(height - 8).toFixed(1)}" text-anchor="middle" fill="rgba(255,255,255,0.55)" font-size="10" font-family="SF Mono, Menlo, monospace">${escapeHtml(label)}</text>`;
    })
    .join('');

  const linesMarkup = lines
    .map((line) => {
      const visible = line.points.filter((p) => p.t >= start - windowMs * 0.05 && Number.isFinite(p.v));
      if (visible.length === 0) {
        return '';
      }
      if (visible.length === 1) {
        const cx = xScale(visible[0].t).toFixed(2);
        const cy = yScale(visible[0].v).toFixed(2);
        return `<circle cx="${cx}" cy="${cy}" r="2.5" fill="${line.color}"></circle>`;
      }
      const renderPoints = downsampleForRender(visible, RENDER_POINT_LIMIT);
      const points = renderPoints
        .map((p) => `${xScale(p.t).toFixed(2)},${yScale(p.v).toFixed(2)}`)
        .join(' ');
      return `<polyline points="${points}" fill="none" stroke="${line.color}" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"></polyline>`;
    })
    .join('');

  svgElement.innerHTML = `
    <rect x="0" y="0" width="${width}" height="${height}" rx="14" fill="rgba(255,255,255,0.02)"></rect>
    ${yTickLines}
    <line x1="${padLeft}" y1="${padTop}" x2="${padLeft}" y2="${padTop + plotHeight}" stroke="rgba(255,255,255,0.18)" stroke-width="1"></line>
    <line x1="${padLeft}" y1="${(padTop + plotHeight).toFixed(1)}" x2="${(width - padRight).toFixed(1)}" y2="${(padTop + plotHeight).toFixed(1)}" stroke="rgba(255,255,255,0.18)" stroke-width="1"></line>
    ${linesMarkup}
    ${yTickLabels}
    ${xLabelMarkup}
    <rect class="hover-capture" x="${padLeft}" y="${padTop}" width="${plotWidth}" height="${plotHeight}" fill="transparent" pointer-events="all"></rect>
    <g class="hover-layer"></g>
  `;
}

function downsampleForRender(points, maxOut) {
  if (points.length <= maxOut) return points;
  const stride = Math.ceil(points.length / maxOut);
  const out = [];
  for (let i = 0; i < points.length; i += stride) {
    out.push(points[i]);
  }
  if (out[out.length - 1] !== points[points.length - 1]) {
    out.push(points[points.length - 1]);
  }
  return out;
}

function findNearestPointIndex(points, t) {
  if (!points.length) return -1;
  let lo = 0;
  let hi = points.length - 1;
  if (t <= points[lo].t) return lo;
  if (t >= points[hi].t) return hi;
  while (lo < hi - 1) {
    const mid = (lo + hi) >> 1;
    if (points[mid].t <= t) lo = mid;
    else hi = mid;
  }
  return (t - points[lo].t) < (points[hi].t - t) ? lo : hi;
}

function computePlotYRange(def) {
  const opts = def.plotOptions || {};
  const start = opts.now - opts.windowMs;
  let yMin = Infinity;
  let yMax = -Infinity;
  for (const line of def.lines) {
    for (const p of line.points) {
      if (p.t < start) continue;
      if (!Number.isFinite(p.v)) continue;
      if (p.v < yMin) yMin = p.v;
      if (p.v > yMax) yMax = p.v;
    }
  }
  if (!Number.isFinite(yMin) || !Number.isFinite(yMax)) {
    yMin = 0;
    yMax = 1;
  }
  if (opts.yMinClamp != null && yMin > opts.yMinClamp) {
    yMin = opts.yMinClamp;
  }
  if (yMin === yMax) {
    const pad = Math.max(1, Math.abs(yMin) * 0.1);
    yMin -= pad;
    yMax += pad;
  } else {
    const pad = (yMax - yMin) * 0.08;
    yMin -= pad;
    yMax += pad;
  }
  return { yMin, yMax };
}

function applyHoverToCard(card, def, fraction) {
  if (!card || !def) return;
  const svg = card.querySelector('svg.graph-svg');
  if (!svg) return;
  const layer = svg.querySelector('.hover-layer');
  if (!layer) return;
  if (fraction == null || !Number.isFinite(fraction)) {
    layer.innerHTML = '';
    return;
  }
  const width = 720;
  const height = 220;
  const padLeft = 44;
  const padRight = 12;
  const padTop = 14;
  const padBottom = 26;
  const plotWidth = width - padLeft - padRight;
  const plotHeight = height - padTop - padBottom;
  const clamped = Math.max(0, Math.min(1, fraction));
  const x = padLeft + clamped * plotWidth;
  const opts = def.plotOptions || {};
  const now = opts.now;
  const windowMs = opts.windowMs;
  const start = now - windowMs;
  const t = start + clamped * windowMs;

  const { yMin, yMax } = computePlotYRange(def);
  const yScale = (v) => padTop + (1 - (v - yMin) / (yMax - yMin)) * plotHeight;

  const readouts = [];
  const dotsMarkup = [];
  for (const line of def.lines) {
    if (!line.points || !line.points.length) continue;
    const idx = findNearestPointIndex(line.points, t);
    if (idx < 0) continue;
    const p = line.points[idx];
    if (!Number.isFinite(p.v)) continue;
    if (p.t < start - windowMs * 0.05 || p.t > now + windowMs * 0.05) continue;
    const cx = padLeft + ((p.t - start) / windowMs) * plotWidth;
    const cy = yScale(p.v);
    dotsMarkup.push(`<circle cx="${cx.toFixed(2)}" cy="${cy.toFixed(2)}" r="3.2" fill="${line.color}" stroke="rgba(10,16,28,0.95)" stroke-width="1"></circle>`);
    const valueLabel = def.legendFormatter ? def.legendFormatter(p.v) : p.v.toFixed(2);
    readouts.push({ color: line.color, name: line.label, value: valueLabel });
  }

  const relSec = (t - now) / 1000;
  const timeLabel = Math.abs(relSec) < 0.05 ? 'now' : `${relSec >= 0 ? '+' : ''}${relSec.toFixed(2)}s`;

  const rowHeight = 14;
  const tipPad = 6;
  const charWidth = 6.6;
  const rowLabels = [timeLabel, ...readouts.map((r) => `${r.name}: ${r.value}`)];
  const maxLen = rowLabels.reduce((m, s) => Math.max(m, s.length), 0);
  const tipW = Math.min(280, maxLen * charWidth + tipPad * 2 + 14);
  const tipH = rowLabels.length * rowHeight + tipPad * 2;
  let tipX = x + 10;
  if (tipX + tipW > width - padRight - 2) {
    tipX = x - 10 - tipW;
  }
  if (tipX < padLeft + 2) {
    tipX = padLeft + 2;
  }
  let tipY = padTop + 4;
  if (tipY + tipH > padTop + plotHeight - 2) {
    tipY = padTop + plotHeight - 2 - tipH;
  }

  let textMarkup = `<rect x="${tipX.toFixed(1)}" y="${tipY.toFixed(1)}" width="${tipW.toFixed(1)}" height="${tipH.toFixed(1)}" rx="6" fill="rgba(10,16,28,0.92)" stroke="rgba(255,255,255,0.18)"></rect>`;
  textMarkup += `<text x="${(tipX + tipPad + 2).toFixed(1)}" y="${(tipY + tipPad + 11).toFixed(1)}" fill="rgba(255,255,255,0.85)" font-size="11" font-family="SF Mono, Menlo, monospace">${escapeHtml(timeLabel)}</text>`;
  for (let i = 0; i < readouts.length; i += 1) {
    const r = readouts[i];
    const ty = tipY + tipPad + 11 + (i + 1) * rowHeight;
    textMarkup += `<circle cx="${(tipX + tipPad + 4).toFixed(1)}" cy="${(ty - 4).toFixed(1)}" r="3" fill="${r.color}"></circle>`;
    textMarkup += `<text x="${(tipX + tipPad + 12).toFixed(1)}" y="${ty.toFixed(1)}" fill="rgba(255,255,255,0.92)" font-size="11" font-family="SF Mono, Menlo, monospace">${escapeHtml(`${r.name}: ${r.value}`)}</text>`;
  }

  layer.innerHTML = `
    <line x1="${x.toFixed(2)}" y1="${padTop}" x2="${x.toFixed(2)}" y2="${(padTop + plotHeight).toFixed(1)}" stroke="rgba(255,255,255,0.35)" stroke-dasharray="3,3" stroke-width="1"></line>
    ${dotsMarkup.join('')}
    ${textMarkup}
  `;
}

function attachHoverHandlers(card, def) {
  const svg = card.querySelector('svg.graph-svg');
  if (!svg) return;
  const width = 720;
  const padLeft = 44;
  const padRight = 12;
  const plotWidth = width - padLeft - padRight;

  const handleMove = (event) => {
    const rect = svg.getBoundingClientRect();
    if (rect.width === 0) return;
    const vbX = (event.clientX - rect.left) * (width / rect.width);
    const fraction = (vbX - padLeft) / plotWidth;
    state.graphs.hover = { plotId: def.id, fraction };
    applyHoverToCard(card, def, fraction);
  };
  const handleLeave = () => {
    state.graphs.hover = { plotId: null, fraction: null };
    applyHoverToCard(card, def, null);
  };
  svg.addEventListener('mousemove', handleMove);
  svg.addEventListener('mouseleave', handleLeave);
}

function buildLegend(lines, formatValue) {
  return `
    <div class="graph-legend">
      ${lines
        .map((line) => {
          const last = line.points.length > 0 ? line.points[line.points.length - 1].v : null;
          const valueLabel = last == null || !Number.isFinite(last)
            ? '--'
            : formatValue
              ? formatValue(last)
              : last.toFixed(2);
          return `
            <span class="legend-item">
              <span class="legend-swatch" style="background:${line.color}"></span>
              <span>${escapeHtml(line.label)}</span>
              <span class="legend-value">${escapeHtml(valueLabel)}</span>
            </span>
          `;
        })
        .join('')}
    </div>
  `;
}

function loadGraphPrefs() {
  try {
    const favRaw = localStorage.getItem(GRAPH_FAVORITES_KEY);
    if (favRaw) {
      const arr = JSON.parse(favRaw);
      if (Array.isArray(arr)) {
        state.graphs.favorites = new Set(arr.map(String));
      }
    }
    const orderRaw = localStorage.getItem(GRAPH_ORDER_KEY);
    if (orderRaw) {
      const parsed = JSON.parse(orderRaw);
      if (parsed && typeof parsed === 'object') {
        if (Array.isArray(parsed.favorites)) state.graphs.order.favorites = parsed.favorites.map(String);
        if (Array.isArray(parsed.throughput)) state.graphs.order.throughput = parsed.throughput.map(String);
        if (parsed.board && typeof parsed.board === 'object') {
          state.graphs.order.board = {};
          for (const [k, v] of Object.entries(parsed.board)) {
            if (Array.isArray(v)) state.graphs.order.board[k] = v.map(String);
          }
        }
      }
    }
  } catch (error) {
    // ignore
  }
}

function saveGraphPrefs() {
  try {
    localStorage.setItem(GRAPH_FAVORITES_KEY, JSON.stringify([...state.graphs.favorites]));
    localStorage.setItem(GRAPH_ORDER_KEY, JSON.stringify(state.graphs.order));
  } catch (error) {
    // ignore
  }
}

function toggleFavorite(plotId) {
  if (state.graphs.favorites.has(plotId)) {
    state.graphs.favorites.delete(plotId);
    state.graphs.order.favorites = state.graphs.order.favorites.filter((id) => id !== plotId);
  } else {
    state.graphs.favorites.add(plotId);
    if (!state.graphs.order.favorites.includes(plotId)) {
      state.graphs.order.favorites.push(plotId);
    }
  }
  saveGraphPrefs();
  renderGraphs();
}

function applyOrderedSort(defs, order) {
  if (!order || order.length === 0) return defs.slice();
  const rank = new Map();
  order.forEach((id, idx) => rank.set(id, idx));
  const known = [];
  const unknown = [];
  for (const def of defs) {
    if (rank.has(def.id)) known.push(def);
    else unknown.push(def);
  }
  known.sort((a, b) => rank.get(a.id) - rank.get(b.id));
  return [...known, ...unknown];
}

function buildPlotCard(def) {
  const card = document.createElement('article');
  card.className = 'graph-card';
  card.dataset.plotId = def.id;
  card.draggable = true;
  const isFav = state.graphs.favorites.has(def.id);
  card.innerHTML = `
    <div class="graph-header">
      <h3>${escapeHtml(def.title)}</h3>
      <div class="graph-card-actions">
        <strong>${escapeHtml(def.badge ?? '')}</strong>
        <button class="favorite-btn ${isFav ? 'is-favorite' : ''}" type="button" title="${isFav ? 'Unpin from favorites' : 'Pin to favorites'}" aria-pressed="${isFav ? 'true' : 'false'}">★</button>
        <span class="drag-handle" title="Drag to reorder" aria-hidden="true">⋮⋮</span>
      </div>
    </div>
    <svg class="graph-svg" viewBox="0 0 720 220" preserveAspectRatio="none"></svg>
    ${buildLegend(def.lines, def.legendFormatter)}
  `;
  renderMultiLinePlot(card.querySelector('svg'), def.lines, def.plotOptions);
  card._plotDef = def;
  card.querySelector('.favorite-btn').addEventListener('click', (event) => {
    event.stopPropagation();
    toggleFavorite(def.id);
  });
  wireCardDrag(card);
  attachHoverHandlers(card, def);
  return card;
}

function wireCardDrag(card) {
  card.addEventListener('dragstart', (event) => {
    state.graphs.dragging = true;
    event.dataTransfer.effectAllowed = 'move';
    try {
      event.dataTransfer.setData('text/plain', card.dataset.plotId);
    } catch (error) {
      // ignore — Safari/Edge sometimes throws on synthetic events
    }
    card.classList.add('dragging');
    const container = card.parentElement;
    if (container) container.classList.add('drop-target');
  });
  card.addEventListener('dragend', () => {
    state.graphs.dragging = false;
    card.classList.remove('dragging');
    document.querySelectorAll('.graphs-drop-zone.drop-target, .board-graph-grid.drop-target')
      .forEach((el) => el.classList.remove('drop-target'));
  });
  card.addEventListener('dragover', (event) => {
    const container = card.parentElement;
    if (!container) return;
    const dragging = container.querySelector('.graph-card.dragging');
    if (!dragging || dragging === card) return;
    event.preventDefault();
    const rect = card.getBoundingClientRect();
    const before = (event.clientY - rect.top) / rect.height < 0.5;
    if (before) {
      container.insertBefore(dragging, card);
    } else {
      container.insertBefore(dragging, card.nextSibling);
    }
  });
}

function wireDropZone(container, orderKey) {
  if (!container || container.dataset.dropWired === '1') return;
  container.dataset.dropWired = '1';
  container.addEventListener('dragover', (event) => {
    if (!state.graphs.dragging) return;
    const dragging = container.querySelector('.graph-card.dragging');
    if (!dragging) return;
    event.preventDefault();
    if (!dragging.parentElement || dragging.parentElement === container) {
      // dragging within this container — handled by card dragover
      return;
    }
  });
  container.addEventListener('drop', (event) => {
    event.preventDefault();
    const ids = [...container.querySelectorAll(':scope > .graph-card')]
      .map((card) => card.dataset.plotId)
      .filter(Boolean);
    if (orderKey === 'favorites') {
      state.graphs.order.favorites = ids;
    } else if (orderKey === 'throughput') {
      state.graphs.order.throughput = ids;
    } else if (orderKey.startsWith('board:')) {
      state.graphs.order.board[orderKey.slice(6)] = ids;
    }
    saveGraphPrefs();
  });
}

function buildAllPlotDefs(now, windowMs) {
  const defs = [];

  const fpsPoints = pickWindowedPoints(state.graphs.throughput.fps, now, windowMs);
  const bpsPoints = pickWindowedPoints(state.graphs.throughput.bps, now, windowMs);

  defs.push({
    id: 'throughput:fps',
    section: 'throughput',
    title: 'Frames / sec',
    badge: `${formatRate(fpsPoints.length ? fpsPoints[fpsPoints.length - 1].v : 0)} fps`,
    lines: [{ label: 'fps', color: FPS_COLOR, points: fpsPoints.map((p) => ({ t: p.t, v: p.v })) }],
    plotOptions: { now, windowMs, yMinClamp: 0, formatY: (v) => v.toFixed(v >= 100 ? 0 : 1), emptyText: 'No throughput samples yet' },
    legendFormatter: (v) => `${formatRate(v)} fps`,
  });

  defs.push({
    id: 'throughput:bps',
    section: 'throughput',
    title: 'Bytes / sec',
    badge: `${formatBytes(bpsPoints.length ? bpsPoints[bpsPoints.length - 1].v : 0)}/s`,
    lines: [{ label: 'bytes/s', color: BPS_COLOR, points: bpsPoints.map((p) => ({ t: p.t, v: p.v })) }],
    plotOptions: { now, windowMs, yMinClamp: 0, formatY: (v) => formatBytes(v), emptyText: 'No throughput samples yet' },
    legendFormatter: (v) => `${formatBytes(v)}/s`,
  });

  const boardIds = [...state.graphs.boards.keys()].sort((a, b) => a - b);
  for (const boardId of boardIds) {
    const history = state.graphs.boards.get(boardId);
    const fastPoints = pickWindowedPoints(history.fast, now, windowMs);
    const slowPoints = pickWindowedPoints(history.slow, now, windowMs);

    defs.push({
      id: `board:${boardId}:sg`,
      section: 'board',
      boardId,
      title: `Board ${boardId} · Strain Gauges (mV)`,
      badge: `${fastPoints.length} pts`,
      lines: SG_COLORS.map((color, idx) => ({
        label: `SG${idx + 1}`,
        color,
        points: fastPoints.map((row) => ({ t: row.t, v: Number(row.sg?.[idx]) })),
      })),
      plotOptions: { now, windowMs, formatY: (v) => v.toFixed(0), emptyText: 'Waiting for fast frames' },
      legendFormatter: (v) => `${v.toFixed(0)} mV`,
    });

    defs.push({
      id: `board:${boardId}:shock`,
      section: 'board',
      boardId,
      title: `Board ${boardId} · Shock (mm)`,
      badge: `${fastPoints.length} pts`,
      lines: [{ label: 'Shock', color: SHOCK_COLOR, points: fastPoints.map((row) => ({ t: row.t, v: row.shockMm })) }],
      plotOptions: { now, windowMs, formatY: (v) => v.toFixed(2), emptyText: 'Waiting for fast frames' },
      legendFormatter: (v) => `${v.toFixed(2)} mm`,
    });

    defs.push({
      id: `board:${boardId}:rpm`,
      section: 'board',
      boardId,
      title: `Board ${boardId} · RPM`,
      badge: `${slowPoints.length} pts`,
      lines: [{ label: 'RPM', color: RPM_COLOR, points: slowPoints.map((row) => ({ t: row.t, v: row.rpm })) }],
      plotOptions: { now, windowMs, yMinClamp: 0, formatY: (v) => v.toFixed(0), emptyText: 'Waiting for slow frames' },
      legendFormatter: (v) => v.toFixed(0),
    });

    defs.push({
      id: `board:${boardId}:tire`,
      section: 'board',
      boardId,
      title: `Board ${boardId} · Tire Temps (°C)`,
      badge: `${slowPoints.length} pts`,
      lines: [
        { label: 'Max', color: TIRE_COLORS.max, points: slowPoints.map((row) => ({ t: row.t, v: row.tireMax })) },
        { label: 'Min', color: TIRE_COLORS.min, points: slowPoints.map((row) => ({ t: row.t, v: row.tireMin })) },
        { label: 'Ctr', color: TIRE_COLORS.center, points: slowPoints.map((row) => ({ t: row.t, v: row.tireCtr })) },
        { label: 'Amb', color: TIRE_COLORS.ambient, points: slowPoints.map((row) => ({ t: row.t, v: row.tireAmb })) },
      ],
      plotOptions: { now, windowMs, formatY: (v) => v.toFixed(1), emptyText: 'Waiting for slow frames' },
      legendFormatter: (v) => `${v.toFixed(1)} °C`,
    });

    defs.push({
      id: `board:${boardId}:brake`,
      section: 'board',
      boardId,
      title: `Board ${boardId} · Brake Temps (°C)`,
      badge: `${slowPoints.length} pts`,
      lines: [
        { label: 'Brake', color: BRAKE_COLORS.brakeC, points: slowPoints.map((row) => ({ t: row.t, v: row.brakeC })) },
        { label: 'Brake Amb', color: BRAKE_COLORS.brakeAmbientC, points: slowPoints.map((row) => ({ t: row.t, v: row.brakeAmbientC })) },
      ],
      plotOptions: { now, windowMs, formatY: (v) => v.toFixed(1), emptyText: 'Waiting for slow frames' },
      legendFormatter: (v) => `${v.toFixed(1)} °C`,
    });
  }

  return { defs, boardIds };
}

function renderFavoritesSection(favDefs) {
  const ordered = applyOrderedSort(favDefs, state.graphs.order.favorites);
  if (ordered.length === 0) {
    elements.favoritesGrid.innerHTML = '<p class="empty-state">Click the star on any graph to pin it here.</p>';
    return;
  }
  elements.favoritesGrid.replaceChildren(...ordered.map(buildPlotCard));
}

function renderThroughputSection(throughputDefs) {
  const ordered = applyOrderedSort(throughputDefs, state.graphs.order.throughput);
  if (ordered.length === 0) {
    elements.throughputGrid.innerHTML = '<p class="empty-state">Throughput plots are pinned to Favorites.</p>';
    return;
  }
  elements.throughputGrid.replaceChildren(...ordered.map(buildPlotCard));
}

function renderBoardSection(boardIds, defsByBoard, now) {
  if (boardIds.length === 0) {
    elements.boardGraphs.innerHTML = '<p class="empty-state">No board telemetry decoded yet.</p>';
    return;
  }
  const fragment = document.createDocumentFragment();
  for (const boardId of boardIds) {
    const history = state.graphs.boards.get(boardId);
    const defsForBoard = defsByBoard.get(boardId) || [];
    if (defsForBoard.length === 0) continue;
    const ageMs = history.lastSeenAt ? now - history.lastSeenAt : null;
    const card = document.createElement('article');
    card.className = 'board-graph-card';
    card.dataset.boardId = String(boardId);
    card.innerHTML = `
      <header>
        <strong>Board ${boardId}</strong>
        <span class="board-age">${escapeHtml(formatBoardAge(ageMs))} · ${history.fast.length} fast / ${history.slow.length} slow</span>
      </header>
      <div class="board-graph-grid graphs-drop-zone" data-drop-key="board:${boardId}"></div>
    `;
    const grid = card.querySelector('.board-graph-grid');
    const ordered = applyOrderedSort(defsForBoard, state.graphs.order.board[String(boardId)]);
    for (const def of ordered) {
      grid.appendChild(buildPlotCard(def));
    }
    wireDropZone(grid, `board:${boardId}`);
    fragment.appendChild(card);
  }
  elements.boardGraphs.replaceChildren(fragment);
}

function renderGraphs() {
  if (state.graphs.activeTab !== 'graphs') return;
  if (state.graphs.dragging) return;

  const now = Date.now();
  const windowMs = activeWindowSeconds() * 1000;
  const { defs, boardIds } = buildAllPlotDefs(now, windowMs);

  if (boardIds.length === 0) {
    elements.graphsStatusLine.textContent = 'Waiting for board telemetry frames.';
  } else {
    const totalFast = boardIds.reduce((sum, id) => sum + state.graphs.boards.get(id).fast.length, 0);
    const totalSlow = boardIds.reduce((sum, id) => sum + state.graphs.boards.get(id).slow.length, 0);
    elements.graphsStatusLine.textContent = `Tracking ${boardIds.length} board${boardIds.length === 1 ? '' : 's'} · ${totalFast} fast / ${totalSlow} slow samples buffered · window ${activeWindowSeconds()}s`;
  }

  const favDefs = [];
  const throughputDefs = [];
  const boardDefsByBoard = new Map();
  for (const def of defs) {
    if (state.graphs.favorites.has(def.id)) {
      favDefs.push(def);
      continue;
    }
    if (def.section === 'throughput') {
      throughputDefs.push(def);
    } else if (def.section === 'board') {
      const list = boardDefsByBoard.get(def.boardId) || [];
      list.push(def);
      boardDefsByBoard.set(def.boardId, list);
    }
  }

  renderFavoritesSection(favDefs);
  renderThroughputSection(throughputDefs);
  renderBoardSection(boardIds, boardDefsByBoard, now);
  reapplyHoverAfterRender();
}

function reapplyHoverAfterRender() {
  const hover = state.graphs.hover;
  if (!hover || !hover.plotId || hover.fraction == null) return;
  const escaped = (window.CSS && CSS.escape) ? CSS.escape(hover.plotId) : hover.plotId.replace(/"/g, '\\"');
  const card = document.querySelector(`.graph-card[data-plot-id="${escaped}"]`);
  if (!card) return;
  const def = card._plotDef;
  if (!def) return;
  applyHoverToCard(card, def, hover.fraction);
}

function renderAll() {
  renderConnection();
  renderDiagnostics();
  renderBoards();
  renderTopIds();
  renderLog();
  renderLoggingControls();
  renderGraphs();
}

function addLogRow(entry) {
  state.logRows.unshift(entry);
  if (state.logRows.length > MAX_LOG_ROWS) {
    state.logRows.length = MAX_LOG_ROWS;
  }
  scheduleRender('log', renderLog);
}

async function chooseAndMaybeStartLogging() {
  const filePath = await api.pickLogFile();
  if (!filePath) {
    return;
  }

  state.selectedLogFile = filePath;
  renderLoggingControls();
}

function wireUi() {
  applyTheme(document.documentElement.getAttribute('data-theme') || 'dark');

  elements.themeToggle.addEventListener('click', () => {
    const current = document.documentElement.getAttribute('data-theme') || 'dark';
    applyTheme(current === 'dark' ? 'light' : 'dark');
  });

  elements.refreshButton.addEventListener('click', async () => {
    await api.listPorts();
  });

  elements.connectButton.addEventListener('click', async () => {
    const portPath = elements.portSelect.value;
    const baudRate = Number(elements.baudInput.value) || 115200;
    if (!portPath) {
      if (state.connection?.hub?.detected) {
        updateStatusLine('The USB2514 hub is visible, but macOS has not exposed a USB CDC child endpoint to open.');
      } else {
        updateStatusLine('Select a USB CDC endpoint first.');
      }
      return;
    }

    await api.connect({ path: portPath, baudRate });
  });

  elements.disconnectButton.addEventListener('click', async () => {
    await api.disconnect();
  });

  elements.autoConnectToggle.addEventListener('change', async (event) => {
    await api.setAutoConnect(event.target.checked);
  });

  elements.clearSessionButton.addEventListener('click', async () => {
    state.charts.frames = [];
    state.charts.bytes = [];
    state.graphs.boards = new Map();
    state.graphs.throughput.fps = [];
    state.graphs.throughput.bps = [];
    scheduleRender('graphs', renderGraphs);
    await api.clearSession();
  });

  for (const button of elements.tabButtons) {
    button.addEventListener('click', () => setActiveTab(button.dataset.tab));
  }

  elements.graphsWindowSelect.addEventListener('change', (event) => {
    const next = Number(event.target.value);
    if (Number.isFinite(next) && next > 0) {
      state.graphs.windowSeconds = next;
      renderGraphs();
    }
  });

  elements.graphsClearButton.addEventListener('click', () => {
    state.graphs.boards = new Map();
    state.graphs.throughput.fps = [];
    state.graphs.throughput.bps = [];
    renderGraphs();
  });

  wireDropZone(elements.favoritesGrid, 'favorites');
  wireDropZone(elements.throughputGrid, 'throughput');

  elements.clearLogButton.addEventListener('click', () => {
    state.logRows = [];
    renderLog();
  });

  elements.chooseLogButton.addEventListener('click', chooseAndMaybeStartLogging);

  elements.startLogButton.addEventListener('click', async () => {
    let filePath = state.selectedLogFile || state.logStatus?.filePath;
    if (!filePath) {
      filePath = await api.pickLogFile();
      if (!filePath) {
        return;
      }
      state.selectedLogFile = filePath;
    }

    state.logStatus = await api.startLogging(filePath);
    renderLoggingControls();
  });

  elements.stopLogButton.addEventListener('click', async () => {
    state.logStatus = await api.stopLogging();
    renderLoggingControls();
  });
}

function wireEvents() {
  api.onPorts((ports) => {
    state.ports = ports;
    renderPorts();
  });

  api.onConnection((connection) => {
    state.connection = connection;
    renderConnection();
  });

  api.onDiagnostics((diagnostics) => {
    state.diagnostics = diagnostics;
    appendChartValue(state.charts.frames, diagnostics.framesPerSecond ?? 0);
    appendChartValue(state.charts.bytes, diagnostics.bytesPerSecond ?? 0);
    recordThroughputSample(Date.now(), diagnostics);
    scheduleRender('diagnostics', renderDiagnostics);
    scheduleRender('boards', renderBoards);
    scheduleRender('topIds', renderTopIds);
    scheduleRender('graphs', renderGraphs);
  });

  api.onFrame((frame) => {
    addLogRow(frame);
    appendBoardSample(frame);
  });

  api.onRuntime((runtime) => {
    addLogRow({ kind: 'runtime', ...runtime });
  });

  api.onLogStatus((logStatus) => {
    state.logStatus = logStatus;
    renderLoggingControls();
    renderDiagnostics();
  });
}

async function init() {
  loadGraphPrefs();

  const initialState = await api.getInitialState();
  state.ports = initialState.ports;
  state.connection = initialState.connection;
  state.diagnostics = initialState.diagnostics;
  state.logStatus = initialState.logStatus;
  state.selectedLogFile = initialState.logStatus?.filePath ?? '';

  appendChartValue(state.charts.frames, state.diagnostics?.framesPerSecond ?? 0);
  appendChartValue(state.charts.bytes, state.diagnostics?.bytesPerSecond ?? 0);
  recordThroughputSample(Date.now(), state.diagnostics);

  wireUi();
  wireEvents();

  if (elements.graphsWindowSelect) {
    elements.graphsWindowSelect.value = String(state.graphs.windowSeconds);
  }
  setActiveTab(state.graphs.activeTab);
  renderAll();
}

init().catch((error) => {
  updateStatusLine(`Failed to initialize the renderer: ${error.message}`);
});