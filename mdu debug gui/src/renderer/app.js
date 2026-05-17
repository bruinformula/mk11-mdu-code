'use strict';

const MAX_LOG_ROWS = 400;
const MAX_CHART_POINTS = 60;
const MAX_GRAPH_POINTS_PER_SERIES = 1200;
const MAX_THROUGHPUT_GRAPH_POINTS = 600;

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
  graphFps: document.getElementById('graph-fps'),
  graphFpsCurrent: document.getElementById('graph-fps-current'),
  graphBps: document.getElementById('graph-bps'),
  graphBpsCurrent: document.getElementById('graph-bps-current'),
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
  const cutoff = now - MAX_THROUGHPUT_GRAPH_POINTS * 1000;
  state.graphs.throughput.fps.push({ t: now, v: Number(diagnostics?.framesPerSecond) || 0 });
  state.graphs.throughput.bps.push({ t: now, v: Number(diagnostics?.bytesPerSecond) || 0 });
  pruneSeries(state.graphs.throughput.fps, cutoff);
  pruneSeries(state.graphs.throughput.bps, cutoff);
  if (state.graphs.throughput.fps.length > MAX_THROUGHPUT_GRAPH_POINTS) {
    state.graphs.throughput.fps.splice(0, state.graphs.throughput.fps.length - MAX_THROUGHPUT_GRAPH_POINTS);
  }
  if (state.graphs.throughput.bps.length > MAX_THROUGHPUT_GRAPH_POINTS) {
    state.graphs.throughput.bps.splice(0, state.graphs.throughput.bps.length - MAX_THROUGHPUT_GRAPH_POINTS);
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
  const cutoff = now - MAX_GRAPH_POINTS_PER_SERIES * 1000;

  if (board.kind === 'fast') {
    entry.fast.push({
      t: now,
      sg: Array.isArray(board.strainGaugesMv) ? board.strainGaugesMv.slice() : [],
      shockMm: Number(board.shockMm),
    });
    pruneSeries(entry.fast, cutoff);
    if (entry.fast.length > MAX_GRAPH_POINTS_PER_SERIES) {
      entry.fast.splice(0, entry.fast.length - MAX_GRAPH_POINTS_PER_SERIES);
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
    if (entry.slow.length > MAX_GRAPH_POINTS_PER_SERIES) {
      entry.slow.splice(0, entry.slow.length - MAX_GRAPH_POINTS_PER_SERIES);
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
      const points = visible
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
  `;
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

function renderThroughputGraphs(now, windowMs) {
  const fpsPoints = pickWindowedPoints(state.graphs.throughput.fps, now, windowMs);
  const bpsPoints = pickWindowedPoints(state.graphs.throughput.bps, now, windowMs);

  const latestFps = fpsPoints.length ? fpsPoints[fpsPoints.length - 1].v : 0;
  const latestBps = bpsPoints.length ? bpsPoints[bpsPoints.length - 1].v : 0;
  elements.graphFpsCurrent.textContent = `${formatRate(latestFps)} fps`;
  elements.graphBpsCurrent.textContent = `${formatBytes(latestBps)}/s`;

  renderMultiLinePlot(elements.graphFps, [{ label: 'fps', color: FPS_COLOR, points: fpsPoints.map((p) => ({ t: p.t, v: p.v })) }], {
    now,
    windowMs,
    yMinClamp: 0,
    formatY: (v) => v.toFixed(v >= 100 ? 0 : 1),
    emptyText: 'No throughput samples yet',
  });

  renderMultiLinePlot(elements.graphBps, [{ label: 'bytes/s', color: BPS_COLOR, points: bpsPoints.map((p) => ({ t: p.t, v: p.v })) }], {
    now,
    windowMs,
    yMinClamp: 0,
    formatY: (v) => formatBytes(v),
    emptyText: 'No throughput samples yet',
  });
}

function lineFromFast(history, accessor, color, label) {
  return {
    label,
    color,
    points: history.map((row) => ({ t: row.t, v: accessor(row) })),
  };
}

function renderBoardGraphCard(boardId, history, now, windowMs) {
  const fastPoints = pickWindowedPoints(history.fast, now, windowMs);
  const slowPoints = pickWindowedPoints(history.slow, now, windowMs);
  const ageMs = history.lastSeenAt ? now - history.lastSeenAt : null;

  const sgLines = SG_COLORS.map((color, idx) => ({
    label: `SG${idx + 1}`,
    color,
    points: fastPoints.map((row) => ({ t: row.t, v: Number(row.sg?.[idx]) })),
  }));

  const shockLines = [
    { label: 'Shock', color: SHOCK_COLOR, points: fastPoints.map((row) => ({ t: row.t, v: row.shockMm })) },
  ];

  const rpmLines = [
    { label: 'RPM', color: RPM_COLOR, points: slowPoints.map((row) => ({ t: row.t, v: row.rpm })) },
  ];

  const tireLines = [
    { label: 'Max', color: TIRE_COLORS.max, points: slowPoints.map((row) => ({ t: row.t, v: row.tireMax })) },
    { label: 'Min', color: TIRE_COLORS.min, points: slowPoints.map((row) => ({ t: row.t, v: row.tireMin })) },
    { label: 'Ctr', color: TIRE_COLORS.center, points: slowPoints.map((row) => ({ t: row.t, v: row.tireCtr })) },
    { label: 'Amb', color: TIRE_COLORS.ambient, points: slowPoints.map((row) => ({ t: row.t, v: row.tireAmb })) },
  ];

  const brakeLines = [
    { label: 'Brake', color: BRAKE_COLORS.brakeC, points: slowPoints.map((row) => ({ t: row.t, v: row.brakeC })) },
    { label: 'Brake Amb', color: BRAKE_COLORS.brakeAmbientC, points: slowPoints.map((row) => ({ t: row.t, v: row.brakeAmbientC })) },
  ];

  const card = document.createElement('article');
  card.className = 'board-graph-card';
  card.dataset.boardId = String(boardId);
  card.innerHTML = `
    <header>
      <strong>Board ${boardId}</strong>
      <span class="board-age">${escapeHtml(formatBoardAge(ageMs))} · ${history.fast.length} fast / ${history.slow.length} slow</span>
    </header>
    <div class="board-graph-grid">
      <div class="graph-card">
        <div class="graph-header"><h3>Strain Gauges (mV)</h3><strong>${fastPoints.length} pts</strong></div>
        <svg class="graph-svg" data-plot="sg" viewBox="0 0 720 220" preserveAspectRatio="none"></svg>
        ${buildLegend(sgLines, (v) => `${v.toFixed(0)} mV`)}
      </div>
      <div class="graph-card">
        <div class="graph-header"><h3>Shock (mm)</h3><strong>${fastPoints.length} pts</strong></div>
        <svg class="graph-svg" data-plot="shock" viewBox="0 0 720 220" preserveAspectRatio="none"></svg>
        ${buildLegend(shockLines, (v) => `${v.toFixed(2)} mm`)}
      </div>
      <div class="graph-card">
        <div class="graph-header"><h3>RPM</h3><strong>${slowPoints.length} pts</strong></div>
        <svg class="graph-svg" data-plot="rpm" viewBox="0 0 720 220" preserveAspectRatio="none"></svg>
        ${buildLegend(rpmLines, (v) => v.toFixed(0))}
      </div>
      <div class="graph-card">
        <div class="graph-header"><h3>Tire Temps (°C)</h3><strong>${slowPoints.length} pts</strong></div>
        <svg class="graph-svg" data-plot="tire" viewBox="0 0 720 220" preserveAspectRatio="none"></svg>
        ${buildLegend(tireLines, (v) => `${v.toFixed(1)} °C`)}
      </div>
      <div class="graph-card">
        <div class="graph-header"><h3>Brake Temps (°C)</h3><strong>${slowPoints.length} pts</strong></div>
        <svg class="graph-svg" data-plot="brake" viewBox="0 0 720 220" preserveAspectRatio="none"></svg>
        ${buildLegend(brakeLines, (v) => `${v.toFixed(1)} °C`)}
      </div>
    </div>
  `;

  renderMultiLinePlot(card.querySelector('[data-plot="sg"]'), sgLines, {
    now, windowMs, formatY: (v) => `${v.toFixed(0)}`, emptyText: 'Waiting for fast frames',
  });
  renderMultiLinePlot(card.querySelector('[data-plot="shock"]'), shockLines, {
    now, windowMs, formatY: (v) => v.toFixed(2), emptyText: 'Waiting for fast frames',
  });
  renderMultiLinePlot(card.querySelector('[data-plot="rpm"]'), rpmLines, {
    now, windowMs, yMinClamp: 0, formatY: (v) => v.toFixed(0), emptyText: 'Waiting for slow frames',
  });
  renderMultiLinePlot(card.querySelector('[data-plot="tire"]'), tireLines, {
    now, windowMs, formatY: (v) => v.toFixed(1), emptyText: 'Waiting for slow frames',
  });
  renderMultiLinePlot(card.querySelector('[data-plot="brake"]'), brakeLines, {
    now, windowMs, formatY: (v) => v.toFixed(1), emptyText: 'Waiting for slow frames',
  });

  return card;
}

function renderGraphs() {
  if (state.graphs.activeTab !== 'graphs') {
    return;
  }
  const now = Date.now();
  const windowMs = activeWindowSeconds() * 1000;

  renderThroughputGraphs(now, windowMs);

  const boardIds = [...state.graphs.boards.keys()].sort((a, b) => a - b);
  if (boardIds.length === 0) {
    elements.boardGraphs.innerHTML = '<p class="empty-state">No board telemetry decoded yet.</p>';
    elements.graphsStatusLine.textContent = 'Waiting for board telemetry frames.';
    return;
  }

  const totalFast = boardIds.reduce((sum, id) => sum + state.graphs.boards.get(id).fast.length, 0);
  const totalSlow = boardIds.reduce((sum, id) => sum + state.graphs.boards.get(id).slow.length, 0);
  elements.graphsStatusLine.textContent = `Tracking ${boardIds.length} board${boardIds.length === 1 ? '' : 's'} · ${totalFast} fast / ${totalSlow} slow samples buffered · window ${activeWindowSeconds()}s`;

  const fragment = document.createDocumentFragment();
  for (const id of boardIds) {
    fragment.appendChild(renderBoardGraphCard(id, state.graphs.boards.get(id), now, windowMs));
  }
  elements.boardGraphs.replaceChildren(fragment);
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