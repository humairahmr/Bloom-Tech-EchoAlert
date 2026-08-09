import { findFastestRoute, navigationConstants, navigationInstruction, poseAlongRoute, prependCurrentPosition } from "./navigation.js";

const CRUISE_MPS = 30.5;
const TURN_MPS = 14.5;
const APPROACH_MPS = 7.5;
const ARRIVAL_THRESHOLD_METERS = 8;
const RETURN_TO_BASE_MS = 700;

export class UnitManager {
  constructor() {
    this.units = new Map([
      ["MED-01", createUnit("MED-01", "medical", "S")],
      ["MED-02", createUnit("MED-02", "medical", "S2")]
    ]);
  }

  list() { return [...this.units.values()]; }
  get(id) { return this.units.get(id) || null; }
  getAvailableAmbulances() { return this.list().filter((unit) => unit.status === "AVAILABLE"); }

  assignMedical(incidentId, blocked = new Set()) {
    const unit = this.getAvailableAmbulances()[0];
    if (!unit) return null;
    const route = findFastestRoute(unit.startNode, "D", blocked);
    if (!route) return null;
    Object.assign(unit, {
      status: "RESERVED",
      assignedIncident: incidentId,
      route,
      routeDistance: 0,
      completedDistance: 0,
      speedMps: 0,
      etaSeconds: Math.ceil(route.totalDistance / CRUISE_MPS),
      routeChanges: 0,
      reservedAt: new Date().toISOString(),
      dispatchedAt: null,
      startedAt: null,
      arrivedAt: null,
      handedOverAt: null,
      originalEtaSeconds: Math.ceil(route.totalDistance / CRUISE_MPS),
      arrivalProcessed: false,
      handoverCompleted: false,
      routeComplete: false,
      instruction: { arrow: "UP", manoeuvre: "Route calculating", distance: route.totalDistance, roadName: route.segments[0]?.roadName || "Emergency network" }
    });
    Object.assign(unit.position, poseAlongRoute(route, 0));
    return unit;
  }

  dispatch(id) {
    const unit = this.get(id);
    if (unit?.status === "RESERVED") {
      const dispatchedAt = new Date().toISOString();
      unit.status = "EN_ROUTE";
      unit.dispatchedAt = dispatchedAt;
      unit.startedAt = dispatchedAt;
    }
    return unit;
  }

  reroute(id, fromNode, blocked) {
    const unit = this.get(id);
    if (!unit?.route) return null;
    const replacement = findFastestRoute(fromNode, "D", blocked);
    if (!replacement) return null;
    unit.completedDistance += unit.routeDistance;
    unit.route = prependCurrentPosition(replacement, unit.position);
    unit.routeDistance = 0;
    unit.routeChanges += 1;
    return unit;
  }

  update(delta) {
    const arrivals = [];
    this.list().filter((unit) => unit.status === "RETURNING_TO_BASE" && Date.now() >= unit.returnReadyAt).forEach(resetUnit);
    this.list().filter((unit) => ["EN_ROUTE", "ARRIVING"].includes(unit.status)).forEach((unit) => {
      const before = poseAlongRoute(unit.route, unit.routeDistance);
      const remaining = Math.max(0, unit.route.totalDistance - unit.routeDistance);
      const segment = unit.route.segments[before.segmentIndex];
      const distanceToTurn = Math.max(0, segment.endDistance - unit.routeDistance);
      const finalSegment = before.segmentIndex >= unit.route.segments.length - 1;
      const turnAhead = !finalSegment && distanceToTurn < 70;
      const target = remaining < 70 ? APPROACH_MPS : turnAhead ? TURN_MPS : CRUISE_MPS;
      if (finalSegment && remaining < 70) unit.status = "ARRIVING";
      unit.speedMps = approach(unit.speedMps, target, (target > unit.speedMps ? 8.5 : 12.5) * delta);
      unit.routeDistance = Math.min(unit.route.totalDistance, unit.routeDistance + unit.speedMps * delta);
      const pose = poseAlongRoute(unit.route, unit.routeDistance);
      Object.assign(unit.position, pose);
      const nextRemaining = Math.max(0, unit.route.totalDistance - unit.routeDistance);
      const destination = unit.route.points.at(-1);
      const distanceToDestination = Math.hypot(unit.position.x - destination.x, unit.position.z - destination.z) * navigationConstants.metersPerUnit;
      unit.etaSeconds = Math.ceil(nextRemaining / Math.max(APPROACH_MPS, unit.speedMps));
      unit.instruction = navigationInstruction(unit.route, pose, nextRemaining);
      if (finalSegment && distanceToDestination <= ARRIVAL_THRESHOLD_METERS && unit.speedMps <= APPROACH_MPS + 0.5) {
        const result = this.completeArrival(unit.id);
        if (result.processed) arrivals.push(result.unit);
      }
    });
    return arrivals;
  }

