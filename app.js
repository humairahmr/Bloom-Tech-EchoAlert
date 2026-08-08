import { createRoadScene } from "./scene3d.js";
import { IncidentManager } from "./incident-manager.js";
import { UnitManager } from "./unit-manager.js";
import {
  ROAD_NODES,
  findFastestRoute,
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
  ,PEDESTRIAN_APPROACH: "PEDESTRIAN_APPROACH"
  ,PEDESTRIAN_CONTACT: "PEDESTRIAN_CONTACT"
  ,SUSPECT_FLEEING: "SUSPECT_FLEEING"
  ,VEHICLE_TRACKING: "VEHICLE_TRACKING"
  ,HUMAN_REVIEW_REQUIRED: "HUMAN_REVIEW_REQUIRED"
});

const SCENARIOS = Object.freeze({
  confirmed: { button: "Simulate Confirmed Crash", trigger: "Vehicle collision" },
  sudden_stop: { button: "Simulate Sudden-Stop Alert", trigger: "Rapid deceleration" },
  loud_noise: { button: "Simulate Loud-Noise Alert", trigger: "High-amplitude sound" },
  pedestrian: { button: "SIMULATE HIT-AND-RUN", trigger: "Pedestrian-vehicle conflict" },
  concurrent: { button: "Simulate Concurrent Incidents", trigger: "Concurrent city incidents" }
});

const NAVIGATION_PHASES = new Set([PHASES.ROUTE_CALCULATING, PHASES.NAVIGATING, PHASES.REROUTING, PHASES.RESPONDER_ARRIVED]);
const VERIFICATION_WINDOW_MS = 1500;
const $ = (selector) => document.querySelector(selector);
const incidentManager = new IncidentManager();
const unitManager = new UnitManager();

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
  responderSpeedMps: 0,
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
  falseResultRecorded: false,
  incidents: incidentManager.list(),
  units: unitManager.list(),
  selectedIncidentId: incidentManager.selectedId,
  activeNavigationUnit: null,
  navigationMinimized: false,
  pedestrian: { visible: false, x: -5.2, z: -8, rotationZ: 0, stationary: false },
  suspectTrackingActive: false,
  secondCameraTracking: false,
  selectedCctvFeed: "CCTV #04",
  cctvGridMode: false,
  cctvWorkspaceOpen: false,
  lastOperationsRender: 0,
  pendingNewIncidentId: null,
  confirmationAction: "minimise"
  ,concurrentMode: false
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
  resetSelected: $("#reset-selected"),
  simulateSecond: $("#simulate-second"),
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
  emergencySubtitle: $("#emergency-subtitle"),
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
  pedestrianDetectionBox: $("#pedestrian-detection-box"),
  pedestrianFacts: [...document.querySelectorAll(".pedestrian-fact")],
  modalTrackingIds: $("#modal-tracking-ids"), modalPlate: $("#modal-plate"), modalLastKnown: $("#modal-last-known"), modalUnits: $("#modal-units"),
  timelinePanel: $("#event-timeline-panel"), timeline: $("#event-timeline"), notesField: $("#incident-notes-field"), notes: $("#incident-notes"),
  pedestrianActions: $("#pedestrian-review-actions"), confirmPedestrian: $("#confirm-pedestrian-btn"), dispatchPending: $("#dispatch-pending-btn"), policeCoordination: $("#police-coordination-btn"), pedestrianFalseAlarm: $("#pedestrian-false-alarm-btn"), continuePedestrian: $("#continue-pedestrian-btn"), minimiseReview: $("#minimise-review-btn"),
  minimiseReviewIcon: $("#minimise-review-icon"), closeReviewIcon: $("#close-review-icon"), unresolvedConfirm: $("#unresolved-confirm"), unresolvedTitle: $("#unresolved-title"), confirmMinimise: $("#confirm-minimise"), returnReview: $("#return-review"),
  reviewQueueShortcut: $("#review-queue-shortcut"),
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
  navSpeed: $("#nav-speed"), navIncident: $("#nav-incident"), navigationUnitId: $("#navigation-unit-id"), minimiseNavigation: $("#minimise-navigation"),
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
  cctvWorkspace: $("#cctv-workspace"), cctvFeedList: $("#cctv-feed-list"), cctvMonitorGrid: $("#cctv-monitor-grid"), cctvGridMode: $("#cctv-grid-mode"), returnCity: $("#return-city"),
  simulateSecondCctv: $("#simulate-second-cctv"),
  reviewQueue: $("#review-queue"), reviewQueueList: $("#review-queue-list"), queueCount: $("#queue-count"), toggleReviewQueue: $("#toggle-review-queue"), pendingReviewBadge: $("#pending-review-badge"), topReviewCount: $("#top-review-count"), incidentTaskbar: $("#incident-taskbar"),
  responderCard: $("#responder-card"), responderCardUnit: $("#responder-card-unit"), responderCardCopy: $("#responder-card-copy"), restoreNavigation: $("#restore-navigation"), operationsToast: $("#operations-toast"),
  newIncidentAlert: $("#new-incident-alert"), openNewIncident: $("#open-new-incident"), keepCurrentReview: $("#keep-current-review"), minimiseOpenNew: $("#minimise-open-new"),
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
  const pedestrian = {
    [PHASES.PEDESTRIAN_APPROACH]: ["CONFLICT PREDICTED", "CCTV #04 is tracking PEDESTRIAN-02 and VEHICLE-07", "Road-user conflict", "Road-user conflict predicted", "Listening", "Timeline monitoring", "suspected"],
    [PHASES.PEDESTRIAN_CONTACT]: ["POSSIBLE PEDESTRIAN COLLISION", "Non-graphic contact warning; independent verification initiated", "Contact suspected", "Pedestrian-vehicle contact suspected", "Possible impact signature detected", "Reconstructing timeline", "suspected"],
    [PHASES.SUSPECT_FLEEING]: ["SUSPECT VEHICLE LEAVING INCIDENT AREA", "VEHICLE-07 is northbound while PEDESTRIAN-02 remains stationary", "Vehicle departure", "Person stationary on roadway", "Possible impact detected", "Possible pedestrian collision", "suspected"],
    [PHASES.VEHICLE_TRACKING]: ["VEHICLE TRACKING ACTIVE", "CCTV #05 matched QAB 4721 farther north", "Cross-camera tracking", "Vehicle leaving incident area", "Impact match 96.8%", "Reconstructing incident timeline", "suspected"],
    [PHASES.HUMAN_REVIEW_REQUIRED]: ["HUMAN REVIEW REQUIRED", "Suspected pedestrian collision with vehicle departure", "Priority human review", "Operational assessment ready", "Possible impact 96.8%", "AWAITING HUMAN DECISION", "suspected"]
  };
  if (pedestrian[model.phase]) return pedestrian[model.phase];
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
  if ([PHASES.IMPACT, PHASES.PEDESTRIAN_CONTACT].includes(nextPhase)) {
    model.impactToken += 1;
    if (!model.impactIso) model.impactIso = new Date().toISOString();
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
  if (nextPhase === PHASES.HUMAN_REVIEW_REQUIRED) {
    const incident = incidentManager.get(model.selectedIncidentId);
    if (incident) {
      incidentManager.update(incident.id, { state: "AWAITING_HUMAN_DECISION", minimized: false });
      syncOperationsState();
      openPedestrianReview(incident.id);
    }
  }
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
  const activeUnit = unitManager.get(model.activeNavigationUnit);
  const managedNavigation = activeUnit && ["RESERVED", "EN_ROUTE", "ON_SCENE"].includes(activeUnit.status);
  const navigating = (NAVIGATION_PHASES.has(model.phase) || managedNavigation) && !model.navigationMinimized;
  elements.navigationHud.classList.toggle("is-active", navigating);
  elements.navigationHud.setAttribute("aria-hidden", String(!navigating));
  elements.operations.dataset.navigationActive = String(navigating);
  elements.unitState.textContent = activeUnit ? `${activeUnit.id} ${activeUnit.status.replaceAll("_", " ").toLowerCase()}` : model.phase === PHASES.RESPONDER_ARRIVED ? "MED-01 on scene" : navigating ? "MED-01 dispatched" : "MED-01 / MED-02 available";
  elements.arrivalSummary.hidden = activeUnit ? activeUnit.status !== "ON_SCENE" : model.phase !== PHASES.RESPONDER_ARRIVED;
  const routeRemaining = model.route ? model.route.totalDistance - model.routeDistance : 0;
  elements.roadBlock.disabled = model.phase !== PHASES.NAVIGATING || model.routeChanges > 0 || routeRemaining < 70;
  elements.simulateSecond.hidden = incidentManager.pendingReviews().length === 0;
  elements.reset.textContent = "Reset All";
}

