const SPEED_OF_SOUND_M_PER_S = 343;
const PIXELS_PER_METER = 2.2;
const MAP_BOUNDS = { minX: 55, maxX: 1145, minY: 55, maxY: 665 };

const sensors = [
  { id: "N1", x: 170, y: 120, heading: 34 },
  { id: "N2", x: 540, y: 78, heading: 116 },
  { id: "N3", x: 1020, y: 180, heading: 198 },
  { id: "N4", x: 245, y: 585, heading: 320 },
  { id: "N5", x: 665, y: 555, heading: 255 },
  { id: "N6", x: 1050, y: 540, heading: 292 }
];

const signatures = {
  collision: {
    label: "Vehicle collision",
    confirmed: "High-impact vehicle collision",
    short: "Collision signature",
    bands: "Low boom + broadband metal scrape",
    range: "0-8 kHz",
    centroid: 920,
    duration: 0.72,
    confidenceBase: 0.91,
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
    centroid: 5200,
    duration: 0.33,
    confidenceBase: 0.94,
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
    centroid: 2600,
    duration: 0.58,
    confidenceBase: 0.87,
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
    centroid: 540,
    duration: 1.32,
    confidenceBase: 0.86,
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
    centroid: 1250,
    duration: 2.2,
    confidenceBase: 0.82,
    response: "Environmental enforcement team",
    dispatch: "Dispatch inspection team",
    vision: "After-hours site activity"
  }
};

const state = {
  event: { x: 720, y: 385 },
  lastResult: null,
  incidentSequence: 1,
  zoom: 1,
  dispatched: false
};

const map = document.getElementById("city-map");
const districtLayer = document.getElementById("district-layer");
const roadLayer = document.getElementById("road-layer");
const mapLabelLayer = document.getElementById("map-label-layer");
const sensorLayer = document.getElementById("sensor-layer");
const waveLayer = document.getElementById("wave-layer");
const bearingLayer = document.getElementById("bearing-layer");
const resultLayer = document.getElementById("result-layer");
const telemetryBody = document.getElementById("telemetry-body");
const incidentPanel = document.getElementById("incident-panel");

const controls = {
  type: document.getElementById("event-type"),
  noise: document.getElementById("noise-level"),
  energy: document.getElementById("event-energy"),
  simulate: document.getElementById("simulate-btn"),
  randomize: document.getElementById("randomize-btn"),
  dispatch: document.getElementById("dispatch-btn"),
  review: document.getElementById("review-btn"),
  close: document.getElementById("close-panel"),
  play: document.getElementById("play-evidence"),
  zoomIn: document.getElementById("zoom-in"),
  zoomOut: document.getElementById("zoom-out"),
  recenter: document.getElementById("recenter")
};

const labels = {
  noise: document.getElementById("noise-readout"),
  energy: document.getElementById("energy-readout"),
  classification: document.getElementById("classification-label"),
  confidence: document.getElementById("confidence-label"),
  signature: document.getElementById("signature-text"),
  signatureBand: document.getElementById("signature-band"),
  snr: document.getElementById("snr-summary"),
  estimate: document.getElementById("estimate-label"),
  error: document.getElementById("error-label"),
  firstNode: document.getElementById("first-node"),
  lockedCount: document.getElementById("locked-count"),
  skew: document.getElementById("clock-skew"),
  loss: document.getElementById("packet-loss"),
  incidentId: document.getElementById("incident-id"),
  location: document.getElementById("location-label"),
  coordinate: document.getElementById("coordinate-label"),
  timestamp: document.getElementById("timestamp-label"),
  cameraTime: document.getElementById("camera-time"),
  confirmedEvent: document.getElementById("confirmed-event"),
  response: document.getElementById("response-label"),
  dispatch: document.getElementById("dispatch-label"),
  dispatchNote: document.getElementById("dispatch-note"),
  vision: document.getElementById("vision-label"),
  visionScore: document.getElementById("vision-score"),
  incidentStatus: document.getElementById("incident-status"),
  fusionState: document.getElementById("fusion-state")
};

function svgEl(tag, attributes = {}) {
  const element = document.createElementNS("http://www.w3.org/2000/svg", tag);
  Object.entries(attributes).forEach(([key, value]) => element.setAttribute(key, value));
  return element;
}

