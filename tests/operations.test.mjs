import assert from "node:assert/strict";
import test from "node:test";
import { IncidentManager } from "../incident-manager.js";
import { UnitManager, unitMotionConstants } from "../unit-manager.js";

function memoryStorage() {
  const values = new Map();
  return { getItem: (key) => values.get(key) || null, setItem: (key, value) => values.set(key, value) };
}

test("minimised vulnerable-road-user reviews persist without resolving", () => {
  const storage = memoryStorage();
  const manager = new IncidentManager(storage);
  const incident = manager.create({ state: "AWAITING_HUMAN_DECISION", severity: "critical", vulnerableRoadUser: true, notes: "Plate requires manual confirmation", evidence: { plate: "QAB 4721" } });
  manager.minimise(incident.id, 120);
  const restored = new IncidentManager(storage).get(incident.id);
  assert.equal(restored.state, "REVIEW_MINIMISED");
  assert.equal(restored.notes, "Plate requires manual confirmation");
  assert.equal(restored.reviewScrollTop, 120);
  assert.equal(new IncidentManager(storage).pendingReviews().length, 1);
});

test("MED-02 is assigned when MED-01 is unavailable", () => {
  const units = new UnitManager();
  assert.equal(units.assignMedical("INC-A").id, "MED-01");
  assert.equal(units.assignMedical("INC-B").id, "MED-02");
  assert.equal(units.assignMedical("INC-C"), null);
});

test("urgent unit movement uses delta time and stops without overshoot", () => {
  const units = new UnitManager();
  const unit = units.assignMedical("INC-A");
  units.dispatch(unit.id);
  let elapsed = 0;
  let arrivalEvents = 0;
  while (["EN_ROUTE", "ARRIVING"].includes(unit.status) && elapsed < 120) { arrivalEvents += units.update(.05).length; elapsed += .05; }
  assert.equal(unit.status, "ON_SCENE");
  assert.equal(unit.routeDistance, unit.route.totalDistance);
  assert.equal(unit.speedMps, 0);
  assert.equal(unit.etaSeconds, 0);
  assert.equal(unit.routeComplete, true);
  assert.equal(unit.arrivalProcessed, true);
  assert.equal(arrivalEvents, 1);
  assert.equal(units.update(.05).length, 0);
  assert.ok(unitMotionConstants.cruiseKmh >= 100 && unitMotionConstants.cruiseKmh <= 120);
  assert.ok(unitMotionConstants.turnKmh >= 40 && unitMotionConstants.turnKmh <= 60);
  assert.ok(unitMotionConstants.approachKmh >= 20 && unitMotionConstants.approachKmh <= 30);
  assert.equal(unitMotionConstants.arrivalThresholdMeters, 8);
});

test("unit arrival and handover are idempotent", () => {
  const units = new UnitManager();
  const unit = units.assignMedical("INC-A");
  units.dispatch(unit.id);
  const firstArrival = units.completeArrival(unit.id, "2026-08-08T06:00:10.000Z");
  const duplicateArrival = units.completeArrival(unit.id, "2026-08-08T06:00:11.000Z");
  assert.equal(firstArrival.processed, true);
  assert.equal(duplicateArrival.processed, false);
  assert.equal(unit.arrivedAt, "2026-08-08T06:00:10.000Z");
  const firstHandover = units.completeHandover(unit.id, "2026-08-08T06:00:20.000Z");
  const duplicateHandover = units.completeHandover(unit.id, "2026-08-08T06:00:21.000Z");
  assert.equal(firstHandover.processed, true);
  assert.equal(duplicateHandover.processed, false);
  assert.equal(unit.status, "HANDOVER_COMPLETE");
  assert.equal(unit.handedOverAt, "2026-08-08T06:00:20.000Z");
});

test("arrival response data persists without clearing human review", () => {
  const storage = memoryStorage();
  const manager = new IncidentManager(storage);
  const incident = manager.create({ state: "MEDICAL_DISPATCHED_REVIEW_PENDING", reviewState: "AWAITING_HUMAN_DECISION" });
  manager.update(incident.id, {
    state: "RESPONDER_ARRIVED_REVIEW_PENDING",
    responseState: "RESPONDER_ARRIVED",
    response: { arrivalProcessed: true, assignedUnitId: "MED-01", arrivedAt: "2026-08-08T06:00:10.000Z" }
  });
  const restored = new IncidentManager(storage).get(incident.id);
  assert.equal(restored.reviewState, "AWAITING_HUMAN_DECISION");
  assert.equal(restored.responseState, "RESPONDER_ARRIVED");
  assert.equal(restored.response.arrivalProcessed, true);
  assert.equal(new IncidentManager(storage).pendingReviews().length, 1);
});

test("completed medical response can be restored for later arrival review", () => {
  const units = new UnitManager();
  const restored = units.restoreCompletedResponse({
    id: "INC-A",
    response: {
      assignedUnitId: "MED-02",
      dispatchedAt: "2026-08-08T06:00:00.000Z",
      arrivedAt: "2026-08-08T06:00:20.000Z",
      handedOverAt: "2026-08-08T06:00:30.000Z",
      originalEtaSeconds: 18,
      arrivalProcessed: true,
      handoverCompleted: true,
      distanceTravelledMeters: 620,
      routeRecalculations: 1
    }
  });
  assert.equal(restored.id, "MED-02");
  assert.equal(restored.status, "HANDOVER_COMPLETE");
  assert.equal(restored.assignedIncident, "INC-A");
  assert.equal(restored.routeDistance, restored.route.totalDistance);
  assert.equal(restored.speedMps, 0);
});
