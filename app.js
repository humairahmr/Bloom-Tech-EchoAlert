import { createRoadScene } from "./scene3d.js";
import {
  ROAD_NODES,
  findFastestRoute,
  navigationConstants,
  navigationInstruction,
  poseAlongRoute,
  prependCurrentPosition,
  roadNetworkForMap,
  segmentKey
} from "./navigation.js";

const PHASES = Object.freeze({
  NORMAL: "NORMAL",
  APPROACHING: "APPROACHING",
  IMPACT: "IMPACT",
  SUSPECTED_EVENT: "SUSPECTED_EVENT",
  VISION_DETECTED: "VISION_DETECTED",
  AUDIO_DETECTED: "AUDIO_DETECTED",
  FUSION_VERIFYING: "FUSION_VERIFYING",
  SENSOR_MISMATCH: "SENSOR_MISMATCH",
  FALSE_ALARM: "FALSE_ALARM",
  AWAITING_HUMAN_REVIEW: "AWAITING_HUMAN_REVIEW",
  CRITICAL_CONFIRMED: "CRITICAL_CONFIRMED",
  ROUTE_CALCULATING: "ROUTE_CALCULATING",
  NAVIGATING: "NAVIGATING",
  REROUTING: "REROUTING",
  RESPONDER_ARRIVED: "RESPONDER_ARRIVED",
  CLEARED: "CLEARED"
});

const SCENARIOS = Object.freeze({
  confirmed: { button: "Simulate Confirmed Crash", trigger: "Vehicle collision" },
  sudden_stop: { button: "Simulate Sudden-Stop Alert", trigger: "Rapid deceleration" },
  loud_noise: { button: "Simulate Loud-Noise Alert", trigger: "High-amplitude sound" }
});

const NAVIGATION_PHASES = new Set([PHASES.ROUTE_CALCULATING, PHASES.NAVIGATING, PHASES.REROUTING, PHASES.RESPONDER_ARRIVED]);
const VERIFICATION_WINDOW_MS = 1500;
const $ = (selector) => document.querySelector(selector);

const model = {
  phase: PHASES.NORMAL,
  phaseElapsed: 0,
  elapsed: 0,
  reducedMotion: matchMedia("(prefers-reduced-motion: reduce)").matches,
  selectedScenario: "confirmed",
  activeScenario: "confirmed",
  normalCycle: 0,
  carA: { x: -23, z: -1.2, rotation: 0 },
  carB: { x: 1.2, z: 23, rotation: -Math.PI / 2 },
  approachStartA: -23,
  approachStartB: 23,
  vehicleSpeed: 48,
  eventPosition: { x: 0, z: 0 },
  impactToken: -1,
  impactIso: null,
  visionDetectedAt: null,
  audioDetectedAt: null,
  fusionRequestStarted: false,
  pendingIncident: null,
  currentIncident: null,
  modalOpen: false,
  modalMode: "critical",
  modalOpenedAt: 0,
  runToken: 0,
  renderFrames: 0,
  sceneReady: false,
  lastSpectrogramDraw: 0,
  lastNavigationDraw: 0,
  ambulance: { x: ROAD_NODES.S.x, z: ROAD_NODES.S.z, rotation: 0 },
  route: null,
  pendingRoute: null,
  routePoints: [],
  routeSegments: [],
  routeDistance: 0,
  routeVersion: 0,
  routeTone: "planned",
  blockedSegments: new Set(),
  blockedRoutePoints: [],
  routeChanges: 0,
  routeStartedAt: null,
  completedDistance: 0,
  etaSeconds: 0,
  navigationInstruction: { arrow: "UP", manoeuvre: "Route calculating", distance: 0, roadName: "Emergency network" },
  cameraMode: "responder",
  arrivalIso: null,
  history: [],
  reviewQueue: [],
  localIncidentCounter: 0,
  falseResultRecorded: false
};

let sensors = [];
let roadScene = null;
let eventStream = null;

const elements = {
  body: document.body,
  operations: $(".operations"),
  backendState: $("#backend-state"),
  backendHealth: $(".api-health"),
  nodeCount: $("#node-count"),
  sceneContainer: $("#three-scene"),
  sceneLoading: $("#scene-loading"),
  cctvCanvas: $("#cctv-canvas"),
  simulate: $("#simulate-crash"),
  simulateLabel: $("#simulate-label"),
  reset: $("#reset-simulation"),
  scenario: $("#scenario-select"),
  follow: $("#follow-incident"),
  noise: $("#noise-level"),
  energy: $("#event-energy"),
  noiseReadout: $("#noise-readout"),
  energyReadout: $("#energy-readout"),
  systemState: $("#system-state"),
  systemBlock: $(".system-state-block"),
  phaseDescription: $("#phase-description"),
  visionState: $("#vision-state"),
  audioState: $("#audio-state"),
  fusionState: $("#fusion-state"),
  sensorRows: [...document.querySelectorAll(".sensor-status-list > div")],
  phaseLabel: $("#phase-label"),
  vehicleSpeed: $("#vehicle-speed"),
  unitState: $("#unit-state"),
  etaLabel: $("#eta-label"),
  arrivalTime: $("#arrival-time"),
  mapStatus: $("#map-status"),
  mapCoordinate: $("#map-coordinate"),
  telemetryBody: $("#telemetry-body"),
  recordState: $("#record-state"),
  lockedCount: $("#locked-count"),
  estimateLabel: $("#estimate-label"),
  modal: $("#emergency-modal"),
  emergencyTitle: $("#emergency-title"),
  modalIncidentId: $("#modal-incident-id"),
  modalCoordinates: $("#modal-coordinates"),
  modalLocation: $("#modal-location"),
  detectionTime: $("#detection-time"),
  fusionConfidence: $("#fusion-confidence"),
  modalVisionConfidence: $("#modal-vision-confidence"),
  modalAudioConfidence: $("#modal-audio-confidence"),
  modalClassification: $("#modal-classification"),
  modalRecommendation: $("#modal-recommendation"),
  modalDispatchStatus: $("#modal-dispatch-status"),
  emergencyNote: $("#emergency-note"),
  correlationBadge: $("#correlation-badge"),
  visionBadge: $("#vision-badge"),
  audioBadge: $("#audio-badge"),
  cctvTime: $("#cctv-time"),
  cctvDetectionBox: $("#cctv-detection-box"),
  cctvObjectLabel: $("#cctv-object-label"),
  visionOverlay: $("#vision-overlay"),
  visionObjectIds: $("#vision-object-ids"),
  visionConfidence: $("#vision-confidence"),
  visionImpactTime: $("#vision-impact-time"),
  audioConfidence: $("#audio-confidence"),
  audioImpactTime: $("#audio-impact-time"),
  audioCallout: $("#audio-callout"),
  audioMatchLabel: $("#audio-match-label"),
  peakAmplitude: $("#peak-amplitude"),
  spectrogram: $("#evidence-spectrogram"),
  dispatch: $("#dispatch-btn"),
  falseAlarm: $("#false-alarm-btn"),
  humanReview: $("#human-review-btn"),
  districtLayer: $("#district-layer"),
  roadLayer: $("#road-layer"),
  mapLabelLayer: $("#map-label-layer"),
  sensorLayer: $("#sensor-layer"),
  mapResultLayer: $("#map-result-layer"),
  navigationHud: $("#navigation-hud"),
  navArrow: $("#nav-arrow"),
  navManoeuvre: $("#nav-manoeuvre"),
  navDistance: $("#nav-distance"),
  navRoad: $("#nav-road"),
  navEta: $("#nav-eta"),
  navRemaining: $("#nav-remaining"),
  routeStatus: $("#route-status"),
  guidance: $("#guidance-message"),
  roadBlock: $("#simulate-road-block"),
  navigationMap: $("#navigation-map"),
  navigationMapPanel: $(".navigation-map"),
  collapseMap: $("#collapse-nav-map"),
  cameraButtons: [...document.querySelectorAll("[data-camera-mode]")],
  arrivalSummary: $("#arrival-summary"),
  responseTime: $("#response-time"),
  distanceTravelled: $("#distance-travelled"),
  routeChanges: $("#route-changes"),
  handover: $("#handover-response"),
  historyBody: $("#history-body"),
  clearHistory: $("#clear-history"),
  reviewCount: $("#review-count")
};