function drawMapBase() {
  const districts = [
    "M36 40 H370 L350 245 L75 300 L30 190 Z",
    "M390 30 H790 L820 230 L565 290 L350 245 Z",
    "M810 35 H1170 V265 L820 230 Z",
    "M48 320 L370 270 L555 315 L510 680 H35 Z",
    "M575 305 L835 250 L1165 290 L1165 685 H530 Z"
  ];
  districts.forEach((d) => districtLayer.appendChild(svgEl("path", { d, class: "district-shape" })));

  roadLayer.append(
    svgEl("path", { d: "M-20 515 C200 455 405 485 590 400 S920 245 1220 278", class: "waterway" }),
    svgEl("path", { d: "M-20 487 C210 430 410 455 580 375 S925 220 1220 250", class: "waterway-edge" }),
    svgEl("path", { d: "M-20 543 C190 485 405 515 605 425 S930 275 1220 306", class: "waterway-edge" })
  );

  const arterials = [
    "M52 190 C260 168 430 207 615 182 S935 155 1175 95",
    "M100 605 C295 530 455 545 650 455 S980 380 1165 410",
    "M310 25 C300 170 352 292 335 424 S320 610 390 705",
    "M780 18 C710 175 775 296 730 430 S725 605 805 720"
  ];
  arterials.forEach((d) => {
    roadLayer.appendChild(svgEl("path", { d, class: "road arterial" }));
    roadLayer.appendChild(svgEl("path", { d, class: "road-center" }));
  });

  const minors = [
    "M85 80 L280 260 L510 95 L700 300 L945 88 L1125 240",
    "M95 360 L280 325 L465 395 L650 300 L860 340 L1100 310",
    "M120 655 L220 420 L440 300 L570 70",
    "M430 690 L520 500 L620 335 L660 70",
    "M880 690 L900 475 L1050 330 L1090 70",
    "M40 250 L210 260 L410 220 L620 255 L835 200 L1180 205",
    "M120 130 L155 420 L280 610",
    "M980 55 L940 260 L1010 475 L1140 620"
  ];
  minors.forEach((d) => roadLayer.appendChild(svgEl("path", { d, class: "road minor" })));

  addMapLabel("Sibu", 590, 390, true);
  addMapLabel("Jalan Awang Ramli Amit", 690, 325, false);
  addMapLabel("Rajang River", 455, 510, false);
  addMapLabel("Pekan Sibu", 870, 155, false);
}

function addMapLabel(text, x, y, major) {
  const label = svgEl("text", { x, y, class: major ? "map-label-major" : "map-label-svg" });
  label.textContent = text;
  mapLabelLayer.appendChild(label);
}

function drawSensors() {
  sensorLayer.innerHTML = "";
  sensors.forEach((sensor) => {
    const group = svgEl("g", { "aria-label": `Sensor ${sensor.id}` });
    group.append(
      svgEl("path", { class: "sensor-coverage", d: directionalWedge(sensor.x, sensor.y, sensor.heading, 112, 37) }),
      svgEl("circle", { class: "sensor-ring", cx: sensor.x, cy: sensor.y, r: 14 }),
      svgEl("circle", { class: "sensor", cx: sensor.x, cy: sensor.y, r: 5 })
    );
    const label = svgEl("text", { class: "sensor-label", x: sensor.x + 12, y: sensor.y - 10 });
    label.textContent = sensor.id;
    group.appendChild(label);
    sensorLayer.appendChild(group);
  });
}

