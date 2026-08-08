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
  while (unit.status === "EN_ROUTE" && elapsed < 120) { units.update(.05); elapsed += .05; }
  assert.equal(unit.status, "ON_SCENE");
  assert.equal(unit.routeDistance, unit.route.totalDistance);
  assert.ok(unitMotionConstants.cruiseKmh >= 100 && unitMotionConstants.cruiseKmh <= 120);
  assert.ok(unitMotionConstants.turnKmh >= 40 && unitMotionConstants.turnKmh <= 60);
  assert.ok(unitMotionConstants.approachKmh >= 20 && unitMotionConstants.approachKmh <= 30);
});