  completeArrival(id, arrivedAt = new Date().toISOString()) {
    const unit = this.get(id);
    if (!unit || unit.arrivalProcessed || !unit.route || unit.type !== "medical") return { unit, processed: false };
    unit.routeDistance = unit.route.totalDistance;
    Object.assign(unit.position, poseAlongRoute(unit.route, unit.routeDistance));
    Object.assign(unit, {
      status: "ON_SCENE",
      speedMps: 0,
      etaSeconds: 0,
      arrivedAt,
      arrivalProcessed: true,
      routeComplete: true,
      instruction: { arrow: "PIN", manoeuvre: "Arrived at incident location", distance: 0, roadName: unit.route.segments.at(-1)?.roadName || "Incident location" }
    });
    return { unit, processed: true };
  }

  completeHandover(id, handedOverAt = new Date().toISOString()) {
    const unit = this.get(id);
    if (!unit || unit.type !== "medical" || unit.status !== "ON_SCENE" || !unit.arrivalProcessed || unit.handoverCompleted) return { unit, processed: false };
    Object.assign(unit, { status: "HANDOVER_COMPLETE", handedOverAt, handoverCompleted: true, speedMps: 0, etaSeconds: 0 });
    return { unit, processed: true };
  }

  restoreCompletedResponse(incident) {
    const response = incident?.response;
    const unit = this.get(response?.assignedUnitId);
    if (!unit || unit.type !== "medical" || !response?.arrivalProcessed) return null;
    const route = findFastestRoute(unit.startNode, "D", new Set());
    const distanceTravelled = Math.max(route.totalDistance, response.distanceTravelledMeters || route.totalDistance);
    Object.assign(unit, {
      status: response.handoverCompleted ? "HANDOVER_COMPLETE" : "ON_SCENE",
      assignedIncident: incident.id,
      route,
      routeDistance: route.totalDistance,
      completedDistance: Math.max(0, distanceTravelled - route.totalDistance),
      routeChanges: response.routeRecalculations || 0,
      speedMps: 0,
      etaSeconds: 0,
      instruction: { arrow: "PIN", manoeuvre: "Arrived at incident location", distance: 0, roadName: route.segments.at(-1)?.roadName || "Incident location" },
      dispatchedAt: response.dispatchedAt,
      startedAt: response.dispatchedAt,
      arrivedAt: response.arrivedAt,
      handedOverAt: response.handedOverAt,
      originalEtaSeconds: response.originalEtaSeconds || 0,
      arrivalProcessed: true,
      handoverCompleted: Boolean(response.handoverCompleted),
      routeComplete: true
    });
    Object.assign(unit.position, poseAlongRoute(route, route.totalDistance));
    return unit;
  }

  releaseIncident(incidentId) {
    this.list().filter((unit) => unit.assignedIncident === incidentId).forEach((unit) => this.returnAmbulanceToStandby(unit.id, incidentId));
  }
  returnAmbulanceToStandby(id, incidentId = null) {
    const unit = this.get(id);
    if (!unit || (incidentId && unit.assignedIncident !== incidentId)) return null;
    Object.assign(unit, { status: "RETURNING_TO_BASE", assignedIncident: null, position: { ...unit.standbyPosition }, speedMps: 0, etaSeconds: 0, route: null, routeDistance: 0, completedDistance: 0, routeChanges: 0, returnReadyAt: Date.now() + RETURN_TO_BASE_MS, releaseAt: new Date().toISOString(), instruction: { arrow: "UP", manoeuvre: "Returning to standby", distance: 0, roadName: "Medical base" } });
    return unit;
  }
  release(id) { return this.returnAmbulanceToStandby(id); }
  resetAll() { this.list().forEach(resetUnit); }
}

function createUnit(id, type, startNode) {
  const start = startNode === "S" ? { x: -28, z: 4.2 } : { x: -28, z: -4.2 };
  return { id, type, startNode, status: "AVAILABLE", assignedIncident: null, position: { ...start, rotation: 0 }, standbyPosition: { ...start, rotation: 0 }, route: null, routeDistance: 0, completedDistance: 0, routeChanges: 0, speedMps: 0, etaSeconds: 0, instruction: null, reservedAt: null, dispatchedAt: null, startedAt: null, arrivedAt: null, handedOverAt: null, releaseAt: null, returnReadyAt: null, originalEtaSeconds: 0, arrivalProcessed: false, handoverCompleted: false, routeComplete: false };
}
function resetUnit(unit) { Object.assign(unit, createUnit(unit.id, unit.type, unit.startNode)); }
function approach(value, target, amount) { return value < target ? Math.min(target, value + amount) : Math.max(target, value - amount); }
export const unitMotionConstants = Object.freeze({ cruiseKmh: CRUISE_MPS * 3.6, turnKmh: TURN_MPS * 3.6, approachKmh: APPROACH_MPS * 3.6, arrivalThresholdMeters: ARRIVAL_THRESHOLD_METERS });