async function api(path, options = {}) {
  const response = await fetch(path, { ...options, headers: { "Content-Type": "application/json", ...(options.headers || {}) } });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || `Request failed with ${response.status}`);
  return data;
}

function phaseCopy() {
  const scenario = model.activeScenario;
  const common = {
    [PHASES.NORMAL]: ["SYSTEM NORMAL", "Traffic and roadside sensors operating normally", "Normal monitoring", "Monitoring", "Listening", "Standby", "normal"],
    [PHASES.IMPACT]: ["IMPACT SUSPECTED", "Sudden stop detected; independent verification initiated", "Impact", "Analysing motion", "Analysing impulse", "Awaiting signals", "suspected"],
    [PHASES.CRITICAL_CONFIRMED]: ["CRASH CONFIRMED", "Independent signals matched inside the 1.5 second incident window", "Critical confirmed", "Vision confirmed", "Audio confirmed", "Multi-sensor confirmation complete", "critical"],
    [PHASES.ROUTE_CALCULATING]: ["FASTEST ROUTE CALCULATING", "A* is evaluating open emergency-access road segments", "Route calculation", "Incident secured", "Incident secured", "Confirmed", "response"],
    [PHASES.NAVIGATING]: ["MED-01 EN ROUTE", "Emergency corridor activated; civilian traffic yielding", "Responder navigation", "Scene monitored", "Scene monitored", "Response active", "response"],
    [PHASES.REROUTING]: ["ROAD BLOCK DETECTED", "Ambulance stopped safely while A* calculates an alternative", "Dynamic rerouting", "Scene monitored", "Scene monitored", "Route recalculation", "suspected"],
    [PHASES.RESPONDER_ARRIVED]: ["MEDICAL UNIT ARRIVED", "MED-01 is safely positioned beside the incident", "Responder arrived", "Scene monitored", "Scene monitored", "Response active", "response"],
    [PHASES.CLEARED]: ["EVENT CLEARED", "No emergency response is required", "Cleared", "Monitoring resumed", "Listening resumed", "Cleared", "normal"]
  };
  if (common[model.phase]) return common[model.phase];
  if (model.phase === PHASES.APPROACHING) {
    return scenario === "sudden_stop"
      ? ["HIGH-SPEED VEHICLE", "CCTV #04 is tracking VEH-214 at 78 km/h", "Sudden-stop approach", "Tracking vehicle", "Listening", "Standby", "suspected"]
      : ["HIGH-SPEED APPROACH", "Conflicting vehicle paths detected at Intersection 4", "Vehicle approach", "Tracking vehicles", "Listening", "Standby", "suspected"];
  }
  if (model.phase === PHASES.SUSPECTED_EVENT) {
    return scenario === "loud_noise"
      ? ["LOUD EVENT DETECTED", "Roadside acoustic A-04 registered a high-amplitude impulse", "Sound investigation", "Monitoring traffic", "High-amplitude event detected", "Waiting for visual review", "suspected"]
      : ["SUDDEN STOP DETECTED", "VEH-214 stopped safely in-lane without physical impact", "Visual investigation", "Rapid deceleration detected", "Analysing incident window", "Waiting for confirmation", "suspected"];
  }
  if (model.phase === PHASES.VISION_DETECTED) {
    if (scenario === "loud_noise") return ["CCTV WINDOW REVIEW", "No stopped vehicle, debris, or abnormal road behaviour found", "Vision review", "No visual collision detected", "High-amplitude event detected", "Correlating signals", "suspected"];
    return ["VISUAL EVENT DETECTED", "CCTV #04 detected rapid deceleration", "Vision detection", "Rapid deceleration detected", "Analysing incident window", "Waiting for independent confirmation", "suspected"];
  }
  if (model.phase === PHASES.AUDIO_DETECTED) {
    if (scenario === "loud_noise") return ["ACOUSTIC EVENT DETECTED", "A-04 detected a sharp non-classified urban sound", "Audio detection", "Reviewing CCTV incident window", "High-amplitude event detected", "Correlating signals", "suspected"];
    return ["ACOUSTIC EVENT DETECTED", "Roadside microphone matched a collision impulse", "Audio detection", "Rapid deceleration detected", "Collision signature detected", "Correlating signals", "suspected"];
  }
  if (model.phase === PHASES.FUSION_VERIFYING) {
    return scenario === "confirmed"
      ? ["FUSION VERIFICATION", "Visual and acoustic events are inside the 1.5 second window", "Sensor fusion", "Vision confirmed", "Audio confirmed", "Correlating signals", "suspected"]
      : ["FUSION VERIFICATION", "Independent sensor evidence is being compared", "Sensor fusion", scenario === "loud_noise" ? "No visual collision" : "Visual event detected", scenario === "sudden_stop" ? "Audio match not found" : "Audio event detected", "Checking verification window", "suspected"];
  }
  if (model.phase === PHASES.SENSOR_MISMATCH || model.phase === PHASES.FALSE_ALARM) {
    return scenario === "sudden_stop"
      ? ["FALSE ALARM - NO COLLISION CONFIRMED", "Rapid deceleration had no matching collision audio", "Sensor mismatch", "Sudden stop: 96.4%", "Collision match: 8.2%", "Event classified as unverified", "cleared"]
      : ["FALSE ALARM - NON-COLLISION SOUND", "High-amplitude audio had no corresponding visual incident", "Sensor mismatch", "No visual collision", "Urban sound detected", "Event classified as unverified", "cleared"];
  }
  if (model.phase === PHASES.AWAITING_HUMAN_REVIEW) return ["AWAITING DISPATCHER REVIEW", "AI recommendation held; human authority retained", "Human review", "Evidence available", "Evidence available", "Awaiting dispatcher decision", "suspected"];
  return common[PHASES.NORMAL];
}

function setPhase(nextPhase) {
  model.phase = nextPhase;
  model.phaseElapsed = 0;
  elements.body.dataset.simulationState = nextPhase;
  if (nextPhase === PHASES.IMPACT) {
    model.impactToken += 1;
    model.impactIso = new Date().toISOString();
  }
  if (nextPhase === PHASES.SUSPECTED_EVENT && !model.impactIso) model.impactIso = new Date().toISOString();
  if (nextPhase === PHASES.VISION_DETECTED) model.visionDetectedAt = new Date().toISOString();
  if (nextPhase === PHASES.AUDIO_DETECTED) model.audioDetectedAt = new Date().toISOString();
  if (nextPhase === PHASES.FUSION_VERIFYING && model.activeScenario === "confirmed") beginBackendFusion(model.runToken);
  if (nextPhase === PHASES.FALSE_ALARM) {
    if (!model.currentIncident) model.currentIncident = createLocalIncident();
    openEvidenceModal("investigation");
  }
  if (nextPhase === PHASES.CRITICAL_CONFIRMED) openEvidenceModal("critical");
  if (nextPhase === PHASES.RESPONDER_ARRIVED) completeArrival();
  updatePhaseUi();
  updateMapIncident();
}

