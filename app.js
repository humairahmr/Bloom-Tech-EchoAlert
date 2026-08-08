import { createRoadScene } from "./scene3d.js";

const PHASES = Object.freeze({
  NORMAL: "NORMAL",
  APPROACHING: "APPROACHING",
  IMPACT: "IMPACT",
  VISION_DETECTED: "VISION_DETECTED",
  AUDIO_DETECTED: "AUDIO_DETECTED",
  FUSION_VERIFYING: "FUSION_VERIFYING",
  CRITICAL_CONFIRMED: "CRITICAL_CONFIRMED",
  DISPATCHED: "DISPATCHED",
  RESPONDER_ARRIVED: "RESPONDER_ARRIVED"
});

const model = {
  phase: PHASES.NORMAL,
  phaseElapsed: 0,
  elapsed: 0,
  reducedMotion: window.matchMedia("(prefers-reduced-motion: reduce)").matches,
  followIncident: true,
  normalCycle: 0,
  carA: { x: -23, z: -1.2, rotation: 0 },
  carB: { x: 1.2, z: 23, rotation: -Math.PI / 2 },
  approachStartA: -23,
  approachStartB: 23,
  vehicleSpeed: 48,
  impactToken: -1,
  impactIso: null,
  visionDetectedAt: null,
  audioDetectedAt: null,
  fusionRequestStarted: false,
  pendingIncident: null,
  currentIncident: null,
  modalOpen: false,
  modalOpenedAt: 0,
  ambulanceProgress: 0,
  etaSeconds: 18,
  arrivalIso: null,
  runToken: 0,
  renderFrames: 0,
  sceneReady: false,
  lastSpectrogramDraw: 0
};

let sensors = [];
let roadScene = null;
let eventStream = null;

const elements = {
  body: document.body,
  backendState: document.getElementById("backend-state"),
  backendHealth: document.querySelector(".api-health"),
  nodeCount: document.getElementById("node-count"),
  sceneContainer: document.getElementById("three-scene"),
  sceneLoading: document.getElementById("scene-loading"),
  cctvCanvas: document.getElementById("cctv-canvas"),
  simulate: document.getElementById("simulate-crash"),
  reset: document.getElementById("reset-simulation"),
  follow: document.getElementById("follow-incident"),
  noise: document.getElementById("noise-level"),
  energy: document.getElementById("event-energy"),
  noiseReadout: document.getElementById("noise-readout"),
  energyReadout: document.getElementById("energy-readout"),
  systemState: document.getElementById("system-state"),
  systemBlock: document.querySelector(".system-state-block"),
  phaseDescription: document.getElementById("phase-description"),
  visionState: document.getElementById("vision-state"),
  audioState: document.getElementById("audio-state"),
  fusionState: document.getElementById("fusion-state"),
  sensorRows: [...document.querySelectorAll(".sensor-status-list > div")],
  phaseLabel: document.getElementById("phase-label"),
  vehicleSpeed: document.getElementById("vehicle-speed"),
  unitState: document.getElementById("unit-state"),
  etaLabel: document.getElementById("eta-label"),
  arrivalTime: document.getElementById("arrival-time"),
  mapStatus: document.getElementById("map-status"),
  mapCoordinate: document.getElementById("map-coordinate"),
  telemetryBody: document.getElementById("telemetry-body"),
  recordState: document.getElementById("record-state"),
  lockedCount: document.getElementById("locked-count"),
  estimateLabel: document.getElementById("estimate-label"),
  modal: document.getElementById("emergency-modal"),
  modalIncidentId: document.getElementById("modal-incident-id"),
  modalCoordinates: document.getElementById("modal-coordinates"),
  modalLocation: document.getElementById("modal-location"),
  detectionTime: document.getElementById("detection-time"),
  fusionConfidence: document.getElementById("fusion-confidence"),
  cctvTime: document.getElementById("cctv-time"),
  visionImpactTime: document.getElementById("vision-impact-time"),
  audioImpactTime: document.getElementById("audio-impact-time"),
  peakAmplitude: document.getElementById("peak-amplitude"),
  spectrogram: document.getElementById("evidence-spectrogram"),
  dispatch: document.getElementById("dispatch-btn"),
  falseAlarm: document.getElementById("false-alarm-btn"),
  districtLayer: document.getElementById("district-layer"),
  roadLayer: document.getElementById("road-layer"),
  mapLabelLayer: document.getElementById("map-label-layer"),
  sensorLayer: document.getElementById("sensor-layer"),
  mapResultLayer: document.getElementById("map-result-layer")
};

