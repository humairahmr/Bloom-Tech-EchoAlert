import { randomUUID } from "node:crypto";

export const SPEED_OF_SOUND_M_PER_S = 343;
export const PIXELS_PER_METER = 2.2;
export const MAP_BOUNDS = Object.freeze({ minX: 55, maxX: 1145, minY: 55, maxY: 665 });

export const SENSORS = Object.freeze([
  { id: "N1", x: 170, y: 120, heading: 34 },
  { id: "N2", x: 540, y: 78, heading: 116 },
  { id: "N3", x: 1020, y: 180, heading: 198 },
  { id: "N4", x: 245, y: 585, heading: 320 },
  { id: "N5", x: 665, y: 555, heading: 255 },
  { id: "N6", x: 1050, y: 540, heading: 292 }
]);

export const SIGNATURES = Object.freeze({
  collision: {
    label: "Vehicle collision",
    confirmed: "High-impact vehicle collision",
    short: "Collision signature",
    bands: "Low boom + broadband metal scrape",
    range: "0-8 kHz",
    centroidHz: 920,
    attack: 0.91,
    durationS: 0.72,
    response: "Medical Tier 1 + traffic unit",
    dispatch: "Dispatch medical tier 1",
    vision: "Rapid deceleration detected"
  },
  glass: {
    label: "Shattering glass",
    confirmed: "High-energy glass break event",
    short: "Glass-break signature",
    bands: "Sharp 3-8 kHz fragments",
    range: "2-10 kHz",
    centroidHz: 5200,
    attack: 0.97,
    durationS: 0.33,
    response: "Police patrol + scene verification",
    dispatch: "Dispatch nearest patrol",
    vision: "Sudden pedestrian-area motion"
  },
  metal: {
    label: "Metal impact",
    confirmed: "Repeated high-energy metal impact",
    short: "Metal impact signature",
    bands: "Ringing 1-4 kHz harmonics",
    range: "0-6 kHz",
    centroidHz: 2600,
    attack: 0.88,
    durationS: 0.58,
    response: "Municipal enforcement unit",
    dispatch: "Dispatch enforcement unit",
    vision: "Industrial motion correlated"
  },
  structure: {
    label: "Structural failure",
    confirmed: "Possible structural collapse",
    short: "Collapse signature",
    bands: "Deep crack + cascading rubble",
    range: "0-4 kHz",
    centroidHz: 540,
    attack: 0.8,
    durationS: 1.32,
    response: "Fire and rescue + medical Tier 1",
    dispatch: "Dispatch fire and rescue",
    vision: "Rapid structural motion detected"
  },
  industrial: {
    label: "Illegal industrial activity",
    confirmed: "Sustained prohibited machinery",
    short: "Machinery signature",
    bands: "Impulse train + machinery hum",
    range: "0-5 kHz",
    centroidHz: 1250,
    attack: 0.67,
    durationS: 2.2,
    response: "Environmental enforcement team",
    dispatch: "Dispatch inspection team",
    vision: "After-hours site activity"
  }
});

const SENSOR_BY_ID = new Map(SENSORS.map((sensor) => [sensor.id, sensor]));

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function seededNoise(seed) {
  const value = Math.sin(seed * 999.13) * 10000;
  return (value - Math.floor(value)) - 0.5;
}

function distanceMeters(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y) / PIXELS_PER_METER;
}

function bearingDegrees(from, to) {
  return (Math.atan2(to.y - from.y, to.x - from.x) * 180 / Math.PI + 360) % 360;
}

function angularDifference(a, b) {
  return Math.abs(((a - b + 540) % 360) - 180);
}

export function coordinatesFor(point) {
  return {
    latitude: 2.2913 + (360 - point.y) * 0.0000105,
    longitude: 111.8291 + (point.x - 600) * 0.0000118
  };
}

export function locationFor(point) {
  if (point.x < 430) return "Jalan Wong King Huo, Sibu";
  if (point.x > 880) return "Jalan Tun Abang Haji Openg, Sibu";
  if (point.y < 260) return "Jalan Kampung Nyabor, Sibu";
  if (point.y > 500) return "Jalan Lanang, Sibu";
  return "Intersection 4, Jalan Awang Ramli Amit, Sibu";
}

export function simulateReadings({
  eventType = "collision",
  noiseDb = 35,
  intensityDb = 118,
  x = 720,
  y = 385,
  eventKey = randomUUID()
} = {}) {
  const signature = SIGNATURES[eventType];
  if (!signature) throw new Error(`Unknown event type: ${eventType}`);

  const event = {
    x: clamp(Number(x), MAP_BOUNDS.minX, MAP_BOUNDS.maxX),
    y: clamp(Number(y), MAP_BOUNDS.minY, MAP_BOUNDS.maxY)
  };
  const noise = clamp(Number(noiseDb), 20, 85);
  const intensity = clamp(Number(intensityDb), 85, 145);

  const readings = SENSORS.map((sensor, index) => {
    const distance = distanceMeters(sensor, event);
    const cleanArrivalMs = distance / SPEED_OF_SOUND_M_PER_S * 1000;
    const timingNoiseMs = seededNoise(index + noise + intensity + event.x * 0.03) * (0.34 + noise / 155);
    const bearing = bearingDegrees(sensor, event);
    const directionPenalty = angularDifference(sensor.heading, bearing) / 150;
    const snrDb = Math.max(3, intensity - noise - distance * 0.085 - directionPenalty * 8);
    const featureNoise = seededNoise(index * 7.1 + event.y + intensity);

    return {
      eventKey,
      sensorId: sensor.id,
      arrivalMs: cleanArrivalMs + timingNoiseMs,
      bearingDeg: bearing,
      snrDb,
      centroidHz: signature.centroidHz * (1 + featureNoise * 0.055),
      durationS: signature.durationS * (1 + featureNoise * 0.08),
      attack: clamp(signature.attack + featureNoise * 0.035, 0, 1),
      capturedAt: new Date().toISOString()
    };
  });

  return {
    eventKey,
    requestedType: eventType,
    noiseDb: noise,
    intensityDb: intensity,
    groundTruth: event,
    readings
  };
}