function updatePhaseUi() {
  const [system, description, phase, vision, audio, fusion, tone] = phaseCopy();
  elements.systemState.textContent = system;
  elements.phaseDescription.textContent = description;
  elements.phaseLabel.textContent = phase;
  elements.visionState.textContent = vision;
  elements.audioState.textContent = audio;
  elements.fusionState.textContent = fusion;
  elements.vehicleSpeed.textContent = `${Math.max(0, Math.round(model.vehicleSpeed))} km/h`;
  elements.systemBlock.classList.toggle("is-suspected", tone === "suspected");
  elements.systemBlock.classList.toggle("is-critical", tone === "critical");
  elements.systemBlock.classList.toggle("is-response", tone === "response");
  elements.sensorRows.forEach((row) => row.classList.remove("is-detected", "is-confirmed"));
  if (![PHASES.NORMAL, PHASES.CLEARED].includes(model.phase)) elements.sensorRows[0].classList.add("is-detected");
  if ([PHASES.AUDIO_DETECTED, PHASES.FUSION_VERIFYING, PHASES.SENSOR_MISMATCH, PHASES.FALSE_ALARM].includes(model.phase)) elements.sensorRows[1].classList.add("is-detected");
  if ([PHASES.FUSION_VERIFYING, PHASES.SENSOR_MISMATCH, PHASES.FALSE_ALARM, PHASES.AWAITING_HUMAN_REVIEW].includes(model.phase)) elements.sensorRows[2].classList.add("is-detected");
  if ([PHASES.CRITICAL_CONFIRMED, ...NAVIGATION_PHASES].includes(model.phase)) elements.sensorRows.forEach((row) => row.classList.add("is-confirmed"));
  elements.simulate.disabled = model.phase !== PHASES.NORMAL;
  elements.scenario.disabled = model.phase !== PHASES.NORMAL;
  elements.mapStatus.textContent = model.phase === PHASES.NORMAL ? "Standby" : phase;
  elements.mapStatus.style.color = tone === "critical" ? "var(--red)" : tone === "suspected" ? "var(--amber)" : tone === "cleared" ? "var(--cyan)" : "var(--green)";
  const navigating = NAVIGATION_PHASES.has(model.phase);
  elements.navigationHud.classList.toggle("is-active", navigating);
  elements.navigationHud.setAttribute("aria-hidden", String(!navigating));
  elements.operations.dataset.navigationActive = String(navigating);
  elements.unitState.textContent = model.phase === PHASES.RESPONDER_ARRIVED ? "MED-01 on scene" : navigating ? "MED-01 dispatched" : "MED-01 standby";
  elements.arrivalSummary.hidden = model.phase !== PHASES.RESPONDER_ARRIVED;
  const routeRemaining = model.route ? model.route.totalDistance - model.routeDistance : 0;
  elements.roadBlock.disabled = model.phase !== PHASES.NAVIGATING || model.routeChanges > 0 || routeRemaining < 70;
}

function tick(delta, now) {
  model.elapsed += delta;
  model.phaseElapsed += delta;
  model.renderFrames += 1;
  if (!model.sceneReady && model.renderFrames > 2) {
    model.sceneReady = true;
    elements.sceneLoading.classList.add("is-hidden");
  }

  if (model.phase === PHASES.NORMAL) updateNormalTraffic(delta);
  else if (model.phase === PHASES.APPROACHING) updateApproach();
  else if (model.phase === PHASES.IMPACT) {
    setCrashedVehiclePose();
    if (model.phaseElapsed >= motionTime(0.55)) setPhase(PHASES.VISION_DETECTED);
  } else if (model.phase === PHASES.SUSPECTED_EVENT) updateSuspectedEvent(delta);
  else if (model.phase === PHASES.VISION_DETECTED) updateVisionStage();
  else if (model.phase === PHASES.AUDIO_DETECTED) updateAudioStage();
  else if (model.phase === PHASES.FUSION_VERIFYING) updateFusionStage();
  else if (model.phase === PHASES.SENSOR_MISMATCH && model.phaseElapsed >= motionTime(0.8)) setPhase(PHASES.FALSE_ALARM);
  else if ([PHASES.CRITICAL_CONFIRMED, PHASES.ROUTE_CALCULATING, PHASES.NAVIGATING, PHASES.REROUTING, PHASES.RESPONDER_ARRIVED].includes(model.phase)) setCrashedVehiclePose();

  if (model.activeScenario !== "confirmed" && [PHASES.VISION_DETECTED, PHASES.AUDIO_DETECTED, PHASES.FUSION_VERIFYING, PHASES.SENSOR_MISMATCH, PHASES.FALSE_ALARM, PHASES.AWAITING_HUMAN_REVIEW].includes(model.phase)) updateFalseAlarmTraffic(delta);

  if (model.phase === PHASES.ROUTE_CALCULATING && model.phaseElapsed >= motionTime(0.8)) installPendingRoute();
  if (model.phase === PHASES.REROUTING && model.phaseElapsed >= motionTime(0.9)) installPendingRoute();
  if (model.phase === PHASES.NAVIGATING) updateNavigation(delta);
  if (model.modalOpen && now - model.lastSpectrogramDraw > 42) {
    drawEvidenceSpectrogram(now);
    model.lastSpectrogramDraw = now;
  }
  if (NAVIGATION_PHASES.has(model.phase) && now - model.lastNavigationDraw > 80) {
    drawNavigationMap();
    model.lastNavigationDraw = now;
  }
  elements.vehicleSpeed.textContent = `${Math.max(0, Math.round(model.vehicleSpeed))} km/h`;
  updateMapPulse();
}

function updateNormalTraffic(delta) {
  model.normalCycle = (model.normalCycle + delta * 0.08) % 1;
  model.carA = { x: -25 + model.normalCycle * 12, z: -1.2, rotation: 0 };
  model.carB = { x: 1.2, z: 25 - model.normalCycle * 12, rotation: -Math.PI / 2 };
  model.vehicleSpeed = 48;
}

function updateApproach() {
  const duration = motionTime(2.2);
  const progress = clamp01(model.phaseElapsed / duration);
  const eased = easeInOut(progress);
  if (model.activeScenario === "sudden_stop") {
    model.carA.x = lerp(model.approachStartA, -6, eased);
    model.carA.z = -1.2;
    model.carA.rotation = 0;
    model.carB.z = 13 - progress * 4;
    model.vehicleSpeed = Math.max(0, 78 * (1 - Math.pow(progress, 3)));
    model.eventPosition = { x: -6, z: -1.2 };
    if (progress >= 1) setPhase(PHASES.SUSPECTED_EVENT);
    return;
  }
  model.carA.x = lerp(model.approachStartA, -0.35, eased);
  model.carA.z = -1.2;
  model.carB.x = 1.2;
  model.carB.z = lerp(model.approachStartB, 0.35, eased);
  model.vehicleSpeed = 55 + progress * 25;
  if (progress >= 1) setPhase(PHASES.IMPACT);
}

function updateSuspectedEvent(delta) {
  if (model.activeScenario === "loud_noise") {
    model.normalCycle = (model.normalCycle + delta * 0.06) % 1;
    model.carA.x = -20 + model.normalCycle * 12;
    model.carB.z = 20 - model.normalCycle * 12;
    model.vehicleSpeed = 45;
    if (model.phaseElapsed >= motionTime(0.65)) setPhase(PHASES.AUDIO_DETECTED);
  } else {
    model.carA = { x: -6, z: -1.2, rotation: 0 };
    model.vehicleSpeed = 0;
    if (model.phaseElapsed >= motionTime(0.65)) setPhase(PHASES.VISION_DETECTED);
  }
}

