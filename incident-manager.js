const STORAGE_KEY = "echoalert-operations-v3";
const FINAL_RESOLUTIONS = new Set(["RESOLVED", "FALSE_ALARM", "ARCHIVED"]);
const REVIEW_STATES = new Set(["AWAITING_HUMAN_DECISION", "REVIEW_MINIMISED", "MEDICAL_DISPATCHED_REVIEW_PENDING", "RESPONDER_ARRIVED_REVIEW_PENDING"]);
const SEVERITY = { critical: 4, high: 3, medium: 2, low: 1 };
export const DUPLICATE_EVENT_WINDOW_MS = 10_000;
export const TRIAGE_DESTINATIONS = Object.freeze({
  ACTIVE: "active",
  PENDING_REVIEW: "pending-review",
  DETECTION_LOG: "detection-log",
  RESOLVED: "resolved"
});

export function triageDetection(event = {}) {
  const confidence = normaliseConfidence(event.confidence?.fusion ?? event.fusionConfidence ?? event.confidence ?? 0);
  const resolved = event.confirmedFalseAlarm || event.resolutionState && event.resolutionState !== "OPEN" || ["FALSE_ALARM", "CLEARED", "CLOSED"].includes(event.state);
  if (resolved) return TRIAGE_DESTINATIONS.RESOLVED;

  const responseActive = ![null, undefined, "NOT_DISPATCHED", "AWAITING_MEDICAL_UNIT"].includes(event.medicalResponseState)
    || ["RESPONSE_IN_PROGRESS", "ON_SCENE"].includes(event.lifecycleState)
    || ["RESPONDER_EN_ROUTE", "RESPONDER_ARRIVED", "ON_SCENE_RESPONSE"].includes(event.state);
  if (responseActive || event.dispatcherPromotedActive) return TRIAGE_DESTINATIONS.ACTIVE;

  const reviewRequired = event.safetyOverride || event.vulnerableRoadUser
    || event.reviewState === "AWAITING_HUMAN_DECISION"
    || REVIEW_STATES.has(event.state);
  if (reviewRequired) return TRIAGE_DESTINATIONS.PENDING_REVIEW;
  if (confidence >= .75) return TRIAGE_DESTINATIONS.ACTIVE;
  if (confidence >= .5) return TRIAGE_DESTINATIONS.PENDING_REVIEW;
  return TRIAGE_DESTINATIONS.DETECTION_LOG;
}

export class IncidentManager {
  constructor(storage = globalThis.localStorage) {
    this.storage = storage;
    this.incidents = new Map();
    this.sequence = 2046;
    this.selectedId = null;
    this.openReviewId = null;
    this.medicalQueue = [];
    this.restore();
  }

  create(input = {}) {
    const id = input.id || `INC-${++this.sequence}`;
    const incident = {
      id,
      type: "traffic-anomaly",
      title: "Traffic anomaly",
      cameraIds: ["CCTV #04"],
      state: "DETECTED",
      lifecycleState: null,
      severity: "medium",
      vulnerableRoadUser: false,
      location: "Sibu city network",
      coordinates: { latitude: 2.2913, longitude: 111.8291 },
      position: { x: 0, z: 0, mapX: 600, mapY: 360 },
      detectedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      confidence: { vision: 0, audio: 0, fusion: 0 },
      evidence: {},
      confidenceHistory: [],
      duplicateCount: 1,
      reviewStatus: "UNREVIEWED",
      timeline: [],
      notes: "",
      decision: null,
      finalClassification: null,
      reviewState: null,
      medicalResponseState: "NOT_DISPATCHED",
      resolutionState: "OPEN",
      medicalDispatchPending: false,
      responseState: "UNASSIGNED",
      response: createResponse(),
      dispatchStatus: "NOT DISPATCHED",
      dispatchAt: null,
      assignedUnit: null,
      minimized: false,
      wasMinimized: false,
      reviewScrollTop: 0,
      arrivalAt: null,
      ...input,
      response: { ...createResponse(), ...(input.response || {}) },
      id
    };
    const normalised = withTriage(normalizedLifecycle(incident));
    const duplicate = normalised.triageDestination === TRIAGE_DESTINATIONS.DETECTION_LOG ? this.findDuplicate(normalised) : null;
    if (duplicate) {
      const evidenceEvents = [...(duplicate.evidence?.groupedEvents || []), compactEvidence(normalised)];
      return this.update(duplicate.id, {
        detectedAt: duplicate.detectedAt,
        lastDetectionAt: normalised.detectedAt,
        duplicateCount: (duplicate.duplicateCount || 1) + 1,
        confidence: normalised.confidence,
        evidence: { ...normalised.evidence, groupedEvents: evidenceEvents },
        timeline: [...duplicate.timeline, { at: normalised.detectedAt, label: "Related low-confidence detection grouped quietly" }]
      });
    }
    this.incidents.set(id, normalised);
    this.selectedId = id;
    this.persist();
    return normalised;
  }