const phaseCopy = {
  [PHASES.NORMAL]: {
    system: "SYSTEM NORMAL",
    description: "Traffic and roadside sensors operating normally",
    phase: "Normal monitoring",
    vision: "Monitoring",
    audio: "Listening",
    fusion: "Standby",
    tone: "normal"
  },
  [PHASES.APPROACHING]: {
    system: "HIGH-SPEED APPROACH",
    description: "Conflicting vehicle paths detected at Intersection 4",
    phase: "Vehicle approach",
    vision: "Tracking vehicles",
    audio: "Listening",
    fusion: "Standby",
    tone: "suspected"
  },
  [PHASES.IMPACT]: {
    system: "IMPACT SUSPECTED",
    description: "Sudden stop detected; independent verification initiated",
    phase: "Impact",
    vision: "Analysing motion",
    audio: "Analysing impulse",
    fusion: "Awaiting signals",
    tone: "suspected"
  },
  [PHASES.VISION_DETECTED]: {
    system: "VISUAL EVENT DETECTED",
    description: "CCTV #04 detected rapid deceleration at the intersection",
    phase: "Vision detection",
    vision: "Rapid deceleration detected",
    audio: "Analysing impulse",
    fusion: "Waiting for audio",
    tone: "suspected"
  },
  [PHASES.AUDIO_DETECTED]: {
    system: "ACOUSTIC EVENT DETECTED",
    description: "Roadside microphone matched a collision impulse",
    phase: "Audio detection",
    vision: "Rapid deceleration detected",
    audio: "Collision signature detected",
    fusion: "Correlating signals",
    tone: "suspected"
  },
  [PHASES.FUSION_VERIFYING]: {
    system: "FUSION VERIFICATION",
    description: "Visual and acoustic timestamps are inside the same incident window",
    phase: "Sensor fusion",
    vision: "Vision confirmed",
    audio: "Audio confirmed",
    fusion: "Correlating signals",
    tone: "suspected"
  },
  [PHASES.CRITICAL_CONFIRMED]: {
    system: "CRASH CONFIRMED",
    description: "Multi-sensor confirmation complete",
    phase: "Critical confirmed",
    vision: "Vision confirmed",
    audio: "Audio confirmed",
    fusion: "Multi-sensor confirmation complete",
    tone: "critical"
  },
  [PHASES.DISPATCHED]: {
    system: "RESPONSE IN PROGRESS",
    description: "Unit MED-01 dispatched; route calculated",
    phase: "Ambulance en route",
    vision: "Incident secured",
    audio: "Incident secured",
    fusion: "Confirmed",
    tone: "response"
  },
  [PHASES.RESPONDER_ARRIVED]: {
    system: "MEDICAL UNIT ARRIVED",
    description: "MED-01 is safely positioned near the crash site",
    phase: "Responder arrived",
    vision: "Scene monitored",
    audio: "Scene monitored",
    fusion: "Response active",
    tone: "response"
  }
};

async function api(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: { "Content-Type": "application/json", ...(options.headers || {}) }
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || `Request failed with ${response.status}`);
  return data;
}

function setBackendStatus(status, text) {
  elements.backendState.textContent = text;
  elements.backendHealth.classList.toggle("is-online", status === "online");
  elements.backendHealth.classList.toggle("is-offline", status === "offline");
}