function directionalWedge(x, y, heading, radius, spread) {
  const a1 = ((heading - spread) * Math.PI) / 180;
  const a2 = ((heading + spread) * Math.PI) / 180;
  const p1 = [x + Math.cos(a1) * radius, y + Math.sin(a1) * radius];
  const p2 = [x + Math.cos(a2) * radius, y + Math.sin(a2) * radius];
  return `M ${x} ${y} L ${p1[0]} ${p1[1]} A ${radius} ${radius} 0 0 1 ${p2[0]} ${p2[1]} Z`;
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

function seededNoise(seed) {
  const value = Math.sin(seed * 999.13) * 10000;
  return (value - Math.floor(value)) - 0.5;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function computeTelemetry() {
  const noise = Number(controls.noise.value);
  const energy = Number(controls.energy.value);
  const skewMs = 0.8 + noise / 42;
  labels.skew.textContent = skewMs.toFixed(1);
  labels.loss.textContent = noise > 76 ? "4" : noise > 64 ? "1" : "0";

  return sensors.map((sensor, index) => {
    const distance = distanceMeters(sensor, state.event);
    const cleanArrival = distance / SPEED_OF_SOUND_M_PER_S;
    const timingNoise = seededNoise(index + noise + energy) * (0.00035 + noise / 155000);
    const bearing = bearingDegrees(sensor, state.event);
    const directionPenalty = angularDifference(sensor.heading, bearing) / 150;
    const snr = Math.max(3, energy - noise - distance * 0.085 - directionPenalty * 8);
    return { ...sensor, distance, bearing, arrival: cleanArrival + timingNoise, snr };
  }).sort((a, b) => a.arrival - b.arrival);
}

function classifyEvent(type, telemetry) {
  const signature = signatures[type];
  const noise = Number(controls.noise.value);
  const energy = Number(controls.energy.value);
  const avgSnr = telemetry.reduce((sum, node) => sum + node.snr, 0) / telemetry.length;
  const confidence = clamp(signature.confidenceBase + (avgSnr - 35) / 150 - noise / 350 + (energy - 110) / 520, 0.46, 0.995);
  return { signature, confidence, avgSnr };
}

function triangulate(telemetry) {
  const reference = telemetry[0];
  let best = { x: 600, y: 360, error: Number.POSITIVE_INFINITY };
  for (let y = MAP_BOUNDS.minY; y <= MAP_BOUNDS.maxY; y += 11) {
    for (let x = MAP_BOUNDS.minX; x <= MAP_BOUNDS.maxX; x += 11) {
      const error = tdoaError({ x, y }, telemetry, reference);
      if (error < best.error) best = { x, y, error };
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
        const error = tdoaError(candidate, telemetry, reference);
        if (error < best.error) {
          best = { ...candidate, error };
          improved = true;
        }
      });
    }
  }
  return best;
}

function tdoaError(point, telemetry, reference) {
  const referenceDistance = distanceMeters(reference, point);
  return telemetry.slice(1).reduce((sum, node) => {
    const predicted = (distanceMeters(node, point) - referenceDistance) / SPEED_OF_SOUND_M_PER_S;
    const observed = node.arrival - reference.arrival;
    return sum + Math.abs(predicted - observed);
  }, 0);
}

function drawEvent(result) {
  waveLayer.innerHTML = "";
  bearingLayer.innerHTML = "";
  resultLayer.innerHTML = "";

  [0, 1, 2].forEach((index) => {
    waveLayer.appendChild(svgEl("circle", {
      class: "wave is-active",
      cx: state.event.x,
      cy: state.event.y,
      r: 12,
      style: `animation-delay:${index * 0.25}s`
    }));
  });

  result.telemetry.filter((node) => node.snr >= 18).forEach((sensor) => {
    bearingLayer.appendChild(svgEl("line", {
      class: "bearing-line",
      x1: sensor.x,
      y1: sensor.y,
      x2: result.estimate.x,
      y2: result.estimate.y
    }));
  });

  resultLayer.append(
    svgEl("circle", { class: "true-event-halo", cx: state.event.x, cy: state.event.y, r: 24 }),
    svgEl("circle", { class: "true-event", cx: state.event.x, cy: state.event.y, r: 9 }),
    svgEl("line", { class: "estimate-line", x1: state.event.x, y1: state.event.y, x2: result.estimate.x, y2: result.estimate.y }),
    svgEl("circle", { class: "estimate-ring", cx: result.estimate.x, cy: result.estimate.y, r: 15 })
  );

  const cross = svgEl("g", { transform: `translate(${result.estimate.x} ${result.estimate.y})` });
  cross.append(
    svgEl("line", { class: "estimate-cross", x1: -9, y1: 0, x2: 9, y2: 0 }),
    svgEl("line", { class: "estimate-cross", x1: 0, y1: -9, x2: 0, y2: 9 })
  );
  resultLayer.appendChild(cross);

  const labelX = clamp(state.event.x + 20, 65, 990);
  const labelY = clamp(state.event.y - 42, 55, 640);
  resultLayer.appendChild(svgEl("rect", { class: "event-label-bg", x: labelX, y: labelY, width: 150, height: 28, rx: 3 }));
  const label = svgEl("text", { class: "event-label-text", x: labelX + 9, y: labelY + 19 });
  label.textContent = result.classified.signature.label;
  resultLayer.appendChild(label);
}

function updateTelemetryTable(telemetry) {
  telemetryBody.innerHTML = "";
  const firstArrival = telemetry[0].arrival;
  let locked = 0;
  telemetry.forEach((node) => {
    const status = node.snr > 24 ? "Locked" : "Weak";
    if (status === "Locked") locked += 1;
    const row = document.createElement("tr");
    const values = [
      node.id,
      `${Math.round(node.bearing)} deg`,
      `${(node.arrival * 1000).toFixed(1)} ms`,
      `+${((node.arrival - firstArrival) * 1000).toFixed(1)} ms`,
      `${node.snr.toFixed(1)} dB`
    ];
    values.forEach((value) => {
      const cell = document.createElement("td");
      cell.textContent = value;
      row.appendChild(cell);
    });
    const statusCell = document.createElement("td");
    statusCell.className = status === "Locked" ? "status-ok" : "status-weak";
    statusCell.textContent = status;
    row.appendChild(statusCell);
    telemetryBody.appendChild(row);
  });
  labels.lockedCount.textContent = String(locked);
}

