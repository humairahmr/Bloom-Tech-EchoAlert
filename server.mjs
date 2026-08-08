import { createServer } from "node:http";
import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { EchoAlertStore } from "./src/store.mjs";
import { fuseReadings, SENSORS, SIGNATURES, simulateReadings } from "./src/engine.mjs";

const root = path.dirname(fileURLToPath(import.meta.url));
const contentTypes = new Map([
  [".html", "text/html; charset=utf-8"],
  [".css", "text/css; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".mjs", "text/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".png", "image/png"],
  [".jpg", "image/jpeg"],
  [".jpeg", "image/jpeg"],
  [".svg", "image/svg+xml"]
]);

const sensorIds = new Set(SENSORS.map((sensor) => sensor.id));

function securityHeaders(extra = {}) {
  return {
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "SAMEORIGIN",
    "Referrer-Policy": "no-referrer",
    ...extra
  };
}

function sendJson(response, status, body) {
  response.writeHead(status, securityHeaders({ "Content-Type": "application/json; charset=utf-8" }));
  response.end(JSON.stringify(body));
}

async function readJson(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > 1_000_000) throw Object.assign(new Error("Request body exceeds 1 MB"), { statusCode: 413 });
    chunks.push(chunk);
  }
  if (chunks.length === 0) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw Object.assign(new Error("Request body must be valid JSON"), { statusCode: 400 });
  }
}

function validateReadings(input) {
  const readings = Array.isArray(input.readings) ? input.readings : input.reading ? [input.reading] : [];
  if (readings.length === 0) throw Object.assign(new Error("Provide reading or readings"), { statusCode: 400 });
  const eventKey = String(input.eventKey || readings[0]?.eventKey || "").trim();
  if (!eventKey || eventKey.length > 120) throw Object.assign(new Error("A valid eventKey is required"), { statusCode: 400 });

  return readings.map((reading) => {
    const sensorId = String(reading.sensorId || "");
    if (!sensorIds.has(sensorId)) throw Object.assign(new Error(`Unknown sensor: ${sensorId}`), { statusCode: 400 });
    const normalized = {
      eventKey,
      sensorId,
      arrivalMs: Number(reading.arrivalMs),
      bearingDeg: Number(reading.bearingDeg),
      snrDb: Number(reading.snrDb),
      centroidHz: Number(reading.centroidHz),
      durationS: Number(reading.durationS),
      attack: Number(reading.attack),
      capturedAt: reading.capturedAt || new Date().toISOString()
    };
    const numericFields = ["arrivalMs", "bearingDeg", "snrDb", "centroidHz", "durationS", "attack"];
    if (numericFields.some((field) => !Number.isFinite(normalized[field]))) {
      throw Object.assign(new Error(`Reading from ${sensorId} contains an invalid numeric value`), { statusCode: 400 });
    }
    return normalized;
  });
}