function setPhase(nextPhase) {
  model.phase = nextPhase;
  model.phaseElapsed = 0;
  elements.body.dataset.simulationState = nextPhase;
  updatePhaseUi();

  if (nextPhase === PHASES.IMPACT) {
    model.impactToken += 1;
    model.impactIso = new Date().toISOString();
  }
  if (nextPhase === PHASES.VISION_DETECTED) model.visionDetectedAt = new Date().toISOString();
  if (nextPhase === PHASES.AUDIO_DETECTED) model.audioDetectedAt = new Date().toISOString();
  if (nextPhase === PHASES.FUSION_VERIFYING) beginBackendFusion(model.runToken);
  if (nextPhase === PHASES.CRITICAL_CONFIRMED) openEmergencyModal();
  if (nextPhase === PHASES.RESPONDER_ARRIVED) {
    model.arrivalIso = new Date().toISOString();
    elements.arrivalTime.textContent = formatTime(model.arrivalIso);
    elements.etaLabel.textContent = "ARRIVED";
  }
  updateMapIncident();
}

function updatePhaseUi() {
  const copy = phaseCopy[model.phase];
  elements.systemState.textContent = copy.system;
  elements.phaseDescription.textContent = copy.description;
  elements.phaseLabel.textContent = copy.phase;
  elements.visionState.textContent = copy.vision;
  elements.audioState.textContent = copy.audio;
  elements.fusionState.textContent = copy.fusion;
  elements.vehicleSpeed.textContent = `${Math.max(0, Math.round(model.vehicleSpeed))} km/h`;

  elements.systemBlock.classList.toggle("is-suspected", copy.tone === "suspected");
  elements.systemBlock.classList.toggle("is-critical", copy.tone === "critical");
  elements.systemBlock.classList.toggle("is-response", copy.tone === "response");

  elements.sensorRows.forEach((row) => row.classList.remove("is-detected", "is-confirmed"));
  if ([PHASES.VISION_DETECTED, PHASES.AUDIO_DETECTED, PHASES.FUSION_VERIFYING].includes(model.phase)) elements.sensorRows[0].classList.add("is-detected");
  if ([PHASES.AUDIO_DETECTED, PHASES.FUSION_VERIFYING].includes(model.phase)) elements.sensorRows[1].classList.add("is-detected");
  if (model.phase === PHASES.FUSION_VERIFYING) elements.sensorRows[2].classList.add("is-detected");
  if ([PHASES.CRITICAL_CONFIRMED, PHASES.DISPATCHED, PHASES.RESPONDER_ARRIVED].includes(model.phase)) {
    elements.sensorRows.forEach((row) => row.classList.add("is-confirmed"));
  }

  elements.mapStatus.textContent = model.phase === PHASES.NORMAL ? "Standby" : copy.phase;
  elements.mapStatus.style.color = copy.tone === "critical" ? "var(--red)" : copy.tone === "suspected" ? "var(--amber)" : "var(--green)";
  elements.simulate.disabled = model.phase !== PHASES.NORMAL;
  if (model.phase === PHASES.DISPATCHED) {
    elements.unitState.textContent = "MED-01 dispatched";
  } else if (model.phase === PHASES.RESPONDER_ARRIVED) {
    elements.unitState.textContent = "MED-01 on scene";
  } else {
    elements.unitState.textContent = "MED-01 standby";
  }
}

