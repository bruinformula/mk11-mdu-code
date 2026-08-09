# MDU Debug GUI

The **MDU Debug GUI** is a comprehensive desktop Electron application designed for real-time telemetry visualization, log analysis, and firmware deployment for Bruin Formula Racing's Mk11 electric race car.

---

## Key Features & Capabilities

### 1. Multi-Transport Telemetry Streams
The GUI supports three distinct transport channels for pulling live vehicle telemetry:
* **Serial USB Link**: Auto-detects connected STM32 Virtual ComPort devices (USB CDC, `VID:PID = 0483:5740`) with selectable baud rates (up to 921600). Scans system hardware profile to alert when the USB2514 hub is present, even prior to STM32 enumeration.
* **WiFi Telemetry Link**: Connects directly to the car's Raspberry Pi over TCP. Enables starting/stopping remote logs directly on the Pi and downloading recorded runs directly to the local machine's data directory.
* **Base Station TCP Link**: Establishes a raw TCP socket connection (port 5005) to the `mk11-base-station` laptop server. In addition to streaming live CAN packets, it parses and displays real-time base station stats (GPS survey-in lock state, mean accuracy in meters, coordinates, and radio TX/RX metrics).

### 2. Live Telemetry Dashboard & Views
The **Live Console** tab serves as the primary workspace during active testing, featuring:
* **View Switcher**: Toggle between the high-fidelity **Live Dashboard** grid and the **Raw Console Logs**.
* **Live Dashboard Grid**: Reorderable, drag-and-drop dashboard cards featuring:
  * **Chassis Atlas**: Displays rotor temperatures, wheel speeds, shock travel, and live HSL tire surface heatmaps.
  * **Live GPS Map**: Real-time vehicle location tracking on ESRI high-resolution satellite imagery with automatic follow-mode and a trailing path breadcrumb.
  * **Power Systems & BMS**: Visualizes HV/LV battery states, cell voltages, temperatures, currents, and pack state of charge.
  * **Inverter, Motor & VCU**: Monitors motor speeds, temperatures, torque commands, APPS/BSE inputs, and active relays (RTD, IMD, AIRs).
  * **Dashboard Settings Drawer**: Slide-out panel to configure custom warning triggers (e.g. max brake temp, min cell voltage, low SoC) and toggle card visibilities.
* **Raw Console Logs**: Rolling monospace terminal output with sub-device source filtering (SDUs, TSHMU, TSPMU, GPS/SMU) and string search.
* **Active CAN IDs**: Real-time frequency (Hz) and message count tracker for all enumerated CAN frames.

### 3. Fullscreen Display Mode
Maximize visual real estate during live pitlane monitoring:
* Click the **Fullscreen** button on the far right of the navigation tab bar to instantly hide the top connection parameters header and tab selections.
* Exit fullscreen mode at any time by pressing the `Escape` key, or clicking the floating glassmorphic **Exit Fullscreen** button in the top-right corner.
* Automatically adjusts container height calculations and shifts layout controls to prevent overlay collisions.

### 4. Telemetry Post-Run Analyzers
Load saved `.csv` or `.jsonl` run logs via a manual file selector or by **dragging and dropping** a run file directly into the application workspace.
* **Overview**: Provides full-run summary timelines, peak telemetry readings, and detects sensor dropouts (e.g., GPS drops, flow sensor gaps).
* **Corner Overlays & Drivetrain**: Side-by-side suspension, brake, and motor speed comparison graphs.
* **IMU & Motion**: Shows acceleration, gyroscope rotation rates, and drift tracking.
* **Custom Plotter**: Interactive multi-signal chart builder. Drag, zoom, and select combinations of signals.
* **Track Map**: Renders full-session paths with variable color-mapping (e.g., speed, lateral G, shock displacement).
* **G-G Replay & GPS Studio**: Visualizes vehicle handling limits (lateral vs. longitudinal Gs) and replays GPS coordinate sequences step-by-step.
* **Spreadsheet**: Tabular explorer for reviewing telemetry row by row.

### 5. Firmware Deploy Studio
An integrated flashing and compilation interface:
* Detects local `bfr-cli` tool chains and configurations.
* Compile and deploy STM32 firmware target packages (`clean`, `build`, `flash`, `deploy`) with live ANSI terminal output decoding.

---

## Getting Started

### Prerequisites
Ensure you have [Node.js](https://nodejs.org/) (v16+) and `npm` installed.

### Setup and Launch
Clone this repository, navigate to the `mdu debug gui` directory, and run:
```bash
npm install
npm start
```

### Packaging for macOS
To compile a standalone, executable application for local deployment:
```bash
npm run dist
```
Unsigned `.dmg` and `.zip` installer files will be generated in the output `dist/` directory.

---

## Log Formats

### 1. Local Structured Session Logs (`.jsonl`)
Local logging records newline-delimited JSON entries containing:
* `session_start` / `session_end` descriptors.
* `runtime` connections, serial handshakes, and transport state transitions.
* `frame` elements capturing raw ASCII packets, timestamps, and decoded signal objects.

### 2. Python CAN Parser
The GUI features a built-in parser option. Click **Parse Raw CAN** in the Select Run section to automatically execute the Python parser on raw log files (e.g. `_CAN.csv`), converting raw hexadecimal frames into structured timeline spreadsheets.
