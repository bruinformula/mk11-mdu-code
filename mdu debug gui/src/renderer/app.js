'use strict';

const MAX_LOG_ROWS = 400;
const MAX_CHART_POINTS = 60;

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
};

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
};

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
    elements.topIdsBody.innerHTML = '<tr><td class="empty-state" colspan="7">No frames decoded yet.</td></tr>';
    return;
  }

  elements.topIdsBody.innerHTML = topIds
    .map((entry) => {
      const sourceLabel = entry.source === 'board' ? 'Board' : 'SLCAN';
      return `
        <tr>
          <td class="mono">${escapeHtml(entry.idText)}</td>
          <td><span class="pill ${entry.source === 'board' ? 'ok' : 'info'}">${escapeHtml(sourceLabel)}</span></td>
          <td>${escapeHtml(entry.idType)}</td>
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

function renderAll() {
  renderConnection();
  renderDiagnostics();
  renderBoards();
  renderTopIds();
  renderLog();
  renderLoggingControls();
}

function addLogRow(entry) {
  state.logRows.unshift(entry);
  if (state.logRows.length > MAX_LOG_ROWS) {
    state.logRows.length = MAX_LOG_ROWS;
  }
  renderLog();
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
    await api.clearSession();
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
    renderDiagnostics();
    renderBoards();
    renderTopIds();
  });

  api.onFrame((frame) => {
    addLogRow(frame);
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

  wireUi();
  wireEvents();
  renderAll();
}

init().catch((error) => {
  updateStatusLine(`Failed to initialize the renderer: ${error.message}`);
});