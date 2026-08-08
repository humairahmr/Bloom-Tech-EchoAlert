# EchoAlert Urban Acoustic Incident Network

EchoAlert is a complete local prototype for receiving acoustic sensor readings, classifying incident signatures, triangulating their location, persisting incident records, and coordinating dispatch from a live command-center dashboard. Its guided 3D intersection demo compares a confirmed crash with two sensor-mismatch false alarms, then guides MED-01 using A* routing, turn-by-turn instructions, and dynamic road-block rerouting.

## Run locally

EchoAlert requires Node.js 22.5 or newer and must be served by its included Node server. Do not open `index.html` directly and do not use the VS Code **Go Live** button. Live Server cannot provide EchoAlert's `/vendor/three.module.js` file, API routes, SQLite database, or sensor simulation.

### Windows and VS Code

1. Download or clone the project, then open its folder in VS Code with **File > Open Folder**.
2. Select **Terminal > New Terminal**. VS Code normally opens the terminal in the selected project folder automatically.
3. Confirm that the terminal is in the correct folder:

```powershell
Get-ChildItem package.json
```

If `package.json` is not found, move to the folder where that file was downloaded. Replace the example path with the actual location on your computer:

```powershell
cd "C:\path\to\Bloom Tech colllision"
```

The project does not need to be stored in the same user account, drive, or OneDrive location as the original development copy.

4. Install the dependency. This is normally required only on the first launch or after `package.json` changes:

```powershell
npm.cmd install
```

5. Start EchoAlert:

```powershell
npm.cmd start
```

6. Wait for the terminal to report that the server is listening, then open:

`http://127.0.0.1:4173/`

Keep the terminal running while using the dashboard. Press `Ctrl+C` in that terminal to stop the server. In Command Prompt, macOS, or Linux, the equivalent commands are `npm install` and `npm start`.

### First use

1. Wait for the 3D city to appear and for the status to show **SYSTEM NORMAL**.
2. Select an incident scenario from the simulation controls.
3. Select **Simulate Crash** or the scenario's simulation action.
4. Follow the CCTV, acoustic detection, sensor-fusion review, and dispatch sequence shown on screen.
5. Use the reset controls before repeating a scenario.

## Cannot open the dashboard?

Work through these checks in order.

### PowerShell says running scripts is disabled

PowerShell may block `npm.ps1` and display a `PSSecurityException`. Use the Windows command wrapper instead; changing the system execution policy is not required:

```powershell
npm.cmd install
npm.cmd start
```

### Port 4173 is already in use

An `EADDRINUSE` error means another process, often an EchoAlert server that is already running, owns port `4173`.

1. First try opening `http://127.0.0.1:4173/`. If EchoAlert loads, use that existing server and do not start another copy.
2. To run a separate copy, choose another port in the same PowerShell terminal:

```powershell
$env:PORT=4174
npm.cmd start
```

Then open `http://127.0.0.1:4174/`.

### The page is blank, incomplete, or shows 404 errors

- Confirm that the `npm.cmd start` terminal is still running.
- Use the exact `http://` address, not `https://`.
- Do not use **Go Live** and do not double-click `index.html`.
- Run `npm.cmd install` again if `/vendor/three.module.js` is missing or the terminal reports that it cannot find the `three` package.
- Check the backend directly at `http://127.0.0.1:4173/api/health`. A working server returns JSON describing the service, database, and sensors.

If the server uses port `4174` or another value, replace `4173` in the health URL with that port.

### The first load is slow

The delay is mainly caused by the local development setup and 3D initialization, not by backend processing. Reference measurements from this project are:

| Resource | Measured result |
| --- | ---: |
| Backend health API | 12 ms |
| `app.js` (114 KB) | 94 ms |
| Three.js (650 KB) | 671 ms |
| Initial HTML | 316 ms |
| Project directory | About 29 MB |

These values vary by computer. The main causes of a slower first load are:

- **OneDrive:** The project is inside OneDrive, which may synchronize or hydrate files while Node and VS Code read them. Mark the folder **Always keep on this device**, pause synchronization during a demo, or move a copy to a local folder such as `C:\Dev\EchoAlert`.
- **Three.js and WebGL:** The browser downloads and parses Three.js, creates the 3D geometry, compiles WebGL shaders, and starts the animation loop.
- **No-store development caching:** Static application files use `Cache-Control: no-store`, so a refresh reads them from disk again instead of relying on a browser cache.
- **VS Code file watching:** VS Code, Git, JavaScript IntelliSense, and extensions may scan `node_modules`, the database, and OneDrive file changes. Close unused VS Code windows and disable unnecessary extensions for the demo workspace if loading remains unusually slow.