function coordinatesFor(point) {
  const latitude = 2.2913 + (360 - point.y) * 0.0000105;
  const longitude = 111.8291 + (point.x - 600) * 0.0000118;
  return { latitude, longitude };
}

function locationFor(point) {
  if (point.x < 430) return "Jalan Wong King Huo, Sibu";
  if (point.x > 880) return "Jalan Tun Abang Haji Openg, Sibu";
  if (point.y < 260) return "Jalan Kampung Nyabor, Sibu";
  if (point.y > 500) return "Jalan Lanang, Sibu";
  return "Intersection 4, Jalan Awang Ramli Amit, Sibu";
}

function drawSpectrogram(signature, confidence) {
  const canvas = document.getElementById("spectrogram");
  const context = canvas.getContext("2d");
  const width = canvas.width;
  const height = canvas.height;
  const image = context.createImageData(width, height);
  const peakX = Math.round(width * 0.58);
  const frequencyBias = signature.centroid / 8000;

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = (y * width + x) * 4;
      const normalizedFrequency = 1 - y / height;
      const background = Math.max(0, seededNoise(x * 0.17 + y * 0.41 + signature.centroid) * 32 + 13);
      const impulse = Math.exp(-Math.pow((x - peakX) / 18, 2));
      const harmonic = Math.max(0, Math.cos((normalizedFrequency - frequencyBias) * 21)) * impulse;
      const lowBand = Math.exp(-Math.pow((normalizedFrequency - Math.min(0.85, frequencyBias)) / 0.18, 2)) * impulse;
      const energy = clamp(background + impulse * 118 + harmonic * 70 + lowBand * 82, 0, 255);
      image.data[index] = clamp(13 + energy * 1.15, 0, 255);
      image.data[index + 1] = clamp(5 + energy * 0.28, 0, 255);
      image.data[index + 2] = clamp(24 + energy * 0.78, 0, 255);
      image.data[index + 3] = 255;
    }
  }
  context.putImageData(image, 0, 0);
  context.strokeStyle = "rgba(255,255,255,0.08)";
  context.lineWidth = 1;
  [0.25, 0.5, 0.75].forEach((ratio) => {
    context.beginPath();
    context.moveTo(0, height * ratio);
    context.lineTo(width, height * ratio);
    context.stroke();
  });
  context.strokeStyle = `rgba(255,85,85,${0.55 + confidence * 0.35})`;
  context.lineWidth = 2;
  context.beginPath();
  context.moveTo(peakX, 0);
  context.lineTo(peakX, height);
  context.stroke();
}

function formatTime(date) {
  return date.toLocaleTimeString("en-MY", { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: true }).toUpperCase();
}

function resetDispatch() {
  state.dispatched = false;
  controls.dispatch.classList.remove("is-dispatched");
  controls.dispatch.disabled = false;
  labels.dispatchNote.textContent = "Awaiting operator confirmation";
}