export function classifyReadings(readings) {
  if (!Array.isArray(readings) || readings.length < 3) {
    throw new Error("At least three readings are required for classification");
  }

  const features = readings.reduce((result, reading) => ({
    centroidHz: result.centroidHz + Number(reading.centroidHz),
    durationS: result.durationS + Number(reading.durationS),
    attack: result.attack + Number(reading.attack),
    snrDb: result.snrDb + Number(reading.snrDb)
  }), { centroidHz: 0, durationS: 0, attack: 0, snrDb: 0 });

  Object.keys(features).forEach((key) => { features[key] /= readings.length; });

  const ranked = Object.entries(SIGNATURES).map(([type, signature]) => {
    const centroidDistance = Math.abs(Math.log((features.centroidHz + 1) / (signature.centroidHz + 1))) / 1.7;
    const durationDistance = Math.abs(features.durationS - signature.durationS) / Math.max(0.3, signature.durationS);
    const attackDistance = Math.abs(features.attack - signature.attack) / 0.35;
    const distance = centroidDistance * 0.52 + durationDistance * 0.3 + attackDistance * 0.18;
    return { type, signature, distance, score: Math.exp(-distance * 2.4) };
  }).sort((a, b) => b.score - a.score);

  const best = ranked[0];
  const margin = best.score - ranked[1].score;
  const confidence = clamp(0.58 + best.score * 0.22 + margin * 0.22 + features.snrDb / 420, 0.45, 0.995);
  return {
    type: best.type,
    signature: best.signature,
    confidence,
    averageSnrDb: features.snrDb,
    features: {
      centroidHz: features.centroidHz,
      durationS: features.durationS,
      attack: features.attack
    },
    candidates: ranked.map(({ type, score }) => ({ type, score }))
  };
}

export function triangulateReadings(readings) {
  if (!Array.isArray(readings) || readings.length < 3) {
    throw new Error("At least three readings are required for triangulation");
  }

  const telemetry = readings.map((reading) => {
    const sensor = SENSOR_BY_ID.get(reading.sensorId);
    if (!sensor) throw new Error(`Unknown sensor: ${reading.sensorId}`);
    return { ...reading, ...sensor, arrivalMs: Number(reading.arrivalMs) };
  }).sort((a, b) => a.arrivalMs - b.arrivalMs);
  const reference = telemetry[0];
  let best = { x: 600, y: 360, residualMs: Number.POSITIVE_INFINITY };

  for (let y = MAP_BOUNDS.minY; y <= MAP_BOUNDS.maxY; y += 11) {
    for (let x = MAP_BOUNDS.minX; x <= MAP_BOUNDS.maxX; x += 11) {
      const residualMs = tdoaResidual({ x, y }, telemetry, reference);
      if (residualMs < best.residualMs) best = { x, y, residualMs };
    }
  }

  for (let step = 5.5; step >= 0.2; step /= 2) {
    let improved = true;
    while (improved) {
      improved = false;
      [[0,-step],[step,0],[0,step],[-step,0],[step,-step],[step,step],[-step,step],[-step,-step]].forEach(([dx, dy]) => {
        const candidate = {
          x: clamp(best.x + dx, MAP_BOUNDS.minX, MAP_BOUNDS.maxX),
          y: clamp(best.y + dy, MAP_BOUNDS.minY, MAP_BOUNDS.maxY)
        };
        const residualMs = tdoaResidual(candidate, telemetry, reference);
        if (residualMs < best.residualMs) {
          best = { ...candidate, residualMs };
          improved = true;
        }
      });
    }
  }

  return { ...best, coordinates: coordinatesFor(best), telemetry };
}

function tdoaResidual(point, telemetry, reference) {
  const referenceDistance = distanceMeters(reference, point);
  return telemetry.slice(1).reduce((sum, node) => {
    const predictedMs = (distanceMeters(node, point) - referenceDistance) / SPEED_OF_SOUND_M_PER_S * 1000;
    const observedMs = node.arrivalMs - reference.arrivalMs;
    return sum + Math.abs(predictedMs - observedMs);
  }, 0);
}

export function fuseReadings(readings, groundTruth = null) {
  const classification = classifyReadings(readings);
  const estimate = triangulateReadings(readings);
  const errorM = groundTruth ? distanceMeters(groundTruth, estimate) : null;
  const lockedCount = estimate.telemetry.filter((reading) => Number(reading.snrDb) > 24).length;
  const status = classification.confidence >= 0.72 && lockedCount >= 4 ? "confirmed" : "review";

  return {
    classification,
    estimate: {
      x: estimate.x,
      y: estimate.y,
      latitude: estimate.coordinates.latitude,
      longitude: estimate.coordinates.longitude,
      residualMs: estimate.residualMs,
      errorM
    },
    telemetry: estimate.telemetry.map((reading) => ({
      sensorId: reading.sensorId,
      arrivalMs: reading.arrivalMs,
      bearingDeg: Number(reading.bearingDeg),
      snrDb: Number(reading.snrDb),
      centroidHz: Number(reading.centroidHz),
      durationS: Number(reading.durationS),
      attack: Number(reading.attack),
      status: Number(reading.snrDb) > 24 ? "locked" : "weak"
    })),
    lockedCount,
    status,
    location: locationFor(estimate)
  };
}