Wait until the server-ready message appears before refreshing the browser. A short delay while the 3D scene initializes is expected; a persistent blank page is not.

To simulate six independent sensor nodes uploading readings through the ingestion API:

```bash
node scripts/simulate-network.mjs collision
```

Supported scenarios are `collision`, `glass`, `metal`, `structure`, and `industrial`.

## System flow

1. Two low-poly vehicles move through a monitored Three.js intersection.
2. A guided impact triggers separate CCTV motion and roadside acoustic detections.
3. The UI confirms an emergency only when both signals meet their thresholds inside the same 1.5 second incident window; mismatches remain unverified and do not dispatch a unit.
4. The backend generates and persists six-node acoustic evidence through `POST /api/simulations`.
5. TDOA localization estimates event coordinates and the full-screen modal presents synchronized visual and audio evidence.
6. Dispatch is persisted through the incident API while A* selects the fastest open road-graph path for MED-01.
7. A simulated road closure blocks a real graph edge, triggers a replacement path, and updates the route geometry, manoeuvres, distance, and ETA.
8. Server-Sent Events keep connected dashboards synchronized with new and updated incidents.

The dashboard scenario injector uses `POST /api/simulations`. This generates realistic readings and passes them through the same persistence and fusion services used by sensor uploads.

## API

| Method | Route | Purpose |
| --- | --- | --- |
| `GET` | `/api/health` | Service, database, and sensor status |
| `GET` | `/api/config` | Sensor geometry and acoustic signatures |
| `GET` | `/api/sensors` | Registered sensor nodes |
| `POST` | `/api/sensor-readings` | Upload one or more DSP feature readings |
| `POST` | `/api/simulations` | Generate and fuse a complete simulated event |
| `GET` | `/api/incidents` | Retrieve persisted incident history |
| `GET` | `/api/incidents/:id` | Retrieve one incident with evidence |
| `POST` | `/api/incidents/:id/dispatch` | Record a responder dispatch |
| `POST` | `/api/incidents/:id/review` | Flag an incident for operator review |
| `GET` | `/api/events` | Live SSE incident stream |

Example sensor payload:

```json
{
  "eventKey": "node-event-001",
  "reading": {
    "sensorId": "N1",
    "arrivalMs": 248.4,
    "bearingDeg": 72.1,
    "snrDb": 43.8,
    "centroidHz": 935,
    "durationS": 0.7,
    "attack": 0.9,
    "capturedAt": "2026-08-08T06:00:00.000Z"
  }
}
```

## Persistence

The server creates `data/echoalert.db` automatically. It stores registered sensors, raw node readings, fused incidents, and dispatch history. Database runtime files are excluded from Git.

## Tests

```bash
npm.cmd test
```

Tests cover all five signature classes, localization accuracy, API health, simulation persistence, dispatch updates, staged multi-node ingestion, A* route selection, blocked-edge rerouting, and route interpolation.

## Project structure

- `server.mjs`: HTTP API, static hosting, validation, and SSE broadcasting
- `src/engine.mjs`: acoustic simulation, classification, and TDOA localization
- `src/store.mjs`: SQLite schema and persistence operations
- `scripts/simulate-network.mjs`: distributed sensor-node simulator
- `scene3d.js`: Three.js city scene, vehicle motion, sensor effects, CCTV replay, and ambulance animation
- `navigation.js`: road-network metadata, A* pathfinding, interpolation, and manoeuvre generation
- `app.js`: scenario state machine, false-alarm review, API integration, evidence, responder navigation, history, and reset behavior
- `index.html`: dashboard, simulation controls, evidence modal, map, and telemetry markup
- `styles.css`: command-center, 3D overlay, modal, and responsive mobile styling
- `tests/backend.test.mjs`: engine and API integration tests
- `tests/navigation.test.mjs`: road-graph, A*, rerouting, and route-position tests

## Demo sequence

1. Select **False Alarm: Sudden Stop**, run it, and show that strong vision evidence without collision audio leaves MED-01 parked.
2. Reset, select **False Alarm: Loud Noise**, and show the inverse mismatch: an audio spike with uninterrupted CCTV traffic.
3. Use **Escalate for Human Review** to explain that AI supports rather than replaces dispatcher authority.
4. Reset, run **Confirmed Collision**, point out the shared timestamp, then dispatch MED-01.
5. During navigation, click **Simulate Road Block** and show the red closure, green replacement route, revised instruction, and new ETA.
6. At arrival, show response statistics and use **Hand Over to On-Scene Response**.

The crash, CCTV inference, audio spectrogram, and ambulance are deterministic demonstration models. They do not replace physical sensor hardware, a trained production ML model, or emergency-service dispatch integration.
