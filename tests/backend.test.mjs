import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { createEchoAlertServer } from "../server.mjs";
import { fuseReadings, SIGNATURES, simulateReadings } from "../src/engine.mjs";

describe("acoustic fusion engine", () => {
  test("classifies every simulated signature from acoustic features", () => {
    Object.keys(SIGNATURES).forEach((eventType, index) => {
      const simulation = simulateReadings({ eventType, noiseDb: 38, intensityDb: 124, x: 420 + index * 95, y: 310 });
      const fused = fuseReadings(simulation.readings, simulation.groundTruth);
      assert.equal(fused.classification.type, eventType);
      assert.ok(fused.classification.confidence > 0.8);
    });
  });

  test("localizes a six-node event within two meters under normal noise", () => {
    const simulation = simulateReadings({ eventType: "collision", noiseDb: 45, intensityDb: 118, x: 845, y: 470 });
    const fused = fuseReadings(simulation.readings, simulation.groundTruth);
    assert.ok(fused.estimate.errorM < 2, `Expected <2 m, received ${fused.estimate.errorM} m`);
    assert.equal(fused.lockedCount, 6);
  });
});

describe("EchoAlert API", () => {
  let server;
  let baseUrl;

  before(async () => {
    server = await createEchoAlertServer({ databasePath: ":memory:" });
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    baseUrl = `http://127.0.0.1:${server.address().port}`;
  });

  after(async () => {
    await new Promise((resolve) => server.close(resolve));
  });

  test("reports database and sensor health", async () => {
    const response = await fetch(`${baseUrl}/api/health`);
    const body = await response.json();
    assert.equal(response.status, 200);
    assert.equal(body.status, "ok");
    assert.equal(body.database, "connected");
    assert.deepEqual(body.sensors, { total: 6, online: 6 });

    const privateFileResponse = await fetch(`${baseUrl}/server.mjs`);
    assert.equal(privateFileResponse.status, 404);

    const sceneModuleResponse = await fetch(`${baseUrl}/scene3d.js`);
    const navigationModuleResponse = await fetch(`${baseUrl}/navigation.js`);
    const threeModuleResponse = await fetch(`${baseUrl}/vendor/three.module.js`);
    const threeCoreResponse = await fetch(`${baseUrl}/vendor/three.core.js`);
    assert.equal(sceneModuleResponse.status, 200);
    assert.equal(navigationModuleResponse.status, 200);
    assert.equal(threeModuleResponse.status, 200);
    assert.equal(threeCoreResponse.status, 200);
  });

  test("runs, persists, retrieves, and dispatches a simulation", async () => {
    const simulationResponse = await fetch(`${baseUrl}/api/simulations`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ eventType: "structure", noiseDb: 55, intensityDb: 130, x: 780, y: 430 })
    });
    const simulationBody = await simulationResponse.json();
    assert.equal(simulationResponse.status, 201);
    assert.equal(simulationBody.state, "fused");
    assert.equal(simulationBody.incident.eventType, "structure");
    assert.equal(simulationBody.incident.telemetry.length, 6);

    const incidentsResponse = await fetch(`${baseUrl}/api/incidents`);
    const incidentsBody = await incidentsResponse.json();
    assert.equal(incidentsBody.incidents.length, 1);

    const id = simulationBody.incident.id;
    const dispatchResponse = await fetch(`${baseUrl}/api/incidents/${encodeURIComponent(id)}/dispatch`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ unit: "Fire and Rescue Test Unit" })
    });
    const dispatchBody = await dispatchResponse.json();
    assert.equal(dispatchResponse.status, 200);
    assert.equal(dispatchBody.incident.status, "dispatched");
    assert.equal(dispatchBody.incident.dispatches[0].unit, "Fire and Rescue Test Unit");
  });

  test("fuses individual sensor uploads after four unique nodes", async () => {
    const simulation = simulateReadings({ eventType: "glass", eventKey: "manual-node-upload", x: 510, y: 240 });
    const firstResponse = await fetch(`${baseUrl}/api/sensor-readings`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ eventKey: simulation.eventKey, readings: simulation.readings.slice(0, 3) })
    });
    const firstBody = await firstResponse.json();
    assert.equal(firstResponse.status, 202);
    assert.equal(firstBody.state, "collecting");
    assert.equal(firstBody.received, 3);

    const secondResponse = await fetch(`${baseUrl}/api/sensor-readings`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ eventKey: simulation.eventKey, reading: simulation.readings[3] })
    });
    const secondBody = await secondResponse.json();
    assert.equal(secondResponse.status, 202);
    assert.equal(secondBody.state, "fused");
    assert.equal(secondBody.incident.eventType, "glass");
    assert.equal(secondBody.incident.telemetry.length, 4);

    const finalResponse = await fetch(`${baseUrl}/api/sensor-readings`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ eventKey: simulation.eventKey, readings: simulation.readings.slice(4) })
    });
    const finalBody = await finalResponse.json();
    assert.equal(finalBody.incident.id, secondBody.incident.id);
    assert.equal(finalBody.incident.telemetry.length, 6);
  });
});
