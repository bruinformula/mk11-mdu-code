"use strict";

const MAX_LOG_ROWS = 400;
const MAX_CHART_POINTS = 60;
const MAX_GRAPH_HISTORY_MS = 700_000;
const MAX_POINTS_PER_SERIES = 200_000;
const RENDER_POINT_LIMIT = 1500;
const GRAPH_FAVORITES_KEY = "mdu-graph-favorites";
const GRAPH_ORDER_KEY = "mdu-graph-order";

const SG_COLORS = [
  "#f7a35c",
  "#6ce0e6",
  "#b9c47a",
  "#e6b657",
  "#9badd9",
  "#ef7457",
];
const TIRE_COLORS = {
  max: "#ef7457",
  min: "#6ce0e6",
  center: "#f7a35c",
  ambient: "#b9c47a",
};
const BRAKE_COLORS = {
  brakeC: "#ef7457",
  brakeAmbientC: "#9badd9",
};
const SHOCK_COLOR = "#f7a35c";
const RPM_COLOR = "#6ce0e6";
const FPS_COLOR = "#f7a35c";
const BPS_COLOR = "#6ce0e6";

const BOARD_NAMES = {
  0: "Front Left (FL)",
  1: "Front Right (FR)",
  2: "Rear Left (RL)",
  3: "Rear Right (RR)",
};

const SMU_NAMES = {
  0: "GPS COG SMU",
  1: "Mid IMU SMU",
  2: "Rear IMU SMU",
};

const api = window.mduDebug;

const state = {
  ports: [],
  connection: null,
  userSelectedPortPath: "",
  diagnostics: null,
  logStatus: null,
  selectedLogFile: "",
  logRows: [],
  loadedLogFile: "",
  loadedLogRows: [],
  logView: "live",
  logPaused: false,
  boardFilter: { type: "all", id: "all" },
  logFilters: {
    search: "",
    boardId: "",
    status: "all",
    frameType: "all",
    valueField: "none",
    valueMin: "",
    valueMax: "",
  },
  charts: {
    frames: [],
    bytes: [],
  },
  graphs: {
    activeTab: "dashboard",
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
    yRanges: new Map(),
    veloUnit: "mps",
    accelUnit: "g",
  },
};

const pendingRenders = {
  log: false,
  diagnostics: false,
  boards: false,
  topIds: false,
  graphs: false,
};

const lastRenderTime = {
  connection: 0,
  ports: 0,
  diagnostics: 0,
  boards: 0,
  topIds: 0,
  graphs: 0,
  log: 0,
};

function scheduleRender(kind, fn) {
  if (pendingRenders[kind]) {
    return;
  }

  const now = Date.now();
  const minInterval = kind === "log" ? 200 : 0; // Throttle log to 5 Hz to avoid locking up renderer on high packet rates
  const elapsed = now - (lastRenderTime[kind] || 0);

  if (elapsed < minInterval) {
    pendingRenders[kind] = true;
    setTimeout(() => {
      pendingRenders[kind] = false;
      lastRenderTime[kind] = Date.now();
      fn();
    }, minInterval - elapsed);
    return;
  }

  pendingRenders[kind] = true;
  requestAnimationFrame(() => {
    pendingRenders[kind] = false;
    lastRenderTime[kind] = Date.now();
    fn();
  });
}

const elements = {
  portSelect: document.getElementById("port-select"),
  baudInput: document.getElementById("baud-input"),
  autoConnectToggle: document.getElementById("auto-connect-toggle"),
  refreshButton: document.getElementById("refresh-button"),
  connectButton: document.getElementById("connect-button"),
  disconnectButton: document.getElementById("disconnect-button"),
  clearSessionButton: document.getElementById("clear-session-button"),
  clearLogButton: document.getElementById("clear-log-button"),
  chooseLogButton: document.getElementById("choose-log-button"),
  startLogButton: document.getElementById("start-log-button"),
  stopLogButton: document.getElementById("stop-log-button"),
  logPath: document.getElementById("log-path"),
  statusLine: document.getElementById("status-line"),
  connectionChip: document.getElementById("connection-chip"),
  targetChip: document.getElementById("target-chip"),
  metricFps: document.getElementById("metric-fps"),
  metricFpsSub: document.getElementById("metric-fps-sub"),
  metricBps: document.getElementById("metric-bps"),
  metricBpsSub: document.getElementById("metric-bps-sub"),
  metricTotalFrames: document.getElementById("metric-total-frames"),
  metricTotalLines: document.getElementById("metric-total-lines"),
  metricBoardsSeen: document.getElementById("metric-boards-seen"),
  metricBoardFrames: document.getElementById("metric-board-frames"),
  metricParseErrors: document.getElementById("metric-parse-errors"),
  metricLastFrameAge: document.getElementById("metric-last-frame-age"),
  metricPayloadSize: document.getElementById("metric-payload-size"),
  metricTotalBytes: document.getElementById("metric-total-bytes"),
  metricUptime: document.getElementById("metric-uptime"),
  metricPortLabel: document.getElementById("metric-port-label"),
  metricLogStatus: document.getElementById("metric-log-status"),
  metricLogDetail: document.getElementById("metric-log-detail"),
  chartFpsCurrent: document.getElementById("chart-fps-current"),
  chartBpsCurrent: document.getElementById("chart-bps-current"),
  framesChart: document.getElementById("frames-chart"),
  bytesChart: document.getElementById("bytes-chart"),
  topIdsBody: document.getElementById("top-ids-body"),
  boardsGrid: document.getElementById("boards-grid"),
  logBody: document.getElementById("log-body"),
  logSearchInput: document.getElementById("log-search-input"),
  logBoardFilter: document.getElementById("log-board-filter"),
  logStatusFilter: document.getElementById("log-status-filter"),
  logFrameTypeFilter: document.getElementById("log-frame-type-filter"),
  logValueFieldFilter: document.getElementById("log-value-field-filter"),
  logValueMin: document.getElementById("log-value-min"),
  logValueMax: document.getElementById("log-value-max"),
  logPauseToggle: document.getElementById("log-pause-toggle"),
  loadLogButton: document.getElementById("load-log-button"),
  exportFilteredButton: document.getElementById("export-filtered-button"),
  liveLogButton: document.getElementById("live-log-button"),
  loadedLogPath: document.getElementById("loaded-log-path"),
  themeToggle: document.getElementById("theme-toggle"),
  themeToggleLabel: document.querySelector("#theme-toggle .theme-toggle-label"),
  tabButtons: Array.from(document.querySelectorAll(".tab-button")),
  tabPanes: {
    dashboard: document.getElementById("tab-dashboard"),
    graphs: document.getElementById("tab-graphs"),
    deploy: document.getElementById("tab-deploy"),
  },
  graphsWindowSelect: document.getElementById("graphs-window-select"),
  graphsBoardSelect: document.getElementById("graphs-board-select"),
  graphsVeloUnitSelect: document.getElementById("graphs-velo-unit-select"),
  graphsAccelUnitSelect: document.getElementById("graphs-accel-unit-select"),
  graphsClearButton: document.getElementById("graphs-clear-button"),
  graphsStatusLine: document.getElementById("graphs-status-line"),
  favoritesGrid: document.getElementById("favorites-grid"),
  throughputGrid: document.getElementById("throughput-grid"),
  boardGraphs: document.getElementById("board-graphs"),

  // Deploy (BFR) Tab Elements
  deploySetupCard: document.getElementById("deploy-setup-card"),
  runSetupBtn: document.getElementById("run-setup-btn"),
  deployWorkspace: document.getElementById("deploy-workspace"),
  deployBoardSelect: document.getElementById("deploy-board-select"),
  changeBoardPathBtn: document.getElementById("change-board-path-btn"),
  deployBoardPathText: document.getElementById("deploy-board-path-text"),
  deployIdGroup: document.getElementById("deploy-id-group"),
  deployIdSelect: document.getElementById("deploy-id-select"),
  deployIdInput: document.getElementById("deploy-id-input"),
  deployBtnClean: document.getElementById("deploy-btn-clean"),
  deployBtnBuild: document.getElementById("deploy-btn-build"),
  deployBtnFlash: document.getElementById("deploy-btn-flash"),
  deployBtnDeploy: document.getElementById("deploy-btn-deploy"),
  deployBtnStop: document.getElementById("deploy-btn-stop"),
  openRegisterModalBtn: document.getElementById("open-register-modal-btn"),
  deployStatusVal: document.getElementById("deploy-status-val"),
  deployTimerVal: document.getElementById("deploy-timer-val"),
  terminalLogContainer: document.getElementById("terminal-log-container"),
  clearConsoleBtn: document.getElementById("clear-console-btn"),
  consoleAutoscrollToggle: document.getElementById("console-autoscroll-toggle"),
  registerBoardModal: document.getElementById("register-board-modal"),
  registerBoardForm: document.getElementById("register-board-form"),
  regPathInput: document.getElementById("reg-path-input"),
  regBrowseBtn: document.getElementById("reg-browse-btn"),
  regKeyInput: document.getElementById("reg-key-input"),
  regNameInput: document.getElementById("reg-name-input"),
  regAliasesInput: document.getElementById("reg-aliases-input"),
  regElfInput: document.getElementById("reg-elf-input"),
  regVarInput: document.getElementById("reg-var-input"),
  regCancelBtn: document.getElementById("reg-cancel-btn"),
};

function applyTheme(theme) {
  const next = theme === "light" ? "light" : "dark";
  document.documentElement.setAttribute("data-theme", next);
  try {
    localStorage.setItem("mdu-theme", next);
  } catch (error) {
    // ignore — storage may be unavailable
  }
  if (elements.themeToggleLabel) {
    elements.themeToggleLabel.textContent = next === "dark" ? "Dark" : "Light";
  }
}

function getVelocityVal(lsb, unit) {
  if (lsb == null) return 0;
  const mps = lsb / 100.0;
  if (unit === "mph") return mps * 2.23694;
  if (unit === "kmh") return mps * 3.6;
  return mps;
}

function getVelocityUnitLabel(unit) {
  if (unit === "mph") return "mph";
  if (unit === "kmh") return "km/h";
  return "m/s";
}

function getAccelVal(mg, unit) {
  if (mg == null) return 0;
  const gVal = mg / 1000.0;
  if (unit === "mps2") return gVal * 9.80665;
  return gVal;
}

function getAccelUnitLabel(unit) {
  if (unit === "mps2") return "m/s²";
  return "g";
}

function formatAccelTuple(x, y, z, unit) {
  return `${getAccelVal(x, unit).toFixed(2)} / ${getAccelVal(y, unit).toFixed(2)} / ${getAccelVal(z, unit).toFixed(2)} ${getAccelUnitLabel(unit)}`;
}