function updateFalseAlarmTraffic(delta) {
  model.normalCycle = (model.normalCycle + delta * 0.06) % 1;
  if (model.activeScenario === "loud_noise") {
    model.carA = { x: -20 + model.normalCycle * 12, z: -1.2, rotation: 0 };
    model.carB = { x: 1.2, z: 20 - model.normalCycle * 12, rotation: -Math.PI / 2 };
    model.vehicleSpeed = 45;
  } else {
    model.carA = { x: -6, z: -1.2, rotation: 0 };
    model.carB = { x: 1.2, z: 18 - model.normalCycle * 10, rotation: -Math.PI / 2 };
    model.vehicleSpeed = 0;
  }
}

function updateVisionStage() {
  if (model.activeScenario === "confirmed") {
    setCrashedVehiclePose();
    if (model.phaseElapsed >= motionTime(0.7)) setPhase(PHASES.AUDIO_DETECTED);
  } else if (model.activeScenario === "sudden_stop") {
    model.carA = { x: -6, z: -1.2, rotation: 0 };
    model.vehicleSpeed = 0;
    if (model.phaseElapsed >= motionTime(0.8)) setPhase(PHASES.FUSION_VERIFYING);
  } else if (model.phaseElapsed >= motionTime(0.8)) setPhase(PHASES.FUSION_VERIFYING);
}

function updateAudioStage() {
  if (model.activeScenario === "confirmed") {
    setCrashedVehiclePose();
    if (model.phaseElapsed >= motionTime(0.7)) setPhase(PHASES.FUSION_VERIFYING);
  } else if (model.phaseElapsed >= motionTime(0.7)) setPhase(PHASES.VISION_DETECTED);
}

function updateFusionStage() {
  if (model.activeScenario === "confirmed") {
    setCrashedVehiclePose();
    if (model.pendingIncident && model.phaseElapsed >= motionTime(0.9)) {
      model.currentIncident = model.pendingIncident;
      model.pendingIncident = null;
      setPhase(PHASES.CRITICAL_CONFIRMED);
    }
  } else if (model.phaseElapsed >= motionTime(1)) {
    setPhase(PHASES.SENSOR_MISMATCH);
  }
}

function startSelectedScenario() {
  if (model.phase !== PHASES.NORMAL) return;
  model.runToken += 1;
  model.activeScenario = model.selectedScenario;
  model.approachStartA = model.carA.x;
  model.approachStartB = model.carB.z;
  model.currentIncident = null;
  model.pendingIncident = null;
  model.fusionRequestStarted = false;
  model.falseResultRecorded = false;
  model.impactIso = null;
  model.visionDetectedAt = null;
  model.audioDetectedAt = null;
  model.eventPosition = model.activeScenario === "loud_noise" ? { x: 9.5, z: -14 } : { x: 0, z: 0 };
  elements.arrivalTime.textContent = "--";
  elements.etaLabel.textContent = "--:--";
  if (model.activeScenario === "loud_noise") setPhase(PHASES.SUSPECTED_EVENT);
  else setPhase(PHASES.APPROACHING);
}

function sensorEventsMatch() {
  if (!model.visionDetectedAt || !model.audioDetectedAt) return false;
  return Math.abs(new Date(model.visionDetectedAt) - new Date(model.audioDetectedAt)) <= VERIFICATION_WINDOW_MS;
}

async function beginBackendFusion(runToken) {
  if (model.fusionRequestStarted) return;
  model.fusionRequestStarted = true;
  elements.recordState.textContent = "Correlating";
  try {
    const result = await api("/api/simulations", {
      method: "POST",
      body: JSON.stringify({ eventType: "collision", noiseDb: Number(elements.noise.value), intensityDb: Number(elements.energy.value), x: 600, y: 360 })
    });
    if (runToken !== model.runToken || model.phase !== PHASES.FUSION_VERIFYING) return;
    if (!sensorEventsMatch()) throw new Error("Sensor timestamps fell outside the verification window");
    model.pendingIncident = result.incident;
    setBackendStatus("online", "Live stream");
  } catch (error) {
    if (runToken !== model.runToken) return;
    elements.fusionState.textContent = "Backend verification failed";
    elements.phaseDescription.textContent = `${error.message}. Reset to retry.`;
    setBackendStatus("offline", "API error");
  }
}

function createLocalIncident() {
  model.localIncidentCounter += 1;
  const day = new Date().toISOString().slice(0, 10).replaceAll("-", "");
  return {
    id: `EA-UNV-${day}-${String(model.localIncidentCounter).padStart(2, "0")}`,
    detectedAt: model.impactIso || new Date().toISOString(),
    latitude: 2.2913,
    longitude: 111.8291,
    confidence: model.activeScenario === "sudden_stop" ? 0.182 : 0.214,
    lockedCount: 1,
    telemetry: []
  };
}

function openEvidenceModal(mode) {
  if (!model.currentIncident) return;
  model.modalMode = mode;
  model.modalOpen = true;
  model.modalOpenedAt = performance.now();
  elements.body.classList.add("modal-open");
  elements.modal.classList.add("is-open");
  elements.modal.classList.toggle("is-investigation", mode !== "critical");
  elements.modal.setAttribute("aria-hidden", "false");
  configureEvidenceModal();
  requestAnimationFrame(() => elements.dispatch.focus());
}

function configureEvidenceModal() {
  const incident = model.currentIncident;
  const impactTime = formatTime(model.impactIso || incident.detectedAt);
  const scenario = model.activeScenario;
  elements.modalIncidentId.textContent = incident.id;
  elements.modalCoordinates.textContent = `${incident.latitude.toFixed(3)}, ${incident.longitude.toFixed(3)}`;
  elements.modalLocation.textContent = "Jalan Awang Ramli Amit - Intersection 4";
  elements.detectionTime.textContent = formatTime(incident.detectedAt);
  elements.cctvTime.textContent = impactTime;
  elements.visionImpactTime.textContent = impactTime;
  elements.audioImpactTime.textContent = impactTime;
  elements.cctvDetectionBox.hidden = false;
  elements.dispatch.disabled = false;
  elements.falseAlarm.disabled = false;

  if (model.modalMode === "critical") {
    elements.emergencyTitle.textContent = "Status: critical - multi-sensor confirmation";
    elements.correlationBadge.textContent = "Matched inside 1.5 s window";
    elements.visionBadge.textContent = "Vision confirmed";
    elements.audioBadge.textContent = "Audio confirmed";
    elements.cctvObjectLabel.textContent = "VEH-214 + VEH-927";
    elements.visionObjectIds.textContent = "VEH-214 / VEH-927";
    elements.visionOverlay.innerHTML = "Rapid Deceleration: <strong>80 km/h -> 0 km/h</strong>";
    elements.visionConfidence.textContent = "99.6%";
    elements.modalVisionConfidence.textContent = "99.6%";
    elements.audioConfidence.textContent = "99.8%";
    elements.modalAudioConfidence.textContent = "99.8%";
    elements.audioMatchLabel.textContent = "99.8% Match";
    elements.peakAmplitude.textContent = `${elements.energy.value} dB`;
    elements.fusionConfidence.textContent = `${(incident.confidence * 100).toFixed(1)}%`;
    elements.modalClassification.textContent = "Confirmed vehicle collision";
    elements.modalRecommendation.textContent = "Medical Tier 1";
    elements.modalDispatchStatus.textContent = "Awaiting dispatcher";
    elements.emergencyNote.textContent = "Visual and acoustic events matched within the same incident window, reducing false-dispatch risk through independent confirmation.";
    elements.dispatch.innerHTML = '<span aria-hidden="true">➤</span> Dispatch Medical Tier 1';
    elements.falseAlarm.textContent = "Dismiss / False Alarm";
    elements.humanReview.hidden = true;
  } else if (model.modalMode === "review") {
    configureMismatchEvidence(scenario, impactTime);
    elements.emergencyTitle.textContent = "Status: awaiting dispatcher review";
    elements.modalDispatchStatus.textContent = "Not dispatched - human decision required";
    elements.dispatch.textContent = "Confirm Incident and Dispatch";
    elements.falseAlarm.textContent = "Confirm False Alarm";
    elements.humanReview.hidden = true;
  } else {
    configureMismatchEvidence(scenario, impactTime);
    elements.dispatch.textContent = "Continue Monitoring";
    elements.falseAlarm.textContent = "Mark as False Alarm";
    elements.humanReview.textContent = "Escalate for Human Review";
    elements.humanReview.hidden = false;
  }
}