  update(id, patch) {
    const incident = this.get(id);
    if (!incident) return null;
    const next = { ...incident, ...patch, updatedAt: new Date().toISOString() };
    if (patch.confidence) next.confidence = { ...incident.confidence, ...patch.confidence };
    if (patch.evidence) next.evidence = { ...incident.evidence, ...patch.evidence };
    if (patch.response) next.response = { ...incident.response, ...patch.response };
    const normalised = withTriage(normalizedLifecycle(next), incident);
    this.incidents.set(id, normalised);
    this.persist();
    return normalised;
  }

  addTimeline(id, label, at = new Date().toISOString()) {
    const incident = this.get(id);
    return incident ? this.update(id, { timeline: [...incident.timeline, { at, label }] }) : null;
  }

  get(id) { return this.incidents.get(id) || null; }
  list() { return [...this.incidents.values()]; }
  select(id) { if (this.incidents.has(id)) this.selectedId = id; return this.get(this.selectedId); }
  byDestination(destination) { return this.list().filter((item) => item.triageDestination === destination).sort(comparePriority); }
  active() { return this.byDestination(TRIAGE_DESTINATIONS.ACTIVE); }
  pendingReviews() { return this.byDestination(TRIAGE_DESTINATIONS.PENDING_REVIEW); }
  detectionLog() { return this.byDestination(TRIAGE_DESTINATIONS.DETECTION_LOG); }
  resolved() { return this.byDestination(TRIAGE_DESTINATIONS.RESOLVED); }
  queuedMedical() { return this.medicalQueue.map((id) => this.get(id)).filter((incident) => incident && isIncidentActive(incident)).sort(compareMedicalQueue); }
  enqueueMedical(id) {
    const incident = this.get(id);
    if (!incident || !isIncidentActive(incident) || incident.medicalResponseState !== "NOT_DISPATCHED") return false;
    if (!this.medicalQueue.includes(id)) this.medicalQueue.push(id);
    this.update(id, { lifecycleState: "AWAITING_MEDICAL_UNIT", medicalResponseState: "AWAITING_MEDICAL_UNIT", responseState: "AWAITING_MEDICAL_UNIT", dispatchStatus: "WAITING FOR MEDICAL UNIT" });
    this.persist();
    return true;
  }
  dequeueMedical(id) { this.medicalQueue = this.medicalQueue.filter((item) => item !== id); this.persist(); }

  promoteToReview(id) {
    return this.update(id, { reviewState: "AWAITING_HUMAN_DECISION", reviewStatus: "PROMOTED", decision: "Promoted from Detection Log" });
  }

  promoteToActive(id) {
    return this.update(id, { dispatcherPromotedActive: true, reviewState: "CONFIRMED", reviewStatus: "PROMOTED_ACTIVE", decision: "Promoted to Active by dispatcher" });
  }

  findDuplicate(candidate) {
    const candidateAt = new Date(candidate.lastDetectionAt || candidate.detectedAt).getTime();
    return this.detectionLog().find((existing) => {
      const existingAt = new Date(existing.lastDetectionAt || existing.detectedAt).getTime();
      return Math.abs(candidateAt - existingAt) <= DUPLICATE_EVENT_WINDOW_MS && duplicateSignature(existing) === duplicateSignature(candidate);
    }) || null;
  }

  minimise(id, scrollTop = 0) {
    const incident = this.get(id);
    if (!incident || !isIncidentActive(incident)) return incident;
    this.openReviewId = null;
    return this.update(id, {
      state: incident.response?.arrivalProcessed ? "RESPONDER_ARRIVED_REVIEW_PENDING" : incident.assignedUnit ? "MEDICAL_DISPATCHED_REVIEW_PENDING" : "REVIEW_MINIMISED",
      lifecycleState: incident.response?.arrivalProcessed ? "ON_SCENE" : incident.assignedUnit ? "RESPONSE_IN_PROGRESS" : "AWAITING_DECISION",
      reviewState: "AWAITING_HUMAN_DECISION",
      minimized: true,
      wasMinimized: true,
      reviewScrollTop: scrollTop
    });
  }