function tick(delta, now) {
  model.elapsed += delta;
  model.phaseElapsed += delta;
  model.renderFrames += 1;
  if (!model.sceneReady && model.renderFrames > 2) {
    model.sceneReady = true;
    elements.sceneLoading.classList.add("is-hidden");
  }

  const arrivals = unitManager.update(delta);
  syncActiveUnit();
  arrivals.forEach(handleManagedArrival);

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
  else if ([PHASES.PEDESTRIAN_APPROACH, PHASES.PEDESTRIAN_CONTACT, PHASES.SUSPECT_FLEEING, PHASES.VEHICLE_TRACKING].includes(model.phase)) updatePedestrianSequence();
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
  if (now - model.lastOperationsRender > 500) {
    renderReviewQueue();
    renderIncidentTaskbar();
    renderCctvWorkspace();
    model.lastOperationsRender = now;
  }
  elements.vehicleSpeed.textContent = `${Math.max(0, Math.round(model.vehicleSpeed))} km/h`;
  updateMapPulse();
}

function updateNormalTraffic(delta) {
  if (unitManager.list().some((unit) => unit.status === "EN_ROUTE")) {
    model.carA = { x: -12, z: -1.2, rotation: 0 };
    model.carB = { x: 1.2, z: 12, rotation: -Math.PI / 2 };
    model.vehicleSpeed = 0;
    return;
  }
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
  if (["pedestrian", "concurrent"].includes(model.activeScenario)) {
    startPedestrianScenario(model.activeScenario === "concurrent");
    return;
  }
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

function startPedestrianScenario(concurrent = false) {
  model.concurrentMode = concurrent;
  model.activeScenario = "pedestrian";
  model.eventPosition = { x: 0, z: -8 };
  model.pedestrian = { visible: true, x: -5.2, z: -8, rotationZ: 0, stationary: false };
  model.suspectTrackingActive = false;
  model.secondCameraTracking = false;
  model.carA = { x: -17, z: 1.2, rotation: 0 };
  model.carB = { x: 1.2, z: -23, rotation: -Math.PI / 2 };
  model.impactIso = null;
  const detectedAt = new Date().toISOString();
  const incident = incidentManager.create({
    type: "suspected-pedestrian-hit-and-run",
    title: "Suspected Pedestrian Hit-and-Run",
    state: "SENSOR_FUSION_ANALYSIS",
    severity: "critical",
    vulnerableRoadUser: true,
    cameraIds: ["CCTV #04", "CCTV #05"],
    location: "Jalan Awang Ramli Amit - Pedestrian Crossing 4",
    coordinates: { latitude: 2.2911, longitude: 111.8294 },
    position: { x: 0, z: -8, mapX: 650, mapY: 405 },
    detectedAt,
    confidence: { vision: 0.962, audio: 0.968, fusion: 0.954 },
    evidence: { pedestrianId: "PEDESTRIAN-02", vehicleId: "VEHICLE-07", plate: "QAB 4721", plateConfidence: 0.946, vehicleDescription: "Silver compact sedan", direction: "Northbound", lastSeen: "CCTV #05", vehicleStatus: "Leaving incident area", classification: "Suspected pedestrian collision with vehicle departure" }
  });
  incidentManager.addTimeline(incident.id, "Pedestrian enters crossing", detectedAt);
  model.selectedIncidentId = incident.id;
  model.currentIncident = incidentToModalRecord(incident);
  syncOperationsState();
  setPhase(PHASES.PEDESTRIAN_APPROACH);
}

function updatePedestrianSequence() {
  const incident = incidentManager.get(model.selectedIncidentId);
  if (!incident) return;
  if (model.phase === PHASES.PEDESTRIAN_APPROACH) {
    const progress = clamp01(model.phaseElapsed / motionTime(2.4));
    model.pedestrian.x = lerp(-5.2, 0, easeInOut(progress));
    model.carB.z = lerp(-23, -8, easeInOut(progress));
    model.vehicleSpeed = 96;
    if (progress >= 1) {
      model.impactIso = new Date().toISOString();
      incidentManager.addTimeline(incident.id, "Vehicle enters conflict zone", offsetIso(model.impactIso, -0.3));
      incidentManager.addTimeline(incident.id, "Visual contact suspected", model.impactIso);
      setPhase(PHASES.PEDESTRIAN_CONTACT);
    }
  } else if (model.phase === PHASES.PEDESTRIAN_CONTACT) {
    model.pedestrian = { visible: true, x: 0, z: -8, rotationZ: Math.PI / 2, stationary: true };
    model.carB.z = -7.5;
    model.vehicleSpeed = 28;
    if (model.phaseElapsed >= motionTime(0.55)) {
      incidentManager.addTimeline(incident.id, "Acoustic event detected", offsetIso(model.impactIso, 0.1));
      incidentManager.addTimeline(incident.id, "Person remains stationary", offsetIso(model.impactIso, 0.9));
      setPhase(PHASES.SUSPECT_FLEEING);
    }
  } else if (model.phase === PHASES.SUSPECT_FLEEING) {
    const progress = clamp01(model.phaseElapsed / motionTime(1.8));
    model.carB.z = lerp(-7.5, 15, easeInOut(progress));
    model.vehicleSpeed = 42 + progress * 46;
    model.suspectTrackingActive = true;
    if (progress >= 1) {
      incidentManager.addTimeline(incident.id, "Vehicle leaves scene", offsetIso(model.impactIso, 1.5));
      setPhase(PHASES.VEHICLE_TRACKING);
    }
  } else if (model.phase === PHASES.VEHICLE_TRACKING) {
    const progress = clamp01(model.phaseElapsed / motionTime(1.6));
    model.carB.z = lerp(15, 27, progress);
    model.vehicleSpeed = 82;
    model.suspectTrackingActive = true;
    model.secondCameraTracking = progress > 0.45;
    if (progress >= 1) {
      incidentManager.addTimeline(incident.id, "Vehicle detected by CCTV #05", offsetIso(model.impactIso, 6.2));
      setPhase(PHASES.HUMAN_REVIEW_REQUIRED);
    }
  }
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
  requestAnimationFrame(() => (mode === "pedestrian" ? elements.confirmPedestrian : elements.dispatch).focus());
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
  elements.pedestrianDetectionBox.hidden = true;
  elements.pedestrianFacts.forEach((fact) => { fact.hidden = true; });
  elements.timelinePanel.hidden = true;
  elements.notesField.hidden = true;
  elements.pedestrianActions.hidden = true;
  elements.dispatch.hidden = false;
  elements.falseAlarm.hidden = false;
  elements.minimiseReviewIcon.hidden = model.modalMode !== "pedestrian";
  elements.closeReviewIcon.hidden = model.modalMode !== "pedestrian";
  elements.emergencySubtitle.textContent = "";
  elements.dispatch.disabled = false;
  elements.falseAlarm.disabled = false;

  if (model.modalMode === "pedestrian") {
    configurePedestrianEvidence();
    return;
  }

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

function configurePedestrianEvidence() {
  const incident = incidentManager.get(model.selectedIncidentId);
  if (!incident) return;
  const evidence = incident.evidence;
  const impact = incident.timeline.find((event) => event.label === "Visual contact suspected")?.at || incident.detectedAt;
  elements.emergencyTitle.textContent = "PRIORITY HUMAN REVIEW";
  elements.emergencySubtitle.textContent = "Suspected Pedestrian Hit-and-Run";
  elements.modalIncidentId.textContent = incident.id;
  elements.modalCoordinates.textContent = `${incident.coordinates.latitude.toFixed(3)}, ${incident.coordinates.longitude.toFixed(3)}`;
  elements.modalLocation.textContent = incident.location;
  elements.detectionTime.textContent = formatTime(incident.detectedAt);
  elements.cctvTime.textContent = formatTime(impact);
  elements.visionImpactTime.textContent = formatTime(impact);
  elements.audioImpactTime.textContent = `${formatTime(offsetIso(impact, .1))} (+0.1 s)`;
  elements.correlationBadge.textContent = "AWAITING HUMAN DECISION";
  elements.visionBadge.textContent = "AI TRACKING";
  elements.audioBadge.textContent = "AUDIO CORRELATED";
  elements.cctvObjectLabel.textContent = evidence.vehicleId;
  elements.pedestrianDetectionBox.hidden = false;
  elements.visionObjectIds.textContent = `${evidence.pedestrianId} / ${evidence.vehicleId}`;
  elements.visionOverlay.innerHTML = "Person-Vehicle Contact Suspected: <strong>96 km/h</strong>";
  elements.visionConfidence.textContent = percent(incident.confidence.vision);
  elements.modalVisionConfidence.textContent = percent(incident.confidence.vision);
  elements.audioConfidence.textContent = percent(incident.confidence.audio);
  elements.modalAudioConfidence.textContent = percent(incident.confidence.audio);
  elements.audioMatchLabel.textContent = `${percent(incident.confidence.audio)} Match`;
  elements.peakAmplitude.textContent = "121 dB";
  elements.fusionConfidence.textContent = percent(incident.confidence.fusion);
  elements.modalClassification.textContent = evidence.classification;
  elements.modalRecommendation.textContent = "Medical Tier 1 - dispatcher decision";
  elements.modalDispatchStatus.textContent = incident.dispatchStatus;
  elements.emergencyNote.textContent = "AI-generated operational assessment. Human verification required. Suspect tracking is for police coordination; medical responders are routed to the pedestrian.";
  elements.pedestrianFacts.forEach((fact) => { fact.hidden = false; });
  elements.modalTrackingIds.textContent = `${evidence.pedestrianId} / ${evidence.vehicleId}`;
  elements.modalPlate.textContent = `${evidence.plate} - ${percent(evidence.plateConfidence)}`;
  elements.modalLastKnown.textContent = `${evidence.direction} - ${evidence.lastSeen}`;
  elements.modalUnits.textContent = unitManager.list().map((unit) => `${unit.id}: ${unit.status.replaceAll("_", " ")}`).join(" / ");
  elements.timeline.innerHTML = "";
  incident.timeline.forEach((event) => { const item = document.createElement("li"); item.textContent = `${formatTimelineTime(event.at)} - ${event.label}`; elements.timeline.appendChild(item); });
  elements.timelinePanel.hidden = false;
  elements.notesField.hidden = false;
  elements.notes.value = incident.notes || "";
  elements.pedestrianActions.hidden = false;
  elements.dispatch.hidden = true;
  elements.falseAlarm.hidden = true;
  elements.dispatchPending.disabled = Boolean(incident.assignedUnit);
  elements.dispatchPending.textContent = incident.assignedUnit ? `${incident.assignedUnit} dispatched - review pending` : "Dispatch Medical - Keep Review Pending";
  elements.policeCoordination.disabled = Boolean(incident.policeUnit);
  elements.policeCoordination.textContent = incident.policeUnit ? `${incident.policeUnit} coordination requested` : "Request Police Coordination";
}

function openPedestrianReview(id) {
  const incident = incidentManager.reopen(id);
  if (!incident) return;
  elements.reviewQueue.classList.remove("is-open");
  elements.toggleReviewQueue.setAttribute("aria-expanded", "false");
  model.selectedIncidentId = id;
  model.currentIncident = incidentToModalRecord(incident);
  model.activeScenario = "pedestrian";
  model.impactIso = incident.timeline.find((event) => event.label === "Visual contact suspected")?.at || incident.detectedAt;
  syncOperationsState();
  openEvidenceModal("pedestrian");
  requestAnimationFrame(() => { const dialog = elements.modal.querySelector(".emergency-dialog"); if (dialog) dialog.scrollTop = incident.reviewScrollTop || 0; });
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
  elements.unresolvedConfirm.hidden = true;
  elements.body.classList.remove("modal-open");
  elements.modal.classList.remove("is-open", "is-investigation");
  elements.modal.setAttribute("aria-hidden", "true");
}

function minimiseCurrentReview() {
  const incident = incidentManager.get(model.selectedIncidentId);
  if (!incident) return;
  const dialog = elements.modal.querySelector(".emergency-dialog");
  incidentManager.minimise(incident.id, dialog?.scrollTop || 0);
  closeEvidenceModal();
  model.phase = PHASES.NORMAL;
  model.phaseElapsed = 0;
  model.cctvWorkspaceOpen = true;
  elements.body.dataset.simulationState = PHASES.NORMAL;
  showToast(`Incident ${incident.id} minimised - awaiting your decision`);
  syncOperationsState();
  updatePhaseUi();
  if (model.concurrentMode && incidentManager.list().length === 1) {
    simulateSecondIncident();
    simulateConcurrentFalseAlarm();
  }
}

function requestReviewExit() {
  model.confirmationAction = "minimise";
  elements.unresolvedTitle.textContent = "This incident is still pending. Minimise it and continue CCTV monitoring?";
  elements.confirmMinimise.textContent = "Minimise and Continue";
  elements.unresolvedConfirm.hidden = false;
  elements.confirmMinimise.focus();
}

function requestPedestrianFalseAlarm() {
  model.confirmationAction = "false-alarm";
  elements.unresolvedTitle.textContent = "This event involves a potentially vulnerable road user. Confirm that no emergency response is required.";
  elements.confirmMinimise.textContent = "Confirm False Alarm";
  elements.unresolvedConfirm.hidden = false;
  elements.confirmMinimise.focus();
}

function completePedestrianFalseAlarm() {
  const incident = incidentManager.get(model.selectedIncidentId);
  if (!incident) return;
  const assigned = unitManager.get(incident.assignedUnit);
  if (assigned?.status === "RESERVED") unitManager.releaseIncident(incident.id);
  incidentManager.update(incident.id, { state: "FALSE_ALARM", decision: "Cleared by dispatcher", finalClassification: "False alarm", dispatchStatus: assigned?.status === "EN_ROUTE" ? "MEDICAL RESPONSE CONTINUES - dispatcher follow-up required" : "NOT DISPATCHED" });
  addManagedHistory(incident.id);
  closeEvidenceModal();
  syncOperationsState();
  showToast("FALSE ALARM - CLEARED BY DISPATCHER");
  setPhase(PHASES.CLEARED);
}

function dispatchPedestrian(keepPending) {
  const incident = incidentManager.get(model.selectedIncidentId);
  if (!incident) return null;
  let unit = incident.assignedUnit ? unitManager.get(incident.assignedUnit) : unitManager.assignMedical(incident.id, model.blockedSegments);
  if (!unit) {
    incidentManager.update(incident.id, { dispatchStatus: "NO IMMEDIATE MEDICAL UNIT AVAILABLE", evidence: { dispatchQueued: true } });
    configurePedestrianEvidence();
    showToast("NO IMMEDIATE MEDICAL UNIT AVAILABLE - incident added to dispatch queue");
    return null;
  }
  unitManager.dispatch(unit.id);
  incidentManager.update(incident.id, { state: keepPending ? "MEDICAL_DISPATCHED_REVIEW_PENDING" : "CONFIRMED_INCIDENT", decision: keepPending ? null : "Incident confirmed by dispatcher", finalClassification: keepPending ? null : "Suspected pedestrian collision", assignedUnit: unit.id, dispatchAt: new Date().toISOString(), dispatchStatus: keepPending ? "MEDICAL DISPATCHED - CLASSIFICATION PENDING" : `${unit.id} DISPATCHED` });
  model.activeNavigationUnit = unit.id;
  model.navigationMinimized = keepPending;
  model.route = unit.route;
  model.routePoints = unit.route.points;
  model.routeSegments = unit.route.segments;
  model.routeVersion += 1;
  model.routeStartedAt = new Date(unit.startedAt);
  syncActiveUnit(true);
  syncOperationsState();
  if (keepPending) {
    configurePedestrianEvidence();
    showToast(`${unit.id} dispatched - human review remains pending`);
  } else {
    addManagedHistory(incident.id);
    closeEvidenceModal();
    model.phase = unit.status === "ON_SCENE" ? PHASES.RESPONDER_ARRIVED : PHASES.NAVIGATING;
    model.navigationMinimized = false;
    updatePhaseUi();
    showToast("INCIDENT CONFIRMED");
  }
  return unit;
}

function requestPedestrianPolice() {
  const incident = incidentManager.get(model.selectedIncidentId);
  if (!incident) return;
  const unit = incident.policeUnit ? unitManager.get(incident.policeUnit) : unitManager.assignPolice(incident.id);
  incidentManager.update(incident.id, { policeUnit: unit?.id || null, evidence: { policePackage: "Plate candidate, vehicle trail and CCTV #05 last-known position" } });
  syncOperationsState();
  configurePedestrianEvidence();
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
  const managed = incidentManager.get(model.currentIncident.id);
  if (managed) {
    const unit = unitManager.assignMedical(managed.id, model.blockedSegments);
    if (!unit) { showToast("NO IMMEDIATE MEDICAL UNIT AVAILABLE"); return; }
    unitManager.dispatch(unit.id);
    incidentManager.update(managed.id, { assignedUnit: unit.id, state: "CONFIRMED_INCIDENT", decision: "Confirmed multi-sensor collision", dispatchAt: new Date().toISOString(), dispatchStatus: `${unit.id} DISPATCHED` });
    model.activeNavigationUnit = unit.id;
    model.navigationMinimized = false;
    closeEvidenceModal();
    syncActiveUnit(true);
    syncOperationsState();
    model.phase = PHASES.NAVIGATING;
    updatePhaseUi();
    addManagedHistory(managed.id);
    return;
  }
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
  model.responderSpeedMps = 0;
  model.routeVersion += 1;
  const pose = poseAlongRoute(model.route, 0);
  model.ambulance = { x: pose.x, z: pose.z, rotation: pose.rotation };
  elements.routeStatus.textContent = model.routeTone === "alternative" ? "Faster alternative route found" : "Fastest emergency route";
  elements.guidance.textContent = model.routeTone === "alternative" ? "Alternative emergency corridor activated" : "Emergency corridor activated";
  setPhase(PHASES.NAVIGATING);
}

function updateNavigation(delta) {
  if (model.activeNavigationUnit) return;
  const currentPose = poseAlongRoute(model.route, model.routeDistance);
  const currentSegment = model.route.segments[currentPose.segmentIndex];
  const nextSegment = model.route.segments[currentPose.segmentIndex + 1];
  const distanceToTurn = Math.max(0, (currentSegment?.endDistance || model.route.totalDistance) - model.routeDistance);
  const remainingBeforeMove = Math.max(0, model.route.totalDistance - model.routeDistance);
  const targetSpeed = remainingBeforeMove < 55 ? 7.5 : nextSegment && distanceToTurn < 70 ? 14.5 : 30.5;
  const rate = targetSpeed > model.responderSpeedMps ? 8 : 13;
  const speedDelta = Math.min(Math.abs(targetSpeed - model.responderSpeedMps), rate * delta);
  model.responderSpeedMps += Math.sign(targetSpeed - model.responderSpeedMps) * speedDelta;
  model.routeDistance = Math.min(model.route.totalDistance, model.routeDistance + model.responderSpeedMps * delta);
  const pose = poseAlongRoute(model.route, model.routeDistance);
  model.ambulance = { x: pose.x, z: pose.z, rotation: pose.rotation };
  const remaining = Math.max(0, model.route.totalDistance - model.routeDistance);
  const etaSpeed = Math.max(14.5, model.responderSpeedMps * 0.35 + targetSpeed * 0.65);
  model.etaSeconds = Math.ceil(remaining / etaSpeed);
  model.navigationInstruction = navigationInstruction(model.route, pose, remaining);
  model.vehicleSpeed = model.responderSpeedMps * 3.6;
  elements.navSpeed.textContent = `${Math.round(model.vehicleSpeed)} km/h`;
  updateNavigationHud(remaining);
  renderResponderCard(null);
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
  const managed = unitManager.get(model.activeNavigationUnit);
  if (managed?.route) {
    const pose = poseAlongRoute(managed.route, managed.routeDistance);
    const upcoming = managed.route.segments[Math.min(managed.route.segments.length - 1, pose.segmentIndex + 1)];
    model.blockedSegments.add(segmentKey(upcoming.from, upcoming.to));
    model.blockedRoutePoints = [[ROAD_NODES[upcoming.from], ROAD_NODES[upcoming.to]]];
    unitManager.reroute(managed.id, upcoming.from, model.blockedSegments);
    model.routeTone = "alternative";
    syncActiveUnit(true);
    elements.routeStatus.textContent = "Alternative route active";
    return;
  }
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
  model.responderSpeedMps = 0;
  model.vehicleSpeed = 0;
  model.etaSeconds = 0;
  elements.arrivalTime.textContent = formatTime(model.arrivalIso);
  elements.etaLabel.textContent = "ARRIVED";
  elements.navEta.textContent = "00:00";
  elements.navSpeed.textContent = "0 km/h";
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
  elements.reviewCount.textContent = String(incidentManager.pendingReviews().length);
  elements.historyBody.innerHTML = "";
  if (!model.history.length) {
    elements.historyBody.innerHTML = '<tr class="empty-history"><td colspan="11">No completed demonstrations yet</td></tr>';
    return;
  }
  model.history.forEach((entry) => {
    const row = document.createElement("tr");
    [entry.id, entry.time, entry.location || "--", entry.trigger, entry.vision, entry.audio, entry.fusion, entry.decision, entry.dispatch, entry.response, entry.notes || "--"].forEach((value) => {
      const cell = document.createElement("td");
      cell.textContent = value;
      row.appendChild(cell);
    });
    elements.historyBody.appendChild(row);
  });
}

const CCTV_FEEDS = [
  ["CCTV #01", "Main Highway"], ["CCTV #02", "School Zone"], ["CCTV #03", "Commercial District"],
  ["CCTV #04", "Incident Crossing"], ["CCTV #05", "Northbound Junction"], ["CCTV #06", "Hospital Route"]
];

function syncOperationsState() {
  model.incidents = incidentManager.list();
  model.units = unitManager.list();
  model.selectedIncidentId = incidentManager.selectedId || model.selectedIncidentId;
  renderReviewQueue();
  renderIncidentTaskbar();
  renderCctvWorkspace();
  updateMapIncident();
}

function syncActiveUnit(forceRoute = false) {
  model.units = unitManager.list();
  const unit = unitManager.get(model.activeNavigationUnit);
  if (!unit?.route) { renderResponderCard(unit); return; }
  if (forceRoute || model.route !== unit.route) {
    model.route = unit.route;
    model.routePoints = unit.route.points;
    model.routeSegments = unit.route.segments;
    model.routeVersion += 1;
  }
  model.routeDistance = unit.routeDistance;
  model.routeChanges = unit.routeChanges;
  model.completedDistance = unit.completedDistance;
  model.ambulance = { ...unit.position };
  model.etaSeconds = unit.etaSeconds;
  model.navigationInstruction = unit.instruction || model.navigationInstruction;
  model.vehicleSpeed = unit.speedMps * 3.6;
  elements.navigationUnitId.textContent = unit.id;
  elements.navIncident.textContent = unit.assignedIncident || "--";
  elements.navSpeed.textContent = `${Math.round(unit.speedMps * 3.6)} km/h`;
  const remaining = Math.max(0, unit.route.totalDistance - unit.routeDistance);
  if (unit.instruction) updateNavigationHud(remaining);
  renderResponderCard(unit);
}

function handleManagedArrival(unit) {
  const incident = incidentManager.get(unit.assignedIncident);
  if (incident) {
    incidentManager.update(incident.id, { state: incident.decision ? "CONFIRMED_INCIDENT" : "MEDICAL_DISPATCHED_REVIEW_PENDING", dispatchStatus: `${unit.id} ON SCENE`, arrivalAt: unit.arrivedAt });
    if (incident.decision) addManagedHistory(incident.id);
  }
  if (unit.id === model.activeNavigationUnit) {
    elements.arrivalTime.textContent = formatTime(unit.arrivedAt);
    elements.etaLabel.textContent = "ARRIVED";
    elements.navSpeed.textContent = "0 km/h";
  }
  syncOperationsState();
}

function renderResponderCard(unit = unitManager.get(model.activeNavigationUnit)) {
  const legacyNavigation = !unit && model.currentIncident && NAVIGATION_PHASES.has(model.phase);
  const visible = model.navigationMinimized && (legacyNavigation || Boolean(unit && ["RESERVED", "EN_ROUTE", "ON_SCENE"].includes(unit.status)));
  elements.responderCard.hidden = !visible;
  if (!visible) return;
  if (legacyNavigation) {
    const remaining = Math.max(0, (model.route?.totalDistance || 0) - model.routeDistance);
    elements.responderCardUnit.textContent = "MED-01";
    elements.responderCardCopy.textContent = `MED-01 -> ${model.currentIncident.id} - ETA ${formatDuration(model.etaSeconds)} - ${model.phase.replaceAll("_", " ")} - ${Math.round(remaining)} m`;
    return;
  }
  const remaining = Math.max(0, (unit.route?.totalDistance || 0) - unit.routeDistance);
  elements.responderCardUnit.textContent = unit.id;
  elements.responderCardCopy.textContent = `${unit.id} -> ${unit.assignedIncident} - ETA ${formatDuration(unit.etaSeconds)} - ${unit.status.replaceAll("_", " ")} - ${Math.round(remaining)} m`;
}

function renderReviewQueue() {
  const pending = incidentManager.pendingReviews();
  elements.queueCount.textContent = String(pending.length);
  elements.topReviewCount.textContent = String(pending.length);
  elements.pendingReviewBadge.classList.toggle("has-pending", pending.length > 0);
  elements.reviewQueueList.innerHTML = pending.length ? "" : "<p>No incidents awaiting review</p>";
  pending.forEach((incident) => {
    const card = document.createElement("article");
    card.className = "review-item";
    card.innerHTML = `<header><strong>${escapeHtml(incident.id)}</strong><span>${escapeHtml(incident.severity)}</span></header><p>${escapeHtml(incident.title)}<br>${escapeHtml(incident.location)}<br>${formatTime(incident.detectedAt)}</p><dl><div><dt>Waiting</dt><dd>${formatWaiting(incident.detectedAt)}</dd></div><div><dt>Fusion</dt><dd>${percent(incident.confidence.fusion)}</dd></div><div><dt>Units</dt><dd>${escapeHtml(incident.assignedUnit || "None")} / ${escapeHtml(incident.policeUnit || "No police")}</dd></div></dl><button type="button" data-open-incident="${escapeHtml(incident.id)}">Reopen Review</button>`;
    elements.reviewQueueList.appendChild(card);
  });
}

function renderIncidentTaskbar() {
  elements.incidentTaskbar.innerHTML = "";
  incidentManager.pendingReviews().filter((incident) => incident.minimized).forEach((incident) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "incident-chip";
    button.dataset.openIncident = incident.id;
    button.innerHTML = `<strong>${escapeHtml(incident.id)} - Pedestrian Incident - Critical</strong><span>Pending ${formatWaiting(incident.detectedAt)} - ${escapeHtml(incident.dispatchStatus)} - REOPEN</span>`;
    elements.incidentTaskbar.appendChild(button);
  });
}

function renderCctvWorkspace() {
  elements.cctvWorkspace.hidden = !model.cctvWorkspaceOpen;
  if (!model.cctvWorkspaceOpen) return;
  elements.cctvFeedList.innerHTML = "";
  elements.cctvMonitorGrid.innerHTML = "";
  elements.cctvMonitorGrid.classList.toggle("is-grid", model.cctvGridMode);
  CCTV_FEEDS.forEach(([id, location]) => {
    const related = incidentManager.list().filter((incident) => incident.cameraIds?.includes(id) && !["FALSE_ALARM", "CLOSED"].includes(incident.state));
    const status = related.some((incident) => incident.assignedUnit)
      ? "UNIT ASSIGNED"
      : related.some((incident) => incidentManager.pendingReviews().some((pending) => pending.id === incident.id))
        ? "AWAITING REVIEW"
        : related.length ? `${related.length} ACTIVE INCIDENT${related.length > 1 ? "S" : ""}` : "";
    const feedButton = document.createElement("button");
    feedButton.type = "button";
    feedButton.className = "cctv-feed-button";
    feedButton.dataset.feedId = id;
    feedButton.setAttribute("aria-pressed", String(model.selectedCctvFeed === id));
    feedButton.innerHTML = `<span><strong>${id}</strong><br>${location}</span>${status ? `<span class="camera-incident-badge">${status}</span>` : ""}`;
    elements.cctvFeedList.appendChild(feedButton);
    if (model.cctvGridMode || model.selectedCctvFeed === id) {
      const card = document.createElement("button");
      card.type = "button";
      card.className = "cctv-feed-card";
      card.dataset.feedId = id;
      card.innerHTML = `<span class="cctv-feed-visual"></span>${status ? `<span class="camera-incident-badge">${status}</span>` : ""}<span class="cctv-feed-meta"><b>${id} - LIVE</b><span>${location}</span></span>`;
      elements.cctvMonitorGrid.appendChild(card);
    }
  });
}

function handleCctvSelection(event) {
  const feed = event.target.closest("[data-feed-id]")?.dataset.feedId;
  if (!feed) return;
  model.selectedCctvFeed = feed;
  model.cctvGridMode = false;
  elements.cctvGridMode.setAttribute("aria-pressed", "false");
  renderCctvWorkspace();
  const pending = incidentManager.pendingReviews().find((incident) => incident.cameraIds?.includes(feed));
  if (pending && event.target.closest(".cctv-feed-card")) openPedestrianReview(pending.id);
}

function simulateSecondIncident() {
  const previousSelection = incidentManager.selectedId;
  const incident = incidentManager.create({ type: "vehicle-collision", title: "Confirmed Vehicle Collision", state: "CONFIRMED_INCIDENT", severity: "high", cameraIds: ["CCTV #02"], location: "School Zone - Intersection 2", coordinates: { latitude: 2.2942, longitude: 111.8248 }, position: { x: -18, z: 16, mapX: 450, mapY: 250 }, confidence: { vision: .991, audio: .987, fusion: .989 }, evidence: { vehicleId: "VEH-318 / VEH-442" } });
  model.pendingNewIncidentId = incident.id;
  if (previousSelection) incidentManager.select(previousSelection);
  elements.newIncidentAlert.hidden = false;
  syncOperationsState();
  showToast("New incident detected on CCTV #02");
}

function simulateConcurrentFalseAlarm() {
  const previousSelection = incidentManager.selectedId;
  const incident = incidentManager.create({
    type: "sudden-stop-anomaly",
    title: "Emergency Braking Anomaly",
    state: "FALSE_ALARM",
    severity: "low",
    cameraIds: ["CCTV #03"],
    location: "Commercial District - Junction 6",
    coordinates: { latitude: 2.2879, longitude: 111.8352 },
    position: { x: 20, z: -17, mapX: 705, mapY: 430 },
    confidence: { vision: .944, audio: .082, fusion: .182 },
    evidence: { reason: "No acoustic impact signature within the incident window" },
    decision: "Automatically retained for dispatcher audit",
    finalClassification: "Emergency braking - no collision",
    dispatchStatus: "NOT DISPATCHED"
  });
  if (previousSelection) incidentManager.select(previousSelection);
  addManagedHistory(incident.id);
}

function openManagedIncident(id) {
  const incident = incidentManager.get(id);
  if (!incident) return;
  if (incident.type === "suspected-pedestrian-hit-and-run") return openPedestrianReview(id);
  incidentManager.select(id);
  model.selectedIncidentId = id;
  model.currentIncident = incidentToModalRecord(incident);
  model.activeScenario = "confirmed";
  model.impactIso = incident.detectedAt;
  model.phase = PHASES.CRITICAL_CONFIRMED;
  openEvidenceModal("critical");
}

function addManagedHistory(id) {
  const incident = incidentManager.get(id);
  if (!incident) return;
  const pendingSeconds = Math.round(((incident.dispatchAt ? new Date(incident.dispatchAt) : new Date()) - new Date(incident.detectedAt)) / 1000);
  const reviewAudit = incident.wasMinimized ? `; minimised review; pending ${formatDuration(pendingSeconds)}` : "";
  upsertHistory({
    id,
    time: formatTime(incident.detectedAt),
    location: incident.location,
    trigger: incident.title,
    decision: `${incident.decision || incident.finalClassification || "Review pending"}${reviewAudit}`,
    dispatch: `${incident.assignedUnit || "No unit"} after ${formatDuration(pendingSeconds)}`,
    response: incident.arrivalAt ? `Arrived ${formatTime(incident.arrivalAt)}` : "--",
    notes: incident.notes || "--",
    fusion: percent(incident.confidence.fusion),
    vision: percent(incident.confidence.vision),
    audio: percent(incident.confidence.audio)
  });
}

function showToast(message) {
  elements.operationsToast.textContent = message;
  elements.operationsToast.hidden = false;
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => { elements.operationsToast.hidden = true; }, 2800);
}

