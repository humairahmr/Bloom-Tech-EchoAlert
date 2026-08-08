# EchoAlert Urban Acoustic Incident Network

EchoAlert is a complete local prototype for receiving acoustic sensor readings, classifying incident signatures, triangulating their location, persisting incident records, and coordinating dispatch from a live command-center dashboard.

## Run

Requires Node.js 22.5 or newer. No package installation is needed.

```bash
node server.mjs
```

Open `http://127.0.0.1:4173`.

To simulate six independent sensor nodes uploading readings through the ingestion API:

```bash
node scripts/simulate-network.mjs collision
```

Supported scenarios are `collision`, `glass`, `metal`, `structure`, and `industrial`.

## System flow

1. Directional microphone nodes extract arrival time, bearing, SNR, spectral centroid, envelope duration, and attack features.
2. Each node uploads its reading to `POST /api/sensor-readings` under a shared event key.
3. The backend fuses an event after four unique nodes report it.
4. Acoustic features are compared with known signatures and assigned a confidence score.
5. TDOA localization estimates the event coordinates using a coarse search and local refinement.
6. The incident, sensor evidence, status, and dispatch actions are stored in SQLite.
7. Server-Sent Events push new and updated incidents to every connected dashboard.

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
- `app.js`: API-connected dashboard behavior and visualization
- `tests/backend.test.mjs`: engine and API integration tests
