import { findFastestRoute, navigationInstruction, poseAlongRoute, prependCurrentPosition } from "./navigation.js";

const CRUISE_MPS = 30.5;
const TURN_MPS = 14.5;
const APPROACH_MPS = 7.5;

export class UnitManager {
  constructor() {
    this.units = new Map([
      ["MED-01", createUnit("MED-01", "medical", "S")],
      ["MED-02", createUnit("MED-02", "medical", "S2")],
      ["POLICE-01", createUnit("POLICE-01", "police", "S2")]
    ]);
  }

  list() { return [...this.units.values()]; }
  get(id) { return this.units.get(id) || null; }

  assignMedical(incidentId, blocked = new Set()) {
    const unit = this.list().find((candidate) => candidate.type === "medical" && candidate.status === "AVAILABLE");
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
      startedAt: new Date().toISOString(),
      arrivedAt: null,
      instruction: { arrow: "UP", manoeuvre: "Route calculating", distance: route.totalDistance, roadName: route.segments[0]?.roadName || "Emergency network" }
    });
    Object.assign(unit.position, poseAlongRoute(route, 0));
    return unit;
  }

  assignPolice(incidentId) {
    const unit = this.get("POLICE-01");
    if (!unit || unit.status !== "AVAILABLE") return null;
    unit.status = "RESERVED";
    unit.assignedIncident = incidentId;
    return unit;
  }

  dispatch(id) {
    const unit = this.get(id);
    if (unit?.status === "RESERVED") unit.status = "EN_ROUTE";
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
    this.list().filter((unit) => unit.status === "EN_ROUTE").forEach((unit) => {
      const before = poseAlongRoute(unit.route, unit.routeDistance);
      const remaining = Math.max(0, unit.route.totalDistance - unit.routeDistance);
      const segment = unit.route.segments[before.segmentIndex];
      const distanceToTurn = Math.max(0, segment.endDistance - unit.routeDistance);
      const turnAhead = before.segmentIndex < unit.route.segments.length - 1 && distanceToTurn < 70;
      const target = remaining < 70 ? APPROACH_MPS : turnAhead ? TURN_MPS : CRUISE_MPS;
      unit.speedMps = approach(unit.speedMps, target, (target > unit.speedMps ? 8.5 : 12.5) * delta);
      unit.routeDistance = Math.min(unit.route.totalDistance, unit.routeDistance + unit.speedMps * delta);
      const pose = poseAlongRoute(unit.route, unit.routeDistance);
      Object.assign(unit.position, pose);
      const nextRemaining = Math.max(0, unit.route.totalDistance - unit.routeDistance);
      unit.etaSeconds = Math.ceil(nextRemaining / Math.max(APPROACH_MPS, unit.speedMps));
      unit.instruction = navigationInstruction(unit.route, pose, nextRemaining);
      if (nextRemaining <= 0) {
        unit.status = "ON_SCENE";
        unit.speedMps = 0;
        unit.etaSeconds = 0;
        unit.arrivedAt = new Date().toISOString();
        arrivals.push(unit);
      }
    });
    return arrivals;
  }

  releaseIncident(incidentId) {
    this.list().filter((unit) => unit.assignedIncident === incidentId).forEach(resetUnit);
  }
  resetAll() { this.list().forEach(resetUnit); }
}

function createUnit(id, type, startNode) {
  const start = startNode === "S" ? { x: -28, z: 4.2 } : { x: -28, z: -4.2 };
  return { id, type, startNode, status: "AVAILABLE", assignedIncident: null, position: { ...start, rotation: 0 }, route: null, routeDistance: 0, completedDistance: 0, routeChanges: 0, speedMps: 0, etaSeconds: 0, instruction: null, startedAt: null, arrivedAt: null };
}
function resetUnit(unit) { Object.assign(unit, createUnit(unit.id, unit.type, unit.startNode)); }
function approach(value, target, amount) { return value < target ? Math.min(target, value + amount) : Math.max(target, value - amount); }
export const unitMotionConstants = Object.freeze({ cruiseKmh: CRUISE_MPS * 3.6, turnKmh: TURN_MPS * 3.6, approachKmh: APPROACH_MPS * 3.6 });