function tick(delta, now) {
  model.elapsed += delta;
  model.phaseElapsed += delta;
  model.renderFrames += 1;
  if (!model.sceneReady && model.renderFrames > 2) {
    model.sceneReady = true;
    elements.sceneLoading.classList.add("is-hidden");
  }

  if (model.phase === PHASES.NORMAL) {
    model.normalCycle = (model.normalCycle + delta * 0.08) % 1;
    model.carA.x = -25 + model.normalCycle * 12;
    model.carA.z = -1.2;
    model.carA.rotation = 0;
    model.carB.x = 1.2;
    model.carB.z = 25 - model.normalCycle * 12;
    model.carB.rotation = -Math.PI / 2;
    model.vehicleSpeed = 48;
  } else if (model.phase === PHASES.APPROACHING) {
    const duration = model.reducedMotion ? 0.9 : 2.2;
    const progress = clamp01(model.phaseElapsed / duration);
    const eased = easeInOut(progress);
    model.carA.x = lerp(model.approachStartA, -0.35, eased);
    model.carA.z = -1.2;
    model.carB.x = 1.2;
    model.carB.z = lerp(model.approachStartB, 0.35, eased);
    model.vehicleSpeed = 55 + progress * 25;
    if (progress >= 1) setPhase(PHASES.IMPACT);
  } else if (model.phase === PHASES.IMPACT) {
    setCrashedVehiclePose();
    model.vehicleSpeed = 0;
    if (model.phaseElapsed >= (model.reducedMotion ? 0.2 : 0.55)) setPhase(PHASES.VISION_DETECTED);
  } else if (model.phase === PHASES.VISION_DETECTED) {
    setCrashedVehiclePose();
    if (model.phaseElapsed >= (model.reducedMotion ? 0.25 : 0.7)) setPhase(PHASES.AUDIO_DETECTED);
  } else if (model.phase === PHASES.AUDIO_DETECTED) {
    setCrashedVehiclePose();
    if (model.phaseElapsed >= (model.reducedMotion ? 0.25 : 0.7)) setPhase(PHASES.FUSION_VERIFYING);
  } else if (model.phase === PHASES.FUSION_VERIFYING) {
    setCrashedVehiclePose();
    const minimumFusionTime = model.reducedMotion ? 0.3 : 0.9;
    if (model.pendingIncident && model.phaseElapsed >= minimumFusionTime) {
      model.currentIncident = model.pendingIncident;
      model.pendingIncident = null;
      setPhase(PHASES.CRITICAL_CONFIRMED);
    }
  } else if ([PHASES.CRITICAL_CONFIRMED, PHASES.DISPATCHED, PHASES.RESPONDER_ARRIVED].includes(model.phase)) {
    setCrashedVehiclePose();
  }

  if (model.phase === PHASES.DISPATCHED) {
    const routeDuration = model.reducedMotion ? 5 : 18;
    model.ambulanceProgress = clamp01(model.ambulanceProgress + delta / routeDuration);
    model.etaSeconds = Math.max(0, Math.ceil((1 - model.ambulanceProgress) * 18));
    elements.etaLabel.textContent = `00:${String(model.etaSeconds).padStart(2, "0")}`;
    if (model.ambulanceProgress >= 1) setPhase(PHASES.RESPONDER_ARRIVED);
  }

  if (model.modalOpen && now - model.lastSpectrogramDraw > 42) {
    drawEvidenceSpectrogram(now);
    model.lastSpectrogramDraw = now;
  }

  elements.vehicleSpeed.textContent = `${Math.max(0, Math.round(model.vehicleSpeed))} km/h`;
  updateMapPulse();
}

function setCrashedVehiclePose() {
  model.carA.x = -0.35;
  model.carA.z = -1.2;
  model.carA.rotation = 0.2;
  model.carB.x = 1.2;
  model.carB.z = 0.35;
  model.carB.rotation = -Math.PI / 2 - 0.28;
  model.vehicleSpeed = 0;
}

function startCrashSimulation() {
  if (model.phase !== PHASES.NORMAL) return;
  model.runToken += 1;
  model.approachStartA = model.carA.x;
  model.approachStartB = model.carB.z;
  model.fusionRequestStarted = false;
  model.pendingIncident = null;
  model.currentIncident = null;
  model.ambulanceProgress = 0;
  model.etaSeconds = 18;
  model.arrivalIso = null;
  elements.arrivalTime.textContent = "--";
  elements.etaLabel.textContent = "--:--";
  setPhase(PHASES.APPROACHING);
}

async function beginBackendFusion(runToken) {
  if (model.fusionRequestStarted) return;
  model.fusionRequestStarted = true;
  elements.recordState.textContent = "Correlating";
  try {
    const result = await api("/api/simulations", {
      method: "POST",
      body: JSON.stringify({
        eventType: "collision",
        noiseDb: Number(elements.noise.value),
        intensityDb: Number(elements.energy.value),
        x: 600,
        y: 360
      })
    });
    if (runToken !== model.runToken || model.phase !== PHASES.FUSION_VERIFYING) return;
    model.pendingIncident = result.incident;
    setBackendStatus("online", "Live stream");
  } catch (error) {
    if (runToken !== model.runToken) return;
    elements.fusionState.textContent = "Backend verification failed";
    elements.phaseDescription.textContent = `${error.message}. Reset to retry.`;
    elements.recordState.textContent = "Verification failed";
    setBackendStatus("offline", "API error");
  }
}

