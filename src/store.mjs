import { DatabaseSync } from "node:sqlite";
import { SENSORS } from "./engine.mjs";

export class EchoAlertStore {
  constructor(databasePath = "data/echoalert.db") {
    this.database = new DatabaseSync(databasePath);
    this.database.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;");
    this.initialize();
  }

  initialize() {
    this.database.exec(`
      CREATE TABLE IF NOT EXISTS sensors (
        id TEXT PRIMARY KEY,
        x REAL NOT NULL,
        y REAL NOT NULL,
        heading REAL NOT NULL,
        online INTEGER NOT NULL DEFAULT 1,
        last_seen TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS readings (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        event_key TEXT NOT NULL,
        sensor_id TEXT NOT NULL REFERENCES sensors(id),
        arrival_ms REAL NOT NULL,
        bearing_deg REAL NOT NULL,
        snr_db REAL NOT NULL,
        centroid_hz REAL NOT NULL,
        duration_s REAL NOT NULL,
        attack REAL NOT NULL,
        captured_at TEXT NOT NULL,
        UNIQUE(event_key, sensor_id)
      );

      CREATE TABLE IF NOT EXISTS incidents (
        id TEXT PRIMARY KEY,
        event_key TEXT NOT NULL UNIQUE,
        event_type TEXT NOT NULL,
        confidence REAL NOT NULL,
        latitude REAL NOT NULL,
        longitude REAL NOT NULL,
        location TEXT NOT NULL,
        status TEXT NOT NULL,
        response TEXT NOT NULL,
        detected_at TEXT NOT NULL,
        payload_json TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS dispatches (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        incident_id TEXT NOT NULL REFERENCES incidents(id),
        unit TEXT NOT NULL,
        status TEXT NOT NULL,
        created_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS readings_event_key_idx ON readings(event_key);
      CREATE INDEX IF NOT EXISTS incidents_detected_at_idx ON incidents(detected_at DESC);
    `);

    const upsert = this.database.prepare(`
      INSERT INTO sensors (id, x, y, heading, online, last_seen)
      VALUES (?, ?, ?, ?, 1, ?)
      ON CONFLICT(id) DO UPDATE SET x = excluded.x, y = excluded.y, heading = excluded.heading
    `);
    const now = new Date().toISOString();
    SENSORS.forEach((sensor) => upsert.run(sensor.id, sensor.x, sensor.y, sensor.heading, now));
  }

  close() {
    this.database.close();
  }

  health() {
    const sensorCounts = this.database.prepare(`
      SELECT COUNT(*) AS total, SUM(CASE WHEN online = 1 THEN 1 ELSE 0 END) AS online
      FROM sensors
    `).get();
    const incidentCount = this.database.prepare("SELECT COUNT(*) AS count FROM incidents").get();
    return {
      database: "connected",
      sensors: { total: Number(sensorCounts.total), online: Number(sensorCounts.online || 0) },
      incidents: Number(incidentCount.count)
    };
  }

  listSensors() {
    return this.database.prepare(`
      SELECT id, x, y, heading, online, last_seen AS lastSeen
      FROM sensors ORDER BY id
    `).all().map((sensor) => ({ ...sensor, online: Boolean(sensor.online) }));
  }

  touchSensor(sensorId, capturedAt) {
    this.database.prepare("UPDATE sensors SET online = 1, last_seen = ? WHERE id = ?").run(capturedAt, sensorId);
  }