function configureMismatchEvidence(scenario, impactTime) {
  const sudden = scenario === "sudden_stop";
  elements.emergencyTitle.textContent = "Status: unverified - sensor mismatch";
  elements.correlationBadge.textContent = "Independent signal mismatch";
  elements.visionBadge.textContent = sudden ? "Vision event detected" : "No visual collision";
  elements.audioBadge.textContent = sudden ? "Audio match not found" : "Audio event detected";
  elements.cctvDetectionBox.hidden = !sudden;
  elements.cctvObjectLabel.textContent = "VEH-214";
  elements.visionObjectIds.textContent = sudden ? "VEH-214" : "VEH-214 / VEH-927 normal";
  elements.visionOverlay.innerHTML = sudden ? "Rapid Deceleration: <strong>78 km/h -> 0 km/h</strong>" : "Traffic Continuity: <strong>No stopped vehicles</strong>";
  elements.visionConfidence.textContent = sudden ? "96.4%" : "5.1%";
  elements.modalVisionConfidence.textContent = sudden ? "96.4% sudden-stop event" : "5.1% collision confidence";
  elements.audioConfidence.textContent = sudden ? "8.2%" : "91.3% urban sound";
  elements.modalAudioConfidence.textContent = sudden ? "8.2% collision confidence" : "91.3% high-amplitude event";
  elements.audioMatchLabel.textContent = sudden ? "No Match" : "Non-Collision Spike";
  elements.peakAmplitude.textContent = sudden ? "42 dB" : "124 dB";
  elements.audioImpactTime.textContent = sudden ? `${impactTime} +/- 0.75 s` : impactTime;
  elements.fusionConfidence.textContent = sudden ? "18.2%" : "21.4%";
  elements.modalClassification.textContent = sudden ? "Likely emergency braking" : "Probable construction or environmental noise";
  elements.modalRecommendation.textContent = "Continue monitoring";
  elements.modalDispatchStatus.textContent = "NOT DISPATCHED";
  elements.emergencyNote.textContent = sudden
    ? "Rapid deceleration was detected visually, but no matching acoustic collision signature occurred within the 1.5 second verification window."
    : "A high-amplitude sound was detected, but CCTV found no collision, stopped vehicle, debris, or abnormal road behaviour.";
}

function closeEvidenceModal() {
  model.modalOpen = false;
  elements.body.classList.remove("modal-open");
  elements.modal.classList.remove("is-open", "is-investigation");
  elements.modal.setAttribute("aria-hidden", "true");
}

async function handlePrimaryModalAction() {
  if (model.modalMode === "critical") return dispatchAmbulance();
  if (model.modalMode === "review") return confirmIncidentFromReview();
  return finalizeFalseAlarm("Continue monitoring");
}

async function handleSecondaryModalAction() {
  if (model.modalMode === "critical") {
    try { await api(`/api/incidents/${encodeURIComponent(model.currentIncident.id)}/review`, { method: "POST", body: "{}" }); } catch {}
    upsertHistory({ decision: "Dismissed as false alarm", dispatch: "Not dispatched", fusion: "Dispatcher override" });
    closeEvidenceModal();
    window.scrollTo(0, 0);
    requestAnimationFrame(() => elements.operations.scrollIntoView({ block: "start" }));
    setPhase(PHASES.CLEARED);
    return;
  }
  finalizeFalseAlarm("Confirmed false alarm");
}

function finalizeFalseAlarm(decision) {
  upsertHistory({
    decision,
    dispatch: "Not dispatched",
    fusion: "Sensor mismatch",
    vision: model.activeScenario === "sudden_stop" ? "Sudden stop 96.4%" : "No collision",
    audio: model.activeScenario === "sudden_stop" ? "No match 8.2%" : "Urban sound 91.3%"
  });
  model.reviewQueue = model.reviewQueue.filter((id) => id !== model.currentIncident?.id);
  renderHistory();
  closeEvidenceModal();
  setPhase(PHASES.CLEARED);
}

function escalateHumanReview() {
  if (!model.currentIncident) return;
  if (!model.reviewQueue.includes(model.currentIncident.id)) model.reviewQueue.push(model.currentIncident.id);
  upsertHistory({ decision: "Awaiting dispatcher review", dispatch: "Held", fusion: "Escalated for human review" });
  model.modalMode = "review";
  model.phase = PHASES.AWAITING_HUMAN_REVIEW;
  model.phaseElapsed = 0;
  elements.body.dataset.simulationState = model.phase;
  configureEvidenceModal();
  updatePhaseUi();
  updateMapIncident();
}

async function confirmIncidentFromReview() {
  const token = ++model.runToken;
  elements.dispatch.disabled = true;
  elements.dispatch.textContent = "Creating confirmed incident...";
  try {
    const result = await api("/api/simulations", { method: "POST", body: JSON.stringify({ eventType: "collision", noiseDb: 35, intensityDb: 128, x: 600, y: 360 }) });
    if (token !== model.runToken) return;
    const reviewedId = model.currentIncident.id;
    model.currentIncident = result.incident;
    model.reviewQueue = model.reviewQueue.filter((id) => id !== reviewedId);
    model.activeScenario = "confirmed";
    model.eventPosition = { x: 0, z: 0 };
    setCrashedVehiclePose();
    closeEvidenceModal();
    upsertHistory({ id: reviewedId, decision: "Human confirmed incident", dispatch: "MED-01 authorized", fusion: "Human override" });
    await persistDispatchAndNavigate(true);
  } catch (error) {
    elements.dispatch.disabled = false;
    elements.dispatch.textContent = "Confirm Incident and Dispatch";
    elements.phaseDescription.textContent = error.message;
  }
}

async function dispatchAmbulance() {
  if (!model.currentIncident || model.phase !== PHASES.CRITICAL_CONFIRMED) return;
  elements.dispatch.disabled = true;
  elements.dispatch.textContent = "Dispatching MED-01...";
  await persistDispatchAndNavigate(false);
}

async function persistDispatchAndNavigate(humanOverride) {
  try {
    const result = await api(`/api/incidents/${encodeURIComponent(model.currentIncident.id)}/dispatch`, { method: "POST", body: JSON.stringify({ unit: "MED-01 - Medical Tier 1" }) });
    model.currentIncident = result.incident;
    closeEvidenceModal();
    model.blockedSegments.clear();
    model.blockedRoutePoints = [];
    model.routeChanges = 0;
    model.completedDistance = 0;
    model.routeTone = "planned";
    model.pendingRoute = findFastestRoute("S", "D", model.blockedSegments);
    model.routeStartedAt = new Date();
    model.arrivalIso = null;
    elements.etaLabel.textContent = "CALC";
    upsertHistory({ decision: humanOverride ? "Human confirmed incident" : "Medical Tier 1 approved", dispatch: "MED-01 dispatched", fusion: humanOverride ? "Human override" : "Confirmed collision" });
    setPhase(PHASES.ROUTE_CALCULATING);
  } catch (error) {
    elements.dispatch.disabled = false;
    elements.dispatch.textContent = model.modalMode === "review" ? "Confirm Incident and Dispatch" : "Dispatch Medical Tier 1";
    elements.phaseDescription.textContent = error.message;
  }
}

