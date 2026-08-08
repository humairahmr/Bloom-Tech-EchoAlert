import test from "node:test";
import assert from "node:assert/strict";
import { findFastestRoute, poseAlongRoute, segmentKey } from "../navigation.js";

test("A* selects the fastest open emergency route", () => {
  const route = findFastestRoute("S", "D");
  assert.deepEqual(route.nodeIds, ["S", "W", "C", "J", "D"]);
  assert.ok(route.totalDistance > 350);
  assert.ok(route.totalTime > 0);
});

test("A* genuinely reroutes around a blocked road segment", () => {
  const blocked = new Set([segmentKey("W", "C")]);
  const route = findFastestRoute("W", "D", blocked);
  assert.deepEqual(route.nodeIds, ["W", "NW", "NE", "D"]);
  assert.ok(route.segments.every((segment) => segment.open));
  assert.ok(!route.segments.some((segment) => segment.key === segmentKey("W", "C")));
});

test("route interpolation stops exactly at the responder staging point", () => {
  const route = findFastestRoute("S", "D");
  const start = poseAlongRoute(route, 0);
  const end = poseAlongRoute(route, route.totalDistance);
  assert.deepEqual({ x: start.x, z: start.z }, { x: -28, z: 4.2 });
  assert.deepEqual({ x: end.x, z: end.z }, { x: -4.2, z: 8.2 });
});