function runSimulation({ newIncident = false, reveal = true } = {}) {
  const telemetry = computeTelemetry();
  const estimate = triangulate(telemetry);
  const classified = classifyEvent(controls.type.value, telemetry);
  const errorMeters = distanceMeters(state.event, estimate);
  const result = { telemetry, estimate, classified, errorMeters };
  state.lastResult = result;
  if (newIncident) state.incidentSequence += 1;

  const now = new Date();
  const coordinates = coordinatesFor(estimate);
  const confidencePercent = Math.round(classified.confidence * 1000) / 10;
  const visionPercent = Math.max(72, confidencePercent - 2.7);
  const averageSnr = classified.avgSnr.toFixed(1);
  const dateCode = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}${String(now.getDate()).padStart(2, "0")}`;

  labels.noise.textContent = `${controls.noise.value} dB`;
  labels.energy.textContent = `${controls.energy.value} dB`;
  labels.classification.textContent = classified.signature.short;
  labels.confidence.textContent = `${confidencePercent}% match`;
  labels.signature.textContent = classified.signature.bands;
  labels.signatureBand.textContent = classified.signature.range;
  labels.snr.textContent = `${averageSnr} dB SNR`;
  labels.estimate.textContent = `${coordinates.latitude.toFixed(4)}, ${coordinates.longitude.toFixed(4)}`;
  labels.error.textContent = `${errorMeters.toFixed(1)} m`;
  labels.firstNode.textContent = telemetry[0].id;
  labels.incidentId.textContent = `EA-${dateCode}-${String(state.incidentSequence).padStart(2, "0")}`;
  labels.location.textContent = locationFor(estimate);
  labels.coordinate.textContent = `${coordinates.latitude.toFixed(4)}, ${coordinates.longitude.toFixed(4)}`;
  labels.timestamp.textContent = formatTime(now);
  labels.cameraTime.textContent = formatTime(now).replace(" AM", "").replace(" PM", "");
  labels.confirmedEvent.textContent = classified.signature.confirmed;
  labels.response.textContent = classified.signature.response;
  labels.dispatch.textContent = classified.signature.dispatch;
  labels.vision.textContent = classified.signature.vision;
  labels.visionScore.textContent = `${visionPercent.toFixed(1)}%`;

  const confirmed = classified.confidence >= 0.72 && errorMeters < 45;
  labels.incidentStatus.textContent = confirmed ? "Status: critical - multi-sensor confirmation" : "Status: review - confidence threshold not met";
  labels.fusionState.innerHTML = confirmed ? "<i></i> Correlated" : "<i></i> Review";

  resetDispatch();
  updateTelemetryTable(telemetry);
  drawEvent(result);
  drawSpectrogram(classified.signature, classified.confidence);
  if (reveal) incidentPanel.classList.remove("is-hidden");
}

function randomizeEvent() {
  state.event.x = 110 + Math.random() * 960;
  state.event.y = 95 + Math.random() * 520;
  runSimulation({ newIncident: true });
}

function dispatchIncident() {
  if (!state.lastResult || state.dispatched) return;
  state.dispatched = true;
  controls.dispatch.classList.add("is-dispatched");
  controls.dispatch.disabled = true;
  labels.dispatch.textContent = "Unit dispatched";
  labels.dispatchNote.textContent = `Acknowledged · ETA ${4 + Math.round(state.lastResult.errorMeters / 12)} minutes`;
}

function flagReview() {
  labels.dispatchNote.textContent = "Incident queued for supervisor review";
  labels.incidentStatus.textContent = "Status: operator review requested";
}

function toggleEvidence() {
  const playing = controls.play.classList.toggle("is-playing");
  controls.play.querySelector("span").textContent = playing ? "Ⅱ" : "▶";
  controls.play.setAttribute("aria-label", playing ? "Pause visual evidence" : "Play visual evidence");
  if (playing) window.setTimeout(() => {
    controls.play.classList.remove("is-playing");
    controls.play.querySelector("span").textContent = "▶";
    controls.play.setAttribute("aria-label", "Play visual evidence");
  }, 2400);
}

function setZoom(nextZoom) {
  state.zoom = clamp(nextZoom, 1, 1.45);
  map.style.transform = `scale(${state.zoom})`;
}

function init() {
  drawMapBase();
  drawSensors();
  controls.simulate.addEventListener("click", () => runSimulation({ newIncident: true }));
  controls.randomize.addEventListener("click", randomizeEvent);
  controls.noise.addEventListener("input", () => runSimulation({ reveal: false }));
  controls.energy.addEventListener("input", () => runSimulation({ reveal: false }));
  controls.type.addEventListener("change", () => runSimulation({ newIncident: true }));
  controls.dispatch.addEventListener("click", dispatchIncident);
  controls.review.addEventListener("click", flagReview);
  controls.close.addEventListener("click", () => incidentPanel.classList.add("is-hidden"));
  controls.play.addEventListener("click", toggleEvidence);
  controls.zoomIn.addEventListener("click", () => setZoom(state.zoom + 0.1));
  controls.zoomOut.addEventListener("click", () => setZoom(state.zoom - 0.1));
  controls.recenter.addEventListener("click", () => setZoom(1));
  map.addEventListener("click", (event) => {
    const point = map.createSVGPoint();
    point.x = event.clientX;
    point.y = event.clientY;
    const cursor = point.matrixTransform(map.getScreenCTM().inverse());
    state.event.x = clamp(cursor.x, MAP_BOUNDS.minX, MAP_BOUNDS.maxX);
    state.event.y = clamp(cursor.y, MAP_BOUNDS.minY, MAP_BOUNDS.maxY);
    runSimulation({ newIncident: true });
  });
  runSimulation();
}

init();