function resetSimulation() {
  model.runToken += 1;
  incidentManager.resetAll();
  unitManager.resetAll();
  model.phase = PHASES.NORMAL;
  model.phaseElapsed = 0;
  model.selectedScenario = "confirmed";
  model.activeScenario = "confirmed";
  model.normalCycle = 0;
  model.carA = { x: -23, z: -1.2, rotation: 0 };
  model.carB = { x: 1.2, z: 23, rotation: -Math.PI / 2 };
  model.vehicleSpeed = 48;
  model.responderSpeedMps = 0;
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
  model.incidents = [];
  model.units = unitManager.list();
  model.selectedIncidentId = null;
  model.activeNavigationUnit = null;
  model.navigationMinimized = false;
  model.pedestrian = { visible: false, x: -5.2, z: -8, rotationZ: 0, stationary: false };
  model.suspectTrackingActive = false;
  model.secondCameraTracking = false;
  model.cctvWorkspaceOpen = false;
  model.selectedCctvFeed = "CCTV #04";
  model.concurrentMode = false;
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
  syncOperationsState();
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
  if (incidentManager.list().length) {
    incidentManager.list().forEach((incident) => {
      const { mapX = 600, mapY = 360 } = incident.position || {};
      if (["AWAITING_HUMAN_DECISION", "REVIEW_MINIMISED", "MEDICAL_DISPATCHED_REVIEW_PENDING"].includes(incident.state)) elements.mapResultLayer.appendChild(svgEl("circle", { cx: mapX, cy: mapY, r: 52, class: "map-investigation-radius" }));
      const markerClass = ["FALSE_ALARM", "CLOSED"].includes(incident.state) ? "map-event-cleared" : ["CONFIRMED_INCIDENT", "RESPONDER_EN_ROUTE", "RESPONDER_ARRIVED"].includes(incident.state) ? "map-event-red" : "map-event-amber";
      const group = svgEl("g", { "data-incident-id": incident.id, tabindex: "0", role: "button", "aria-label": `Open ${incident.id}` });
      group.appendChild(svgEl("circle", { cx: mapX, cy: mapY, r: 22, class: markerClass, "data-map-marker": "true" }));
      elements.mapResultLayer.appendChild(group);
    });
    return;
  }
  if ([PHASES.NORMAL, PHASES.APPROACHING, PHASES.IMPACT].includes(model.phase)) return;
  if (NAVIGATION_PHASES.has(model.phase)) elements.mapResultLayer.appendChild(svgEl("path", { d: "M160 590 C300 520 430 430 600 360", class: "map-route" }));
  const suspected = [PHASES.SUSPECTED_EVENT, PHASES.VISION_DETECTED, PHASES.AUDIO_DETECTED, PHASES.FUSION_VERIFYING, PHASES.SENSOR_MISMATCH, PHASES.FALSE_ALARM, PHASES.AWAITING_HUMAN_REVIEW].includes(model.phase);
  const confirmed = [PHASES.CRITICAL_CONFIRMED, ...NAVIGATION_PHASES].includes(model.phase);
  if (suspected) elements.mapResultLayer.appendChild(svgEl("circle", { cx: 600, cy: 360, r: 62, class: "map-investigation-radius" }));
  const markerClass = confirmed ? "map-event-red" : model.phase === PHASES.CLEARED ? "map-event-cleared" : "map-event-amber";
  elements.mapResultLayer.appendChild(svgEl("circle", { cx: 600, cy: 360, r: 23, class: markerClass, "data-map-marker": "true" }));
}