function openEmergencyModal() {
  const incident = model.currentIncident;
  if (!incident) return;
  const impactTime = formatTime(model.impactIso);
  model.modalOpen = true;
  model.modalOpenedAt = performance.now();
  elements.modal.classList.add("is-open");
  elements.modal.setAttribute("aria-hidden", "false");
  elements.modalIncidentId.textContent = incident.id;
  elements.modalCoordinates.textContent = `${incident.latitude.toFixed(3)}, ${incident.longitude.toFixed(3)}`;
  elements.modalLocation.textContent = "Jalan Awang Ramli Amit — Intersection 4";
  elements.detectionTime.textContent = formatTime(incident.detectedAt);
  elements.fusionConfidence.textContent = `${(incident.confidence * 100).toFixed(1)}%`;
  elements.cctvTime.textContent = impactTime;
  elements.visionImpactTime.textContent = impactTime;
  elements.audioImpactTime.textContent = impactTime;
  elements.peakAmplitude.textContent = `${elements.energy.value} dB`;
  elements.dispatch.disabled = false;
  updateTelemetryTable(incident.telemetry);
  updateIncidentRecord(incident);
  requestAnimationFrame(() => elements.dispatch.focus());
}

function closeEmergencyModal() {
  model.modalOpen = false;
  elements.modal.classList.remove("is-open");
  elements.modal.setAttribute("aria-hidden", "true");
}

async function dispatchAmbulance() {
  if (!model.currentIncident || model.phase !== PHASES.CRITICAL_CONFIRMED) return;
  elements.dispatch.disabled = true;
  elements.dispatch.textContent = "Dispatching MED-01...";
  try {
    const result = await api(`/api/incidents/${encodeURIComponent(model.currentIncident.id)}/dispatch`, {
      method: "POST",
      body: JSON.stringify({ unit: "MED-01 · Medical Tier 1" })
    });
    model.currentIncident = result.incident;
    closeEmergencyModal();
    model.ambulanceProgress = 0;
    model.etaSeconds = 18;
    elements.etaLabel.textContent = "00:18";
    setPhase(PHASES.DISPATCHED);
  } catch (error) {
    elements.dispatch.disabled = false;
    elements.dispatch.textContent = "Dispatch Medical Tier 1";
    elements.phaseDescription.textContent = error.message;
  }
}

async function dismissFalseAlarm() {
  const incident = model.currentIncident;
  elements.falseAlarm.disabled = true;
  try {
    if (incident) {
      await api(`/api/incidents/${encodeURIComponent(incident.id)}/review`, { method: "POST", body: "{}" });
    }
  } catch {
    // A reset remains available even if the demonstration backend is unavailable.
  } finally {
    elements.falseAlarm.disabled = false;
    resetSimulation();
  }
}

function resetSimulation() {
  model.runToken += 1;
  model.phase = PHASES.NORMAL;
  model.phaseElapsed = 0;
  model.normalCycle = 0;
  model.carA = { x: -23, z: -1.2, rotation: 0 };
  model.carB = { x: 1.2, z: 23, rotation: -Math.PI / 2 };
  model.vehicleSpeed = 48;
  model.impactIso = null;
  model.visionDetectedAt = null;
  model.audioDetectedAt = null;
  model.fusionRequestStarted = false;
  model.pendingIncident = null;
  model.currentIncident = null;
  model.modalOpen = false;
  model.ambulanceProgress = 0;
  model.etaSeconds = 18;
  model.arrivalIso = null;
  closeEmergencyModal();
  elements.dispatch.textContent = "Dispatch Medical Tier 1";
  elements.dispatch.disabled = false;
  elements.recordState.textContent = "Monitoring";
  elements.lockedCount.textContent = "0";
  elements.estimateLabel.textContent = "Awaiting incident";
  elements.mapCoordinate.textContent = "2.2913, 111.8291";
  elements.etaLabel.textContent = "--:--";
  elements.arrivalTime.textContent = "--";
  clearMapIncident();
  renderStandbyTelemetry();
  elements.body.dataset.simulationState = PHASES.NORMAL;
  updatePhaseUi();
  elements.simulate.focus();
}