  reopen(id) {
    const incident = this.get(id);
    if (!incident) return null;
    this.selectedId = id;
    this.openReviewId = id;
    return this.update(id, {
      state: incident.response?.arrivalProcessed ? "RESPONDER_ARRIVED_REVIEW_PENDING" : incident.assignedUnit ? "MEDICAL_DISPATCHED_REVIEW_PENDING" : "AWAITING_HUMAN_DECISION",
      lifecycleState: incident.response?.arrivalProcessed ? "ON_SCENE" : incident.assignedUnit ? "RESPONSE_IN_PROGRESS" : "AWAITING_DECISION",
      reviewState: "AWAITING_HUMAN_DECISION",
      minimized: false
    });
  }

  remove(id) {
    const removed = this.incidents.delete(id);
    if (this.selectedId === id) this.selectedId = this.active()[0]?.id || null;
    if (this.openReviewId === id) this.openReviewId = null;
    this.dequeueMedical(id);
    this.persist();
    return removed;
  }

  resetAll() {
    this.incidents.clear();
    this.selectedId = null;
    this.openReviewId = null;
    this.medicalQueue = [];
    this.persist();
  }

  persist() {
    try {
      this.storage?.setItem(STORAGE_KEY, JSON.stringify({ incidents: this.list(), selectedId: this.selectedId, sequence: this.sequence, medicalQueue: this.medicalQueue }));
    } catch {}
  }

  restore() {
    try {
      const saved = JSON.parse(this.storage?.getItem(STORAGE_KEY) || "null");
      saved?.incidents?.forEach((incident) => this.incidents.set(incident.id, withTriage(normalizedLifecycle({ ...incident, responseState: incident.responseState || "UNASSIGNED", response: { ...createResponse(), ...(incident.response || {}) } }))));
      this.selectedId = saved?.selectedId || null;
      this.medicalQueue = Array.isArray(saved?.medicalQueue) ? saved.medicalQueue.filter((id) => this.incidents.has(id) && isIncidentActive(this.get(id))) : [];
      this.sequence = Math.max(saved?.sequence || 2046, ...this.list().map((item) => Number(item.id.match(/\d+/)?.[0]) || 0));
    } catch {
      this.incidents.clear();
    }
  }
}

export function compareMedicalQueue(a, b) {
  const priority = { critical: 4, high: 3, medium: 2, low: 1 };
  return (priority[b.severity] || 0) - (priority[a.severity] || 0)
    || Number(b.vulnerableRoadUser) - Number(a.vulnerableRoadUser)
    || new Date(a.detectedAt) - new Date(b.detectedAt)
    || (b.confidence?.fusion || 0) - (a.confidence?.fusion || 0);
}

export function isIncidentActive(incident) {
  return Boolean(incident) && !FINAL_RESOLUTIONS.has(incident.resolutionState || legacyResolution(incident.state));
}

function normalizedLifecycle(incident) {
  const legacyFinalResolution = legacyResolution(incident.state);
  const resolutionState = legacyFinalResolution !== "OPEN" ? legacyFinalResolution : incident.resolutionState || "OPEN";
  const medicalResponseState = incident.medicalResponseState || legacyMedicalResponse(incident);
  const lifecycleState = incident.lifecycleState || legacyLifecycle(incident, resolutionState, medicalResponseState);
  const medicalOnlyIncident = { ...incident };
  ["poli" + "ceUnit", "poli" + "ceResponseState"].forEach((key) => delete medicalOnlyIncident[key]);
  return { ...medicalOnlyIncident, resolutionState, medicalResponseState, lifecycleState, medicalDispatchPending: Boolean(incident.medicalDispatchPending) };
}