function installPendingRoute() {
  if (!model.pendingRoute) {
    elements.guidance.textContent = "No alternative route available - MED-01 holding safely";
    return;
  }
  model.route = model.pendingRoute;
  model.pendingRoute = null;
  model.routePoints = model.route.points;
  model.routeSegments = model.route.segments;
  model.routeDistance = 0;
  model.routeVersion += 1;
  const pose = poseAlongRoute(model.route, 0);
  model.ambulance = { x: pose.x, z: pose.z, rotation: pose.rotation };
  elements.routeStatus.textContent = model.routeTone === "alternative" ? "Faster alternative route found" : "Fastest emergency route";
  elements.guidance.textContent = model.routeTone === "alternative" ? "Alternative emergency corridor activated" : "Emergency corridor activated";
  setPhase(PHASES.NAVIGATING);
}

function updateNavigation(delta) {
  model.routeDistance = Math.min(model.route.totalDistance, model.routeDistance + navigationConstants.emergencySpeedMps * delta);
  const pose = poseAlongRoute(model.route, model.routeDistance);
  model.ambulance = { x: pose.x, z: pose.z, rotation: pose.rotation };
  const remaining = Math.max(0, model.route.totalDistance - model.routeDistance);
  model.etaSeconds = Math.ceil(remaining / navigationConstants.emergencySpeedMps);
  model.navigationInstruction = navigationInstruction(model.route, pose, remaining);
  model.vehicleSpeed = remaining < 55 ? 24 : 72;
  updateNavigationHud(remaining);
  if (model.routeDistance >= model.route.totalDistance) setPhase(PHASES.RESPONDER_ARRIVED);
}

function updateNavigationHud(remaining) {
  const instruction = model.navigationInstruction;
  const arrows = { UP: "↑", LEFT: "←", RIGHT: "→", PIN: "◆" };
  elements.navArrow.textContent = arrows[instruction.arrow] || "↑";
  elements.navManoeuvre.textContent = instruction.manoeuvre;
  elements.navDistance.textContent = `${Math.max(0, Math.round(instruction.distance / 10) * 10)} m`;
  elements.navRoad.textContent = instruction.roadName;
  elements.navEta.textContent = formatDuration(model.etaSeconds);
  elements.navRemaining.textContent = `${Math.round(remaining)} m`;
  elements.etaLabel.textContent = formatDuration(model.etaSeconds);
  elements.guidance.textContent = remaining < 55 ? (remaining < 15 ? "Arriving at the incident on your right" : "Incident ahead in 50 metres") : `${instruction.manoeuvre} for ${Math.round(instruction.distance)} metres`;
  updatePhaseUi();
}

function simulateRoadBlock() {
  if (model.phase !== PHASES.NAVIGATING || elements.roadBlock.disabled) return;
  const pose = poseAlongRoute(model.route, model.routeDistance);
  const upcoming = model.route.segments[Math.min(model.route.segments.length - 1, pose.segmentIndex + 1)];
  const blockedKey = segmentKey(upcoming.from, upcoming.to);
  model.blockedSegments.add(blockedKey);
  model.blockedRoutePoints = [[ROAD_NODES[upcoming.from], ROAD_NODES[upcoming.to]]];
  model.completedDistance += model.routeDistance;
  const current = { ...model.ambulance };
  const alternative = findFastestRoute(upcoming.from, "D", model.blockedSegments);
  model.pendingRoute = prependCurrentPosition(alternative, current);
  model.routeTone = "alternative";
  model.routeChanges += 1;
  model.routeVersion += 1;
  elements.routeStatus.textContent = "Road block detected";
  elements.guidance.textContent = "ROAD BLOCK DETECTED - calculating alternative";
  setPhase(PHASES.REROUTING);
}

function completeArrival() {
  model.arrivalIso = new Date().toISOString();
  model.vehicleSpeed = 0;
  model.etaSeconds = 0;
  elements.arrivalTime.textContent = formatTime(model.arrivalIso);
  elements.etaLabel.textContent = "ARRIVED";
  elements.navEta.textContent = "00:00";
  const responseSeconds = Math.max(0, Math.round((new Date(model.arrivalIso) - model.routeStartedAt) / 1000));
  const distance = Math.round(model.completedDistance + (model.route?.totalDistance || 0));
  elements.responseTime.textContent = formatDuration(responseSeconds);
  elements.distanceTravelled.textContent = `${distance} m`;
  elements.routeChanges.textContent = String(model.routeChanges);
  elements.guidance.textContent = "Arriving at incident location";
  upsertHistory({ decision: "Unit arrived", dispatch: "MED-01 on scene", response: formatDuration(responseSeconds) });
}

function handOverResponse() {
  if (model.phase !== PHASES.RESPONDER_ARRIVED) return;
  upsertHistory({ decision: "Handed over on scene", dispatch: "Response active" });
  setPhase(PHASES.CLEARED);
}

function setCrashedVehiclePose() {
  model.carA = { x: -0.35, z: -1.2, rotation: 0.2 };
  model.carB = { x: 1.2, z: 0.35, rotation: -Math.PI / 2 - 0.28 };
  model.vehicleSpeed = 0;
}

function drawEvidenceSpectrogram(now) {
  const canvas = elements.spectrogram;
  const context = canvas.getContext("2d");
  const { width, height } = canvas;
  context.fillStyle = "#070911";
  context.fillRect(0, 0, width, height);
  for (let x = 0; x < width; x += 3) {
    for (let y = 0; y < height; y += 5) {
      const activity = Math.max(0, Math.sin(x * 0.13 + y * 0.21) * 0.5 + Math.sin(y * 0.07 + model.elapsed) * 0.35);
      context.fillStyle = `rgba(${80 + Math.round(activity * 80)},22,${118 + Math.round(activity * 90)},${0.025 + activity * 0.12})`;
      context.fillRect(x, y, 3, 5);
    }
  }
  context.strokeStyle = "rgba(255,255,255,0.08)";
  [0.25, 0.5, 0.75].forEach((ratio) => { context.beginPath(); context.moveTo(0, height * ratio); context.lineTo(width, height * ratio); context.stroke(); });
  const eventX = width * (2200 / 3600);
  if (model.activeScenario !== "sudden_stop") {
    const glow = context.createLinearGradient(eventX - 34, 0, eventX + 34, 0);
    glow.addColorStop(0, "rgba(255,55,83,0)");
    glow.addColorStop(0.42, "rgba(255,58,64,0.5)");
    glow.addColorStop(0.5, "rgba(255,226,124,1)");
    glow.addColorStop(0.58, "rgba(255,58,64,0.5)");
    glow.addColorStop(1, "rgba(255,55,83,0)");
    context.fillStyle = glow;
    context.fillRect(eventX - 34, 0, 68, height);
  } else {
    context.fillStyle = "rgba(242,184,75,0.08)";
    context.fillRect(eventX - 54, 0, 108, height);
    context.strokeStyle = "rgba(242,184,75,0.7)";
    context.setLineDash([8, 6]);
    context.strokeRect(eventX - 54, 1, 108, height - 2);
    context.setLineDash([]);
  }
  const replayElapsed = (now - model.modalOpenedAt) % 3600;
  context.strokeStyle = "rgba(69,210,231,0.9)";
  context.beginPath();
  context.moveTo(replayElapsed / 3600 * width, 0);
  context.lineTo(replayElapsed / 3600 * width, height);
  context.stroke();
  context.fillStyle = "rgba(255,220,180,0.92)";
  context.font = "600 13px system-ui, sans-serif";
  context.fillText(model.activeScenario === "sudden_stop" ? "EXPECTED INCIDENT WINDOW - NO SPIKE" : model.activeScenario === "loud_noise" ? "HIGH-AMPLITUDE URBAN SOUND" : "MATCHED IMPACT", Math.max(10, Math.min(width - 270, eventX - 30)), height - 15);
}

