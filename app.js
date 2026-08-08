const MAP_BOUNDS = { minX: 55, maxX: 1145, minY: 55, maxY: 665 };

let sensors = [];
let signatures = {};

const state = {
  event: { x: 720, y: 385 },
  currentIncident: null,
  zoom: 1,
  eventStream: null
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
  backendState: document.getElementById("backend-state"),
  backendHealth: document.querySelector(".api-health"),
  nodeCount: document.getElementById("node-count"),
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
  recordState: document.getElementById("record-state"),
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

async function api(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: { "Content-Type": "application/json", ...(options.headers || {}) }
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || `Request failed with ${response.status}`);
  return data;
}

function setBackendStatus(status, text) {
  labels.backendState.textContent = text;
  labels.backendHealth.classList.toggle("is-online", status === "online");
  labels.backendHealth.classList.toggle("is-offline", status === "offline");
}

function svgEl(tag, attributes = {}) {
  const element = document.createElementNS("http://www.w3.org/2000/svg", tag);
  Object.entries(attributes).forEach(([key, value]) => element.setAttribute(key, value));
  return element;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function seededNoise(seed) {
  const value = Math.sin(seed * 999.13) * 10000;
  return (value - Math.floor(value)) - 0.5;
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

  [
    "M85 80 L280 260 L510 95 L700 300 L945 88 L1125 240",
    "M95 360 L280 325 L465 395 L650 300 L860 340 L1100 310",
    "M120 655 L220 420 L440 300 L570 70",
    "M430 690 L520 500 L620 335 L660 70",
    "M880 690 L900 475 L1050 330 L1090 70",
    "M40 250 L210 260 L410 220 L620 255 L835 200 L1180 205",
    "M120 130 L155 420 L280 610",
    "M980 55 L940 260 L1010 475 L1140 620"
  ].forEach((d) => roadLayer.appendChild(svgEl("path", { d, class: "road minor" })));

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

function directionalWedge(x, y, heading, radius, spread) {
  const a1 = ((heading - spread) * Math.PI) / 180;
  const a2 = ((heading + spread) * Math.PI) / 180;
  const p1 = [x + Math.cos(a1) * radius, y + Math.sin(a1) * radius];
  const p2 = [x + Math.cos(a2) * radius, y + Math.sin(a2) * radius];
  return `M ${x} ${y} L ${p1[0]} ${p1[1]} A ${radius} ${radius} 0 0 1 ${p2[0]} ${p2[1]} Z`;
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

function drawEvent(incident) {
  waveLayer.innerHTML = "";
  bearingLayer.innerHTML = "";
  resultLayer.innerHTML = "";
  const estimate = incident.estimate;
  const source = incident.groundTruth || estimate;

  [0, 1, 2].forEach((index) => {
    waveLayer.appendChild(svgEl("circle", {
      class: "wave is-active",
      cx: source.x,
      cy: source.y,
      r: 12,
      style: `animation-delay:${index * 0.25}s`
    }));
  });

  incident.telemetry.filter((reading) => reading.status === "locked").forEach((reading) => {
    const sensor = sensors.find((candidate) => candidate.id === reading.sensorId);
    if (!sensor) return;
    bearingLayer.appendChild(svgEl("line", {
      class: "bearing-line",
      x1: sensor.x,
      y1: sensor.y,
      x2: estimate.x,
      y2: estimate.y
    }));
  });

  resultLayer.append(
    svgEl("circle", { class: "true-event-halo", cx: source.x, cy: source.y, r: 24 }),
    svgEl("circle", { class: "true-event", cx: source.x, cy: source.y, r: 9 })
  );
  if (incident.groundTruth) {
    resultLayer.appendChild(svgEl("line", { class: "estimate-line", x1: source.x, y1: source.y, x2: estimate.x, y2: estimate.y }));
  }
  resultLayer.appendChild(svgEl("circle", { class: "estimate-ring", cx: estimate.x, cy: estimate.y, r: 15 }));
  const cross = svgEl("g", { transform: `translate(${estimate.x} ${estimate.y})` });
  cross.append(
    svgEl("line", { class: "estimate-cross", x1: -9, y1: 0, x2: 9, y2: 0 }),
    svgEl("line", { class: "estimate-cross", x1: 0, y1: -9, x2: 0, y2: 9 })
  );
  resultLayer.appendChild(cross);

  const labelX = clamp(source.x + 20, 65, 990);
  const labelY = clamp(source.y - 42, 55, 640);
  resultLayer.appendChild(svgEl("rect", { class: "event-label-bg", x: labelX, y: labelY, width: 150, height: 28, rx: 3 }));
  const label = svgEl("text", { class: "event-label-text", x: labelX + 9, y: labelY + 19 });
  label.textContent = incident.classification.signature.label;
  resultLayer.appendChild(label);
}

function updateTelemetryTable(telemetry) {
  telemetryBody.innerHTML = "";
  const firstArrival = telemetry[0]?.arrivalMs || 0;
  telemetry.forEach((reading) => {
    const row = document.createElement("tr");
    [
      reading.sensorId,
      `${Math.round(reading.bearingDeg)} deg`,
      `${reading.arrivalMs.toFixed(1)} ms`,
      `+${(reading.arrivalMs - firstArrival).toFixed(1)} ms`,
      `${reading.snrDb.toFixed(1)} dB`
    ].forEach((value) => {
      const cell = document.createElement("td");
      cell.textContent = value;
      row.appendChild(cell);
    });
    const statusCell = document.createElement("td");
    statusCell.className = reading.status === "locked" ? "status-ok" : "status-weak";
    statusCell.textContent = reading.status === "locked" ? "Locked" : "Weak";
    row.appendChild(statusCell);
    telemetryBody.appendChild(row);
  });
}

function drawSpectrogram(signature, confidence) {
  const canvas = document.getElementById("spectrogram");
  const context = canvas.getContext("2d");
  const width = canvas.width;
  const height = canvas.height;
  const image = context.createImageData(width, height);
  const peakX = Math.round(width * 0.58);
  const frequencyBias = signature.centroidHz / 8000;

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = (y * width + x) * 4;
      const normalizedFrequency = 1 - y / height;
      const background = Math.max(0, seededNoise(x * 0.17 + y * 0.41 + signature.centroidHz) * 32 + 13);
      const impulse = Math.exp(-Math.pow((x - peakX) / 18, 2));
      const harmonic = Math.max(0, Math.cos((normalizedFrequency - frequencyBias) * 21)) * impulse;
      const band = Math.exp(-Math.pow((normalizedFrequency - Math.min(0.85, frequencyBias)) / 0.18, 2)) * impulse;
      const energy = clamp(background + impulse * 118 + harmonic * 70 + band * 82, 0, 255);
      image.data[index] = clamp(13 + energy * 1.15, 0, 255);
      image.data[index + 1] = clamp(5 + energy * 0.28, 0, 255);
      image.data[index + 2] = clamp(24 + energy * 0.78, 0, 255);
      image.data[index + 3] = 255;
    }
  }
  context.putImageData(image, 0, 0);
  context.strokeStyle = "rgba(255,255,255,0.08)";
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

function formatTime(isoDate) {
  return new Date(isoDate).toLocaleTimeString("en-MY", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: true
  }).toUpperCase();
}

function renderStatus(incident) {
  const statusCopy = {
    confirmed: "Status: critical - multi-sensor confirmation",
    review: "Status: review - confidence threshold not met",
    dispatched: "Status: response unit dispatched"
  };
  labels.incidentStatus.textContent = statusCopy[incident.status] || `Status: ${incident.status}`;
  labels.fusionState.innerHTML = incident.status === "review" ? "<i></i> Review" : "<i></i> Correlated";

  const dispatched = incident.status === "dispatched";
  controls.dispatch.classList.toggle("is-dispatched", dispatched);
  controls.dispatch.disabled = dispatched;
  labels.dispatch.textContent = dispatched ? "Unit dispatched" : incident.classification.signature.dispatch;
  labels.dispatchNote.textContent = dispatched
    ? `Recorded by backend at ${formatTime(incident.dispatches.at(-1)?.createdAt || incident.detectedAt)}`
    : incident.status === "review" ? "Incident queued for supervisor review" : "Awaiting operator confirmation";
}

function renderIncident(incident, { reveal = true } = {}) {
  state.currentIncident = incident;
  state.event = incident.groundTruth || { x: incident.estimate.x, y: incident.estimate.y };
  const signature = incident.classification.signature;
  const confidencePercent = Math.round(incident.confidence * 1000) / 10;
  const simulationNoise = incident.simulation?.noiseDb;
  const visionPercent = Math.max(72, confidencePercent - 2.7);
  const localization = incident.estimate.errorM == null
    ? `${incident.estimate.residualMs.toFixed(2)} ms residual`
    : `${incident.estimate.errorM.toFixed(1)} m`;

  if (simulationNoise != null) {
    controls.noise.value = String(simulationNoise);
    controls.energy.value = String(incident.simulation.intensityDb);
  }
  controls.type.value = incident.eventType;
  labels.noise.textContent = `${controls.noise.value} dB`;
  labels.energy.textContent = `${controls.energy.value} dB`;
  labels.classification.textContent = signature.short;
  labels.confidence.textContent = `${confidencePercent}% match`;
  labels.signature.textContent = signature.bands;
  labels.signatureBand.textContent = signature.range;
  labels.snr.textContent = `${incident.classification.averageSnrDb.toFixed(1)} dB SNR`;
  labels.estimate.textContent = `${incident.latitude.toFixed(4)}, ${incident.longitude.toFixed(4)}`;
  labels.error.textContent = localization;
  labels.firstNode.textContent = incident.telemetry[0]?.sensorId || "--";
  labels.lockedCount.textContent = String(incident.lockedCount);
  labels.recordState.textContent = incident.id;
  labels.skew.textContent = (0.8 + Number(controls.noise.value) / 42).toFixed(1);
  labels.loss.textContent = Number(controls.noise.value) > 76 ? "4" : Number(controls.noise.value) > 64 ? "1" : "0";
  labels.incidentId.textContent = incident.id;
  labels.location.textContent = incident.location;
  labels.coordinate.textContent = `${incident.latitude.toFixed(4)}, ${incident.longitude.toFixed(4)}`;
  labels.timestamp.textContent = formatTime(incident.detectedAt);
  labels.cameraTime.textContent = formatTime(incident.detectedAt).replace(" AM", "").replace(" PM", "");
  labels.confirmedEvent.textContent = signature.confirmed;
  labels.response.textContent = signature.response;
  labels.vision.textContent = signature.vision;
  labels.visionScore.textContent = `${visionPercent.toFixed(1)}%`;

  renderStatus(incident);
  updateTelemetryTable(incident.telemetry);
  drawEvent(incident);
  drawSpectrogram(signature, incident.confidence);
  if (reveal) incidentPanel.classList.remove("is-hidden");
}

async function runSimulation({ reveal = true } = {}) {
  controls.simulate.disabled = true;
  controls.randomize.disabled = true;
  labels.recordState.textContent = "Processing";
  try {
    const result = await api("/api/simulations", {
      method: "POST",
      body: JSON.stringify({
        eventType: controls.type.value,
        noiseDb: Number(controls.noise.value),
        intensityDb: Number(controls.energy.value),
        x: state.event.x,
        y: state.event.y
      })
    });
    renderIncident(result.incident, { reveal });
    setBackendStatus("online", "API connected");
  } catch (error) {
    labels.recordState.textContent = "Failed";
    labels.dispatchNote.textContent = error.message;
    setBackendStatus("offline", "API offline");
  } finally {
    controls.simulate.disabled = false;
    controls.randomize.disabled = false;
  }
}

async function dispatchIncident() {
  if (!state.currentIncident || state.currentIncident.status === "dispatched") return;
  controls.dispatch.disabled = true;
  labels.dispatchNote.textContent = "Sending dispatch request";
  try {
    const result = await api(`/api/incidents/${encodeURIComponent(state.currentIncident.id)}/dispatch`, {
      method: "POST",
      body: JSON.stringify({ unit: state.currentIncident.classification.signature.response })
    });
    renderIncident(result.incident);
  } catch (error) {
    controls.dispatch.disabled = false;
    labels.dispatchNote.textContent = error.message;
  }
}

async function flagReview() {
  if (!state.currentIncident) return;
  labels.dispatchNote.textContent = "Recording review request";
  try {
    const result = await api(`/api/incidents/${encodeURIComponent(state.currentIncident.id)}/review`, {
      method: "POST",
      body: "{}"
    });
    renderIncident(result.incident);
  } catch (error) {
    labels.dispatchNote.textContent = error.message;
  }
}

function randomizeEvent() {
  state.event.x = 110 + Math.random() * 960;
  state.event.y = 95 + Math.random() * 520;
  runSimulation();
}

function toggleEvidence() {
  const playing = controls.play.classList.toggle("is-playing");
  controls.play.querySelector("span").textContent = playing ? "II" : ">";
  controls.play.setAttribute("aria-label", playing ? "Pause visual evidence" : "Play visual evidence");
  if (playing) window.setTimeout(() => {
    controls.play.classList.remove("is-playing");
    controls.play.querySelector("span").textContent = ">";
    controls.play.setAttribute("aria-label", "Play visual evidence");
  }, 2400);
}

function setZoom(nextZoom) {
  state.zoom = clamp(nextZoom, 1, 1.45);
  map.style.transform = `scale(${state.zoom})`;
}

function startEventStream() {
  if (!window.EventSource) return;
  state.eventStream = new EventSource("/api/events");
  state.eventStream.addEventListener("connected", () => setBackendStatus("online", "Live stream"));
  state.eventStream.addEventListener("incident", (event) => {
    const incident = JSON.parse(event.data);
    if (incident.id !== state.currentIncident?.id) renderIncident(incident);
  });
  state.eventStream.addEventListener("reading-progress", (event) => {
    const progress = JSON.parse(event.data);
    labels.recordState.textContent = `${progress.received}/${progress.required} nodes`;
  });
  state.eventStream.addEventListener("incident-updated", (event) => {
    const incident = JSON.parse(event.data);
    if (incident.id === state.currentIncident?.id) renderIncident(incident);
  });
  state.eventStream.onerror = () => setBackendStatus("offline", "Stream retrying");
}

function bindControls() {
  controls.simulate.addEventListener("click", () => runSimulation());
  controls.randomize.addEventListener("click", randomizeEvent);
  controls.noise.addEventListener("input", () => { labels.noise.textContent = `${controls.noise.value} dB`; });
  controls.energy.addEventListener("input", () => { labels.energy.textContent = `${controls.energy.value} dB`; });
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
    runSimulation();
  });
}

async function init() {
  drawMapBase();
  bindControls();
  try {
    const [health, config, history] = await Promise.all([
      api("/api/health"),
      api("/api/config"),
      api("/api/incidents?limit=1")
    ]);
    sensors = config.sensors;
    signatures = config.signatures;
    labels.nodeCount.textContent = String(health.sensors.online);
    drawSensors();
    setBackendStatus("online", "API connected");
    startEventStream();
    if (history.incidents.length > 0) renderIncident(history.incidents[0]);
    else await runSimulation();
  } catch (error) {
    setBackendStatus("offline", "API offline");
    labels.dispatchNote.textContent = `${error.message}. Start with node server.mjs.`;
    controls.simulate.disabled = true;
    controls.randomize.disabled = true;
  }
}

init();