function withTriage(incident, previous = null) {
  const triageDestination = triageDetection(incident);
  const confidence = normaliseConfidence(incident.confidence?.fusion);
  const confidenceHistory = Array.isArray(incident.confidenceHistory) ? [...incident.confidenceHistory] : [];
  const previousConfidence = previous ? normaliseConfidence(previous.confidence?.fusion) : null;
  if (!confidenceHistory.length || previousConfidence !== confidence) confidenceHistory.push({ at: incident.updatedAt || incident.detectedAt || new Date().toISOString(), value: confidence });
  const timeline = [...(incident.timeline || [])];
  if (previous?.triageDestination && previous.triageDestination !== triageDestination) {
    timeline.push({ at: incident.updatedAt || new Date().toISOString(), label: `Triage moved from ${previous.triageDestination} to ${triageDestination}` });
  }
  return {
    ...incident,
    triageDestination,
    triageReason: triageReason(incident, triageDestination),
    confidenceHistory,
    timeline,
    duplicateCount: incident.duplicateCount || 1,
    lastDetectionAt: incident.lastDetectionAt || incident.detectedAt
  };
}

function triageReason(event, destination) {
  if (destination === TRIAGE_DESTINATIONS.RESOLVED) return event.decision || "Confirmed false alarm or resolved incident";
  if (destination === TRIAGE_DESTINATIONS.ACTIVE) return event.medicalResponseState !== "NOT_DISPATCHED" ? "Medical response active" : "Fusion confidence meets the active threshold";
  if (event.vulnerableRoadUser || event.safetyOverride) return "Vulnerable-road-user safety override requires a human decision";
  if (destination === TRIAGE_DESTINATIONS.PENDING_REVIEW) return "Uncertain evidence requires human review";
  return "Fusion confidence is below the dispatcher-alert threshold";
}

function normaliseConfidence(value) {
  const number = Number(value) || 0;
  return number > 1 ? number / 100 : number;
}

function duplicateSignature(incident) {
  const objects = incident.evidence?.objectIds || incident.evidence?.vehicleId || incident.evidence?.pedestrianId || "";
  return [incident.cameraIds?.[0] || incident.sensorId || "", incident.location || "", incident.type || "", String(objects)].join("|").toLowerCase();
}

function compactEvidence(incident) {
  return { at: incident.detectedAt, confidence: incident.confidence?.fusion || 0, camera: incident.cameraIds?.[0] || incident.sensorId || "Unknown", evidence: incident.evidence || {} };
}

function legacyResolution(state) {
  return ["FALSE_ALARM", "CLEARED"].includes(state) ? "FALSE_ALARM" : state === "CLOSED" ? "RESOLVED" : "OPEN";
}

function legacyMedicalResponse(incident) {
  if (incident.response?.handoverCompleted) return "HANDOVER_COMPLETE";
  if (incident.response?.arrivalProcessed) return "ON_SCENE";
  if (incident.assignedUnit || incident.dispatchStatus?.includes("DISPATCHED") || incident.dispatchStatus?.includes("EN ROUTE")) return "DISPATCHED";
  return "NOT_DISPATCHED";
}

function legacyLifecycle(incident, resolutionState, medicalResponseState) {
  if (resolutionState !== "OPEN") return "RESOLVED";
  if (medicalResponseState === "HANDOVER_COMPLETE" || medicalResponseState === "ON_SCENE") return "ON_SCENE";
  if (medicalResponseState === "DISPATCHED") return "RESPONSE_IN_PROGRESS";
  if (incident.reviewState === "AWAITING_HUMAN_DECISION" || REVIEW_STATES.has(incident.state)) return "AWAITING_DECISION";
  return incident.state === "DETECTED" ? "DETECTED" : "ACTIVE";
}

function createResponse() {
  return {
    assignedUnitId: null,
    dispatchedAt: null,
    arrivedAt: null,
    handedOverAt: null,
    responseTimeMs: null,
    handoverDurationMs: null,
    originalEtaSeconds: 0,
    actualArrivalSeconds: null,
    arrivalProcessed: false,
    handoverCompleted: false,
    distanceTravelledMeters: 0,
    routeRecalculations: 0,
    finalRouteStatus: "Not dispatched"
  };
}

function comparePriority(a, b) {
  return (SEVERITY[b.severity] || 0) - (SEVERITY[a.severity] || 0)
    || Number(b.vulnerableRoadUser) - Number(a.vulnerableRoadUser)
    || new Date(a.detectedAt) - new Date(b.detectedAt)
    || (b.confidence?.fusion || 0) - (a.confidence?.fusion || 0);
}