function updateMapPulse() {
  elements.mapResultLayer.querySelectorAll("[data-map-marker]").forEach((marker) => {
    if (marker.classList.contains("map-event-cleared")) return;
    const base = marker.classList.contains("map-event-red") ? 23 : 20;
    marker.setAttribute("r", String(base + Math.sin(model.elapsed * 6) * 4));
  });
}

function resetSelectedIncident() {
  const incident = incidentManager.get(model.selectedIncidentId);
  if (!incident) return resetSimulation();
  unitManager.releaseIncident(incident.id);
  incidentManager.remove(incident.id);
  if (model.currentIncident?.id === incident.id) closeEvidenceModal();
  const active = unitManager.get(model.activeNavigationUnit);
  if (!active?.assignedIncident) model.activeNavigationUnit = unitManager.list().find((unit) => unit.status === "EN_ROUTE")?.id || null;
  if (incident.vulnerableRoadUser) model.pedestrian.visible = false;
  model.phase = PHASES.NORMAL;
  model.currentIncident = null;
  syncActiveUnit(true);
  syncOperationsState();
  updatePhaseUi();
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
  elements.resetSelected.addEventListener("click", resetSelectedIncident);
  elements.simulateSecond.addEventListener("click", simulateSecondIncident);
  elements.simulateSecondCctv.addEventListener("click", simulateSecondIncident);
  elements.scenario.addEventListener("change", () => {
    model.selectedScenario = elements.scenario.value;
    elements.simulateLabel.textContent = SCENARIOS[model.selectedScenario].button;
    const pedestrianPreview = ["pedestrian","concurrent"].includes(model.selectedScenario);
    model.pedestrian = { visible: pedestrianPreview, x: -5.2, z: -8, rotationZ: 0, stationary: false };
  });
  elements.noise.addEventListener("input", () => { elements.noiseReadout.textContent = `${elements.noise.value} dB`; });
  elements.energy.addEventListener("input", () => { elements.energyReadout.textContent = `${elements.energy.value} dB`; });
  elements.dispatch.addEventListener("click", handlePrimaryModalAction);
  elements.falseAlarm.addEventListener("click", handleSecondaryModalAction);
  elements.humanReview.addEventListener("click", escalateHumanReview);
  elements.roadBlock.addEventListener("click", simulateRoadBlock);
  elements.handover.addEventListener("click", handOverResponse);
  elements.confirmPedestrian.addEventListener("click", () => dispatchPedestrian(false));
  elements.dispatchPending.addEventListener("click", () => dispatchPedestrian(true));
  elements.policeCoordination.addEventListener("click", requestPedestrianPolice);
  elements.pedestrianFalseAlarm.addEventListener("click", requestPedestrianFalseAlarm);
  elements.continuePedestrian.addEventListener("click", minimiseCurrentReview);
  elements.minimiseReview.addEventListener("click", minimiseCurrentReview);
  elements.minimiseReviewIcon.addEventListener("click", minimiseCurrentReview);
  elements.closeReviewIcon.addEventListener("click", requestReviewExit);
  elements.reviewQueueShortcut.addEventListener("click", () => { elements.reviewQueue.classList.add("is-open"); elements.toggleReviewQueue.setAttribute("aria-expanded", "true"); });
  elements.confirmMinimise.addEventListener("click", () => model.confirmationAction === "false-alarm" ? completePedestrianFalseAlarm() : minimiseCurrentReview());
  elements.returnReview.addEventListener("click", () => { elements.unresolvedConfirm.hidden = true; elements.minimiseReview.focus(); });
  elements.notes.addEventListener("input", () => { if (model.selectedIncidentId) incidentManager.update(model.selectedIncidentId, { notes: elements.notes.value }); });
  elements.pendingReviewBadge.addEventListener("click", () => { elements.reviewQueue.classList.add("is-open"); elements.toggleReviewQueue.setAttribute("aria-expanded", "true"); });
  elements.toggleReviewQueue.addEventListener("click", () => { const open = elements.reviewQueue.classList.toggle("is-open"); elements.toggleReviewQueue.setAttribute("aria-expanded", String(open)); });
  const openIncidentFromEvent = (event) => { const target = event.target.closest("[data-open-incident],[data-incident-id]"); const id = target?.dataset.openIncident || target?.dataset.incidentId; if (id) openManagedIncident(id); };
  elements.reviewQueueList.addEventListener("click", openIncidentFromEvent);
  elements.incidentTaskbar.addEventListener("click", openIncidentFromEvent);
  elements.mapResultLayer.addEventListener("click", openIncidentFromEvent);
  elements.cctvFeedList.addEventListener("click", handleCctvSelection);
  elements.cctvMonitorGrid.addEventListener("click", handleCctvSelection);
  elements.cctvGridMode.addEventListener("click", () => { model.cctvGridMode = !model.cctvGridMode; elements.cctvGridMode.setAttribute("aria-pressed", String(model.cctvGridMode)); renderCctvWorkspace(); });
  elements.returnCity.addEventListener("click", () => { model.cctvWorkspaceOpen = false; renderCctvWorkspace(); });
  elements.minimiseNavigation.addEventListener("click", () => { model.navigationMinimized = true; model.cctvWorkspaceOpen = true; model.cameraMode = "incident"; renderCctvWorkspace(); renderResponderCard(); updatePhaseUi(); });
  elements.restoreNavigation.addEventListener("click", () => { model.navigationMinimized = false; model.cctvWorkspaceOpen = false; model.cameraMode = "responder"; renderCctvWorkspace(); renderResponderCard(); updatePhaseUi(); });
  elements.openNewIncident.addEventListener("click", () => { elements.newIncidentAlert.hidden = true; openManagedIncident(model.pendingNewIncidentId); });
  elements.keepCurrentReview.addEventListener("click", () => { elements.newIncidentAlert.hidden = true; });
  elements.minimiseOpenNew.addEventListener("click", () => { const id = model.pendingNewIncidentId; elements.newIncidentAlert.hidden = true; if (model.modalMode === "pedestrian") minimiseCurrentReview(); openManagedIncident(id); });
  elements.clearHistory.addEventListener("click", () => { model.history = []; model.reviewQueue = []; renderHistory(); });
  elements.collapseMap.addEventListener("click", () => { const collapsed = elements.navigationMapPanel.classList.toggle("is-collapsed"); elements.collapseMap.textContent = collapsed ? "+" : "−"; });
  elements.cameraButtons.forEach((button) => button.addEventListener("click", () => {
    model.cameraMode = button.dataset.cameraMode;
    elements.cameraButtons.forEach((candidate) => candidate.setAttribute("aria-pressed", String(candidate === button)));
  }));
  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape" || !model.modalOpen) return;
    if (model.modalMode === "pedestrian") return requestReviewExit();
    if (model.modalMode === "review") return;
    if (model.modalMode === "critical") handleSecondaryModalAction();
    else finalizeFalseAlarm("Continue monitoring");
  });
}