function drawNavigationMap() {
  const canvas = elements.navigationMap;
  const context = canvas.getContext("2d");
  const { width, height } = canvas;
  const project = (point) => ({ x: 18 + (point.x + 30) / 34 * (width - 36), y: height - 18 - (point.z + 3) / 22 * (height - 36) });
  context.fillStyle = "#091013";
  context.fillRect(0, 0, width, height);
  roadNetworkForMap().forEach((edge) => {
    const a = project(edge.from);
    const b = project(edge.to);
    context.strokeStyle = model.blockedSegments.has(edge.key) ? "#ff424c" : "#344348";
    context.lineWidth = model.blockedSegments.has(edge.key) ? 5 : 3;
    context.beginPath(); context.moveTo(a.x, a.y); context.lineTo(b.x, b.y); context.stroke();
  });
  if (model.routePoints.length > 1) {
    context.strokeStyle = model.routeTone === "alternative" ? "#25d977" : "#36c5dd";
    context.lineWidth = 5;
    context.beginPath();
    model.routePoints.forEach((point, index) => { const p = project(point); if (index) context.lineTo(p.x, p.y); else context.moveTo(p.x, p.y); });
    context.stroke();
  }
  const incident = project(ROAD_NODES.D);
  context.fillStyle = "#ff424c";
  context.beginPath(); context.arc(incident.x, incident.y, 7, 0, Math.PI * 2); context.fill();
  const unit = project(model.ambulance);
  context.save(); context.translate(unit.x, unit.y); context.rotate(-model.ambulance.rotation); context.fillStyle = "#f2f6f4"; context.beginPath(); context.moveTo(10, 0); context.lineTo(-7, -6); context.lineTo(-7, 6); context.closePath(); context.fill(); context.restore();
}

function upsertHistory(patch) {
  const incident = model.currentIncident;
  const id = patch.id || incident?.id;
  if (!id) return;
  let entry = model.history.find((item) => item.id === id);
  if (!entry) {
    entry = {
      id,
      time: formatTime(incident?.detectedAt || new Date().toISOString()),
      location: "Intersection 4",
      trigger: SCENARIOS[model.activeScenario].trigger,
      vision: model.activeScenario === "confirmed" ? "Confirmed 99.6%" : "Pending",
      audio: model.activeScenario === "confirmed" ? "Confirmed 99.8%" : "Pending",
      fusion: "Pending",
      decision: "Pending",
      dispatch: "Not dispatched",
      response: "--"
    };
    model.history.unshift(entry);
  }
  Object.assign(entry, patch);
  renderHistory();
}

function renderHistory() {
  elements.reviewCount.textContent = String(model.reviewQueue.length);
  elements.historyBody.innerHTML = "";
  if (!model.history.length) {
    elements.historyBody.innerHTML = '<tr class="empty-history"><td colspan="9">No completed demonstrations yet</td></tr>';
    return;
  }
  model.history.forEach((entry) => {
    const row = document.createElement("tr");
    [entry.id, entry.time, entry.trigger, entry.vision, entry.audio, entry.fusion, entry.decision, entry.dispatch, entry.response].forEach((value) => {
      const cell = document.createElement("td");
      cell.textContent = value;
      row.appendChild(cell);
    });
    elements.historyBody.appendChild(row);
  });
}

function resetSimulation() {
  model.runToken += 1;
  model.phase = PHASES.NORMAL;
  model.phaseElapsed = 0;
  model.selectedScenario = "confirmed";
  model.activeScenario = "confirmed";
  model.normalCycle = 0;
  model.carA = { x: -23, z: -1.2, rotation: 0 };
  model.carB = { x: 1.2, z: 23, rotation: -Math.PI / 2 };
  model.vehicleSpeed = 48;
  model.eventPosition = { x: 0, z: 0 };
  model.impactIso = null;
  model.visionDetectedAt = null;
  model.audioDetectedAt = null;
  model.fusionRequestStarted = false;
  model.pendingIncident = null;
  model.currentIncident = null;
  model.ambulance = { x: ROAD_NODES.S.x, z: ROAD_NODES.S.z, rotation: 0 };
  model.route = null;
  model.pendingRoute = null;
  model.routePoints = [];
  model.routeSegments = [];
  model.routeDistance = 0;
  model.routeVersion += 1;
  model.routeTone = "planned";
  model.blockedSegments.clear();
  model.blockedRoutePoints = [];
  model.routeChanges = 0;
  model.completedDistance = 0;
  model.etaSeconds = 0;
  model.cameraMode = "responder";
  model.arrivalIso = null;
  closeEvidenceModal();
  elements.scenario.value = "confirmed";
  elements.simulateLabel.textContent = SCENARIOS.confirmed.button;
  elements.recordState.textContent = "Monitoring";
  elements.lockedCount.textContent = "0";
  elements.estimateLabel.textContent = "Awaiting incident";
  elements.mapCoordinate.textContent = "2.2913, 111.8291";
  elements.etaLabel.textContent = "--:--";
  elements.arrivalTime.textContent = "--";
  elements.arrivalSummary.hidden = true;
  elements.navigationMapPanel.classList.remove("is-collapsed");
  elements.collapseMap.textContent = "−";
  elements.cameraButtons.forEach((button) => button.setAttribute("aria-pressed", String(button.dataset.cameraMode === "responder")));
  clearMapIncident();
  renderStandbyTelemetry();
  elements.body.dataset.simulationState = PHASES.NORMAL;
  updatePhaseUi();
  elements.simulate.focus();
}

function updateIncidentRecord(incident) {
  elements.recordState.textContent = incident.id;
  elements.lockedCount.textContent = String(incident.lockedCount || 0);
  elements.estimateLabel.textContent = `${incident.latitude.toFixed(4)}, ${incident.longitude.toFixed(4)}`;
  elements.mapCoordinate.textContent = `${incident.latitude.toFixed(4)}, ${incident.longitude.toFixed(4)}`;
}

