# EchoAlert Urban Acoustic Incident Network

EchoAlert is a complete local prototype for receiving acoustic sensor readings, classifying incident signatures, triangulating their location, persisting incident records, and coordinating dispatch from a live command-center dashboard. Its guided 3D intersection demo compares a confirmed crash with two sensor-mismatch false alarms, then guides MED-01 using A* routing, turn-by-turn instructions, and dynamic road-block rerouting.

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