function formatVeloTuple(x, y, z, unit) {
  return `${getVelocityVal(x, unit).toFixed(2)} / ${getVelocityVal(y, unit).toFixed(2)} / ${getVelocityVal(z, unit).toFixed(2)} ${getVelocityUnitLabel(unit)}`;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
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
    return "--:--";
  }

  const totalSeconds = Math.max(0, Math.floor(milliseconds / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) {
    return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  }

  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function formatAge(milliseconds) {
  if (milliseconds == null) {
    return "No activity yet";
  }

  if (milliseconds < 1000) {
    return "Active now";
  }

  if (milliseconds < 60000) {
    return `${Math.floor(milliseconds / 1000)}s ago`;
  }

  return `${Math.floor(milliseconds / 60000)}m ago`;
}

function formatTimestamp(isoString) {
  if (!isoString) {
    return "--";
  }

  return new Date(isoString).toLocaleTimeString();
}

function isRuntimeEntry(entry) {
  return entry.kind === "runtime" || entry.type === "runtime";
}

function getActiveLogRows() {
  return state.logView === "file" ? state.loadedLogRows : state.logRows;
}

function parseLogNumericValue(entry, field) {
  if (!entry || !entry.board) {
    return null;
  }

  switch (field) {
    case "rpm":
      return Number(entry.board.rpm);
    case "tireMax":
      return Number(entry.board.tireC?.max);
    case "tireMin":
      return Number(entry.board.tireC?.min);
    case "tireCtr":
      return Number(entry.board.tireC?.center);
    case "tireAmb":
      return Number(entry.board.tireC?.ambient);
    case "brake":
      return Number(entry.board.brakeC);
    case "brakeAmb":
      return Number(entry.board.brakeAmbientC);
    case "shock":
      return Number(entry.board.shockMm);
    case "pressure1":
      return Number(entry.board.pressure1);
    case "pressure2":
      return Number(entry.board.pressure2);
    case "tspmuTemp1":
      return Number(entry.board.tspmuTemp1);
    case "tspmuTemp2":
      return Number(entry.board.tspmuTemp2);
    case "tspmuTemp3":
      return Number(entry.board.tspmuTemp3);
    case "tspmuTemp4":
      return Number(entry.board.tspmuTemp4);
    case "accelX":
      return Number(entry.board.accelX);
    case "accelY":
      return Number(entry.board.accelY);
    case "accelZ":
      return Number(entry.board.accelZ);
    case "veloX":
      return Number(entry.board.veloX);
    case "veloY":
      return Number(entry.board.veloY);
    case "veloZ":
      return Number(entry.board.veloZ);
    default:
      return null;
  }
}

function getFilteredLogRows(rows) {
  return rows.filter((entry) => {
    const search = state.logFilters.search.trim().toLowerCase();
    if (search) {
      const text = [
        entry.raw,
        entry.reason,
        entry.message,
        entry.frame?.idText,
        entry.frame?.dataHex,
        entry.board?.kind,
        entry.board?.boardId,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();

      if (!text.includes(search)) {
        return false;
      }
    }

    const boardIdFilter = state.logFilters.boardId.trim();
    if (boardIdFilter) {
      const boardId = Number(boardIdFilter);
      if (!Number.isFinite(boardId) || entry.board?.boardId !== boardId) {
        return false;
      }
    }

    const status = state.logFilters.status;
    if (status === "ok" && !entry.ok) {
      return false;
    }
    if (status === "error" && entry.ok) {
      return false;
    }
    if (
      status === "slcan" &&
      !(entry.source && entry.source !== "board" && entry.frame)
    ) {
      return false;
    }

    const frameType = state.logFilters.frameType;
    if (frameType === "board-fast" && entry.board?.kind !== "fast") {
      return false;
    }
    if (frameType === "board-slow" && entry.board?.kind !== "slow") {
      return false;
    }
    if (
      frameType === "tire" &&
      !(
        entry.board?.kind === "slow" && Number.isFinite(entry.board?.tireC?.max)
      )
    ) {
      return false;
    }
    if (
      frameType === "brake" &&
      !(entry.board?.kind === "slow" && Number.isFinite(entry.board?.brakeC))
    ) {
      return false;
    }
    if (
      frameType === "imu" &&
      !(entry.board?.boardType === 1 && entry.board?.kind === "fast")
    ) {
      return false;
    }
    if (
      frameType === "slcan" &&
      !(entry.source && entry.source !== "board" && entry.frame)
    ) {
      return false;
    }

    const valueField = state.logFilters.valueField;
    const hasValueFilter = valueField !== "none";
    if (hasValueFilter) {
      const value = parseLogNumericValue(entry, valueField);
      if (!Number.isFinite(value)) {
        return false;
      }

      const min = Number(state.logFilters.valueMin);
      const max = Number(state.logFilters.valueMax);
      if (
        state.logFilters.valueMin !== "" &&
        Number.isFinite(min) &&
        value < min
      ) {
        return false;
      }
      if (
        state.logFilters.valueMax !== "" &&
        Number.isFinite(max) &&
        value > max
      ) {
        return false;
      }
    }

    return true;
  });
}

function renderLogViewStatus() {
  if (elements.loadedLogPath) {
    if (state.logView === "file" && state.loadedLogFile) {
      elements.loadedLogPath.textContent = `Viewing saved log: ${state.loadedLogFile}`;
      elements.liveLogButton.hidden = false;
    } else {
      elements.loadedLogPath.textContent = "";
      elements.liveLogButton.hidden = true;
    }
  }
}

function describePort(port) {
  if (!port) {
    return "No USB CDC endpoint selected";
  }

  const usbTag =
    port.vendorId && port.productId
      ? `${port.vendorId}:${port.productId}`
      : "USB ID unavailable";
  const hubPath = port.locationId ? `hub path ${port.locationId}` : null;
  const extras = [port.manufacturer, hubPath].filter(Boolean).join(" | ");
  return extras
    ? `${port.path} · ${usbTag} · ${extras}`
    : `${port.path} · ${usbTag}`;
}

function describeHub(hub) {
  if (!hub) {
    return "USB2514 hub not detected";
  }

  const usbTag =
    hub.vendorId && hub.productId
      ? `${hub.vendorId}:${hub.productId}`
      : "USB ID unavailable";
  const extras = [hub.name, hub.locationId].filter(Boolean).join(" | ");
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
  const stepX =
    safePoints.length === 1 ? width : width / (safePoints.length - 1);
  const polyline = safePoints
    .map((value, index) => {
      const x = index * stepX;
      const y = height - (value / max) * (height - 12) - 6;
      return `${x.toFixed(2)},${y.toFixed(2)}`;
    })
    .join(" ");

  const area = [`0,${height}`, polyline, `${width},${height}`].join(" ");

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
  const selectedPath =
    state.userSelectedPortPath ||
    state.connection?.port?.path ||
    state.connection?.preferredPortPath ||
    "";
  const options = [];
  const hub = state.connection?.hub;

  if (state.ports.length === 0) {
    options.push(
      `<option value="">${hub?.detected ? "USB2514 detected, no USB CDC child endpoint" : "No USB CDC endpoints detected"}</option>`,
    );
  }

  const targetPorts = state.ports.filter((port) => port.matchesTarget);
  if (targetPorts.length > 1) {
    options.push(
      `<option value="all" ${selectedPath === "all" ? "selected" : ""}>All STM32 USB CDC Ports (${targetPorts.length} ports)</option>`,
    );
  }

  for (const port of state.ports) {
    try {
      const labelParts = [port.path];
      
      if (port.manufacturer) {
        labelParts.push(port.manufacturer);
      }
      
      if (port.vendorId && port.productId) {
        labelParts.push(`USB ${port.vendorId}:${port.productId}`);
      }

      if (port.matchesTarget) {
        labelParts.push('TARGET MDU');
      }

      if (port.serialNumber) {
        labelParts.push(`SN: ${port.serialNumber}`);
      }

      if (port.locationId) {
        labelParts.push(`hub ${port.locationId}`);
      }

      options.push(
        `<option value="${escapeHtml(port.path)}" ${selectedPath === port.path ? 'selected' : ''}>${escapeHtml(labelParts.join(' · '))}</option>`
      );
    } catch (err) {
      console.error('Error rendering port details:', port, err);
      options.push(
        `<option value="${escapeHtml(port?.path || '')}" ${selectedPath === port?.path ? 'selected' : ''}>${escapeHtml(port?.path || 'Unknown Port')}</option>`
      );
    }
  }

  elements.portSelect.innerHTML = options.join("");
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
    ? "Connecting"
    : connected
      ? "Connected"
      : "Disconnected";
  elements.connectionChip.className =
    `status-chip ${connected ? "" : "warning"}`.trim();
  elements.targetChip.textContent = hub?.detected
    ? `Hub detected: ${describeHub(hub.info)}`
    : `Looking for USB2514 hub ${hub?.targetVendorId ?? "0424"}:${hub?.targetProductId ?? "2514"}`;

  const currentPort = connection.port;
  if (connected && currentPort) {
    updateStatusLine(`Connected to ${describePort(currentPort)}.`);
  } else if (connection.connecting) {
    updateStatusLine("Opening the selected USB CDC endpoint.");
  } else if (hub?.detected && state.ports.length === 0) {
    updateStatusLine(
      `USB2514 hub detected at ${hub.info?.locationId ?? "unknown location"}, but macOS has not enumerated a USB CDC child endpoint yet, so there is nothing to mirror.`,
    );
  } else if (connection.lastError) {
    updateStatusLine(`Last USB mirror error: ${connection.lastError}`);
  } else if (hub?.lastError) {
    updateStatusLine(`USB topology scan error: ${hub.lastError}`);
  } else {
    updateStatusLine(
      "Waiting for the USB2514 hub and its STM32 USB CDC child endpoint. Bluetooth-style pseudo ports are ignored.",
    );
  }

  renderPorts();
}

function renderDiagnostics() {
  const diagnostics = state.diagnostics ?? {};
  const logging = state.logStatus ??
    diagnostics.logging ?? { active: false, linesWritten: 0, bytesWritten: 0 };

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
  elements.metricLastFrameAge.textContent =
    diagnostics.timeSinceLastFrameMs == null
      ? "No frames yet"
      : `Last frame ${formatAge(diagnostics.timeSinceLastFrameMs)}`;
  elements.metricPayloadSize.textContent = `${(diagnostics.averagePayloadBytes ?? 0).toFixed(1)} B`;
  elements.metricTotalBytes.textContent = `${formatBytes(diagnostics.totalBytes ?? 0)} received`;
  elements.metricUptime.textContent = formatDuration(
    diagnostics.connectionUptimeMs,
  );
  elements.metricPortLabel.textContent = state.connection?.port
    ? describePort(state.connection.port)
    : state.connection?.hub?.detected
      ? `Hub present: ${describeHub(state.connection.hub.info)}`
      : "No port connected";
  elements.metricLogStatus.textContent = logging.active ? "Recording" : "Idle";
  elements.metricLogDetail.textContent = logging.active
    ? `${logging.linesWritten} lines · ${formatBytes(logging.bytesWritten)}`
    : "No active capture";

  elements.chartFpsCurrent.textContent = `${formatRate(diagnostics.framesPerSecond)} fps`;
  elements.chartBpsCurrent.textContent = `${formatBytes(diagnostics.bytesPerSecond)}/s`;
  renderSparkline(elements.framesChart, state.charts.frames, "#f7a35c");
  renderSparkline(elements.bytesChart, state.charts.bytes, "#6ce0e6");
}

function renderTopIds() {
  const topIds = state.diagnostics?.topIds ?? [];
  if (topIds.length === 0) {
    elements.topIdsBody.innerHTML =
      '<tr><td class="empty-state" colspan="6">No frames decoded yet.</td></tr>';
    return;
  }

  elements.topIdsBody.innerHTML = topIds
    .map((entry) => {
      const sourceLabel = entry.source === "board" ? "Board" : "SLCAN";
      return `
        <tr>
          <td class="mono">${escapeHtml(entry.idText)}</td>
          <td><span class="pill ${entry.source === "board" ? "ok" : "info"}">${escapeHtml(sourceLabel)}</span></td>
          <td>${entry.count}</td>
          <td>${formatRate(entry.recentHz)}</td>
          <td>${entry.lastDataLength}</td>
          <td class="mono">${escapeHtml(entry.lastDataHex || "--")}</td>
        </tr>
      `;
    })
    .join("");
}

function formatSigned(value, digits) {
  if (value == null || Number.isNaN(value)) {
    return "--";
  }
  return value.toFixed(digits);
}

function formatBoardAge(ageMs) {
  if (ageMs == null) {
    return "never";
  }
  if (ageMs < 1000) {
    return "just now";
  }
  if (ageMs < 60000) {
    return `${Math.floor(ageMs / 1000)}s ago`;
  }
  return `${Math.floor(ageMs / 60000)}m ago`;
}

function renderTable(headers, rows) {
  return `
    <div class="board-detail-scroll">
      <table class="board-detail-table">
        <thead>
          <tr>
            ${headers.map((h) => `<th>${escapeHtml(h)}</th>`).join("")}
          </tr>
        </thead>
        <tbody>
          ${rows.join("")}
        </tbody>
      </table>
    </div>
  `;
}

function captureOpenBoardDetails() {
  const openDetails = new Set();
  if (!elements.boardsGrid) {
    return openDetails;
  }

  for (const card of elements.boardsGrid.querySelectorAll(".board-card")) {
    const boardKey = card.dataset.boardKey;
    if (!boardKey) {
      continue;
    }

    for (const detail of card.querySelectorAll("details.board-detail")) {
      if (detail.open && detail.dataset.detail) {
        openDetails.add(`${boardKey}:${detail.dataset.detail}`);
      }
    }
  }

  return openDetails;
}

function captureBoardDetailScroll() {
  const scrollMap = new Map();
  if (!elements.boardsGrid) {
    return scrollMap;
  }

  for (const card of elements.boardsGrid.querySelectorAll(".board-card")) {
    const boardKey = card.dataset.boardKey;
    if (!boardKey) {
      continue;
    }

    for (const detail of card.querySelectorAll("details.board-detail")) {
      const detailKey = detail.dataset.detail;
      const scrollWrap = detail.querySelector(".board-detail-scroll");
      if (!detailKey || !scrollWrap) {
        continue;
      }
      if (scrollWrap.scrollLeft > 0) {
        scrollMap.set(`${boardKey}:${detailKey}`, scrollWrap.scrollLeft);
      }
    }
  }

  return scrollMap;
}

function renderStrainDetails(fast) {
  if (!fast?.strainBlocks?.length) {
    return "";
  }

  const rows = fast.strainBlocks.map((block) => {
    const values = block.strainGaugesMv.map((mv) => `${mv} mV`).join(" / ");
    return `
      <tr>
        <td>${block.index + 1}</td>
        <td>${escapeHtml(values)}</td>
        <td>${escapeHtml(String(block.jitterUs))} µs</td>
      </tr>
    `;
  });

  return `
    <details class="board-detail" data-detail="strain">
      <summary>Strain blocks (${fast.strainBlocks.length})</summary>
      ${renderTable(["Block", "Channel values", "Jitter"], rows)}
    </details>
  `;
}

function renderSampleDetails(samples, label, unit, detailKey) {
  if (!samples?.length) {
    return "";
  }

  const rows = samples.map(
    (sample) => `
    <tr>
      <td>${sample.index + 1}</td>
      <td>${escapeHtml(formatSigned(sample.value, 2))}${escapeHtml(unit)}</td>
      <td>${escapeHtml(String(sample.jitterUs))} µs</td>
    </tr>
  `,
  );

  return `
    <details class="board-detail" data-detail="${escapeHtml(detailKey)}">
      <summary>${escapeHtml(label)} (${samples.length})</summary>
      ${renderTable(["Sample", label, "Jitter"], rows)}
    </details>
  `;
}

function renderTireDetails(slow) {
  if (!slow?.tireBlocks?.length) {
    return "";
  }

  const rows = slow.tireBlocks.map(
    (block) => `
    <tr>
      <td>${block.index + 1}</td>
      <td>${escapeHtml(String(block.max))} °C</td>
      <td>${escapeHtml(String(block.min))} °C</td>
      <td>${escapeHtml(String(block.center))} °C</td>
      <td>${escapeHtml(String(block.ambient))} °C</td>
      <td>${escapeHtml(String(block.jitterMs))} ms</td>
    </tr>
  `,
  );

  return `
    <details class="board-detail" data-detail="tire">
      <summary>Tire history (${slow.tireBlocks.length})</summary>
      ${renderTable(["Block", "Max", "Min", "Center", "Ambient", "Jitter"], rows)}
    </details>
  `;
}

function renderTspmuPressureDetails(fast) {
  if (!fast?.pressureBlocks?.length) {
    return "";
  }

  const rows = fast.pressureBlocks.map(
    (block) => `
    <tr>
      <td>${block.index + 1}</td>
      <td>${escapeHtml(formatSigned(block.pressure1, 2))} Pa</td>
      <td>${escapeHtml(formatSigned(block.pressure2, 2))} Pa</td>
      <td>${escapeHtml(String(block.jitter))}</td>
    </tr>
  `,
  );

  return `
    <details class="board-detail" data-detail="tspmu-pressure">
      <summary>Pressure blocks (${fast.pressureBlocks.length})</summary>
      ${renderTable(["Block", "Pressure 1", "Pressure 2", "Jitter"], rows)}
    </details>
  `;
}

function renderTspmuTempDetails(slow) {
  if (!slow?.tempBlocks?.length) {
    return "";
  }

  const rows = slow.tempBlocks.map(
    (block) => `
    <tr>
      <td>${block.index + 1}</td>
      <td>${escapeHtml(formatSigned(block.temp1, 1))} °C</td>
      <td>${escapeHtml(formatSigned(block.temp2, 1))} °C</td>
      <td>${escapeHtml(formatSigned(block.temp3, 1))} °C</td>
      <td>${escapeHtml(formatSigned(block.temp4, 1))} °C</td>
      <td>${escapeHtml(String(block.jitterMs))} ms</td>
    </tr>
  `,
  );

  return `
    <details class="board-detail" data-detail="tspmu-temp">
      <summary>Temperature blocks (${slow.tempBlocks.length})</summary>
      ${renderTable(["Block", "Temp 1", "Temp 2", "Temp 3", "Temp 4", "Jitter"], rows)}
    </details>
  `;
}

function renderFastBlock(fast) {
  if (!fast) {
    return '<p class="board-empty">Waiting for fast frame...</p>';
  }

  const sgRows = fast.strainGaugesMv
    .map((mv, index) => `<dt>SG${index + 1}</dt><dd>${mv} mV</dd>`)
    .join("");

  return `
    <p class="board-meta">${escapeHtml(fast.idText)} · Δt ${fast.timeSinceLastMs} ms · ${escapeHtml(formatBoardAge(fast.ageMs))}</p>
    <dl class="board-readings">
      ${sgRows}
      <dt>Shock</dt><dd>${formatSigned(fast.shockMm, 2)} mm</dd>
    </dl>
    ${renderStrainDetails(fast)}
    ${renderSampleDetails(fast.shockSamples, "Shock mm", " mm", "shock")}
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
    ${renderSampleDetails(slow.wheelSamples, "RPM", "", "rpm")}
    ${renderSampleDetails(slow.brakeSamples, "Brake °C", " °C", "brake")}
    ${renderTireDetails(slow)}
  `;
}

function renderTspmuFastBlock(fast) {
  if (!fast) {
    return '<p class="board-empty">Waiting for pressure frame...</p>';
  }

  return `
    <p class="board-meta">${escapeHtml(fast.idText)} · Δt ${fast.timeSinceLastMs} ms · ${escapeHtml(formatBoardAge(fast.ageMs))}</p>
    <dl class="board-readings">
      <dt>Pressure 1</dt><dd>${formatSigned(fast.pressure1, 2)} Pa</dd>
      <dt>Pressure 2</dt><dd>${formatSigned(fast.pressure2, 2)} Pa</dd>
      <dt>Jitter</dt><dd>${fast.jitter}</dd>
    </dl>
    ${renderTspmuPressureDetails(fast)}
  `;
}

function renderTspmuSlowBlock(slow) {
  if (!slow) {
    return '<p class="board-empty">Waiting for temp frame...</p>';
  }

  return `
    <p class="board-meta">${escapeHtml(slow.idText)} · Δt ${slow.timeSinceLastMs} ms · ${escapeHtml(formatBoardAge(slow.ageMs))}</p>
    <dl class="board-readings">
      <dt>Temp 1</dt><dd>${formatSigned(slow.tspmuTemp1, 1)} &deg;C</dd>
      <dt>Temp 2</dt><dd>${formatSigned(slow.tspmuTemp2, 1)} &deg;C</dd>
      <dt>Temp 3</dt><dd>${formatSigned(slow.tspmuTemp3, 1)} &deg;C</dd>
      <dt>Temp 4</dt><dd>${formatSigned(slow.tspmuTemp4, 1)} &deg;C</dd>
    </dl>
    ${renderTspmuTempDetails(slow)}
  `;
}

function renderImuBlock(fast) {
  if (!fast) {
    return '<p class="board-empty">Waiting for IMU frame...</p>';
  }

  // Find all SMU boards in the system to overlay their dots on the G-force meter
  const allSmuBoards = (state.diagnostics?.boards ?? []).filter(
    (b) => b.boardType === 1,
  );
  const maxG = 2.0;

  const dots = [];
  const legends = [];

  // Sort them to have consistent order: COG (0), Mid (1), Rear (2)
  const sortedSmuBoards = allSmuBoards.sort((a, b) => a.boardId - b.boardId);

  for (const b of sortedSmuBoards) {
    const samples = b.fast?.samples;
    const sample = samples?.[0] || { accelX: 0, accelY: 0, accelZ: 0 };
    const gX = (sample.accelY || 0) / 1000.0;
    const gY = (sample.accelX || 0) / 1000.0;
    const gMag = Math.sqrt(gX * gX + gY * gY);
    const cx = 50 + Math.max(-1, Math.min(1, gX / maxG)) * 50;
    const cy = 50 - Math.max(-1, Math.min(1, gY / maxG)) * 50;

    let colorVar = "var(--accent)";
    let label = `SMU ${b.boardId}`;
    if (b.boardId === 0) {
      colorVar = "var(--teal)";
      label = "COG";
    } else if (b.boardId === 1) {
      colorVar = "var(--success)";
      label = "Mid";
    } else if (b.boardId === 2) {
      colorVar = "var(--warning)";
      label = "Rear";
    }

    dots.push(`
      <circle cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="4.5" fill="${colorVar}" stroke="#ffffff" stroke-width="0.75" stroke-opacity="0.6" style="filter: drop-shadow(0 0 4px ${colorVar}); transition: cx 60ms ease, cy 60ms ease;"></circle>
    `);

    const convertedG =
      state.graphs.accelUnit === "mps2" ? gMag * 9.80665 : gMag;
    const accelUnitLabel = getAccelUnitLabel(state.graphs.accelUnit);

    legends.push(`
      <div style="display: flex; justify-content: space-between; align-items: center; width: 100%;">
        <div style="display: flex; align-items: center; gap: 5px;">
          <div style="width: 7px; height: 7px; border-radius: 50%; background: ${colorVar}; box-shadow: 0 0 3px ${colorVar};"></div>
          <span style="color: var(--ink-soft); font-weight: 500;">${label}</span>
        </div>
        <span style="font-family: 'SF Mono', Menlo, monospace; font-weight: 600; color: var(--ink);">${convertedG.toFixed(2)} ${accelUnitLabel}</span>
      </div>
    `);
  }

  if (dots.length === 0) {
    const sample = fast.samples?.[0] || { accelX: 0, accelY: 0, accelZ: 0 };
    const gX = (sample.accelY || 0) / 1000.0;
    const gY = (sample.accelX || 0) / 1000.0;
    const gMag = Math.sqrt(gX * gX + gY * gY);
    const cx = 50 + Math.max(-1, Math.min(1, gX / maxG)) * 50;
    const cy = 50 - Math.max(-1, Math.min(1, gY / maxG)) * 50;
    dots.push(`
      <circle cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="4.5" fill="var(--accent)" stroke="#ffffff" stroke-width="0.75" stroke-opacity="0.6" style="filter: drop-shadow(0 0 4px var(--accent)); transition: cx 60ms ease, cy 60ms ease;"></circle>
    `);

    const convertedG =
      state.graphs.accelUnit === "mps2" ? gMag * 9.80665 : gMag;
    const accelUnitLabel = getAccelUnitLabel(state.graphs.accelUnit);

    legends.push(`
      <div style="display: flex; justify-content: space-between; align-items: center; width: 100%;">
        <div style="display: flex; align-items: center; gap: 5px;">
          <div style="width: 7px; height: 7px; border-radius: 50%; background: var(--accent); box-shadow: 0 0 3px var(--accent);"></div>
          <span style="color: var(--ink-soft); font-weight: 500;">SMU ${fast.boardId ?? 0}</span>
        </div>
        <span style="font-family: 'SF Mono', Menlo, monospace; font-weight: 600; color: var(--ink);">${convertedG.toFixed(2)} ${accelUnitLabel}</span>
      </div>
    `);
  }

  return `
    <p class="board-meta">${escapeHtml(fast.idText)} · Δt ${fast.timeSinceLastMs} ms · ${escapeHtml(formatBoardAge(fast.ageMs))}</p>
    <div class="imu-meta-grid" style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; margin-bottom: 12px; font-size: 0.85rem; color: var(--ink-soft);">
      <div><strong>Timestamp:</strong> ${fast.baseTimestamp} µs</div>
      <div><strong>Period:</strong> ${fast.expectedPeriod} µs</div>
      <div><strong>Flags:</strong> 0x${((fast.errorFlags ?? 0) & 0x7f).toString(16).toUpperCase()}</div>
    </div>
    
    <div class="imu-layout" style="display: flex; gap: 16px; align-items: stretch;">
      <!-- G-Force Meter Container -->
      <div class="g-meter-container" style="flex: 0 0 120px; display: flex; flex-direction: column; align-items: center; justify-content: center; background: var(--surface-strong); padding: 8px; border-radius: var(--radius-sm); border: 1px solid var(--line);">
        <span style="font-size: 0.58rem; font-weight: 700; text-transform: uppercase; color: var(--ink-soft); margin-bottom: 4px; letter-spacing: 0.04em;">G-Force (${state.graphs.accelUnit === "mps2" ? "19.6 m/s²" : "2.0G"})</span>
        <svg class="g-meter-svg" width="76" height="76" viewBox="0 0 100 100" style="display: block; overflow: visible;">
          <!-- Circular borders representing G zones -->
          <circle cx="50" cy="50" r="50" fill="none" stroke="var(--ink-soft)" stroke-opacity="0.35" stroke-width="1.5"></circle>
          <circle cx="50" cy="50" r="25" fill="none" stroke="var(--ink-soft)" stroke-opacity="0.3" stroke-width="1" stroke-dasharray="2,2"></circle>
          
          <!-- Crosshair axes -->
          <line x1="0" y1="50" x2="100" y2="50" stroke="var(--ink-soft)" stroke-opacity="0.35" stroke-width="1"></line>
          <line x1="50" y1="0" x2="50" y2="100" stroke="var(--ink-soft)" stroke-opacity="0.35" stroke-width="1"></line>
          
          <!-- Labels for directions -->
          <text x="50" y="8" text-anchor="middle" fill="var(--ink-soft)" fill-opacity="0.85" font-weight="600" font-size="8" font-family="sans-serif">F</text>
          <text x="50" y="98" text-anchor="middle" fill="var(--ink-soft)" fill-opacity="0.85" font-weight="600" font-size="8" font-family="sans-serif">B</text>
          <text x="6" y="53" text-anchor="start" fill="var(--ink-soft)" fill-opacity="0.85" font-weight="600" font-size="8" font-family="sans-serif">L</text>
          <text x="94" y="53" text-anchor="end" fill="var(--ink-soft)" fill-opacity="0.85" font-weight="600" font-size="8" font-family="sans-serif">R</text>

          <!-- Current G position indicator dots -->
          ${dots.join("\n")}
        </svg>
        
        <!-- Legend list -->
        <div style="display: flex; flex-direction: column; gap: 4px; width: 100%; margin-top: 8px; font-size: 0.65rem;">
          ${legends.join("\n")}
        </div>
      </div>

      <!-- Right side: Samples -->
      <div class="imu-samples" style="flex: 1; display: flex; flex-direction: column; gap: 8px;">
        <div class="imu-sample-block" style="border: 1px solid var(--line); padding: 6px 8px; border-radius: var(--radius-sm); background: var(--board-col-bg);">
          <strong style="font-size: 0.8rem; color: var(--accent); display: block; margin-bottom: 2px;">Sample 1 (Jitter: ${fast.samples?.[0]?.jitter ?? 0} µs)</strong>
          <dl class="board-readings" style="display: grid; grid-template-columns: repeat(2, max-content 1fr); font-size: 0.78rem; margin: 0; gap: 2px 10px; white-space: nowrap;">
            <dt>acc X</dt><dd>${getAccelVal(fast.samples?.[0]?.accelX, state.graphs.accelUnit).toFixed(3)} ${getAccelUnitLabel(state.graphs.accelUnit)}</dd>
            <dt>acc Y</dt><dd>${getAccelVal(fast.samples?.[0]?.accelY, state.graphs.accelUnit).toFixed(3)} ${getAccelUnitLabel(state.graphs.accelUnit)}</dd>
            <dt>acc Z</dt><dd>${getAccelVal(fast.samples?.[0]?.accelZ, state.graphs.accelUnit).toFixed(3)} ${getAccelUnitLabel(state.graphs.accelUnit)}</dd>
            <dt>acc A</dt><dd>${getAccelVal(fast.samples?.[0]?.accelA, state.graphs.accelUnit).toFixed(3)} ${getAccelUnitLabel(state.graphs.accelUnit)}</dd>
            <dt>acc B</dt><dd>${getAccelVal(fast.samples?.[0]?.accelB, state.graphs.accelUnit).toFixed(3)} ${getAccelUnitLabel(state.graphs.accelUnit)}</dd>
            <dt>acc C</dt><dd>${getAccelVal(fast.samples?.[0]?.accelC, state.graphs.accelUnit).toFixed(3)} ${getAccelUnitLabel(state.graphs.accelUnit)}</dd>
            <dt>vel X</dt><dd>${getVelocityVal(fast.samples?.[0]?.veloX, state.graphs.veloUnit).toFixed(2)} ${getVelocityUnitLabel(state.graphs.veloUnit)}</dd>
            <dt>vel Y</dt><dd>${getVelocityVal(fast.samples?.[0]?.veloY, state.graphs.veloUnit).toFixed(2)} ${getVelocityUnitLabel(state.graphs.veloUnit)}</dd>
            <dt>vel Z</dt><dd>${getVelocityVal(fast.samples?.[0]?.veloZ, state.graphs.veloUnit).toFixed(2)} ${getVelocityUnitLabel(state.graphs.veloUnit)}</dd>
            <dt>vel A</dt><dd>${getVelocityVal(fast.samples?.[0]?.veloA, state.graphs.veloUnit).toFixed(2)} ${getVelocityUnitLabel(state.graphs.veloUnit)}</dd>
            <dt>vel B</dt><dd>${getVelocityVal(fast.samples?.[0]?.veloB, state.graphs.veloUnit).toFixed(2)} ${getVelocityUnitLabel(state.graphs.veloUnit)}</dd>
            <dt>vel C</dt><dd>${getVelocityVal(fast.samples?.[0]?.veloC, state.graphs.veloUnit).toFixed(2)} ${getVelocityUnitLabel(state.graphs.veloUnit)}</dd>
          </dl>
        </div>
        
        <div class="imu-sample-block" style="border: 1px solid var(--line); padding: 6px 8px; border-radius: var(--radius-sm); background: var(--board-col-bg);">
          <strong style="font-size: 0.8rem; color: var(--accent); display: block; margin-bottom: 2px;">Sample 2</strong>
          <dl class="board-readings" style="display: grid; grid-template-columns: repeat(2, max-content 1fr); font-size: 0.78rem; margin: 0; gap: 2px 10px; white-space: nowrap;">
            <dt>acc X</dt><dd>${getAccelVal(fast.samples?.[1]?.accelX, state.graphs.accelUnit).toFixed(3)} ${getAccelUnitLabel(state.graphs.accelUnit)}</dd>
            <dt>acc Y</dt><dd>${getAccelVal(fast.samples?.[1]?.accelY, state.graphs.accelUnit).toFixed(3)} ${getAccelUnitLabel(state.graphs.accelUnit)}</dd>
            <dt>acc Z</dt><dd>${getAccelVal(fast.samples?.[1]?.accelZ, state.graphs.accelUnit).toFixed(3)} ${getAccelUnitLabel(state.graphs.accelUnit)}</dd>
            <dt>acc A</dt><dd>${getAccelVal(fast.samples?.[1]?.accelA, state.graphs.accelUnit).toFixed(3)} ${getAccelUnitLabel(state.graphs.accelUnit)}</dd>
            <dt>acc B</dt><dd>${getAccelVal(fast.samples?.[1]?.accelB, state.graphs.accelUnit).toFixed(3)} ${getAccelUnitLabel(state.graphs.accelUnit)}</dd>
            <dt>acc C</dt><dd>${getAccelVal(fast.samples?.[1]?.accelC, state.graphs.accelUnit).toFixed(3)} ${getAccelUnitLabel(state.graphs.accelUnit)}</dd>
            <dt>vel X</dt><dd>${getVelocityVal(fast.samples?.[1]?.veloX, state.graphs.veloUnit).toFixed(2)} ${getVelocityUnitLabel(state.graphs.veloUnit)}</dd>
            <dt>vel Y</dt><dd>${getVelocityVal(fast.samples?.[1]?.veloY, state.graphs.veloUnit).toFixed(2)} ${getVelocityUnitLabel(state.graphs.veloUnit)}</dd>
            <dt>vel Z</dt><dd>${getVelocityVal(fast.samples?.[1]?.veloZ, state.graphs.veloUnit).toFixed(2)} ${getVelocityUnitLabel(state.graphs.veloUnit)}</dd>
            <dt>vel A</dt><dd>${getVelocityVal(fast.samples?.[1]?.veloA, state.graphs.veloUnit).toFixed(2)} ${getVelocityUnitLabel(state.graphs.veloUnit)}</dd>
            <dt>vel B</dt><dd>${getVelocityVal(fast.samples?.[1]?.veloB, state.graphs.veloUnit).toFixed(2)} ${getVelocityUnitLabel(state.graphs.veloUnit)}</dd>
            <dt>vel C</dt><dd>${getVelocityVal(fast.samples?.[1]?.veloC, state.graphs.veloUnit).toFixed(2)} ${getVelocityUnitLabel(state.graphs.veloUnit)}</dd>
          </dl>
        </div>
      </div>
    </div>
    ${renderImuDetails(fast)}
  `;
}

function renderImuDetails(fast) {
  if (!fast?.samples?.length) {
    return "";
  }

  const rows = fast.samples.map(
    (sample) => `
    <tr>
      <td>${sample.index + 1}</td>
      <td>${formatAccelTuple(sample.accelX, sample.accelY, sample.accelZ, state.graphs.accelUnit)}</td>
      <td>${formatAccelTuple(sample.accelA, sample.accelB, sample.accelC, state.graphs.accelUnit)}</td>
      <td>${formatVeloTuple(sample.veloX, sample.veloY, sample.veloZ, state.graphs.veloUnit)}</td>
      <td>${formatVeloTuple(sample.veloA, sample.veloB, sample.veloC, state.graphs.veloUnit)}</td>
      <td>${sample.jitter != null ? sample.jitter + " µs" : "--"}</td>
    </tr>
  `,
  );

  return `
    <details class="board-detail" data-detail="imu-samples">
      <summary>IMU Samples (${fast.samples.length})</summary>
      ${renderTable(["Sample", "Accel XYZ", "Accel ABC", "Velo XYZ", "Velo ABC", "Jitter"], rows)}
    </details>
  `;
}

function renderTestPayloadDetails(fast) {
  if (!fast?.dataBytes?.length) {
    return '';
  }

  const rows = [];
  // Render payload in rows of 8 bytes
  for (let i = 0; i < fast.dataBytes.length; i += 8) {
    const chunk = fast.dataBytes.slice(i, i + 8);
    const hexVal = chunk.map(b => b.toString(16).padStart(2, '0').toUpperCase()).join(' ');
    rows.push(`
      <tr>
        <td class="mono">Byte ${i} - ${i + 7}</td>
        <td class="mono">${escapeHtml(hexVal)}</td>
      </tr>
    `);
  }

  return `
    <details class="board-detail" data-detail="test-payload" style="margin-top: 8px;">
      <summary>Full 64-Byte Payload</summary>
      ${renderTable(['Byte Range', 'Hex values'], rows)}
    </details>
  `;
}

function renderTestBlock(fast, board) {
  if (!fast) {
    return '<p class="board-empty">Waiting for Test frame...</p>';
  }

  const rateHz = fast.rateHz ?? (fast.timeSinceLastMs > 0 ? Math.round(1000 / fast.timeSinceLastMs) : 0);
  const rateText = `${rateHz} Hz`;

  // Dynamic Mbps calculation
  const payloadBytes = fast.dataBytes ? fast.dataBytes.length : 0;
  const payloadMbps = ((rateHz * payloadBytes * 8) / 1000000).toFixed(2);
  
  // CAN FD Overhead: Nominal phase (70us @ 1Mbps) + Data phase (payload*8 + 28 bits) * 0.2us @ 5Mbps
  // Frame time = 70us + (payloadBytes*8 + 28) * 0.2us
  // Bus utilization = rateHz * frameTime; express as fraction then percentage
  const frameTimeUs = 70 + (payloadBytes * 8 + 28) * 0.2;
  const busUtil = rateHz * frameTimeUs / 1000000;
  const busMbps = busUtil.toFixed(2);
  const busPct = (busUtil * 100).toFixed(1);

  // Format first 16 bytes for quick preview
  const previewBytes = fast.dataBytes.slice(0, 16);
  const previewHex = previewBytes.map(b => b.toString(16).padStart(2, '0').toUpperCase()).join(' ');

  return `
    <p class="board-meta">${escapeHtml(fast.idText)} · Δt ${fast.timeSinceLastMs} ms · ${escapeHtml(formatBoardAge(fast.ageMs))}</p>
    <dl class="board-readings">
      <dt>Message Rate</dt><dd>${rateText}</dd>
      <dt>Payload Rate</dt><dd>${payloadMbps} Mbps</dd>
      <dt>Est. Bus Load</dt><dd>${busPct}%</dd>
      <dt>Last Rx Seq</dt><dd>${fast.rxSeq}</dd>
      <dt>Total Rx</dt><dd>${board.fastCount}</dd>
      <dt>Dropped</dt><dd style="color: ${board.counterMismatchCount > 0 ? 'var(--accent-red, #ff5c5c)' : 'inherit'}; font-weight: bold;">${board.counterMismatchCount}</dd>
    </dl>
    
    <div style="margin-top: 10px; font-size: 0.8rem;">
      <strong style="color: var(--accent); display: block; margin-bottom: 4px;">Payload Preview (First 16B):</strong>
      <code style="font-family: monospace; display: block; background: rgba(0,0,0,0.15); padding: 6px; border-radius: 4px; word-break: break-all;">${previewHex} ...</code>
    </div>
    
    ${renderTestPayloadDetails(fast)}
  `;
}

function renderBoards() {
  const boards = state.diagnostics?.boards ?? [];
  if (boards.length === 0) {
    elements.boardsGrid.innerHTML =
      '<p class="empty-state">No board telemetry frames decoded yet.</p>';
    return;
  }

  let filteredBoards = boards;
  if (state.boardFilter && state.boardFilter.type !== "all") {
    const filterType = Number(state.boardFilter.type);
    const filterId = Number(state.boardFilter.id);
    filteredBoards = boards.filter(
      (b) => b.boardType === filterType && b.boardId === filterId,
    );
  }

  if (filteredBoards.length === 0) {
    elements.boardsGrid.innerHTML =
      '<p class="empty-state">No board telemetry decoded yet for the selected filter.</p>';
    return;
  }

  const openDetails = captureOpenBoardDetails();
  const scrollPositions = captureBoardDetailScroll();

  elements.boardsGrid.innerHTML = filteredBoards
    .map((board) => {
      const boardKey = `${board.boardType}-${board.boardId}`;
      if (board.boardType === 6) {
        const boardName = `TSPMU ${board.boardId}`;
        const pressureHex = (0x180 + (board.boardId << 3))
          .toString(16)
          .toUpperCase()
          .padStart(3, "0");
        const tempHex = (0x181 + (board.boardId << 3))
          .toString(16)
          .toUpperCase()
          .padStart(3, "0");

        return `
          <article class="board-card" data-board-key="${boardKey}">
            <header class="board-card-header">
              <strong>${escapeHtml(boardName)}</strong>
              <span class="board-age">${escapeHtml(formatBoardAge(board.lastSeenAgeMs))}</span>
              <span class="board-counter">CNT: ${board.lastMessageCounterReceived != null ? board.lastMessageCounterReceived : "--"} (Drops: ${board.counterMismatchCount})</span>
              ${board.counterMismatch ? '<span class="pill error">CNT MISMATCH</span>' : ""}
            </header>
            <div class="board-cols">
              <div class="board-col">
                <h3>Fast (Pressure: 0x${pressureHex})</h3>
                ${renderTspmuFastBlock(board.fast)}
              </div>
              <div class="board-col">
                <h3>Slow (Temp: 0x${tempHex})</h3>
                ${renderTspmuSlowBlock(board.slow)}
              </div>
            </div>
          </article>
        `;
      } else if (board.boardType === 4) {
        const boardName = `Test Board (Overload)`;

        return `
          <article class="board-card" data-board-key="${boardKey}">
            <header class="board-card-header">
              <strong>${escapeHtml(boardName)}</strong>
              <span class="board-age">${escapeHtml(formatBoardAge(board.lastSeenAgeMs))}</span>
              <span class="board-counter">CNT: ${board.lastMessageCounterReceived != null ? board.lastMessageCounterReceived : '--'} (Drops: ${board.counterMismatchCount})</span>
              ${board.counterMismatch ? '<span class="pill error">CNT MISMATCH</span>' : ''}
            </header>
            <div class="board-cols">
              <div class="board-col" style="flex: 1;">
                <h3>Fast (Test: 0x111)</h3>
                ${renderTestBlock(board.fast, board)}
              </div>
            </div>
          </article>
        `;
      } else if (board.boardType === 1) {
        const boardName = SMU_NAMES[board.boardId] || `SMU ${board.boardId}`;
        const imuHex = (0x040 + (board.boardId << 3) + 3)
          .toString(16)
          .toUpperCase()
          .padStart(3, "0");

        return `
          <article class="board-card" data-board-key="${boardKey}">
            <header class="board-card-header">
              <strong>${escapeHtml(boardName)}</strong>
              <span class="board-age">${escapeHtml(formatBoardAge(board.lastSeenAgeMs))}</span>
              <span class="board-counter">CNT: ${board.lastMessageCounterReceived != null ? board.lastMessageCounterReceived : "--"} (Drops: ${board.counterMismatchCount})</span>
              ${board.counterMismatch ? '<span class="pill error">CNT MISMATCH</span>' : ""}
            </header>
            <div class="board-cols" style="grid-template-columns: 1fr;">
              <div class="board-col">
                <h3>Fast (IMU: 0x${imuHex})</h3>
                ${renderImuBlock(board.fast)}
              </div>
            </div>
          </article>
        `;
      } else {
        const boardName =
          BOARD_NAMES[board.boardId] || `Board ${board.boardId}`;
        const sduBase = 0x080 + (board.boardId << 3);
        const sgHex = sduBase.toString(16).toUpperCase().padStart(3, "0");
        const shockHex = (sduBase + 1)
          .toString(16)
          .toUpperCase()
          .padStart(3, "0");
        const brakeHex = (sduBase + 2)
          .toString(16)
          .toUpperCase()
          .padStart(3, "0");
        const tireHex = (sduBase + 3)
          .toString(16)
          .toUpperCase()
          .padStart(3, "0");
        const wheelHex = (sduBase + 4)
          .toString(16)
          .toUpperCase()
          .padStart(3, "0");

        return `
          <article class="board-card" data-board-key="${boardKey}">
            <header class="board-card-header">
              <strong>${escapeHtml(boardName)}</strong>
              <span class="board-age">${escapeHtml(formatBoardAge(board.lastSeenAgeMs))}</span>
              <span class="board-counter">CNT: ${board.lastMessageCounterReceived != null ? board.lastMessageCounterReceived : "--"} (Drops: ${board.counterMismatchCount})</span>
              ${board.counterMismatch ? '<span class="pill error">CNT MISMATCH</span>' : ""}
            </header>
            <div class="board-cols">
              <div class="board-col">
                <h3>Fast (SG: 0x${sgHex}, Shock: 0x${shockHex})</h3>
                ${renderFastBlock(board.fast)}
              </div>
              <div class="board-col">
                <h3>Slow (Brk: 0x${brakeHex}, Tire: 0x${tireHex}, Whl: 0x${wheelHex})</h3>
                ${renderSlowBlock(board.slow)}
              </div>
            </div>
          </article>
        `;
      }
    })
    .join("");

  if (openDetails.size > 0) {
    for (const card of elements.boardsGrid.querySelectorAll(".board-card")) {
      const boardKey = card.dataset.boardKey;
      if (!boardKey) {
        continue;
      }

      for (const detail of card.querySelectorAll("details.board-detail")) {
        if (
          detail.dataset.detail &&
          openDetails.has(`${boardKey}:${detail.dataset.detail}`)
        ) {
          detail.open = true;
        }
      }
    }
  }

  if (scrollPositions.size > 0) {
    for (const card of elements.boardsGrid.querySelectorAll(".board-card")) {
      const boardKey = card.dataset.boardKey;
      if (!boardKey) {
        continue;
      }

      for (const detail of card.querySelectorAll("details.board-detail")) {
        const detailKey = detail.dataset.detail;
        if (!detailKey) {
          continue;
        }
        const preservedScrollLeft = scrollPositions.get(
          `${boardKey}:${detailKey}`,
        );
        if (preservedScrollLeft == null) {
          continue;
        }
        const scrollWrap = detail.querySelector(".board-detail-scroll");
        if (scrollWrap) {
          scrollWrap.scrollLeft = preservedScrollLeft;
        }
      }
    }
  }
}

function renderLog() {
  const rows = getActiveLogRows();
  if (rows.length === 0) {
    elements.logBody.innerHTML =
      '<tr><td class="empty-state" colspan="6">No log entries yet.</td></tr>';
    return;
  }

  const filteredRows = getFilteredLogRows(rows);
  if (filteredRows.length === 0) {
    elements.logBody.innerHTML =
      '<tr><td class="empty-state" colspan="6">No log entries match the current filters.</td></tr>';
    return;
  }

  elements.logBody.innerHTML = filteredRows
    .map((entry) => {
      try {
        if (isRuntimeEntry(entry)) {
          return `
            <tr>
              <td>${escapeHtml(formatTimestamp(entry.timestamp))}</td>
              <td><span class="pill ${entry.level === "error" ? "error" : "info"}">${escapeHtml(entry.level)}</span></td>
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
              <td>${escapeHtml(entry.reason ?? "decode failed")}</td>
              <td>--</td>
              <td>--</td>
              <td class="mono">${escapeHtml(entry.raw)}</td>
            </tr>
          `;
        }

        if (entry.source === 'board' && entry.board) {
          const typeLabel = entry.board.boardType === 6 ? 'TSPMU' : entry.board.boardType === 1 ? 'SMU' : entry.board.boardType === 4 ? 'TEST' : 'SDU';
          const idLabel = `${typeLabel} ${entry.board.boardId ?? 0} · ${entry.board.kind === 'fast' ? 'Fast' : 'Slow'} · ${entry.frame?.idText ?? '--'}`;
          let summary = '';
          if (entry.board.boardType === 6) {
            summary =
              entry.board.kind === "fast"
                ? `Pres1 ${formatSigned(entry.board.pressure1, 2)} Pa · Pres2 ${formatSigned(entry.board.pressure2, 2)} Pa · Jitter ${entry.board.jitter ?? 0}`
                : `Temp ${formatSigned(entry.board.tspmuTemp1, 1)}/${formatSigned(entry.board.tspmuTemp2, 1)}/${formatSigned(entry.board.tspmuTemp3, 1)}/${formatSigned(entry.board.tspmuTemp4, 1)} °C`;
          } else if (entry.board.boardType === 1) {
            summary = `Accel X/Y/Z: ${entry.board.accelX}/${entry.board.accelY}/${entry.board.accelZ} · Velo X/Y/Z: ${entry.board.veloX}/${entry.board.veloY}/${entry.board.veloZ}`;
          } else if (entry.board.boardType === 4) {
            const hz = entry.board.timeSinceLastMs > 0 ? (1000 / entry.board.timeSinceLastMs).toFixed(1) : '0.0';
            summary = `Seq ${entry.board.rxSeq} · Rate ${hz} Hz`;
          } else {
            summary =
              entry.board.kind === "fast"
                ? `SG ${Array.isArray(entry.board.strainGaugesMv) ? entry.board.strainGaugesMv.join("/") : "--"} mV · Shock ${formatSigned(entry.board.shockMm, 2)} mm`
                : `RPM ${entry.board.rpm ?? 0} · Tire ${formatSigned(entry.board.tireC?.max, 1)}/${formatSigned(entry.board.tireC?.min, 1)}/${formatSigned(entry.board.tireC?.center, 1)}/${formatSigned(entry.board.tireC?.ambient, 1)} · Brk ${formatSigned(entry.board.brakeC, 1)}/${formatSigned(entry.board.brakeAmbientC, 1)}`;
          }
          return `
            <tr>
              <td>${escapeHtml(formatTimestamp(entry.timestamp))}</td>
              <td><span class="pill ok">${escapeHtml(entry.board.kind)}</span></td>
              <td class="mono">${escapeHtml(idLabel)}</td>
              <td>${entry.board.timeSinceLastMs ?? 0} ms</td>
              <td>${escapeHtml(summary)}</td>
              <td class="mono">${escapeHtml(entry.raw)}</td>
            </tr>
          `;
        }

        return `
          <tr>
            <td>${escapeHtml(formatTimestamp(entry.timestamp))}</td>
            <td><span class="pill info">slcan</span></td>
            <td class="mono">${escapeHtml(entry.frame?.idText ?? "--")}</td>
            <td>${entry.frame?.dataLength ?? 0}</td>
            <td class="mono">${escapeHtml(entry.frame?.dataHex ?? "--")}</td>
            <td class="mono">${escapeHtml(entry.raw)}</td>
          </tr>
        `;
      } catch (err) {
        console.error("Failed to render log entry:", err, entry);
        return `
          <tr>
            <td>${escapeHtml(formatTimestamp(entry.timestamp))}</td>
            <td><span class="pill error">render err</span></td>
            <td colspan="3">${escapeHtml(err.message)}</td>
            <td class="mono">${escapeHtml(entry.raw ?? "")}</td>
          </tr>
        `;
      }
    })
    .join("");
}

function renderLoggingControls() {
  const logStatus = state.logStatus ?? { active: false, filePath: null };
  const activePath = logStatus.filePath || state.selectedLogFile || "";
  elements.logPath.value = activePath;
  elements.startLogButton.disabled =
    logStatus.active || (!activePath && state.ports.length === 0);
  elements.stopLogButton.disabled = !logStatus.active;
  renderLogViewStatus();
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
  state.graphs.throughput.fps.push({
    t: now,
    v: Number(diagnostics?.framesPerSecond) || 0,
  });
  state.graphs.throughput.bps.push({
    t: now,
    v: Number(diagnostics?.bytesPerSecond) || 0,
  });
  pruneSeries(state.graphs.throughput.fps, cutoff);
  pruneSeries(state.graphs.throughput.bps, cutoff);
  if (state.graphs.throughput.fps.length > MAX_POINTS_PER_SERIES) {
    state.graphs.throughput.fps.splice(
      0,
      state.graphs.throughput.fps.length - MAX_POINTS_PER_SERIES,
    );
  }
  if (state.graphs.throughput.bps.length > MAX_POINTS_PER_SERIES) {
    state.graphs.throughput.bps.splice(
      0,
      state.graphs.throughput.bps.length - MAX_POINTS_PER_SERIES,
    );
  }
}

function initializeBoardHistories() {
  state.graphs.boards.set("2-0", { fast: [], slow: [], lastSeenAt: null });
  state.graphs.boards.set("2-1", { fast: [], slow: [], lastSeenAt: null });
  state.graphs.boards.set("2-2", { fast: [], slow: [], lastSeenAt: null });
  state.graphs.boards.set("2-3", { fast: [], slow: [], lastSeenAt: null });
  state.graphs.boards.set("6-0", { fast: [], slow: [], lastSeenAt: null });
  state.graphs.boards.set("6-1", { fast: [], slow: [], lastSeenAt: null });
  state.graphs.boards.set("1-0", { fast: [], slow: [], lastSeenAt: null });
  state.graphs.boards.set("1-1", { fast: [], slow: [], lastSeenAt: null });
  state.graphs.boards.set("1-2", { fast: [], slow: [], lastSeenAt: null });
}

function getOrCreateBoardHistory(boardKey) {
  let entry = state.graphs.boards.get(boardKey);
  if (!entry) {
    entry = { fast: [], slow: [], lastSeenAt: null };
    state.graphs.boards.set(boardKey, entry);
  }
  return entry;
}

function mergeBoardIntoDiagnostics(frameEvent) {
  const board = frameEvent.board;
  const boardType = board.boardType ?? 2;
  const boardId = board.boardId;
  if (typeof boardId !== "number") {
    return;
  }
  const now = frameEvent.timestamp
    ? Date.parse(frameEvent.timestamp)
    : Date.now();
  const diag = state.diagnostics ?? (state.diagnostics = {});
  if (!Array.isArray(diag.boards)) {
    diag.boards = [];
  }
  let entry = diag.boards.find(
    (b) => b.boardType === boardType && b.boardId === boardId,
  );
  if (!entry) {
    entry = {
      boardType,
      boardId,
      fastCount: 0,
      slowCount: 0,
      fast: null,
      slow: null,
      lastSeenAt: now,
      lastSeenAgeMs: 0,
    };
    diag.boards.push(entry);
  }
  entry.lastSeenAt = now;
  entry.lastSeenAgeMs = 0;
  if (board.kind === "fast") {
    entry.fast = { ...(entry.fast ?? {}), ...board, receivedAt: now, ageMs: 0 };
    entry.fastCount = (entry.fastCount ?? 0) + 1;
  } else if (board.kind === "slow") {
    entry.slow = { ...(entry.slow ?? {}), ...board, receivedAt: now, ageMs: 0 };
    entry.slowCount = (entry.slowCount ?? 0) + 1;
  }
}

function appendBoardSample(frameEvent) {
  if (
    !frameEvent ||
    !frameEvent.ok ||
    frameEvent.source !== "board" ||
    !frameEvent.board
  ) {
    return;
  }
  const board = frameEvent.board;
  const now = frameEvent.timestamp
    ? Date.parse(frameEvent.timestamp)
    : Date.now();
  if (!Number.isFinite(now)) {
    return;
  }
  const boardType = board.boardType ?? 2;
  const boardId = board.boardId;
  const boardKey = `${boardType}-${boardId}`;
  const historyEntry = getOrCreateBoardHistory(boardKey);
  historyEntry.lastSeenAt = now;
  const cutoff = now - MAX_GRAPH_HISTORY_MS;

  // Find the merged diagnostics board entry to get complete sensor telemetry
  const diag = state.diagnostics ?? {};
  const diagEntry = Array.isArray(diag.boards)
    ? diag.boards.find(
        (b) => b.boardType === boardType && b.boardId === boardId,
      )
    : null;

  if (board.kind === "fast") {
    const mergedFast = diagEntry?.fast ?? board;
    if (boardType === 6) {
      historyEntry.fast.push({
        t: now,
        pressure1: Number(mergedFast.pressure1),
        pressure2: Number(mergedFast.pressure2),
        jitter: Number(mergedFast.jitter),
      });
    } else if (boardType === 1) {
      historyEntry.fast.push({
        t: now,
        accelX: Number(mergedFast.accelX),
        accelY: Number(mergedFast.accelY),
        accelZ: Number(mergedFast.accelZ),
        accelA: Number(mergedFast.accelA),
        accelB: Number(mergedFast.accelB),
        accelC: Number(mergedFast.accelC),
        veloX: Number(mergedFast.veloX),
        veloY: Number(mergedFast.veloY),
        veloZ: Number(mergedFast.veloZ),
        veloA: Number(mergedFast.veloA),
        veloB: Number(mergedFast.veloB),
        veloC: Number(mergedFast.veloC),
        jitter: Number(mergedFast.jitter ?? 0),
      });
    } else if (boardType === 4) {
      historyEntry.fast.push({
        t: now,
        rxSeq: Number(mergedFast.rxSeq),
        timeSinceLastMs: Number(mergedFast.timeSinceLastMs),
      });
    } else {
      historyEntry.fast.push({
        t: now,
        sg: Array.isArray(mergedFast.strainGaugesMv)
          ? mergedFast.strainGaugesMv.slice()
          : [],
        shockMm: Number(mergedFast.shockMm),
      });
    }
    pruneSeries(historyEntry.fast, cutoff);
    if (historyEntry.fast.length > MAX_POINTS_PER_SERIES) {
      historyEntry.fast.splice(
        0,
        historyEntry.fast.length - MAX_POINTS_PER_SERIES,
      );
    }
  } else if (board.kind === "slow") {
    const mergedSlow = diagEntry?.slow ?? board;
    if (boardType === 6) {
      historyEntry.slow.push({
        t: now,
        tspmuTemp1: Number(mergedSlow.tspmuTemp1),
        tspmuTemp2: Number(mergedSlow.tspmuTemp2),
        tspmuTemp3: Number(mergedSlow.tspmuTemp3),
        tspmuTemp4: Number(mergedSlow.tspmuTemp4),
      });
    } else {
      historyEntry.slow.push({
        t: now,
        rpm: Number(mergedSlow.rpm),
        tireMax: Number(mergedSlow.tireC?.max),
        tireMin: Number(mergedSlow.tireC?.min),
        tireCtr: Number(mergedSlow.tireC?.center),
        tireAmb: Number(mergedSlow.tireC?.ambient),
        brakeC: Number(mergedSlow.brakeC),
        brakeAmbientC: Number(mergedSlow.brakeAmbientC),
      });
    }
    pruneSeries(historyEntry.slow, cutoff);
    if (historyEntry.slow.length > MAX_POINTS_PER_SERIES) {
      historyEntry.slow.splice(
        0,
        historyEntry.slow.length - MAX_POINTS_PER_SERIES,
      );
    }
  }
}

function activeWindowSeconds() {
  const value = Number(state.graphs.windowSeconds);
  return Number.isFinite(value) && value > 0 ? value : 60;
}

function setActiveTab(tab) {
  let next = "dashboard";
  if (tab === "graphs") {
    next = "graphs";
  } else if (tab === "deploy") {
    next = "deploy";
  }
  state.graphs.activeTab = next;
  for (const button of elements.tabButtons) {
    const isActive = button.dataset.tab === next;
    button.classList.toggle("active", isActive);
    button.setAttribute("aria-selected", isActive ? "true" : "false");
  }
  for (const [name, pane] of Object.entries(elements.tabPanes)) {
    if (!pane) continue;
    const isActive = name === next;
    pane.classList.toggle("active", isActive);
    if (isActive) {
      pane.removeAttribute("hidden");
    } else {
      pane.setAttribute("hidden", "");
    }
  }
  if (next === "graphs") {
    renderGraphs();
  } else if (next === "deploy") {
    loadBfrConfig();
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
      <text x="${width / 2}" y="${height / 2}" text-anchor="middle" fill="rgba(255,255,255,0.45)" font-size="14" font-family="Avenir Next, sans-serif">${escapeHtml(options.emptyText || "No samples yet")}</text>
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

  if (options.plotId) {
    const previousRange = state.graphs.yRanges.get(options.plotId);
    if (
      previousRange &&
      Number.isFinite(previousRange.yMin) &&
      Number.isFinite(previousRange.yMax)
    ) {
      // Expand immediately for new extremes, but shrink slowly to prevent visual bouncing.
      const SHRINK_ALPHA = 0.18;
      yMin =
        yMin < previousRange.yMin
          ? yMin
          : previousRange.yMin + (yMin - previousRange.yMin) * SHRINK_ALPHA;
      yMax =
        yMax > previousRange.yMax
          ? yMax
          : previousRange.yMax + (yMax - previousRange.yMax) * SHRINK_ALPHA;
    }
    state.graphs.yRanges.set(options.plotId, { yMin, yMax });
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
    .map(
      ({ y }) =>
        `<line x1="${padLeft}" y1="${y.toFixed(1)}" x2="${(width - padRight).toFixed(1)}" y2="${y.toFixed(1)}" stroke="rgba(255,255,255,0.07)" stroke-width="1"></line>`,
    )
    .join("");

  // Adaptive label formatting based on tick step size so small ranges show
  // an appropriate number of decimal places (previously always used 1).
  const step = (yMax - yMin) / Math.max(1, tickCount);
  let defaultDecimals = 1;
  if (step > 0) {
    defaultDecimals = Math.min(
      6,
      Math.max(0, Math.ceil(-Math.log10(Math.abs(step)))),
    );
  }

  // Tick labels should represent numeric axis values. `formatY` is intended
  // for legends/tooltips (may include units) so avoid using it here to keep
  // axis labels unambiguous. Plots can provide `tickFormatter` in
  // `plotOptions` for custom tick text if needed.
  const yTickLabels = yTicks
    .map(({ value, y }) => {
      const label = options.tickFormatter
        ? options.tickFormatter(value, defaultDecimals)
        : Number.isFinite(value)
          ? value.toFixed(defaultDecimals)
          : "--";
      return `<text x="${padLeft - 6}" y="${(y + 4).toFixed(1)}" text-anchor="end" fill="rgba(255,255,255,0.55)" font-size="10" font-family="SF Mono, Menlo, monospace">${escapeHtml(label)}</text>`;
    })
    .join("");

  const windowSec = windowMs / 1000;
  const xLabels = [
    `-${windowSec.toFixed(0)}s`,
    `-${(windowSec / 2).toFixed(0)}s`,
    "now",
  ];
  const xLabelMarkup = xLabels
    .map((label, idx) => {
      const x = padLeft + (idx / (xLabels.length - 1)) * plotWidth;
      return `<text x="${x.toFixed(1)}" y="${(height - 8).toFixed(1)}" text-anchor="middle" fill="rgba(255,255,255,0.55)" font-size="10" font-family="SF Mono, Menlo, monospace">${escapeHtml(label)}</text>`;
    })
    .join("");

  const linesMarkup = lines
    .map((line) => {
      const visible = line.points.filter(
        (p) => p.t >= start - windowMs * 0.05 && Number.isFinite(p.v),
      );
      if (visible.length === 0) {
        return "";
      }
      if (visible.length === 1) {
        const cx = xScale(visible[0].t).toFixed(2);
        const cy = yScale(visible[0].v).toFixed(2);
        return `<circle cx="${cx}" cy="${cy}" r="2.5" fill="${line.color}"></circle>`;
      }
      const renderPoints = downsampleForRender(visible, RENDER_POINT_LIMIT);
      const points = renderPoints
        .map((p) => `${xScale(p.t).toFixed(2)},${yScale(p.v).toFixed(2)}`)
        .join(" ");
      return `<polyline points="${points}" fill="none" stroke="${line.color}" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"></polyline>`;
    })
    .join("");

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

  return { yMin, yMax };
}

function downsampleForRender(points, maxOut) {
  if (points.length <= maxOut) return points;

  const bucketCount = Math.floor(maxOut / 2);
  if (bucketCount <= 1) return [points[0], points[points.length - 1]];

  const bucketSize = points.length / bucketCount;
  const out = [];

  // Always include the first point
  out.push(points[0]);

  for (let i = 0; i < bucketCount; i++) {
    const startIdx = Math.floor(i * bucketSize);
    const endIdx = Math.min(points.length, Math.floor((i + 1) * bucketSize));
    if (startIdx >= endIdx) continue;

    let minPt = points[startIdx];
    let maxPt = points[startIdx];

    for (let j = startIdx + 1; j < endIdx; j++) {
      const p = points[j];
      if (p.v < minPt.v) minPt = p;
      if (p.v > maxPt.v) maxPt = p;
    }

    if (minPt.t < maxPt.t) {
      out.push(minPt);
      out.push(maxPt);
    } else if (minPt.t > maxPt.t) {
      out.push(maxPt);
      out.push(minPt);
    } else {
      out.push(minPt);
    }
  }

  const lastPoint = points[points.length - 1];
  if (out[out.length - 1] !== lastPoint) {
    out.push(lastPoint);
  }

  const uniqueOut = [];
  for (let i = 0; i < out.length; i++) {
    const p = out[i];
    if (uniqueOut.length === 0 || uniqueOut[uniqueOut.length - 1].t !== p.t) {
      uniqueOut.push(p);
    }
  }
  return uniqueOut;
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
  return t - points[lo].t < points[hi].t - t ? lo : hi;
}

function computePlotYRange(def) {
  if (def && def.id && state.graphs.yRanges.has(def.id)) {
    return state.graphs.yRanges.get(def.id);
  }

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
  const svg = card.querySelector("svg.graph-svg");
  if (!svg) return;
  const layer = svg.querySelector(".hover-layer");
  if (!layer) return;
  if (fraction == null || !Number.isFinite(fraction)) {
    layer.innerHTML = "";
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

  const { yMin, yMax } = card._plotRange || computePlotYRange(def);
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
    dotsMarkup.push(
      `<circle cx="${cx.toFixed(2)}" cy="${cy.toFixed(2)}" r="3.2" fill="${line.color}" stroke="rgba(10,16,28,0.95)" stroke-width="1"></circle>`,
    );
    const valueLabel = def.legendFormatter
      ? def.legendFormatter(p.v)
      : p.v.toFixed(2);
    readouts.push({ color: line.color, name: line.label, value: valueLabel });
  }

  const relSec = (t - now) / 1000;
  const timeLabel =
    Math.abs(relSec) < 0.05
      ? "now"
      : `${relSec >= 0 ? "+" : ""}${relSec.toFixed(2)}s`;

  const rowHeight = 14;
  const tipPad = 6;
  const charWidth = 6.6;
  const rowLabels = [
    timeLabel,
    ...readouts.map((r) => `${r.name}: ${r.value}`),
  ];
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
    ${dotsMarkup.join("")}
    ${textMarkup}
  `;
}

function attachHoverHandlers(card, def) {
  const svg = card.querySelector("svg.graph-svg");
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
  svg.addEventListener("mousemove", handleMove);
  svg.addEventListener("mouseleave", handleLeave);
}

function buildLegend(lines, formatValue) {
  return `
    <div class="graph-legend">
      ${lines
        .map((line) => {
          // Walk backwards for the most recent finite value: SDU "fast" frames
          // come from either the strain or shock sensor (and "slow" frames from
          // brake / tire / wheel), so the last appended row often carries NaN
          // for fields belonging to the other sensor. Using just the tail value
          // makes the legend flash between "--" and the actual reading.
          let last = null;
          for (let i = line.points.length - 1; i >= 0; i -= 1) {
            const v = line.points[i].v;
            if (Number.isFinite(v)) {
              last = v;
              break;
            }
          }
          const valueLabel =
            last == null
              ? "--"
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
        .join("")}
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
      if (parsed && typeof parsed === "object") {
        if (Array.isArray(parsed.favorites))
          state.graphs.order.favorites = parsed.favorites.map(String);
        if (Array.isArray(parsed.throughput))
          state.graphs.order.throughput = parsed.throughput.map(String);
        if (parsed.board && typeof parsed.board === "object") {
          state.graphs.order.board = {};
          for (const [k, v] of Object.entries(parsed.board)) {
            if (Array.isArray(v)) state.graphs.order.board[k] = v.map(String);
          }
        }
      }
    }
    const veloUnit = localStorage.getItem("mdu-graph-velo-unit");
    if (veloUnit) {
      state.graphs.veloUnit = veloUnit;
    }
    const accelUnit = localStorage.getItem("mdu-graph-accel-unit");
    if (accelUnit) {
      state.graphs.accelUnit = accelUnit;
    }
  } catch (error) {
    // ignore
  }
}

function saveGraphPrefs() {
  try {
    localStorage.setItem(
      GRAPH_FAVORITES_KEY,
      JSON.stringify([...state.graphs.favorites]),
    );
    localStorage.setItem(GRAPH_ORDER_KEY, JSON.stringify(state.graphs.order));
    localStorage.setItem("mdu-graph-velo-unit", state.graphs.veloUnit);
    localStorage.setItem("mdu-graph-accel-unit", state.graphs.accelUnit);
  } catch (error) {
    // ignore
  }
}

function toggleFavorite(plotId) {
  if (state.graphs.favorites.has(plotId)) {
    state.graphs.favorites.delete(plotId);
    state.graphs.order.favorites = state.graphs.order.favorites.filter(
      (id) => id !== plotId,
    );
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
  const escaped =
    window.CSS && CSS.escape ? CSS.escape(def.id) : def.id.replace(/"/g, '\\"');
  let card = document.querySelector(`.graph-card[data-plot-id="${escaped}"]`);
  const isFav = state.graphs.favorites.has(def.id);

  if (card) {
    // Update existing card elements
    const titleEl = card.querySelector("h3");
    if (titleEl) titleEl.textContent = def.title;

    const badgeEl = card.querySelector(".graph-card-actions strong");
    if (badgeEl) badgeEl.textContent = def.badge ?? "";

    const favBtn = card.querySelector(".favorite-btn");
    if (favBtn) {
      favBtn.className = `favorite-btn ${isFav ? "is-favorite" : ""}`;
      favBtn.title = isFav ? "Unpin from favorites" : "Pin to favorites";
      favBtn.setAttribute("aria-pressed", isFav ? "true" : "false");
    }

    // Update legend
    const legendEl = card.querySelector(".graph-legend");
    if (legendEl) {
      legendEl.outerHTML = buildLegend(def.lines, def.legendFormatter);
    }

    // Render plot content
    card._plotRange = renderMultiLinePlot(
      card.querySelector("svg"),
      def.lines,
      {
        ...def.plotOptions,
        plotId: def.id,
      },
    );
    card._plotDef = def;

    return card;
  }

  card = document.createElement("article");
  card.className = "graph-card";
  card.dataset.plotId = def.id;
  card.draggable = true;
  card.innerHTML = `
    <div class="graph-header">
      <h3>${escapeHtml(def.title)}</h3>
      <div class="graph-card-actions">
        <strong>${escapeHtml(def.badge ?? "")}</strong>
        <button class="favorite-btn ${isFav ? "is-favorite" : ""}" type="button" title="${isFav ? "Unpin from favorites" : "Pin to favorites"}" aria-pressed="${isFav ? "true" : "false"}">★</button>
        <span class="drag-handle" title="Drag to reorder" aria-hidden="true">⋮⋮</span>
      </div>
    </div>
    <svg class="graph-svg" viewBox="0 0 720 220" preserveAspectRatio="none"></svg>
    ${buildLegend(def.lines, def.legendFormatter)}
  `;
  card._plotRange = renderMultiLinePlot(card.querySelector("svg"), def.lines, {
    ...def.plotOptions,
    plotId: def.id,
  });
  card._plotDef = def;
  card.querySelector(".favorite-btn").addEventListener("click", (event) => {
    event.stopPropagation();
    toggleFavorite(def.id);
  });
  wireCardDrag(card);
  attachHoverHandlers(card, def);
  return card;
}

function wireCardDrag(card) {
  card.addEventListener("dragstart", (event) => {
    state.graphs.dragging = true;
    event.dataTransfer.effectAllowed = "move";
    try {
      event.dataTransfer.setData("text/plain", card.dataset.plotId);
    } catch (error) {
      // ignore — Safari/Edge sometimes throws on synthetic events
    }
    card.classList.add("dragging");
    const container = card.parentElement;
    if (container) container.classList.add("drop-target");
  });
  card.addEventListener("dragend", () => {
    state.graphs.dragging = false;
    card.classList.remove("dragging");
    document
      .querySelectorAll(
        ".graphs-drop-zone.drop-target, .board-graph-grid.drop-target",
      )
      .forEach((el) => el.classList.remove("drop-target"));
  });
  card.addEventListener("dragover", (event) => {
    const container = card.parentElement;
    if (!container) return;
    const dragging = container.querySelector(".graph-card.dragging");
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
  if (!container || container.dataset.dropWired === "1") return;
  container.dataset.dropWired = "1";
  container.addEventListener("dragover", (event) => {
    if (!state.graphs.dragging) return;
    const dragging = container.querySelector(".graph-card.dragging");
    if (!dragging) return;
    event.preventDefault();
    if (!dragging.parentElement || dragging.parentElement === container) {
      // dragging within this container — handled by card dragover
      return;
    }
  });
  container.addEventListener("drop", (event) => {
    event.preventDefault();
    const ids = [...container.querySelectorAll(":scope > .graph-card")]
      .map((card) => card.dataset.plotId)
      .filter(Boolean);
    if (orderKey === "favorites") {
      state.graphs.order.favorites = ids;
    } else if (orderKey === "throughput") {
      state.graphs.order.throughput = ids;
    } else if (orderKey.startsWith("board:")) {
      state.graphs.order.board[orderKey.slice(6)] = ids;
    }
    saveGraphPrefs();
  });
}

function buildAllPlotDefs(now, windowMs) {
  const defs = [];

  const fpsPoints = pickWindowedPoints(
    state.graphs.throughput.fps,
    now,
    windowMs,
  );
  const bpsPoints = pickWindowedPoints(
    state.graphs.throughput.bps,
    now,
    windowMs,
  );

  defs.push({
    id: "throughput:fps",
    section: "throughput",
    title: "Frames / sec",
    badge: `${formatRate(fpsPoints.length ? fpsPoints[fpsPoints.length - 1].v : 0)} fps`,
    lines: [
      {
        label: "fps",
        color: FPS_COLOR,
        points: fpsPoints.map((p) => ({ t: p.t, v: p.v })),
      },
    ],
    plotOptions: {
      now,
      windowMs,
      yMinClamp: 0,
      formatY: (v) => v.toFixed(v >= 100 ? 0 : 1),
      emptyText: "No throughput samples yet",
    },
    legendFormatter: (v) => `${formatRate(v)} fps`,
  });

  defs.push({
    id: "throughput:bps",
    section: "throughput",
    title: "Bytes / sec",
    badge: `${formatBytes(bpsPoints.length ? bpsPoints[bpsPoints.length - 1].v : 0)}/s`,
    lines: [
      {
        label: "bytes/s",
        color: BPS_COLOR,
        points: bpsPoints.map((p) => ({ t: p.t, v: p.v })),
      },
    ],
    plotOptions: {
      now,
      windowMs,
      yMinClamp: 0,
      formatY: (v) => formatBytes(v),
      emptyText: "No throughput samples yet",
    },
    legendFormatter: (v) => `${formatBytes(v)}/s`,
  });

  const boardKeys = [...state.graphs.boards.keys()].sort((a, b) =>
    a.localeCompare(b),
  );
  let filteredBoardKeys = boardKeys;
  if (state.boardFilter && state.boardFilter.type !== "all") {
    const filterType = Number(state.boardFilter.type);
    const filterId = Number(state.boardFilter.id);
    filteredBoardKeys = boardKeys.filter((k) => {
      const [typeStr, idStr] = k.split("-");
      return Number(typeStr) === filterType && Number(idStr) === filterId;
    });
  }

  const activeSmuKeys = filteredBoardKeys.filter((k) => k.startsWith("1-"));

  for (const boardKey of filteredBoardKeys) {
    if (boardKey === "imu-overlay") continue;
    const [typeStr, idStr] = boardKey.split("-");
    const boardType = Number(typeStr);
    const boardId = Number(idStr);
    const history = state.graphs.boards.get(boardKey);
    const fastPoints = pickWindowedPoints(history.fast, now, windowMs);
    const slowPoints = pickWindowedPoints(history.slow, now, windowMs);

    if (boardType === 6) {
      const boardName = `TSPMU ${boardId}`;
      defs.push({
        id: `board:${boardKey}:pressure`,
        section: "board",
        boardKey,
        title: `${boardName} · Pressure (Pa)`,
        badge: `${fastPoints.length} pts`,
        lines: [
          {
            label: "Pres 1",
            color: "#6ce0e6",
            points: fastPoints.map((row) => ({ t: row.t, v: row.pressure1 })),
          },
          {
            label: "Pres 2",
            color: "#f7a35c",
            points: fastPoints.map((row) => ({ t: row.t, v: row.pressure2 })),
          },
        ],
        plotOptions: {
          now,
          windowMs,
          formatY: (v) => v.toFixed(2),
          emptyText: "Waiting for pressure frames",
        },
        legendFormatter: (v) => `${v.toFixed(2)} Pa`,
      });

      defs.push({
        id: `board:${boardKey}:temp`,
        section: "board",
        boardKey,
        title: `${boardName} · Temp (°C)`,
        badge: `${slowPoints.length} pts`,
        lines: [
          {
            label: "Temp 1",
            color: "#ef7457",
            points: slowPoints.map((row) => ({ t: row.t, v: row.tspmuTemp1 })),
          },
          {
            label: "Temp 2",
            color: "#6ce0e6",
            points: slowPoints.map((row) => ({ t: row.t, v: row.tspmuTemp2 })),
          },
          {
            label: "Temp 3",
            color: "#b9c47a",
            points: slowPoints.map((row) => ({ t: row.t, v: row.tspmuTemp3 })),
          },
          {
            label: "Temp 4",
            color: "#e6b657",
            points: slowPoints.map((row) => ({ t: row.t, v: row.tspmuTemp4 })),
          },
        ],
        plotOptions: {
          now,
          windowMs,
          formatY: (v) => v.toFixed(1),
          emptyText: "Waiting for temp frames",
        },
        legendFormatter: (v) => `${v.toFixed(1)} °C`,
      });
    } else if (boardType === 1) {
      const boardName = SMU_NAMES[boardId] || `SMU ${boardId}`;
      if (activeSmuKeys.length <= 1) {
        defs.push({
          id: `board:${boardKey}:imu:accel`,
          section: "board",
          boardKey,
          title: `${boardName} · Accel XYZ (${getAccelUnitLabel(state.graphs.accelUnit)})`,
          badge: `${fastPoints.length} pts`,
          lines: [
            {
              label: "Accel X",
              color: "#ff5c5c",
              points: fastPoints.map((row) => ({
                t: row.t,
                v: getAccelVal(row.accelX, state.graphs.accelUnit),
              })),
            },
            {
              label: "Accel Y",
              color: "#5cff5c",
              points: fastPoints.map((row) => ({
                t: row.t,
                v: getAccelVal(row.accelY, state.graphs.accelUnit),
              })),
            },
            {
              label: "Accel Z",
              color: "#5c5cff",
              points: fastPoints.map((row) => ({
                t: row.t,
                v: getAccelVal(row.accelZ, state.graphs.accelUnit),
              })),
            },
          ],
          plotOptions: {
            now,
            windowMs,
            formatY: (v) =>
              `${v.toFixed(3)} ${getAccelUnitLabel(state.graphs.accelUnit)}`,
            emptyText: "Waiting for IMU frames",
          },
          legendFormatter: (v) =>
            `${v.toFixed(3)} ${getAccelUnitLabel(state.graphs.accelUnit)}`,
        });
      }

      defs.push({
        id: `board:${boardKey}:imu:accel_abc`,
        section: "board",
        boardKey,
        title: `${boardName} · Accel ABC (${getAccelUnitLabel(state.graphs.accelUnit)})`,
        badge: `${fastPoints.length} pts`,
        lines: [
          {
            label: "Accel A",
            color: "#ffaa5c",
            points: fastPoints.map((row) => ({
              t: row.t,
              v: getAccelVal(row.accelA, state.graphs.accelUnit),
            })),
          },
          {
            label: "Accel B",
            color: "#aaff5c",
            points: fastPoints.map((row) => ({
              t: row.t,
              v: getAccelVal(row.accelB, state.graphs.accelUnit),
            })),
          },
          {
            label: "Accel C",
            color: "#5cffaa",
            points: fastPoints.map((row) => ({
              t: row.t,
              v: getAccelVal(row.accelC, state.graphs.accelUnit),
            })),
          },
        ],
        plotOptions: {
          now,
          windowMs,
          formatY: (v) =>
            `${v.toFixed(3)} ${getAccelUnitLabel(state.graphs.accelUnit)}`,
          emptyText: "Waiting for IMU frames",
        },
        legendFormatter: (v) =>
          `${v.toFixed(3)} ${getAccelUnitLabel(state.graphs.accelUnit)}`,
      });

      defs.push({
        id: `board:${boardKey}:imu:velo`,
        section: "board",
        boardKey,
        title: `${boardName} · Velo XYZ (${getVelocityUnitLabel(state.graphs.veloUnit)})`,
        badge: `${fastPoints.length} pts`,
        lines: [
          {
            label: "Velo X",
            color: "#ef7457",
            points: fastPoints.map((row) => ({
              t: row.t,
              v: getVelocityVal(row.veloX, state.graphs.veloUnit),
            })),
          },
          {
            label: "Velo Y",
            color: "#6ce0e6",
            points: fastPoints.map((row) => ({
              t: row.t,
              v: getVelocityVal(row.veloY, state.graphs.veloUnit),
            })),
          },
          {
            label: "Velo Z",
            color: "#b9c47a",
            points: fastPoints.map((row) => ({
              t: row.t,
              v: getVelocityVal(row.veloZ, state.graphs.veloUnit),
            })),
          },
        ],
        plotOptions: {
          now,
          windowMs,
          formatY: (v) =>
            `${v.toFixed(2)} ${getVelocityUnitLabel(state.graphs.veloUnit)}`,
          emptyText: "Waiting for IMU frames",
        },
        legendFormatter: (v) =>
          `${v.toFixed(2)} ${getVelocityUnitLabel(state.graphs.veloUnit)}`,
      });

      defs.push({
        id: `board:${boardKey}:imu:velo_abc`,
        section: "board",
        boardKey,
        title: `${boardName} · Velo ABC (${getVelocityUnitLabel(state.graphs.veloUnit)})`,
        badge: `${fastPoints.length} pts`,
        lines: [
          {
            label: "Velo A",
            color: "#e6b657",
            points: fastPoints.map((row) => ({
              t: row.t,
              v: getVelocityVal(row.veloA, state.graphs.veloUnit),
            })),
          },
          {
            label: "Velo B",
            color: "#b657e6",
            points: fastPoints.map((row) => ({
              t: row.t,
              v: getVelocityVal(row.veloB, state.graphs.veloUnit),
            })),
          },
          {
            label: "Velo C",
            color: "#57e6b6",
            points: fastPoints.map((row) => ({
              t: row.t,
              v: getVelocityVal(row.veloC, state.graphs.veloUnit),
            })),
          },
        ],
        plotOptions: {
          now,
          windowMs,
          formatY: (v) =>
            `${v.toFixed(2)} ${getVelocityUnitLabel(state.graphs.veloUnit)}`,
          emptyText: "Waiting for IMU frames",
        },
        legendFormatter: (v) =>
          `${v.toFixed(2)} ${getVelocityUnitLabel(state.graphs.veloUnit)}`,
      });
    } else {
      const boardName = BOARD_NAMES[boardId] || `Board ${boardId}`;
      defs.push({
        id: `board:${boardKey}:sg`,
        section: "board",
        boardKey,
        title: `${boardName} · Strain Gauges (mV)`,
        badge: `${fastPoints.length} pts`,
        lines: SG_COLORS.map((color, idx) => ({
          label: `SG${idx + 1}`,
          color,
          points: fastPoints.map((row) => ({
            t: row.t,
            v: Number(row.sg?.[idx]),
          })),
        })),
        plotOptions: {
          now,
          windowMs,
          formatY: (v) => v.toFixed(0),
          emptyText: "Waiting for fast frames",
        },
        legendFormatter: (v) => `${v.toFixed(0)} mV`,
      });

      defs.push({
        id: `board:${boardKey}:shock`,
        section: "board",
        boardKey,
        title: `${boardName} · Shock (mm)`,
        badge: `${fastPoints.length} pts`,
        lines: [
          {
            label: "Shock",
            color: SHOCK_COLOR,
            points: fastPoints.map((row) => ({ t: row.t, v: row.shockMm })),
          },
        ],
        plotOptions: {
          now,
          windowMs,
          formatY: (v) => v.toFixed(2),
          emptyText: "Waiting for fast frames",
        },
        legendFormatter: (v) => `${v.toFixed(2)} mm`,
      });

      defs.push({
        id: `board:${boardKey}:rpm`,
        section: "board",
        boardKey,
        title: `${boardName} · Wheel Speed (RPM)`,
        badge: `${slowPoints.length} pts`,
        lines: [
          {
            label: "RPM",
            color: RPM_COLOR,
            points: slowPoints.map((row) => ({ t: row.t, v: row.rpm })),
          },
        ],
        plotOptions: {
          now,
          windowMs,
          yMinClamp: 0,
          formatY: (v) => v.toFixed(0),
          emptyText: "Waiting for slow frames",
        },
        legendFormatter: (v) => v.toFixed(0),
      });

      defs.push({
        id: `board:${boardKey}:tire`,
        section: "board",
        boardKey,
        title: `${boardName} · Tire Temps (°C)`,
        badge: `${slowPoints.length} pts`,
        lines: [
          {
            label: "Max",
            color: TIRE_COLORS.max,
            points: slowPoints.map((row) => ({ t: row.t, v: row.tireMax })),
          },
          {
            label: "Min",
            color: TIRE_COLORS.min,
            points: slowPoints.map((row) => ({ t: row.t, v: row.tireMin })),
          },
          {
            label: "Ctr",
            color: TIRE_COLORS.center,
            points: slowPoints.map((row) => ({ t: row.t, v: row.tireCtr })),
          },
          {
            label: "Amb",
            color: TIRE_COLORS.ambient,
            points: slowPoints.map((row) => ({ t: row.t, v: row.tireAmb })),
          },
        ],
        plotOptions: {
          now,
          windowMs,
          formatY: (v) => v.toFixed(1),
          emptyText: "Waiting for slow frames",
        },
        legendFormatter: (v) => `${v.toFixed(1)} °C`,
      });

      defs.push({
        id: `board:${boardKey}:brake`,
        section: "board",
        boardKey,
        title: `${boardName} · Brake Temps (°C)`,
        badge: `${slowPoints.length} pts`,
        lines: [
          {
            label: "Brake",
            color: BRAKE_COLORS.brakeC,
            points: slowPoints.map((row) => ({ t: row.t, v: row.brakeC })),
          },
          {
            label: "Brake Amb",
            color: BRAKE_COLORS.brakeAmbientC,
            points: slowPoints.map((row) => ({
              t: row.t,
              v: row.brakeAmbientC,
            })),
          },
        ],
        plotOptions: {
          now,
          windowMs,
          formatY: (v) => v.toFixed(1),
          emptyText: "Waiting for slow frames",
        },
        legendFormatter: (v) => `${v.toFixed(1)} °C`,
      });
    }
  }

  if (activeSmuKeys.length > 1) {
    const lateralLines = [];
    const longitudinalLines = [];

    activeSmuKeys.forEach((boardKey) => {
      const boardId = Number(boardKey.split("-")[1]);
      const history = state.graphs.boards.get(boardKey);
      if (!history) return;
      const fastPoints = pickWindowedPoints(history.fast, now, windowMs);

      let color = "#bf5d29";
      let shortLabel = `SMU ${boardId}`;
      if (boardId === 0) {
        color = "#6ce0e6"; // Teal
        shortLabel = "COG";
      } else if (boardId === 1) {
        color = "#5dd49a"; // Success Green
        shortLabel = "Mid";
      } else if (boardId === 2) {
        color = "#ef7457"; // Sunset Red
        shortLabel = "Rear";
      }

      lateralLines.push({
        label: `${shortLabel} Y`,
        color: color,
        points: fastPoints.map((row) => ({
          t: row.t,
          v: getAccelVal(row.accelY, state.graphs.accelUnit),
        })),
      });

      longitudinalLines.push({
        label: `${shortLabel} X`,
        color: color,
        points: fastPoints.map((row) => ({
          t: row.t,
          v: getAccelVal(row.accelX, state.graphs.accelUnit),
        })),
      });
    });

    defs.push({
      id: `board:imu-lateral-overlay`,
      section: "board",
      boardKey: "imu-overlay",
      title: `IMU Lateral Acceleration Overlay (Y) (${getAccelUnitLabel(state.graphs.accelUnit)})`,
      badge: `${activeSmuKeys.length} IMUs`,
      lines: lateralLines,
      plotOptions: {
        now,
        windowMs,
        formatY: (v) =>
          `${v.toFixed(2)} ${getAccelUnitLabel(state.graphs.accelUnit)}`,
        emptyText: "Waiting for IMU frames",
      },
      legendFormatter: (v) =>
        `${v.toFixed(2)} ${getAccelUnitLabel(state.graphs.accelUnit)}`,
    });

    defs.push({
      id: `board:imu-longitudinal-overlay`,
      section: "board",
      boardKey: "imu-overlay",
      title: `IMU Longitudinal Acceleration Overlay (X) (${getAccelUnitLabel(state.graphs.accelUnit)})`,
      badge: `${activeSmuKeys.length} IMUs`,
      lines: longitudinalLines,
      plotOptions: {
        now,
        windowMs,
        formatY: (v) =>
          `${v.toFixed(2)} ${getAccelUnitLabel(state.graphs.accelUnit)}`,
        emptyText: "Waiting for IMU frames",
      },
      legendFormatter: (v) =>
        `${v.toFixed(2)} ${getAccelUnitLabel(state.graphs.accelUnit)}`,
    });

    filteredBoardKeys.push("imu-overlay");
  }

  return { defs, boardKeys: filteredBoardKeys };
}

function renderFavoritesSection(favDefs) {
  const ordered = applyOrderedSort(favDefs, state.graphs.order.favorites);
  if (ordered.length === 0) {
    elements.favoritesGrid.innerHTML =
      '<p class="empty-state">Click the star on any graph to pin it here.</p>';
    return;
  }
  elements.favoritesGrid.replaceChildren(...ordered.map(buildPlotCard));
}

function renderThroughputSection(throughputDefs) {
  const ordered = applyOrderedSort(
    throughputDefs,
    state.graphs.order.throughput,
  );
  if (ordered.length === 0) {
    elements.throughputGrid.innerHTML =
      '<p class="empty-state">Throughput plots are pinned to Favorites.</p>';
    return;
  }
  elements.throughputGrid.replaceChildren(...ordered.map(buildPlotCard));
}

function renderBoardSection(boardKeys, defsByBoard, now) {
  if (boardKeys.length === 0) {
    elements.boardGraphs.innerHTML =
      '<p class="empty-state">No board telemetry decoded yet.</p>';
    return;
  }
  const fragment = document.createDocumentFragment();
  for (const boardKey of boardKeys) {
    const history = state.graphs.boards.get(boardKey);
    const defsForBoard = defsByBoard.get(boardKey) || [];
    if (defsForBoard.length === 0) continue;

    let ageMs = null;
    let fastLength = 0;
    let slowLength = 0;
    if (history) {
      ageMs = history.lastSeenAt ? now - history.lastSeenAt : null;
      fastLength = history.fast.length;
      slowLength = history.slow.length;
    } else if (boardKey === "imu-overlay") {
      const smuHistories = [...state.graphs.boards.entries()]
        .filter(([k]) => k.startsWith("1-"))
        .map(([, hist]) => hist);
      if (smuHistories.length > 0) {
        const lastSeens = smuHistories.map((h) => h.lastSeenAt).filter(Boolean);
        if (lastSeens.length > 0) {
          ageMs = now - Math.max(...lastSeens);
        }
        fastLength = smuHistories.reduce((sum, h) => sum + h.fast.length, 0);
        slowLength = smuHistories.reduce((sum, h) => sum + h.slow.length, 0);
      }
    }

    const [typeStr, idStr] = boardKey.split("-");
    const boardType = Number(typeStr);
    const boardId = Number(idStr);
    const boardName =
      boardKey === "imu-overlay"
        ? "IMU Acceleration Overlays"
        : boardType === 6
          ? `TSPMU ${boardId}`
          : boardType === 1
            ? SMU_NAMES[boardId] || `SMU ${boardId}`
            : BOARD_NAMES[boardId] || `Board ${boardId}`;

    // Check if card wrapper already exists
    let card = elements.boardGraphs.querySelector(
      `.board-graph-card[data-board-id="${boardKey}"]`,
    );
    if (!card) {
      card = document.createElement("article");
      card.className = "board-graph-card";
      card.dataset.boardId = String(boardKey);
      card.innerHTML = `
        <header>
          <strong>${escapeHtml(boardName)}</strong>
          <span class="board-age"></span>
        </header>
        <div class="board-graph-grid graphs-drop-zone" data-drop-key="board:${boardKey}"></div>
      `;
      wireDropZone(
        card.querySelector(".board-graph-grid"),
        `board:${boardKey}`,
      );
    }

    // Update the age and sample counts
    const ageEl = card.querySelector(".board-age");
    if (ageEl) {
      ageEl.textContent = `${formatBoardAge(ageMs)} · ${fastLength} fast / ${slowLength} slow`;
    }

    const grid = card.querySelector(".board-graph-grid");
    const ordered = applyOrderedSort(
      defsForBoard,
      state.graphs.order.board[String(boardKey)],
    );
    grid.replaceChildren(...ordered.map(buildPlotCard));

    fragment.appendChild(card);
  }
  elements.boardGraphs.replaceChildren(fragment);
}

function renderGraphs() {
  if (state.graphs.activeTab !== "graphs") return;
  if (state.graphs.dragging) return;

  const now = Date.now();
  const windowMs = activeWindowSeconds() * 1000;
  const { defs, boardKeys } = buildAllPlotDefs(now, windowMs);

  if (boardKeys.length === 0) {
    elements.graphsStatusLine.textContent =
      "Waiting for board telemetry frames.";
  } else {
    const totalFast = boardKeys.reduce((sum, key) => {
      const hist = state.graphs.boards.get(key);
      return sum + (hist ? hist.fast.length : 0);
    }, 0);
    const totalSlow = boardKeys.reduce((sum, key) => {
      const hist = state.graphs.boards.get(key);
      return sum + (hist ? hist.slow.length : 0);
    }, 0);
    elements.graphsStatusLine.textContent = `Tracking ${boardKeys.length} board${boardKeys.length === 1 ? "" : "s"} · ${totalFast} fast / ${totalSlow} slow samples buffered · window ${activeWindowSeconds()}s`;
  }

  const favDefs = [];
  const throughputDefs = [];
  const boardDefsByBoard = new Map();
  for (const def of defs) {
    if (state.graphs.favorites.has(def.id)) {
      favDefs.push(def);
      continue;
    }
    if (def.section === "throughput") {
      throughputDefs.push(def);
    } else if (def.section === "board") {
      const list = boardDefsByBoard.get(def.boardKey) || [];
      list.push(def);
      boardDefsByBoard.set(def.boardKey, list);
    }
  }

  renderFavoritesSection(favDefs);
  renderThroughputSection(throughputDefs);
  renderBoardSection(boardKeys, boardDefsByBoard, now);
  reapplyHoverAfterRender();
}

function reapplyHoverAfterRender() {
  const hover = state.graphs.hover;
  if (!hover || !hover.plotId || hover.fraction == null) return;
  const escaped =
    window.CSS && CSS.escape
      ? CSS.escape(hover.plotId)
      : hover.plotId.replace(/"/g, '\\"');
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
  if (!entry) {
    return;
  }
  if (!entry.sourceOrigin) {
    entry.sourceOrigin = "live";
  }

  state.logRows.unshift(entry);
  if (state.logRows.length > MAX_LOG_ROWS) {
    state.logRows.length = MAX_LOG_ROWS;
  }

  if (!state.logPaused && state.logView === "live") {
    scheduleRender("log", renderLog);
  }
}

async function chooseAndMaybeStartLogging() {
  const filePath = await api.pickLogFile();
  if (!filePath) {
    return;
  }

  state.selectedLogFile = filePath;
  renderLoggingControls();
}

let bfrBoards = {};
let deployTimerInterval = null;
let deployStartTime = 0;

async function loadBfrConfig() {
  try {
    const config = await api.getBfrConfig();
    if (!config.detected) {
      if (elements.deploySetupCard)
        elements.deploySetupCard.style.display = "block";
      if (elements.deployWorkspace)
        elements.deployWorkspace.style.display = "none";
    } else {
      if (elements.deploySetupCard)
        elements.deploySetupCard.style.display = "none";
      if (elements.deployWorkspace)
        elements.deployWorkspace.style.display = "grid";
      bfrBoards = config.boards;
      populateBoardSelect();
    }
  } catch (error) {
    updateStatusLine(`Failed to load BFR config: ${error.message}`);
  }
}

function populateBoardSelect() {
  if (!elements.deployBoardSelect) return;

  const currentSelection = elements.deployBoardSelect.value;
  elements.deployBoardSelect.innerHTML = "";

  for (const [key, info] of Object.entries(bfrBoards)) {
    const opt = document.createElement("option");
    opt.value = key;
    opt.textContent = info.name;
    if (key === "mdu" && !currentSelection) {
      opt.selected = true;
    } else if (key === currentSelection) {
      opt.selected = true;
    }
    elements.deployBoardSelect.appendChild(opt);
  }

  handleBoardSelectChange();
}

function handleBoardSelectChange() {
  if (!elements.deployBoardSelect) return;
  const boardKey = elements.deployBoardSelect.value;
  const board = bfrBoards[boardKey];

  if (!board) return;

  if (elements.deployBoardPathText) {
    elements.deployBoardPathText.textContent = board.path
      ? `Workspace: ${board.path}`
      : "No path registered";
  }

  if (board.ids && board.ids.length > 0) {
    if (elements.deployIdGroup) elements.deployIdGroup.style.display = "grid";
    if (elements.deployIdSelect) {
      elements.deployIdSelect.style.display = "block";
      elements.deployIdSelect.innerHTML = "";
      for (const idVal of board.ids) {
        const opt = document.createElement("option");
        opt.value = idVal;
        opt.textContent = idVal;
        elements.deployIdSelect.appendChild(opt);
      }
    }
    if (elements.deployIdInput) elements.deployIdInput.style.display = "none";
  } else if (board.board_id_var) {
    if (elements.deployIdGroup) elements.deployIdGroup.style.display = "grid";
    if (elements.deployIdSelect) elements.deployIdSelect.style.display = "none";
    if (elements.deployIdInput) {
      elements.deployIdInput.style.display = "block";
      elements.deployIdInput.value = "";
    }
  } else {
    if (elements.deployIdGroup) elements.deployIdGroup.style.display = "none";
  }
}

function ansiToHtml(text) {
  let html = escapeHtml(text);
  const ansiMap = [
    { regex: /\u001b\[1;36m/g, html: '<span class="log-cyan log-bold">' },
    { regex: /\u001b\[36m/g, html: '<span class="log-cyan">' },
    { regex: /\u001b\[1;33m/g, html: '<span class="log-yellow log-bold">' },
    { regex: /\u001b\[33m/g, html: '<span class="log-yellow">' },
    { regex: /\u001b\[1;32m/g, html: '<span class="log-green log-bold">' },
    { regex: /\u001b\[92m/g, html: '<span class="log-green log-bold">' },
    { regex: /\u001b\[32m/g, html: '<span class="log-green">' },
    { regex: /\u001b\[1;31m/g, html: '<span class="log-red log-bold">' },
    { regex: /\u001b\[91m/g, html: '<span class="log-red log-bold">' },
    { regex: /\u001b\[31m/g, html: '<span class="log-red">' },
    { regex: /\u001b\[2m/g, html: '<span class="log-dim">' },
    { regex: /\u001b\[1m/g, html: '<span class="log-bold">' },
    { regex: /\u001b\[0m/g, html: "</span>" },
  ];

  for (const item of ansiMap) {
    html = html.replace(item.regex, item.html);
  }
  return html.replace(/\u001b\[[0-9;]*m/g, "");
}

function appendConsoleLog(text, type = "") {
  if (!elements.terminalLogContainer) return;

  const welcome =
    elements.terminalLogContainer.querySelector(".terminal-welcome");
  if (welcome) {
    welcome.remove();
  }

  const span = document.createElement("span");
  if (type === "red") {
    span.className = "log-red";
  } else if (type === "cyan") {
    span.className = "log-cyan";
  } else if (type === "green") {
    span.className = "log-green";
  } else if (type === "yellow") {
    span.className = "log-yellow";
  }

  span.innerHTML = ansiToHtml(text);
  elements.terminalLogContainer.appendChild(span);

  if (
    elements.consoleAutoscrollToggle &&
    elements.consoleAutoscrollToggle.checked
  ) {
    elements.terminalLogContainer.scrollTop =
      elements.terminalLogContainer.scrollHeight;
  }
}

function startDeployTimer() {
  if (deployTimerInterval) {
    clearInterval(deployTimerInterval);
  }

  deployStartTime = Date.now();
  if (elements.deployTimerVal)
    elements.deployTimerVal.textContent = "Elapsed: 0s";

  deployTimerInterval = setInterval(() => {
    const elapsed = Math.floor((Date.now() - deployStartTime) / 1000);
    if (elements.deployTimerVal)
      elements.deployTimerVal.textContent = `Elapsed: ${elapsed}s`;
  }, 1000);
}

function stopDeployTimer() {
  if (deployTimerInterval) {
    clearInterval(deployTimerInterval);
    deployTimerInterval = null;
  }
}

async function runDeployAction(action) {
  if (!elements.deployBoardSelect) return;

  const boardKey = elements.deployBoardSelect.value;
  if (!boardKey) return;

  const board = bfrBoards[boardKey];
  let boardId = "";

  if (board) {
    if (board.ids && board.ids.length > 0) {
      boardId = elements.deployIdSelect ? elements.deployIdSelect.value : "";
    } else if (board.board_id_var) {
      boardId = elements.deployIdInput
        ? elements.deployIdInput.value.trim()
        : "";
      if (!boardId && action !== "clean") {
        appendConsoleLog(
          `\n[GUI] Error: Board ID is required for target ${boardKey}.\n`,
          "red",
        );
        return;
      }
    }
  }

  const buttons = document.querySelectorAll(".deploy-action-btn");
  buttons.forEach((btn) => (btn.disabled = true));

  if (elements.deployBtnStop) {
    elements.deployBtnStop.style.display = "block";
    elements.deployBtnStop.disabled = false;
  }

  if (elements.deployStatusVal) {
    elements.deployStatusVal.textContent = action.toUpperCase() + "ING...";
    elements.deployStatusVal.style.color = "var(--gold)";
  }

  appendConsoleLog(
    `\n[GUI] Starting action: ${action} on board: ${boardKey} ${boardId ? "(ID: " + boardId + ")" : ""}\n`,
    "cyan",
  );

  startDeployTimer();

  try {
    const result = await api.deployBoard(action, boardKey, boardId);

    stopDeployTimer();
    const totalTime = Math.floor((Date.now() - deployStartTime) / 1000);

    if (result.success) {
      if (elements.deployStatusVal) {
        elements.deployStatusVal.textContent = "Success";
        elements.deployStatusVal.style.color = "var(--success)";
      }
      appendConsoleLog(
        `\n[GUI] Action: ${action} succeeded in ${totalTime}s!\n`,
        "green",
      );
    } else {
      if (elements.deployStatusVal) {
        elements.deployStatusVal.textContent = `Failed (${result.code})`;
        elements.deployStatusVal.style.color = "var(--warning)";
      }
      appendConsoleLog(
        `\n[GUI] Action: ${action} failed with exit code ${result.code} after ${totalTime}s.\n`,
        "red",
      );
    }
  } catch (err) {
    stopDeployTimer();
    if (elements.deployStatusVal) {
      elements.deployStatusVal.textContent = "Error";
      elements.deployStatusVal.style.color = "var(--warning)";
    }
    appendConsoleLog(`\n[GUI] Action error: ${err.message}\n`, "red");
  } finally {
    buttons.forEach((btn) => (btn.disabled = false));
    if (elements.deployBtnStop) {
      elements.deployBtnStop.style.display = "none";
    }
  }
}

function wireUi() {
  applyTheme(document.documentElement.getAttribute("data-theme") || "dark");

  elements.themeToggle.addEventListener("click", () => {
    const current =
      document.documentElement.getAttribute("data-theme") || "dark";
    applyTheme(current === "dark" ? "light" : "dark");
  });

  elements.refreshButton.addEventListener("click", async () => {
    await api.listPorts();
  });

  elements.portSelect.addEventListener("change", async () => {
    state.userSelectedPortPath = elements.portSelect.value;
    if (state.userSelectedPortPath) {
      if (
        state.connection?.connected ||
        (state.connection?.autoConnect && !state.connection?.connected)
      ) {
        const baudRate = Number(elements.baudInput.value) || 115200;
        await api.connect({ path: state.userSelectedPortPath, baudRate });
      } else {
        await api.setPreferredPort(state.userSelectedPortPath);
      }
    }
  });

  elements.connectButton.addEventListener("click", async () => {
    const portPath = elements.portSelect.value;
    const baudRate = Number(elements.baudInput.value) || 115200;
    if (!portPath) {
      if (state.connection?.hub?.detected) {
        updateStatusLine(
          "The USB2514 hub is visible, but macOS has not exposed a USB CDC child endpoint to open.",
        );
      } else {
        updateStatusLine("Select a USB CDC endpoint first.");
      }
      return;
    }

    await api.connect({ path: portPath, baudRate });
  });

  elements.disconnectButton.addEventListener("click", async () => {
    await api.disconnect();
  });

  elements.autoConnectToggle.addEventListener("change", async (event) => {
    await api.setAutoConnect(event.target.checked);
  });

  elements.clearSessionButton.addEventListener("click", async () => {
    state.charts.frames = [];
    state.charts.bytes = [];
    state.graphs.boards = new Map();
    initializeBoardHistories();
    state.graphs.throughput.fps = [];
    state.graphs.throughput.bps = [];
    state.graphs.yRanges = new Map();
    scheduleRender("graphs", renderGraphs);
    await api.clearSession();
  });

  for (const button of elements.tabButtons) {
    button.addEventListener("click", () => setActiveTab(button.dataset.tab));
  }

  const boardTabButtons = Array.from(
    document.querySelectorAll(".board-tab-button"),
  );
  for (const button of boardTabButtons) {
    button.addEventListener("click", () => {
      const filterType = button.dataset.filterType;
      const filterId = button.dataset.filterId;
      state.boardFilter = { type: filterType, id: filterId };
      for (const btn of boardTabButtons) {
        const active = btn === button;
        btn.classList.toggle("active", active);
        btn.setAttribute("aria-selected", active ? "true" : "false");
      }
      if (elements.graphsBoardSelect) {
        elements.graphsBoardSelect.value = `${filterType}-${filterId}`;
      }
      renderBoards();
      renderGraphs();
    });
  }

  if (elements.graphsBoardSelect) {
    elements.graphsBoardSelect.addEventListener("change", (event) => {
      const val = event.target.value;
      const [typeStr, idStr] = val.split("-");
      state.boardFilter = { type: typeStr, id: idStr };
      for (const btn of boardTabButtons) {
        const active =
          btn.dataset.filterType === typeStr && btn.dataset.filterId === idStr;
        btn.classList.toggle("active", active);
        btn.setAttribute("aria-selected", active ? "true" : "false");
      }
      renderBoards();
      renderGraphs();
    });
  }

  elements.graphsWindowSelect.addEventListener("change", (event) => {
    const next = Number(event.target.value);
    if (Number.isFinite(next) && next > 0) {
      state.graphs.windowSeconds = next;
      renderGraphs();
    }
  });

  if (elements.graphsVeloUnitSelect) {
    elements.graphsVeloUnitSelect.addEventListener("change", (event) => {
      state.graphs.veloUnit = event.target.value;
      saveGraphPrefs();
      // Reset stored y-axis ranges so ranges computed in the previous
      // velocity unit don't cause mismatched ticks after a unit change.
      state.graphs.yRanges = new Map();
      renderGraphs();
      renderBoards();
    });
  }

  if (elements.graphsAccelUnitSelect) {
    elements.graphsAccelUnitSelect.addEventListener("change", (event) => {
      state.graphs.accelUnit = event.target.value;
      saveGraphPrefs();
      // Reset stored y-axis ranges so ranges computed in the previous
      // accel unit don't cause mismatched ticks after a unit change.
      state.graphs.yRanges = new Map();
      renderGraphs();
      renderBoards();
    });
  }

  elements.graphsClearButton.addEventListener("click", () => {
    state.graphs.boards = new Map();
    initializeBoardHistories();
    state.graphs.throughput.fps = [];
    state.graphs.throughput.bps = [];
    state.graphs.yRanges = new Map();
    renderGraphs();
  });

  wireDropZone(elements.favoritesGrid, "favorites");
  wireDropZone(elements.throughputGrid, "throughput");

  elements.clearLogButton.addEventListener("click", () => {
    state.logRows = [];
    state.loadedLogRows = [];
    state.logView = "live";
    state.loadedLogFile = "";
    renderLog();
    renderLogViewStatus();
  });

  elements.chooseLogButton.addEventListener(
    "click",
    chooseAndMaybeStartLogging,
  );

  elements.logSearchInput.addEventListener("input", () => {
    state.logFilters.search = elements.logSearchInput.value;
    renderLog();
  });

  elements.logBoardFilter.addEventListener("input", () => {
    state.logFilters.boardId = elements.logBoardFilter.value;
    renderLog();
  });

  elements.logStatusFilter.addEventListener("change", () => {
    state.logFilters.status = elements.logStatusFilter.value;
    renderLog();
  });

  elements.logFrameTypeFilter.addEventListener("change", () => {
    state.logFilters.frameType = elements.logFrameTypeFilter.value;
    renderLog();
  });

  elements.logValueFieldFilter.addEventListener("change", () => {
    state.logFilters.valueField = elements.logValueFieldFilter.value;
    renderLog();
  });

  elements.logValueMin.addEventListener("input", () => {
    state.logFilters.valueMin = elements.logValueMin.value;
    renderLog();
  });

  elements.logValueMax.addEventListener("input", () => {
    state.logFilters.valueMax = elements.logValueMax.value;
    renderLog();
  });

  elements.logPauseToggle.addEventListener("change", () => {
    state.logPaused = elements.logPauseToggle.checked;
    if (!state.logPaused) {
      renderLog();
    }
  });

  elements.loadLogButton.addEventListener("click", async () => {
    try {
      const result = await api.openLogFile();
      if (!result?.entries) {
        return;
      }

      state.loadedLogRows = result.entries
        .map((entry) => ({ sourceOrigin: "file", ...entry }))
        .reverse();
      state.loadedLogFile = result.filePath ?? "";
      state.logView = "file";
      renderLog();
      renderLogViewStatus();
      updateStatusLine(
        `Loaded ${state.loadedLogRows.length} log entries from file.`,
      );
    } catch (error) {
      updateStatusLine(`Failed to load log file: ${error.message}`);
    }
  });

  elements.exportFilteredButton.addEventListener("click", async () => {
    const rows = getFilteredLogRows(getActiveLogRows());
    if (!rows.length) {
      updateStatusLine("No filtered rows available to export.");
      return;
    }

    try {
      const filePath = await api.exportFilteredLog(rows);
      if (filePath) {
        updateStatusLine(`Exported ${rows.length} rows to ${filePath}`);
      }
    } catch (error) {
      updateStatusLine(`Failed to export filtered log: ${error.message}`);
    }
  });

  elements.liveLogButton.addEventListener("click", () => {
    state.logView = "live";
    state.loadedLogFile = "";
    renderLog();
    renderLogViewStatus();
  });

  elements.startLogButton.addEventListener("click", async () => {
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

  elements.stopLogButton.addEventListener("click", async () => {
    state.logStatus = await api.stopLogging();
    renderLoggingControls();
  });

  // Deploy action button listeners
  if (elements.deployBtnClean)
    elements.deployBtnClean.addEventListener("click", () =>
      runDeployAction("clean"),
    );
  if (elements.deployBtnBuild)
    elements.deployBtnBuild.addEventListener("click", () =>
      runDeployAction("build"),
    );
  if (elements.deployBtnFlash)
    elements.deployBtnFlash.addEventListener("click", () =>
      runDeployAction("flash"),
    );
  if (elements.deployBtnDeploy)
    elements.deployBtnDeploy.addEventListener("click", () =>
      runDeployAction("deploy"),
    );

  if (elements.deployBtnStop) {
    elements.deployBtnStop.addEventListener("click", async () => {
      elements.deployBtnStop.disabled = true;
      try {
        await api.stopDeploy();
      } catch (err) {
        appendConsoleLog(
          `\n[GUI] Failed to stop process: ${err.message}\n`,
          "red",
        );
      } finally {
        elements.deployBtnStop.disabled = false;
      }
    });
  }

  if (elements.deployBoardSelect)
    elements.deployBoardSelect.addEventListener(
      "change",
      handleBoardSelectChange,
    );

  if (elements.changeBoardPathBtn) {
    elements.changeBoardPathBtn.addEventListener("click", async () => {
      if (!elements.deployBoardSelect) return;
      const boardKey = elements.deployBoardSelect.value;
      if (!boardKey) return;

      try {
        const dirPath = await api.selectDirectory();
        if (dirPath) {
          appendConsoleLog(
            `\n[GUI] Updating workspace path for board "${boardKey}" to: ${dirPath}...\n`,
            "cyan",
          );
          const result = await api.registerBoard(
            boardKey,
            "",
            "",
            "",
            "",
            dirPath,
          );
          appendConsoleLog(
            `\n[GUI] Workspace path updated successfully!\n`,
            "green",
          );
          if (result.stdout) {
            appendConsoleLog(result.stdout);
          }
          await loadBfrConfig();
        }
      } catch (err) {
        appendConsoleLog(
          `\n[GUI] Failed to update workspace path: ${err.message}\n`,
          "red",
        );
      }
    });
  }

  if (elements.clearConsoleBtn) {
    elements.clearConsoleBtn.addEventListener("click", () => {
      if (elements.terminalLogContainer) {
        elements.terminalLogContainer.innerHTML = "";
      }
    });
  }

  // Setup script trigger
  if (elements.runSetupBtn) {
    elements.runSetupBtn.addEventListener("click", async () => {
      elements.runSetupBtn.disabled = true;
      appendConsoleLog("\n[GUI] Starting BFR setup script...\n", "cyan");
      try {
        const res = await api.runSetupScript();
        appendConsoleLog(`\n[GUI] Setup finished successfully!\n`, "green");
        await loadBfrConfig();
      } catch (e) {
        appendConsoleLog(`\n[GUI] Setup failed: ${e.message}\n`, "red");
      } finally {
        elements.runSetupBtn.disabled = false;
      }
    });
  }

  // Custom Board Registration Modal triggers
  if (elements.openRegisterModalBtn) {
    elements.openRegisterModalBtn.addEventListener("click", () => {
      if (elements.registerBoardModal)
        elements.registerBoardModal.style.display = "flex";
    });
  }

  if (elements.regCancelBtn) {
    elements.regCancelBtn.addEventListener("click", () => {
      if (elements.registerBoardModal)
        elements.registerBoardModal.style.display = "none";
      if (elements.registerBoardForm) elements.registerBoardForm.reset();
    });
  }

  if (elements.regBrowseBtn) {
    elements.regBrowseBtn.addEventListener("click", async () => {
      try {
        const dirPath = await api.selectDirectory();
        if (dirPath && elements.regPathInput) {
          elements.regPathInput.value = dirPath;
          const folderName = dirPath.split(/[/\\]/).pop().toLowerCase();
          if (elements.regKeyInput && !elements.regKeyInput.value) {
            elements.regKeyInput.value = folderName.replace(/[^a-z0-9]/g, "");
          }
          if (elements.regNameInput && !elements.regNameInput.value) {
            elements.regNameInput.value = folderName.toUpperCase();
          }
        }
      } catch (e) {
        updateStatusLine(`Failed to select directory: ${e.message}`);
      }
    });
  }

  if (elements.registerBoardForm) {
    elements.registerBoardForm.addEventListener("submit", async (e) => {
      e.preventDefault();

      const dirPath = elements.regPathInput ? elements.regPathInput.value : "";
      const boardKey = elements.regKeyInput
        ? elements.regKeyInput.value.trim().toLowerCase()
        : "";
      const name = elements.regNameInput
        ? elements.regNameInput.value.trim()
        : "";
      const aliases = elements.regAliasesInput
        ? elements.regAliasesInput.value.trim()
        : "";
      const elf = elements.regElfInput ? elements.regElfInput.value.trim() : "";
      const boardIdVar = elements.regVarInput
        ? elements.regVarInput.value.trim()
        : "";

      if (!dirPath || !boardKey || !name) {
        updateStatusLine("Please fill in the required fields.");
        return;
      }

      appendConsoleLog(
        `\n[GUI] Registering custom board "${name}" (${boardKey})...\n`,
        "cyan",
      );

      try {
        const result = await api.registerBoard(
          boardKey,
          elf,
          name,
          aliases,
          boardIdVar,
          dirPath,
        );
        appendConsoleLog(`\n[GUI] Board registered successfully!\n`, "green");
        if (result.stdout) {
          appendConsoleLog(result.stdout);
        }
        if (elements.registerBoardModal)
          elements.registerBoardModal.style.display = "none";
        elements.registerBoardForm.reset();
        await loadBfrConfig();
      } catch (err) {
        appendConsoleLog(
          `\n[GUI] Registration failed: ${err.message}\n`,
          "red",
        );
      }
    });
  }
}

function wireEvents() {
  api.onPorts((ports) => {
    state.ports = ports;
    renderPorts();
  });

  api.onConnection((connection) => {
    state.connection = connection;
    if (connection.connected && connection.port) {
      state.userSelectedPortPath = connection.port.path;
    } else if (connection.preferredPortPath) {
      state.userSelectedPortPath = connection.preferredPortPath;
    }
    renderConnection();
  });

  api.onDiagnostics((diagnostics) => {
    state.diagnostics = diagnostics;
    appendChartValue(state.charts.frames, diagnostics.framesPerSecond ?? 0);
    appendChartValue(state.charts.bytes, diagnostics.bytesPerSecond ?? 0);
    recordThroughputSample(Date.now(), diagnostics);
    scheduleRender("diagnostics", renderDiagnostics);
    scheduleRender("boards", renderBoards);
    scheduleRender("topIds", renderTopIds);
    scheduleRender("graphs", renderGraphs);
  });

  api.onFrames((frames) => {
    for (const frame of frames) {
      addLogRow(frame);
      if (frame && frame.ok && frame.source === 'board' && frame.board) {
        mergeBoardIntoDiagnostics(frame);
        appendBoardSample(frame);
      }
    }
    scheduleRender('boards', renderBoards);
  });

  api.onRuntime((runtime) => {
    addLogRow({ kind: "runtime", ...runtime });
  });

  api.onLogStatus((logStatus) => {
    state.logStatus = logStatus;
    renderLoggingControls();
    renderDiagnostics();
  });

  api.onDeployLog((log) => {
    appendConsoleLog(log.text, log.type === "stderr" ? "red" : "");
  });
}

async function init() {
  loadGraphPrefs();
  initializeBoardHistories();

  const initialState = await api.getInitialState();
  state.ports = initialState.ports;
  state.connection = initialState.connection;
  state.userSelectedPortPath =
    state.connection?.port?.path ?? state.connection?.preferredPortPath ?? "";
  state.diagnostics = initialState.diagnostics;
  state.logStatus = initialState.logStatus;
  state.selectedLogFile = initialState.logStatus?.filePath ?? "";

  appendChartValue(
    state.charts.frames,
    state.diagnostics?.framesPerSecond ?? 0,
  );
  appendChartValue(state.charts.bytes, state.diagnostics?.bytesPerSecond ?? 0);
  recordThroughputSample(Date.now(), state.diagnostics);

  wireUi();
  wireEvents();

  if (elements.graphsWindowSelect) {
    elements.graphsWindowSelect.value = String(state.graphs.windowSeconds);
  }
  if (elements.graphsVeloUnitSelect) {
    elements.graphsVeloUnitSelect.value = state.graphs.veloUnit;
  }
  if (elements.graphsAccelUnitSelect) {
    elements.graphsAccelUnitSelect.value = state.graphs.accelUnit;
  }
  setActiveTab(state.graphs.activeTab);
  renderAll();
}

init().catch((error) => {
  updateStatusLine(`Failed to initialize the renderer: ${error.message}`);
});