function updateIncidentRecord(incident) {
  elements.recordState.textContent = incident.id;
  elements.lockedCount.textContent = String(incident.lockedCount);
  elements.estimateLabel.textContent = `${incident.latitude.toFixed(4)}, ${incident.longitude.toFixed(4)}`;
  elements.mapCoordinate.textContent = `${incident.latitude.toFixed(4)}, ${incident.longitude.toFixed(4)}`;
}

function updateTelemetryTable(telemetry) {
  elements.telemetryBody.innerHTML = "";
  const firstArrival = telemetry[0]?.arrivalMs || 0;
  telemetry.forEach((reading) => {
    const row = document.createElement("tr");
    [
      reading.sensorId,
      `${Math.round(reading.bearingDeg)} deg`,
      `${reading.arrivalMs.toFixed(1)} ms`,
      `+${(reading.arrivalMs - firstArrival).toFixed(1)} ms`,
      `${reading.snrDb.toFixed(1)} dB`
    ].forEach((value) => {
      const cell = document.createElement("td");
      cell.textContent = value;
      row.appendChild(cell);
    });
    const status = document.createElement("td");
    status.className = reading.status === "locked" ? "status-ok" : "status-weak";
    status.textContent = reading.status === "locked" ? "Locked" : "Weak";
    row.appendChild(status);
    elements.telemetryBody.appendChild(row);
  });
}

function renderStandbyTelemetry() {
  elements.telemetryBody.innerHTML = "";
  sensors.forEach((sensor) => {
    const row = document.createElement("tr");
    [sensor.id, `${sensor.heading} deg`, "--", "--", "Ambient", "Listening"].forEach((value, index) => {
      const cell = document.createElement("td");
      cell.textContent = value;
      if (index === 5) cell.className = "status-ok";
      row.appendChild(cell);
    });
    elements.telemetryBody.appendChild(row);
  });
}

function drawEvidenceSpectrogram(now) {
  const canvas = elements.spectrogram;
  const context = canvas.getContext("2d");
  const width = canvas.width;
  const height = canvas.height;
  context.fillStyle = "#070911";
  context.fillRect(0, 0, width, height);

  for (let x = 0; x < width; x += 3) {
    for (let y = 0; y < height; y += 5) {
      const activity = Math.max(0, Math.sin(x * 0.13 + y * 0.21) * 0.5 + Math.sin(y * 0.07 + model.elapsed) * 0.35);
      const alpha = 0.025 + activity * 0.12;
      context.fillStyle = `rgba(${80 + Math.round(activity * 80)}, 22, ${118 + Math.round(activity * 90)}, ${alpha})`;
      context.fillRect(x, y, 3, 5);
    }
  }

  context.strokeStyle = "rgba(255,255,255,0.08)";
  context.lineWidth = 1;
  [0.25, 0.5, 0.75].forEach((ratio) => {
    context.beginPath();
    context.moveTo(0, height * ratio);
    context.lineTo(width, height * ratio);
    context.stroke();
  });

  const impactX = width * (2200 / 3600);
  const glow = context.createLinearGradient(impactX - 34, 0, impactX + 34, 0);
  glow.addColorStop(0, "rgba(255,55,83,0)");
  glow.addColorStop(0.42, "rgba(255,58,64,0.5)");
  glow.addColorStop(0.5, "rgba(255,226,124,1)");
  glow.addColorStop(0.58, "rgba(255,58,64,0.5)");
  glow.addColorStop(1, "rgba(255,55,83,0)");
  context.fillStyle = glow;
  context.fillRect(impactX - 34, 0, 68, height);
  context.strokeStyle = "rgba(255,105,105,0.9)";
  context.lineWidth = 2;
  context.beginPath();
  context.moveTo(impactX, 0);
  context.lineTo(impactX, height);
  context.stroke();

  const replayElapsed = (now - model.modalOpenedAt) % 3600;
  const playheadX = replayElapsed / 3600 * width;
  context.strokeStyle = "rgba(69,210,231,0.9)";
  context.lineWidth = 1;
  context.beginPath();
  context.moveTo(playheadX, 0);
  context.lineTo(playheadX, height);
  context.stroke();

  context.fillStyle = "rgba(255,205,205,0.92)";
  context.font = "600 13px system-ui, sans-serif";
  context.fillText("MATCHED IMPACT", Math.min(width - 130, impactX + 9), height - 15);
}

