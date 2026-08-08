# EchoAlert Urban Acoustic Incident Network

A browser-based command-center simulation for detecting and triangulating high-decibel urban incidents such as vehicle collisions, shattering glass, metal impacts, structural failures, and illegal industrial activity.

## Run

Open `index.html` in a browser. No install step or package download is required.

For a local URL, run:

```bash
node server.mjs
```

Then open `http://127.0.0.1:4173`.

## Simulation workflow

- Six directional microphone-array nodes distributed around a schematic Sibu city map.
- Frequency, duration, energy, and signal-to-noise features used to classify five incident types.
- Per-node arrival times with deterministic ambient-noise timing uncertainty.
- Time-difference-of-arrival triangulation using a coarse search followed by local refinement.
- Acoustic spectrogram and simulated CCTV evidence fused into one incident record.
- Dispatch or operator-review actions based on classification confidence and localization quality.

Click anywhere on the map to place an incident. Use **Trigger event** to replay the current scenario, the arrow button to move it, or change the ambient-noise and intensity controls to see confidence and error respond.

## Project files

- `index.html` contains the accessible command-center interface.
- `styles.css` provides the responsive desktop and mobile layouts.
- `app.js` contains sensor propagation, classification, TDOA localization, spectrogram rendering, and dispatch state.
- `assets/cctv-collision.png` is the generated visual-evidence frame used by the simulator.
- `server.mjs` serves the demo locally with Node.js.
