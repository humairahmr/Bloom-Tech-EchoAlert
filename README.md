# EchoAlert Urban Acoustic Incident Network

EchoAlert is a complete local prototype for receiving acoustic sensor readings, classifying incident signatures, triangulating their location, persisting incident records, and coordinating dispatch from a live command-center dashboard. Its guided 3D intersection demo connects CCTV evidence, acoustic analysis, sensor fusion, and an animated medical response in one repeatable flow.

## Run

Requires Node.js 22.5 or newer.

```bash
npm.cmd install
npm.cmd start
```

Open `http://127.0.0.1:4173`.

To simulate six independent sensor nodes uploading readings through the ingestion API:

```bash
node scripts/simulate-network.mjs collision
```

Supported scenarios are `collision`, `glass`, `metal`, `structure`, and `industrial`.

## System flow

1. Two low-poly vehicles move through a monitored Three.js intersection.
2. A guided impact triggers separate CCTV motion and roadside acoustic detections.
3. The UI confirms an emergency only when both signals match the same incident window.
4. The backend generates and persists six-node acoustic evidence through `POST /api/simulations`.
5. TDOA localization estimates event coordinates and the full-screen modal presents synchronized visual and audio evidence.
6. Dispatch is persisted through the incident API while MED-01 follows an animated route and ETA to the scene.
7. Server-Sent Events keep connected dashboards synchronized with new and updated incidents.

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

Tests cover all five signature classes, localization accuracy, API health, simulation persistence, dispatch updates, and staged multi-node ingestion.

## Project structure

- `server.mjs`: HTTP API, static hosting, validation, and SSE broadcasting
- `src/engine.mjs`: acoustic simulation, classification, and TDOA localization
- `src/store.mjs`: SQLite schema and persistence operations
- `scripts/simulate-network.mjs`: distributed sensor-node simulator
- `scene3d.js`: Three.js city scene, vehicle motion, sensor effects, CCTV replay, and ambulance animation
- `app.js`: central incident state machine, API integration, modal, spectrogram, dispatch, and reset behavior
- `index.html`: dashboard, simulation controls, evidence modal, map, and telemetry markup
- `styles.css`: command-center, 3D overlay, modal, and responsive mobile styling
- `tests/backend.test.mjs`: engine and API integration tests

## Demo sequence

1. Show the moving traffic and the three standby AI indicators.
2. Click **Simulate Crash** and narrate the approach, impact, CCTV detection, acoustic detection, and signal correlation.
3. In the evidence modal, point out the shared impact timestamp and independent confidence scores.
4. Click **Dispatch Medical Tier 1** and follow MED-01, its route, and the live ETA.
5. After arrival, click **Reset** to demonstrate that the full sequence is repeatable.

The crash, CCTV inference, audio spectrogram, and ambulance are deterministic demonstration models. They do not replace physical sensor hardware, a trained production ML model, or emergency-service dispatch integration.