async function init() {
  bindControls();
  drawMapBase();
  renderHistory();
  syncOperationsState();
  try {
    const [health, config] = await Promise.all([api("/api/health"), api("/api/config")]);
    sensors = config.sensors;
    elements.nodeCount.textContent = String(health.sensors.online);
    drawMapSensors();
    renderStandbyTelemetry();
    setBackendStatus("online", "API connected");
    startEventStream();
    roadScene = createRoadScene({ container: elements.sceneContainer, evidenceCanvas: elements.cctvCanvas, getState: () => model, onFrame: tick });
    window.__echoAlertDebug = { getState: () => ({ phase: model.phase, scenario: model.activeScenario, modalMode: model.modalMode, route: model.route?.nodeIds || [], routeDistance: model.routeDistance, routeChanges: model.routeChanges, renderFrames: model.renderFrames, incidentId: model.currentIncident?.id || null, incidents: incidentManager.list(), units: unitManager.list(), selectedCctvFeed: model.selectedCctvFeed }), loopCount: 1 };
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
function formatWaiting(value) { return formatDuration((Date.now() - new Date(value).getTime()) / 1000); }
function formatTimelineTime(value) { const date = new Date(value); return `${date.toLocaleTimeString("en-MY", { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false })}.${String(date.getMilliseconds()).padStart(3, "0").slice(0, 1)}`; }
function offsetIso(value, seconds) { return new Date(new Date(value).getTime() + seconds * 1000).toISOString(); }
function percent(value) { return `${((Number(value) || 0) * 100).toFixed(1)}%`; }
function incidentToModalRecord(incident) { return { id: incident.id, detectedAt: incident.detectedAt, latitude: incident.coordinates.latitude, longitude: incident.coordinates.longitude, confidence: incident.confidence.fusion, lockedCount: 2, telemetry: [] }; }
function lerp(start, end, amount) { return start + (end - start) * amount; }
function easeInOut(value) { return value * value * (3 - 2 * value); }
function clamp01(value) { return Math.max(0, Math.min(1, value)); }
function escapeHtml(value) { return String(value).replace(/[&<>'"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[character]); }

init();
