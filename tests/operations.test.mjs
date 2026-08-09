import assert from "node:assert/strict";
import test from "node:test";
import { IncidentManager, TRIAGE_DESTINATIONS, isIncidentActive, triageDetection } from "../incident-manager.js";
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

test("released ambulances clear their assignment before becoming available", () => {
  const units = new UnitManager();
  const unit = units.assignMedical("INC-A");
  units.dispatch(unit.id);
  units.returnAmbulanceToStandby(unit.id, "INC-A");
  assert.equal(unit.status, "RETURNING_TO_BASE");
  assert.equal(unit.assignedIncident, null);
  assert.equal(unit.route, null);
  assert.deepEqual(unit.position, unit.standbyPosition);
  unit.returnReadyAt = 0;
  units.update(0);
  assert.equal(unit.status, "AVAILABLE");
  assert.equal(unit.assignedIncident, null);
});

test("incident resolution is independent from the medical responder record", () => {
  const manager = new IncidentManager(memoryStorage());
  const incident = manager.create({ state: "CONFIRMED_INCIDENT" });
  assert.equal(incident.lifecycleState, "ACTIVE");
  assert.equal(incident.medicalResponseState, "NOT_DISPATCHED");
  assert.equal(isIncidentActive(incident), true);
  const closed = manager.update(incident.id, {
    state: "CLOSED",
    lifecycleState: "RESOLVED",
    resolutionState: "RESOLVED",
    medicalResponseState: "HANDOVER_COMPLETE"
  });
  assert.equal(isIncidentActive(closed), false);
  assert.equal(manager.active().length, 0);
  assert.equal(closed.medicalResponseState, "HANDOVER_COMPLETE");
});

test("false alarms are resolved rather than left in active incidents", () => {
  const manager = new IncidentManager(memoryStorage());
  const incident = manager.create({ state: "FALSE_ALARM" });
  assert.equal(incident.resolutionState, "FALSE_ALARM");
  assert.equal(isIncidentActive(incident), false);
  assert.equal(manager.active().length, 0);
});

test("central triage assigns one destination from confidence and safety state", () => {
  assert.equal(triageDetection({ confidence: { fusion: .84 }, resolutionState: "OPEN", medicalResponseState: "NOT_DISPATCHED" }), TRIAGE_DESTINATIONS.ACTIVE);
  assert.equal(triageDetection({ confidence: { fusion: .62 }, resolutionState: "OPEN", medicalResponseState: "NOT_DISPATCHED" }), TRIAGE_DESTINATIONS.PENDING_REVIEW);
  assert.equal(triageDetection({ confidence: { fusion: .38 }, resolutionState: "OPEN", medicalResponseState: "NOT_DISPATCHED" }), TRIAGE_DESTINATIONS.DETECTION_LOG);
  assert.equal(triageDetection({ confidence: { fusion: .91 }, state: "FALSE_ALARM", resolutionState: "FALSE_ALARM" }), TRIAGE_DESTINATIONS.RESOLVED);
  assert.equal(triageDetection({ confidence: { fusion: .42 }, vulnerableRoadUser: true, resolutionState: "OPEN", medicalResponseState: "NOT_DISPATCHED" }), TRIAGE_DESTINATIONS.PENDING_REVIEW);
});

test("confidence escalation moves the same record between exclusive tabs", () => {
  const manager = new IncidentManager(memoryStorage());
  const event = manager.create({ type: "audio-anomaly", cameraIds: ["A-04"], location: "Intersection 4", confidence: { fusion: .38 } });
  assert.equal(manager.detectionLog()[0].id, event.id);
  manager.update(event.id, { confidence: { fusion: .62 } });
  assert.equal(manager.get(event.id).triageDestination, TRIAGE_DESTINATIONS.PENDING_REVIEW);
  assert.equal(manager.detectionLog().length, 0);
  manager.update(event.id, { confidence: { fusion: .84 } });
  assert.equal(manager.get(event.id).triageDestination, TRIAGE_DESTINATIONS.ACTIVE);
  assert.equal(manager.active()[0].id, event.id);
  assert.equal(manager.get(event.id).confidenceHistory.length, 3);
});

test("ten repeated low-confidence detections group quietly with evidence", () => {
  const manager = new IncidentManager(memoryStorage());
  let record;
  for (let index = 0; index < 10; index += 1) {
    record = manager.create({ type: "low-acoustic-event", cameraIds: ["A-04"], location: "Intersection 4", detectedAt: new Date(Date.UTC(2026, 7, 9, 4, 0, index / 10)).toISOString(), confidence: { fusion: .32 + index / 1000 }, evidence: { sample: index } });
  }
  assert.equal(manager.detectionLog().length, 1);
  assert.equal(record.duplicateCount, 10);
  assert.equal(record.evidence.groupedEvents.length, 9);
  assert.equal(manager.active().length, 0);
  assert.equal(manager.pendingReviews().length, 0);
});