export async function createEchoAlertServer({ databasePath = path.join(root, "data", "echoalert.db") } = {}) {
  if (databasePath !== ":memory:") await mkdir(path.dirname(databasePath), { recursive: true });
  const store = new EchoAlertStore(databasePath);
  const eventClients = new Set();
  const startedAt = Date.now();

  function broadcast(type, payload) {
    const message = `event: ${type}\ndata: ${JSON.stringify(payload)}\n\n`;
    eventClients.forEach((client) => client.write(message));
  }

  function processReadings(readings, extras = {}) {
    store.saveReadings(readings);
    const eventKey = readings[0].eventKey;
    const accumulated = store.readingsForEvent(eventKey);
    const existing = store.incidentForEvent(eventKey);
    if (existing) {
      if (accumulated.length > existing.telemetry.length) {
        const refined = store.refreshIncident(existing.id, fuseReadings(accumulated, extras.groundTruth || null), extras);
        broadcast("incident-updated", refined);
        return { state: "fused", incident: refined, received: accumulated.length };
      }
      return { state: "fused", incident: existing, received: accumulated.length };
    }
    if (accumulated.length < 4) {
      const pending = { state: "collecting", eventKey, received: accumulated.length, required: 4 };
      broadcast("reading-progress", pending);
      return pending;
    }

    const fused = fuseReadings(accumulated, extras.groundTruth || null);
    const incident = store.createIncident(eventKey, fused, extras);
    broadcast("incident", incident);
    return { state: "fused", incident, received: accumulated.length };
  }

  const server = createServer(async (request, response) => {
    const url = new URL(request.url || "/", "http://127.0.0.1");
    const pathname = url.pathname;

    try {
      if (request.method === "GET" && pathname === "/api/health") {
        sendJson(response, 200, {
          status: "ok",
          service: "echoalert-api",
          uptimeSeconds: Math.round((Date.now() - startedAt) / 1000),
          liveClients: eventClients.size,
          ...store.health()
        });
        return;
      }

      if (request.method === "GET" && pathname === "/api/config") {
        sendJson(response, 200, { sensors: SENSORS, signatures: SIGNATURES, minimumNodes: 4 });
        return;
      }

      if (request.method === "GET" && pathname === "/api/sensors") {
        sendJson(response, 200, { sensors: store.listSensors() });
        return;
      }

      if (request.method === "GET" && pathname === "/api/incidents") {
        const limit = Math.max(1, Math.min(100, Number(url.searchParams.get("limit")) || 25));
        sendJson(response, 200, { incidents: store.listIncidents(limit) });
        return;
      }

      if (request.method === "GET" && pathname === "/api/events") {
        response.writeHead(200, securityHeaders({
          "Content-Type": "text/event-stream",
          Connection: "keep-alive",
          "Cache-Control": "no-cache"
        }));
        response.write(`event: connected\ndata: ${JSON.stringify({ connectedAt: new Date().toISOString() })}\n\n`);
        eventClients.add(response);
        request.on("close", () => eventClients.delete(response));
        return;
      }

      if (request.method === "POST" && pathname === "/api/simulations") {
        const body = await readJson(request);
        const simulation = simulateReadings({
          eventType: body.eventType,
          noiseDb: body.noiseDb,
          intensityDb: body.intensityDb,
          x: body.x,
          y: body.y
        });
        const result = processReadings(simulation.readings, {
          groundTruth: simulation.groundTruth,
          simulation: {
            requestedType: simulation.requestedType,
            noiseDb: simulation.noiseDb,
            intensityDb: simulation.intensityDb
          }
        });
        sendJson(response, 201, result);
        return;
      }

      if (request.method === "POST" && pathname === "/api/sensor-readings") {
        const body = await readJson(request);
        const readings = validateReadings(body);
        sendJson(response, 202, processReadings(readings));
        return;
      }

      const incidentMatch = pathname.match(/^\/api\/incidents\/([^/]+)$/);
      if (request.method === "GET" && incidentMatch) {
        const incident = store.getIncident(decodeURIComponent(incidentMatch[1]));
        if (!incident) return sendJson(response, 404, { error: "Incident not found" });
        sendJson(response, 200, { incident });
        return;
      }

      const actionMatch = pathname.match(/^\/api\/incidents\/([^/]+)\/(dispatch|review)$/);
      if (request.method === "POST" && actionMatch) {
        const id = decodeURIComponent(actionMatch[1]);
        const action = actionMatch[2];
        const body = await readJson(request);
        const unit = action === "dispatch" ? String(body.unit || "Recommended response unit") : null;
        const incident = store.updateIncidentStatus(id, action === "dispatch" ? "dispatched" : "review", unit);
        if (!incident) return sendJson(response, 404, { error: "Incident not found" });
        broadcast("incident-updated", incident);
        sendJson(response, 200, { incident });
        return;
      }

      if (pathname.startsWith("/api/")) {
        sendJson(response, 404, { error: "API route not found" });
        return;
      }

      if (request.method !== "GET" && request.method !== "HEAD") {
        sendJson(response, 405, { error: "Method not allowed" });
        return;
      }

      const threeBuildFiles = new Map([
        ["/vendor/three.module.js", "three.module.js"],
        ["/vendor/three.core.js", "three.core.js"]
      ]);
      if (threeBuildFiles.has(pathname)) {
        const threeModule = await readFile(path.join(root, "node_modules", "three", "build", threeBuildFiles.get(pathname)));
        response.writeHead(200, securityHeaders({
          "Content-Type": "text/javascript; charset=utf-8",
          "Cache-Control": "public, max-age=86400"
        }));
        if (request.method === "HEAD") response.end();
        else response.end(threeModule);
        return;
      }

      const publicFile = pathname === "/" || pathname === "/index.html" || pathname === "/styles.css" || pathname === "/app.js" || pathname === "/scene3d.js" || pathname === "/navigation.js" || pathname.startsWith("/assets/");
      if (!publicFile) {
        sendJson(response, 404, { error: "Not found" });
        return;
      }
      const requestPath = pathname === "/" ? "/index.html" : decodeURIComponent(pathname);
      const filePath = path.resolve(root, `.${requestPath}`);
      if (filePath !== root && !filePath.startsWith(`${root}${path.sep}`)) {
        sendJson(response, 403, { error: "Forbidden" });
        return;
      }
      const body = await readFile(filePath);
      response.writeHead(200, securityHeaders({
        "Content-Type": contentTypes.get(path.extname(filePath).toLowerCase()) || "application/octet-stream",
        "Cache-Control": "no-store"
      }));
      if (request.method === "HEAD") response.end();
      else response.end(body);
    } catch (error) {
      const status = error.code === "ENOENT" ? 404 : error.statusCode || 500;
      sendJson(response, status, { error: status === 500 ? "Internal server error" : error.message });
      if (status === 500) console.error(error);
    }
  });

  server.echoAlertStore = store;
  server.on("close", () => {
    eventClients.forEach((client) => client.end());
    store.close();
  });
  return server;
}

async function start() {
  const host = process.env.HOST || "127.0.0.1";
  const port = Number(process.env.PORT || 4173);
  const server = await createEchoAlertServer();
  server.listen(port, host, () => {
    console.log(`EchoAlert API and dashboard running at http://${host}:${port}`);
  });

  const shutdown = () => server.close(() => process.exit(0));
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
if (isMain) start();