function drawMapBase() {
  const districts = [
    "M36 40 H370 L350 245 L75 300 L30 190 Z",
    "M390 30 H790 L820 230 L565 290 L350 245 Z",
    "M810 35 H1170 V265 L820 230 Z",
    "M48 320 L370 270 L555 315 L510 680 H35 Z",
    "M575 305 L835 250 L1165 290 L1165 685 H530 Z"
  ];
  districts.forEach((d) => elements.districtLayer.appendChild(svgEl("path", { d, class: "district-shape" })));
  elements.roadLayer.appendChild(svgEl("path", { d: "M-20 515 C200 455 405 485 590 400 S920 245 1220 278", class: "waterway" }));
  [
    "M52 190 C260 168 430 207 615 182 S935 155 1175 95",
    "M100 605 C295 530 455 545 650 455 S980 380 1165 410",
    "M310 25 C300 170 352 292 335 424 S320 610 390 705",
    "M780 18 C710 175 775 296 730 430 S725 605 805 720"
  ].forEach((d) => elements.roadLayer.appendChild(svgEl("path", { d, class: "road arterial" })));
  [
    "M85 80 L280 260 L510 95 L700 300 L945 88 L1125 240",
    "M95 360 L280 325 L465 395 L650 300 L860 340 L1100 310",
    "M120 655 L220 420 L440 300 L570 70",
    "M430 690 L520 500 L620 335 L660 70",
    "M880 690 L900 475 L1050 330 L1090 70"
  ].forEach((d) => elements.roadLayer.appendChild(svgEl("path", { d, class: "road minor" })));
  addMapLabel("Sibu", 590, 390, true);
  addMapLabel("Jalan Awang Ramli Amit", 675, 325, false);
}

function drawMapSensors() {
  elements.sensorLayer.innerHTML = "";
  sensors.forEach((sensor) => {
    elements.sensorLayer.appendChild(svgEl("circle", { class: "sensor-ring", cx: sensor.x, cy: sensor.y, r: 15 }));
    elements.sensorLayer.appendChild(svgEl("circle", { class: "sensor", cx: sensor.x, cy: sensor.y, r: 5 }));
    const label = svgEl("text", { class: "sensor-label", x: sensor.x + 14, y: sensor.y - 10 });
    label.textContent = sensor.id;
    elements.sensorLayer.appendChild(label);
  });
}

function updateMapIncident() {
  clearMapIncident();
  if ([PHASES.NORMAL, PHASES.APPROACHING, PHASES.IMPACT].includes(model.phase)) return;
  if ([PHASES.DISPATCHED, PHASES.RESPONDER_ARRIVED].includes(model.phase)) {
    elements.mapResultLayer.appendChild(svgEl("path", { d: "M160 590 C300 520 430 430 600 360", class: "map-route" }));
  }
  const confirmed = [PHASES.CRITICAL_CONFIRMED, PHASES.DISPATCHED, PHASES.RESPONDER_ARRIVED].includes(model.phase);
  const marker = svgEl("circle", { cx: 600, cy: 360, r: 23, class: confirmed ? "map-event-red" : "map-event-amber", "data-map-marker": "true" });
  elements.mapResultLayer.appendChild(marker);
}

function updateMapPulse() {
  const marker = elements.mapResultLayer.querySelector("[data-map-marker]");
  if (!marker) return;
  const base = marker.classList.contains("map-event-red") ? 23 : 20;
  marker.setAttribute("r", String(base + Math.sin(model.elapsed * 6) * 4));
}

function clearMapIncident() {
  elements.mapResultLayer.innerHTML = "";
}

function addMapLabel(text, x, y, major) {
  const label = svgEl("text", { x, y, class: major ? "map-label-major" : "map-label-svg" });
  label.textContent = text;
  elements.mapLabelLayer.appendChild(label);
}

