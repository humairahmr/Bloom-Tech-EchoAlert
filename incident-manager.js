const STORAGE_KEY = "echoalert-operations-v3";
const FINAL_STATES = new Set(["CONFIRMED_INCIDENT", "FALSE_ALARM", "CLOSED"]);
const REVIEW_STATES = new Set(["AWAITING_HUMAN_DECISION", "REVIEW_MINIMISED", "MEDICAL_DISPATCHED_REVIEW_PENDING"]);
const SEVERITY = { critical: 4, high: 3, medium: 2, low: 1 };

export class IncidentManager {
  constructor(storage = globalThis.localStorage) {
    this.storage = storage;
    this.incidents = new Map();
    this.sequence = 2046;
    this.selectedId = null;
    this.openReviewId = null;
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
      severity: "medium",
      vulnerableRoadUser: false,
      location: "Sibu city network",
      coordinates: { latitude: 2.2913, longitude: 111.8291 },
      position: { x: 0, z: 0, mapX: 600, mapY: 360 },
      detectedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      confidence: { vision: 0, audio: 0, fusion: 0 },
      evidence: {},
      timeline: [],
      notes: "",
      decision: null,
      finalClassification: null,
      dispatchStatus: "NOT DISPATCHED",
      dispatchAt: null,
      assignedUnit: null,
      policeUnit: null,
      minimized: false,
      wasMinimized: false,
      reviewScrollTop: 0,
      arrivalAt: null,
      ...input,
      id
    };
    this.incidents.set(id, incident);
    this.selectedId = id;
    this.persist();
    return incident;
  }

  update(id, patch) {
    const incident = this.get(id);
    if (!incident) return null;
    const next = { ...incident, ...patch, updatedAt: new Date().toISOString() };
    if (patch.confidence) next.confidence = { ...incident.confidence, ...patch.confidence };
    if (patch.evidence) next.evidence = { ...incident.evidence, ...patch.evidence };
    this.incidents.set(id, next);
    this.persist();
    return next;
  }

  addTimeline(id, label, at = new Date().toISOString()) {
    const incident = this.get(id);
    return incident ? this.update(id, { timeline: [...incident.timeline, { at, label }] }) : null;
  }

  get(id) { return this.incidents.get(id) || null; }
  list() { return [...this.incidents.values()]; }
  select(id) { if (this.incidents.has(id)) this.selectedId = id; return this.get(this.selectedId); }
  active() { return this.list().filter((item) => !FINAL_STATES.has(item.state)).sort(comparePriority); }
  pendingReviews() { return this.list().filter((item) => REVIEW_STATES.has(item.state)).sort(comparePriority); }

  minimise(id, scrollTop = 0) {
    const incident = this.get(id);
    if (!incident || FINAL_STATES.has(incident.state)) return incident;
    this.openReviewId = null;
    return this.update(id, {
      state: incident.assignedUnit ? "MEDICAL_DISPATCHED_REVIEW_PENDING" : "REVIEW_MINIMISED",
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
      state: incident.assignedUnit ? "MEDICAL_DISPATCHED_REVIEW_PENDING" : "AWAITING_HUMAN_DECISION",
      minimized: false
    });
  }

  remove(id) {
    const removed = this.incidents.delete(id);
    if (this.selectedId === id) this.selectedId = this.active()[0]?.id || null;
    if (this.openReviewId === id) this.openReviewId = null;
    this.persist();
    return removed;
  }

  resetAll() {
    this.incidents.clear();
    this.selectedId = null;
    this.openReviewId = null;
    this.persist();
  }

  persist() {
    try {
      this.storage?.setItem(STORAGE_KEY, JSON.stringify({ incidents: this.list(), selectedId: this.selectedId, sequence: this.sequence }));
    } catch {}
  }

  restore() {
    try {
      const saved = JSON.parse(this.storage?.getItem(STORAGE_KEY) || "null");
      saved?.incidents?.forEach((incident) => this.incidents.set(incident.id, incident));
      this.selectedId = saved?.selectedId || null;
      this.sequence = Math.max(saved?.sequence || 2046, ...this.list().map((item) => Number(item.id.match(/\d+/)?.[0]) || 0));
    } catch {
      this.incidents.clear();
    }
  }
}

function comparePriority(a, b) {
  return (SEVERITY[b.severity] || 0) - (SEVERITY[a.severity] || 0)
    || Number(b.vulnerableRoadUser) - Number(a.vulnerableRoadUser)
    || new Date(a.detectedAt) - new Date(b.detectedAt)
    || (b.confidence?.fusion || 0) - (a.confidence?.fusion || 0);
}