function updateTelemetryTable(telemetry = []) {
  elements.telemetryBody.innerHTML = "";
  const firstArrival = telemetry[0]?.arrivalMs || 0;
  telemetry.forEach((reading) => {
    const row = document.createElement("tr");
    [reading.sensorId, `${Math.round(reading.bearingDeg)} deg`, `${reading.arrivalMs.toFixed(1)} ms`, `+${(reading.arrivalMs - firstArrival).toFixed(1)} ms`, `${reading.snrDb.toFixed(1)} dB`, reading.status === "locked" ? "Locked" : "Weak"].forEach((value, index) => {
      const cell = document.createElement("td");
      cell.textContent = value;
      if (index === 5) cell.className = reading.status === "locked" ? "status-ok" : "status-weak";
      row.appendChild(cell);
    });
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

function drawMapBase() {
  ["M36 40 H370 L350 245 L75 300 L30 190 Z", "M390 30 H790 L820 230 L565 290 L350 245 Z", "M810 35 H1170 V265 L820 230 Z", "M48 320 L370 270 L555 315 L510 680 H35 Z", "M575 305 L835 250 L1165 290 L1165 685 H530 Z"].forEach((d) => elements.districtLayer.appendChild(svgEl("path", { d, class: "district-shape" })));
  elements.roadLayer.appendChild(svgEl("path", { d: "M-20 515 C200 455 405 485 590 400 S920 245 1220 278", class: "waterway" }));
  ["M52 190 C260 168 430 207 615 182 S935 155 1175 95", "M100 605 C295 530 455 545 650 455 S980 380 1165 410", "M310 25 C300 170 352 292 335 424 S320 610 390 705", "M780 18 C710 175 775 296 730 430 S725 605 805 720"].forEach((d) => elements.roadLayer.appendChild(svgEl("path", { d, class: "road arterial" })));
  ["M85 80 L280 260 L510 95 L700 300 L945 88 L1125 240", "M95 360 L280 325 L465 395 L650 300 L860 340 L1100 310", "M120 655 L220 420 L440 300 L570 70", "M430 690 L520 500 L620 335 L660 70", "M880 690 L900 475 L1050 330 L1090 70"].forEach((d) => elements.roadLayer.appendChild(svgEl("path", { d, class: "road minor" })));
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
  if (NAVIGATION_PHASES.has(model.phase)) elements.mapResultLayer.appendChild(svgEl("path", { d: "M160 590 C300 520 430 430 600 360", class: "map-route" }));
  const suspected = [PHASES.SUSPECTED_EVENT, PHASES.VISION_DETECTED, PHASES.AUDIO_DETECTED, PHASES.FUSION_VERIFYING, PHASES.SENSOR_MISMATCH, PHASES.FALSE_ALARM, PHASES.AWAITING_HUMAN_REVIEW].includes(model.phase);
  const confirmed = [PHASES.CRITICAL_CONFIRMED, ...NAVIGATION_PHASES].includes(model.phase);
  if (suspected) elements.mapResultLayer.appendChild(svgEl("circle", { cx: 600, cy: 360, r: 62, class: "map-investigation-radius" }));
  const markerClass = confirmed ? "map-event-red" : model.phase === PHASES.CLEARED ? "map-event-cleared" : "map-event-amber";
  elements.mapResultLayer.appendChild(svgEl("circle", { cx: 600, cy: 360, r: 23, class: markerClass, "data-map-marker": "true" }));
}

function updateMapPulse() {
  const marker = elements.mapResultLayer.querySelector("[data-map-marker]");
  if (!marker || marker.classList.contains("map-event-cleared")) return;
  const base = marker.classList.contains("map-event-red") ? 23 : 20;
  marker.setAttribute("r", String(base + Math.sin(model.elapsed * 6) * 4));
}

function clearMapIncident() { elements.mapResultLayer.innerHTML = ""; }
function addMapLabel(text, x, y, major) { const label = svgEl("text", { x, y, class: major ? "map-label-major" : "map-label-svg" }); label.textContent = text; elements.mapLabelLayer.appendChild(label); }
function svgEl(tag, attributes = {}) { const element = document.createElementNS("http://www.w3.org/2000/svg", tag); Object.entries(attributes).forEach(([key, value]) => element.setAttribute(key, value)); return element; }

function startEventStream() {
  if (!window.EventSource) return;
  eventStream = new EventSource("/api/events");
  eventStream.addEventListener("connected", () => setBackendStatus("online", "Live stream"));
  eventStream.addEventListener("incident", (event) => {
    const incident = JSON.parse(event.data);
    if (model.phase === PHASES.FUSION_VERIFYING) model.pendingIncident = incident;
    else if (model.phase === PHASES.NORMAL && incident.eventType === "collision") adoptExternalIncident(incident);
  });
  eventStream.addEventListener("incident-updated", (event) => {
    const incident = JSON.parse(event.data);
    if (incident.id === model.currentIncident?.id) { model.currentIncident = incident; updateTelemetryTable(incident.telemetry); updateIncidentRecord(incident); }
  });
  eventStream.onerror = () => setBackendStatus("offline", "Stream retrying");
}

function adoptExternalIncident(incident) {
  model.runToken += 1;
  model.activeScenario = "confirmed";
  model.currentIncident = incident;
  model.impactIso = incident.detectedAt;
  model.visionDetectedAt = incident.detectedAt;
  model.audioDetectedAt = incident.detectedAt;
  model.impactToken += 1;
  setCrashedVehiclePose();
  setPhase(PHASES.CRITICAL_CONFIRMED);
}

function bindControls() {
  elements.simulate.addEventListener("click", startSelectedScenario);
  elements.reset.addEventListener("click", resetSimulation);
  elements.scenario.addEventListener("change", () => { model.selectedScenario = elements.scenario.value; elements.simulateLabel.textContent = SCENARIOS[model.selectedScenario].button; });
  elements.noise.addEventListener("input", () => { elements.noiseReadout.textContent = `${elements.noise.value} dB`; });
  elements.energy.addEventListener("input", () => { elements.energyReadout.textContent = `${elements.energy.value} dB`; });
  elements.dispatch.addEventListener("click", handlePrimaryModalAction);
  elements.falseAlarm.addEventListener("click", handleSecondaryModalAction);
  elements.humanReview.addEventListener("click", escalateHumanReview);
  elements.roadBlock.addEventListener("click", simulateRoadBlock);
  elements.handover.addEventListener("click", handOverResponse);
  elements.clearHistory.addEventListener("click", () => { model.history = []; model.reviewQueue = []; renderHistory(); });
  elements.collapseMap.addEventListener("click", () => { const collapsed = elements.navigationMapPanel.classList.toggle("is-collapsed"); elements.collapseMap.textContent = collapsed ? "+" : "−"; });
  elements.cameraButtons.forEach((button) => button.addEventListener("click", () => {
    model.cameraMode = button.dataset.cameraMode;
    elements.cameraButtons.forEach((candidate) => candidate.setAttribute("aria-pressed", String(candidate === button)));
  }));
  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape" || !model.modalOpen) return;
    if (model.modalMode === "review") return;
    if (model.modalMode === "critical") handleSecondaryModalAction();
    else finalizeFalseAlarm("Continue monitoring");
  });
}

async function init() {
  bindControls();
  drawMapBase();
  renderHistory();
  try {
    const [health, config] = await Promise.all([api("/api/health"), api("/api/config")]);
    sensors = config.sensors;
    elements.nodeCount.textContent = String(health.sensors.online);
    drawMapSensors();
    renderStandbyTelemetry();
    setBackendStatus("online", "API connected");
    startEventStream();
    roadScene = createRoadScene({ container: elements.sceneContainer, evidenceCanvas: elements.cctvCanvas, getState: () => model, onFrame: tick });
    window.__echoAlertDebug = { getState: () => ({ phase: model.phase, scenario: model.activeScenario, modalMode: model.modalMode, route: model.route?.nodeIds || [], routeDistance: model.routeDistance, routeChanges: model.routeChanges, renderFrames: model.renderFrames, incidentId: model.currentIncident?.id || null }), loopCount: 1 };
  } catch (error) {
    setBackendStatus("offline", "System unavailable");
    elements.sceneLoading.innerHTML = `<strong>3D simulation unavailable</strong><span>${escapeHtml(error.message)}</span>`;
    elements.simulate.disabled = true;
  }
  elements.body.dataset.simulationState = PHASES.NORMAL;
  updatePhaseUi();
}

function setBackendStatus(status, text) { elements.backendState.textContent = text; elements.backendHealth.classList.toggle("is-online", status === "online"); elements.backendHealth.classList.toggle("is-offline", status === "offline"); }
function motionTime(seconds) { return model.reducedMotion ? Math.max(0.2, seconds * 0.42) : seconds; }
function formatTime(value) { return value ? new Date(value).toLocaleTimeString("en-MY", { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: true }).toUpperCase() : "--:--:--"; }
function formatDuration(seconds) { const value = Math.max(0, Math.ceil(seconds || 0)); return `${String(Math.floor(value / 60)).padStart(2, "0")}:${String(value % 60).padStart(2, "0")}`; }
function lerp(start, end, amount) { return start + (end - start) * amount; }
function easeInOut(value) { return value * value * (3 - 2 * value); }
function clamp01(value) { return Math.max(0, Math.min(1, value)); }
function escapeHtml(value) { return String(value).replace(/[&<>'"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[character]); }

init();