function svgEl(tag, attributes = {}) {
  const element = document.createElementNS("http://www.w3.org/2000/svg", tag);
  Object.entries(attributes).forEach(([key, value]) => element.setAttribute(key, value));
  return element;
}

function startEventStream() {
  if (!window.EventSource) return;
  eventStream = new EventSource("/api/events");
  eventStream.addEventListener("connected", () => setBackendStatus("online", "Live stream"));
  eventStream.addEventListener("reading-progress", (event) => {
    if (model.phase === PHASES.NORMAL) {
      const progress = JSON.parse(event.data);
      elements.recordState.textContent = `${progress.received}/${progress.required} nodes`;
    }
  });
  eventStream.addEventListener("incident", (event) => {
    const incident = JSON.parse(event.data);
    if (model.phase === PHASES.FUSION_VERIFYING) {
      model.pendingIncident = incident;
    } else if (model.phase === PHASES.NORMAL && incident.eventType === "collision") {
      adoptExternalIncident(incident);
    }
  });
  eventStream.addEventListener("incident-updated", (event) => {
    const incident = JSON.parse(event.data);
    if (incident.id === model.currentIncident?.id) {
      model.currentIncident = incident;
      updateTelemetryTable(incident.telemetry);
      updateIncidentRecord(incident);
    }
  });
  eventStream.onerror = () => setBackendStatus("offline", "Stream retrying");
}

function adoptExternalIncident(incident) {
  model.runToken += 1;
  model.currentIncident = incident;
  model.impactIso = incident.detectedAt;
  model.impactToken += 1;
  setCrashedVehiclePose();
  setPhase(PHASES.CRITICAL_CONFIRMED);
}

function bindControls() {
  elements.simulate.addEventListener("click", startCrashSimulation);
  elements.reset.addEventListener("click", resetSimulation);
  elements.follow.addEventListener("change", () => { model.followIncident = elements.follow.checked; });
  elements.noise.addEventListener("input", () => { elements.noiseReadout.textContent = `${elements.noise.value} dB`; });
  elements.energy.addEventListener("input", () => { elements.energyReadout.textContent = `${elements.energy.value} dB`; });
  elements.dispatch.addEventListener("click", dispatchAmbulance);
  elements.falseAlarm.addEventListener("click", dismissFalseAlarm);
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && model.modalOpen) dismissFalseAlarm();
  });
}

async function init() {
  bindControls();
  drawMapBase();
  try {
    const [health, config] = await Promise.all([api("/api/health"), api("/api/config")]);
    sensors = config.sensors;
    elements.nodeCount.textContent = String(health.sensors.online);
    drawMapSensors();
    renderStandbyTelemetry();
    setBackendStatus("online", "API connected");
    startEventStream();

    roadScene = createRoadScene({
      container: elements.sceneContainer,
      evidenceCanvas: elements.cctvCanvas,
      getState: () => model,
      onFrame: tick
    });
    window.__echoAlertDebug = {
      getState: () => ({
        phase: model.phase,
        modalOpen: model.modalOpen,
        ambulanceProgress: model.ambulanceProgress,
        renderFrames: model.renderFrames,
        runToken: model.runToken,
        incidentId: model.currentIncident?.id || null
      }),
      loopCount: 1
    };
  } catch (error) {
    setBackendStatus("offline", "System unavailable");
    elements.sceneLoading.innerHTML = `<strong>3D simulation unavailable</strong><span>${escapeHtml(error.message)}</span>`;
    elements.simulate.disabled = true;
  }
  elements.body.dataset.simulationState = PHASES.NORMAL;
  updatePhaseUi();
}

function formatTime(isoDate) {
  if (!isoDate) return "--:--:--";
  return new Date(isoDate).toLocaleTimeString("en-MY", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: true
  }).toUpperCase();
}

function lerp(start, end, amount) { return start + (end - start) * amount; }
function easeInOut(value) { return value * value * (3 - 2 * value); }
function clamp01(value) { return Math.max(0, Math.min(1, value)); }
function escapeHtml(value) {
  return String(value).replace(/[&<>'"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[character]);
}

init();