  saveReadings(readings) {
    const insert = this.database.prepare(`
      INSERT INTO readings (
        event_key, sensor_id, arrival_ms, bearing_deg, snr_db,
        centroid_hz, duration_s, attack, captured_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(event_key, sensor_id) DO UPDATE SET
        arrival_ms = excluded.arrival_ms,
        bearing_deg = excluded.bearing_deg,
        snr_db = excluded.snr_db,
        centroid_hz = excluded.centroid_hz,
        duration_s = excluded.duration_s,
        attack = excluded.attack,
        captured_at = excluded.captured_at
    `);

    this.database.exec("BEGIN");
    try {
      readings.forEach((reading) => {
        insert.run(
          reading.eventKey,
          reading.sensorId,
          reading.arrivalMs,
          reading.bearingDeg,
          reading.snrDb,
          reading.centroidHz,
          reading.durationS,
          reading.attack,
          reading.capturedAt || new Date().toISOString()
        );
        this.touchSensor(reading.sensorId, reading.capturedAt || new Date().toISOString());
      });
      this.database.exec("COMMIT");
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
  }

  readingsForEvent(eventKey) {
    return this.database.prepare(`
      SELECT
        event_key AS eventKey,
        sensor_id AS sensorId,
        arrival_ms AS arrivalMs,
        bearing_deg AS bearingDeg,
        snr_db AS snrDb,
        centroid_hz AS centroidHz,
        duration_s AS durationS,
        attack,
        captured_at AS capturedAt
      FROM readings WHERE event_key = ? ORDER BY arrival_ms
    `).all(eventKey);
  }

  incidentForEvent(eventKey) {
    return this.parseIncident(this.database.prepare("SELECT * FROM incidents WHERE event_key = ?").get(eventKey));
  }

  nextIncidentId(date = new Date()) {
    const dateCode = `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, "0")}${String(date.getDate()).padStart(2, "0")}`;
    const prefix = `EA-${dateCode}-`;
    const row = this.database.prepare("SELECT COUNT(*) AS count FROM incidents WHERE id LIKE ?").get(`${prefix}%`);
    return `${prefix}${String(Number(row.count) + 1).padStart(2, "0")}`;
  }

  createIncident(eventKey, fused, extras = {}) {
    const existing = this.incidentForEvent(eventKey);
    if (existing) return existing;

    const now = new Date();
    const id = this.nextIncidentId(now);
    const signature = fused.classification.signature;
    const incident = {
      id,
      eventKey,
      eventType: fused.classification.type,
      confidence: fused.classification.confidence,
      latitude: fused.estimate.latitude,
      longitude: fused.estimate.longitude,
      location: fused.location,
      status: fused.status,
      response: signature.response,
      detectedAt: now.toISOString(),
      classification: fused.classification,
      estimate: fused.estimate,
      telemetry: fused.telemetry,
      lockedCount: fused.lockedCount,
      groundTruth: extras.groundTruth || null,
      simulation: extras.simulation || null,
      dispatches: []
    };

    this.database.prepare(`
      INSERT INTO incidents (
        id, event_key, event_type, confidence, latitude, longitude,
        location, status, response, detected_at, payload_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      incident.id,
      incident.eventKey,
      incident.eventType,
      incident.confidence,
      incident.latitude,
      incident.longitude,
      incident.location,
      incident.status,
      incident.response,
      incident.detectedAt,
      JSON.stringify(incident)
    );
    return incident;
  }

  refreshIncident(id, fused, extras = {}) {
    const existing = this.getIncident(id);
    if (!existing) return null;
    const signature = fused.classification.signature;
    const incident = {
      ...existing,
      eventType: fused.classification.type,
      confidence: fused.classification.confidence,
      latitude: fused.estimate.latitude,
      longitude: fused.estimate.longitude,
      location: fused.location,
      response: signature.response,
      classification: fused.classification,
      estimate: fused.estimate,
      telemetry: fused.telemetry,
      lockedCount: fused.lockedCount,
      groundTruth: extras.groundTruth || existing.groundTruth || null,
      simulation: extras.simulation || existing.simulation || null,
      dispatches: this.dispatchesForIncident(id)
    };
    this.database.prepare(`
      UPDATE incidents SET
        event_type = ?, confidence = ?, latitude = ?, longitude = ?,
        location = ?, response = ?, payload_json = ?
      WHERE id = ?
    `).run(
      incident.eventType,
      incident.confidence,
      incident.latitude,
      incident.longitude,
      incident.location,
      incident.response,
      JSON.stringify(incident),
      id
    );
    return incident;
  }

  listIncidents(limit = 25) {
    return this.database.prepare("SELECT * FROM incidents ORDER BY detected_at DESC LIMIT ?").all(limit)
      .map((row) => this.parseIncident(row));
  }

  getIncident(id) {
    return this.parseIncident(this.database.prepare("SELECT * FROM incidents WHERE id = ?").get(id));
  }

  updateIncidentStatus(id, status, unit = null) {
    const incident = this.getIncident(id);
    if (!incident) return null;
    const timestamp = new Date().toISOString();
    if (unit) {
      this.database.prepare(`
        INSERT INTO dispatches (incident_id, unit, status, created_at)
        VALUES (?, ?, ?, ?)
      `).run(id, unit, status, timestamp);
    }

    incident.status = status;
    incident.dispatches = this.dispatchesForIncident(id);
    this.database.prepare("UPDATE incidents SET status = ?, payload_json = ? WHERE id = ?")
      .run(status, JSON.stringify(incident), id);
    return incident;
  }

  dispatchesForIncident(id) {
    return this.database.prepare(`
      SELECT id, unit, status, created_at AS createdAt
      FROM dispatches WHERE incident_id = ? ORDER BY created_at
    `).all(id);
  }

  parseIncident(row) {
    if (!row) return null;
    const incident = JSON.parse(row.payload_json);
    incident.status = row.status;
    incident.dispatches = this.dispatchesForIncident(row.id);
    return incident;
  }
}
