import { setTimeout as delay } from "node:timers/promises";
import { SIGNATURES, simulateReadings } from "../src/engine.mjs";

const eventType = process.argv[2] || "collision";
const baseUrl = process.env.ECHOALERT_URL || "http://127.0.0.1:4173";

if (!SIGNATURES[eventType]) {
  console.error(`Unknown event type: ${eventType}`);
  console.error(`Choose one of: ${Object.keys(SIGNATURES).join(", ")}`);
  process.exit(1);
}

const simulation = simulateReadings({
  eventType,
  noiseDb: 35 + Math.round(Math.random() * 25),
  intensityDb: 112 + Math.round(Math.random() * 20),
  x: 140 + Math.random() * 900,
  y: 100 + Math.random() * 500
});

console.log(`Emitting ${eventType} event ${simulation.eventKey}`);
for (const reading of simulation.readings) {
  const response = await fetch(`${baseUrl}/api/sensor-readings`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ eventKey: simulation.eventKey, reading })
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || `Upload failed with ${response.status}`);
  console.log(`${reading.sensorId}: ${result.state} (${result.received} node${result.received === 1 ? "" : "s"})`);
  if (result.incident) {
    console.log(`Incident ${result.incident.id}: ${result.incident.classification.signature.label}`);
    console.log(`Estimate: ${result.incident.latitude.toFixed(4)}, ${result.incident.longitude.toFixed(4)}`);
  }
  await delay(120);
}
