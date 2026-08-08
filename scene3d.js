import * as THREE from "/vendor/three.module.js";

const COLORS = {
  background: 0x080d12,
  ground: 0x0c1419,
  road: 0x1a2228,
  sidewalk: 0x293237,
  marking: 0xd9e0df,
  cyan: 0x35c6df,
  amber: 0xf2b84b,
  red: 0xff3f49,
  blue: 0x2f7cff,
  green: 0x25d977
};

const CRASHED_PHASES = new Set([
  "IMPACT",
  "VISION_DETECTED",
  "AUDIO_DETECTED",
  "FUSION_VERIFYING",
  "CRITICAL_CONFIRMED",
  "DISPATCHED",
  "RESPONDER_ARRIVED"
]);

function material(color, options = {}) {
  return new THREE.MeshStandardMaterial({ color, roughness: 0.72, metalness: 0.12, ...options });
}

function box(width, height, depth, meshMaterial) {
  return new THREE.Mesh(new THREE.BoxGeometry(width, height, depth), meshMaterial);
}

function createLabelSprite(text, color = "#d7e1df") {
  const canvas = document.createElement("canvas");
  canvas.width = 512;
  canvas.height = 96;
  const context = canvas.getContext("2d");
  context.fillStyle = "rgba(6,10,13,0.86)";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.strokeStyle = color;
  context.lineWidth = 3;
  context.strokeRect(2, 2, canvas.width - 4, canvas.height - 4);
  context.fillStyle = color;
  context.font = "600 34px system-ui, sans-serif";
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.fillText(text, canvas.width / 2, canvas.height / 2 + 1);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, transparent: true, depthTest: false }));
  sprite.scale.set(5.8, 1.08, 1);
  return sprite;
}

function createVehicle(color, { ambulance = false } = {}) {
  const group = new THREE.Group();
  group.name = ambulance ? "MED-01" : "civilian-vehicle";

  const bodyMaterial = material(color, { roughness: 0.46, metalness: 0.28 });
  const glassMaterial = material(0x6c8995, { roughness: 0.18, metalness: 0.2, transparent: true, opacity: 0.88 });
  const trimMaterial = material(0x111519, { roughness: 0.88 });
  const body = box(ambulance ? 4.8 : 4.1, ambulance ? 1.45 : 1.05, 2.15, bodyMaterial);
  body.position.y = ambulance ? 1.08 : 0.83;
  group.add(body);

  const cabin = box(ambulance ? 2.65 : 2.15, ambulance ? 1.2 : 0.84, 1.82, ambulance ? bodyMaterial : glassMaterial);
  cabin.position.set(ambulance ? -0.3 : -0.15, ambulance ? 2.18 : 1.68, 0);
  group.add(cabin);

  if (ambulance) {
    const windscreen = box(0.08, 0.77, 1.58, glassMaterial);
    windscreen.position.set(1.05, 2.18, 0);
    group.add(windscreen);
    const stripe = box(4.88, 0.34, 2.19, material(COLORS.red, { emissive: COLORS.red, emissiveIntensity: 0.08 }));
    stripe.position.y = 1.2;
    group.add(stripe);
  }

  const wheelGeometry = new THREE.CylinderGeometry(0.4, 0.4, 0.28, 14);
  const wheelMaterial = material(0x080a0c, { roughness: 1 });
  [-1.35, 1.35].forEach((x) => {
    [-1.08, 1.08].forEach((z) => {
      const wheel = new THREE.Mesh(wheelGeometry, wheelMaterial);
      wheel.rotation.x = Math.PI / 2;
      wheel.position.set(x, 0.43, z);
      group.add(wheel);
    });
  });

  const headlightMaterial = material(0xeaf8ff, { emissive: 0xeaf8ff, emissiveIntensity: 2 });
  [-0.66, 0.66].forEach((z) => {
    const light = box(0.12, 0.22, 0.42, headlightMaterial);
    light.position.set(ambulance ? 2.44 : 2.09, 0.9, z);
    group.add(light);
  });

  const emergencyLights = [];
  if (ambulance) {
    const lightBar = box(0.75, 0.14, 1.5, trimMaterial);
    lightBar.position.set(-0.25, 2.9, 0);
    group.add(lightBar);
    const redBulb = box(0.58, 0.2, 0.58, material(COLORS.red, { emissive: COLORS.red, emissiveIntensity: 0 }));
    const blueBulb = box(0.58, 0.2, 0.58, material(COLORS.blue, { emissive: COLORS.blue, emissiveIntensity: 0 }));
    redBulb.position.set(-0.25, 3.05, -0.42);
    blueBulb.position.set(-0.25, 3.05, 0.42);
    group.add(redBulb, blueBulb);
    emergencyLights.push(redBulb, blueBulb);
  }

  group.userData.emergencyLights = emergencyLights;
  return group;
}

function createBuilding(width, depth, height, color, windowColor) {
  const group = new THREE.Group();
  const building = box(width, height, depth, material(color, { roughness: 0.82, metalness: 0.08 }));
  building.position.y = height / 2;
  group.add(building);

  const windowMaterial = material(windowColor, { emissive: windowColor, emissiveIntensity: 0.55 });
  const floors = Math.max(2, Math.floor(height / 2.1));
  for (let floor = 1; floor < floors; floor += 1) {
    const windowStrip = box(width * 0.72, 0.22, 0.06, windowMaterial);
    windowStrip.position.set(0, floor * 1.9, depth / 2 + 0.035);
    group.add(windowStrip);
  }
  return group;
}

function createStreetlight(x, z) {
  const group = new THREE.Group();
  const poleMaterial = material(0x505b60, { metalness: 0.62, roughness: 0.42 });
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.13, 5.6, 10), poleMaterial);
  pole.position.y = 2.8;
  const lamp = box(0.7, 0.18, 0.35, material(0xc9f5ff, { emissive: 0x7dd9ef, emissiveIntensity: 1.5 }));
  lamp.position.set(0.28, 5.55, 0);
  group.add(pole, lamp);
  group.position.set(x, 0, z);
  return group;
}

function createTrafficLight(x, z, rotationY = 0) {
  const group = new THREE.Group();
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.14, 4.6, 10), material(0x4d585e, { metalness: 0.6 }));
  pole.position.y = 2.3;
  const signal = box(0.7, 1.7, 0.55, material(0x151a1d));
  signal.position.set(0, 4.25, 0);
  group.add(pole, signal);
  const bulbs = {};
  [["red", COLORS.red, 4.72], ["amber", COLORS.amber, 4.25], ["green", COLORS.green, 3.78]].forEach(([name, color, y]) => {
    const bulbMaterial = material(color, { emissive: color, emissiveIntensity: name === "green" ? 1.8 : 0.05 });
    const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.2, 12, 8), bulbMaterial);
    bulb.position.set(0, y, 0.3);
    group.add(bulb);
    bulbs[name] = bulb;
  });
  group.position.set(x, 0, z);
  group.rotation.y = rotationY;
  group.userData.bulbs = bulbs;
  return group;
}

function createSensorHardware(scene) {
  const cctv = new THREE.Group();
  const poleMaterial = material(0x5c686d, { metalness: 0.68, roughness: 0.38 });
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.14, 6.2, 12), poleMaterial);
  pole.position.y = 3.1;
  const arm = box(2.3, 0.12, 0.12, poleMaterial);
  arm.position.set(1, 5.95, 0);
  const cameraBody = box(1.1, 0.62, 0.62, material(0x9ba9ac, { metalness: 0.35 }));
  cameraBody.position.set(2.05, 5.75, 0);
  cameraBody.rotation.z = -0.22;
  const lens = new THREE.Mesh(new THREE.CylinderGeometry(0.21, 0.21, 0.25, 16), material(0x13242d, { emissive: COLORS.cyan, emissiveIntensity: 0.3 }));
  lens.rotation.z = Math.PI / 2;
  lens.position.set(2.62, 5.63, 0);
  const label = createLabelSprite("CCTV #04", "#5ed5e7");
  label.position.set(1.2, 7, 0);
  cctv.add(pole, arm, cameraBody, lens, label);
  cctv.position.set(-12, 0, 11);
  cctv.rotation.y = -0.72;
  scene.add(cctv);

  const microphone = new THREE.Group();
  const micPole = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.13, 3.8, 10), poleMaterial);
  micPole.position.y = 1.9;
  const micHead = new THREE.Mesh(new THREE.SphereGeometry(0.42, 16, 10), material(0x26343a, { emissive: COLORS.cyan, emissiveIntensity: 0.45 }));
  micHead.position.y = 4;
  const micRing = new THREE.Mesh(new THREE.TorusGeometry(0.68, 0.07, 8, 28), material(COLORS.cyan, { emissive: COLORS.cyan, emissiveIntensity: 0.9 }));
  micRing.position.y = 4;
  micRing.rotation.x = Math.PI / 2;
  const micLabel = createLabelSprite("ACOUSTIC A-04", "#5ed5e7");
  micLabel.position.set(0, 5.25, 0);
  microphone.add(micPole, micHead, micRing, micLabel);
  microphone.position.set(12, 0, -11);
  scene.add(microphone);

  return { cctv, microphone, micRing };
}

function createLine(points, color, opacity = 1) {
  const geometry = new THREE.BufferGeometry().setFromPoints(points);
  const line = new THREE.Line(geometry, new THREE.LineBasicMaterial({ color, transparent: opacity < 1, opacity }));
  return line;
}

export function createRoadScene({ container, evidenceCanvas, getState, onFrame }) {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(COLORS.background);
  scene.fog = new THREE.FogExp2(COLORS.background, 0.018);

  const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 160);
  camera.position.set(27, 23, 28);
  const cameraTarget = new THREE.Vector3(0, 0.8, 0);

  const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.6));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.domElement.className = "road-scene-canvas";
  renderer.domElement.setAttribute("aria-label", "Interactive 3D smart-city intersection crash simulation");
  container.appendChild(renderer.domElement);

  const evidenceRenderer = new THREE.WebGLRenderer({ canvas: evidenceCanvas, antialias: false, alpha: false, powerPreference: "low-power" });
  evidenceRenderer.setPixelRatio(1);
  evidenceRenderer.outputColorSpace = THREE.SRGBColorSpace;
  const cctvCamera = new THREE.PerspectiveCamera(43, 16 / 9, 0.1, 100);
  cctvCamera.position.set(-15, 11.5, 14);
  cctvCamera.lookAt(0, 0.8, 0);

  const ambient = new THREE.HemisphereLight(0x8eb8c5, 0x172026, 1.35);
  scene.add(ambient);
  const keyLight = new THREE.DirectionalLight(0xd4edf2, 2.2);
  keyLight.position.set(12, 25, 16);
  keyLight.castShadow = true;
  keyLight.shadow.mapSize.set(1024, 1024);
  keyLight.shadow.camera.left = -32;
  keyLight.shadow.camera.right = 32;
  keyLight.shadow.camera.top = 32;
  keyLight.shadow.camera.bottom = -32;
  scene.add(keyLight);

  const ground = new THREE.Mesh(new THREE.PlaneGeometry(72, 72), material(COLORS.ground, { roughness: 1 }));
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);

  const grid = new THREE.GridHelper(72, 36, 0x183844, 0x12242c);
  grid.position.y = 0.012;
  scene.add(grid);

  const roadMaterial = material(COLORS.road, { roughness: 0.98 });
  const horizontalRoad = box(72, 0.08, 14, roadMaterial);
  const verticalRoad = box(14, 0.085, 72, roadMaterial);
  horizontalRoad.position.y = 0.06;
  verticalRoad.position.y = 0.065;
  horizontalRoad.receiveShadow = true;
  verticalRoad.receiveShadow = true;
  scene.add(horizontalRoad, verticalRoad);

  const sidewalkMaterial = material(COLORS.sidewalk, { roughness: 0.95 });
  [[-22, -22], [-22, 22], [22, -22], [22, 22]].forEach(([x, z]) => {
    const sidewalk = box(28, 0.3, 28, sidewalkMaterial);
    sidewalk.position.set(x, 0.17, z);
    sidewalk.receiveShadow = true;
    scene.add(sidewalk);
  });

  const markingMaterial = material(COLORS.marking, { roughness: 0.8, emissive: 0x151919 });
  for (let x = -33; x <= 33; x += 7) {
    if (Math.abs(x) < 9) continue;
    const dash = box(3.3, 0.035, 0.16, markingMaterial);
    dash.position.set(x, 0.125, 0);
    scene.add(dash);
  }
  for (let z = -33; z <= 33; z += 7) {
    if (Math.abs(z) < 9) continue;
    const dash = box(0.16, 0.035, 3.3, markingMaterial);
    dash.position.set(0, 0.13, z);
    scene.add(dash);
  }

  for (let offset = -4.8; offset <= 4.8; offset += 1.2) {
    [[offset, -8, 0.72, 3.2], [offset, 8, 0.72, 3.2]].forEach(([x, z, w, d]) => {
      const stripe = box(w, 0.035, d, markingMaterial);
      stripe.position.set(x, 0.14, z);
      scene.add(stripe);
    });
    [[-8, offset, 3.2, 0.72], [8, offset, 3.2, 0.72]].forEach(([x, z, w, d]) => {
      const stripe = box(w, 0.035, d, markingMaterial);
      stripe.position.set(x, 0.14, z);
      scene.add(stripe);
    });
  }

  const buildingSpecs = [
    [-25, -23, 10, 11, 12, 0x27343b], [-15, -24, 7, 9, 8, 0x30383d],
    [-24, 23, 11, 10, 15, 0x25323a], [-14, 24, 6, 8, 10, 0x363a3e],
    [23, -24, 10, 11, 14, 0x29363c], [15, -25, 6, 8, 9, 0x363b3f],
    [24, 23, 12, 10, 16, 0x273239], [14, 24, 6, 8, 11, 0x343a3f]
  ];
  buildingSpecs.forEach(([x, z, width, depth, height, color], index) => {
    const building = createBuilding(width, depth, height, color, index % 2 ? 0x8ec3ca : 0x6fa8b5);
    building.position.set(x, 0.3, z);
    building.traverse((object) => { if (object.isMesh) object.castShadow = true; });
    scene.add(building);
  });

  [[-9.5,-9.5],[-9.5,9.5],[9.5,-9.5],[9.5,9.5],[-29,8],[29,-8]].forEach(([x,z]) => scene.add(createStreetlight(x,z)));
  const trafficLights = [
    createTrafficLight(-8.7, -8.7, 0),
    createTrafficLight(8.7, 8.7, Math.PI)
  ];
  trafficLights.forEach((light) => scene.add(light));

  const hardware = createSensorHardware(scene);
  const cctvWorldPosition = new THREE.Vector3();
  hardware.cctv.getWorldPosition(cctvWorldPosition);
  cctvWorldPosition.y = 5.5;
  const cctvScan = new THREE.Line(
    new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(-10.1, 5.4, 9.8), new THREE.Vector3(0, 0.5, 0)]),
    new THREE.LineDashedMaterial({ color: COLORS.cyan, dashSize: 0.7, gapSize: 0.35, transparent: true, opacity: 0.8 })
  );
  cctvScan.computeLineDistances();
  cctvScan.visible = false;
  scene.add(cctvScan);

  const audioPath = createLine([new THREE.Vector3(0, 0.55, 0), new THREE.Vector3(12, 4, -11)], COLORS.amber, 0.48);
  audioPath.visible = false;
  scene.add(audioPath);
  const audioPulse = new THREE.Mesh(new THREE.SphereGeometry(0.32, 12, 8), material(COLORS.amber, { emissive: COLORS.amber, emissiveIntensity: 2 }));
  audioPulse.visible = false;
  scene.add(audioPulse);

  const carA = createVehicle(0x327ba5);
  const carB = createVehicle(0xd5d9d8);
  carB.rotation.y = -Math.PI / 2;
  carA.castShadow = true;
  carB.castShadow = true;
  scene.add(carA, carB);
  const carALabel = createLabelSprite("VEH-214", "#74d5e7");
  const carBLabel = createLabelSprite("VEH-927", "#dfe7e5");
  carALabel.scale.multiplyScalar(0.72);
  carBLabel.scale.multiplyScalar(0.72);
  scene.add(carALabel, carBLabel);

  const ambulance = createVehicle(0xe9eeee, { ambulance: true });
  ambulance.position.set(-27, 0, 4.2);
  scene.add(ambulance);
  const ambulanceLabel = createLabelSprite("MED-01", "#ff6d73");
  ambulanceLabel.scale.multiplyScalar(0.72);
  scene.add(ambulanceLabel);

  const markerMaterial = new THREE.MeshBasicMaterial({ color: COLORS.amber, transparent: true, opacity: 0.9, side: THREE.DoubleSide });
  const crashMarker = new THREE.Mesh(new THREE.RingGeometry(2.2, 2.7, 48), markerMaterial);
  crashMarker.rotation.x = -Math.PI / 2;
  crashMarker.position.y = 0.24;
  crashMarker.visible = false;
  scene.add(crashMarker);
  const impactPulse = new THREE.Mesh(new THREE.RingGeometry(1, 1.18, 48), new THREE.MeshBasicMaterial({ color: COLORS.red, transparent: true, opacity: 0.9, side: THREE.DoubleSide }));
  impactPulse.rotation.x = -Math.PI / 2;
  impactPulse.position.y = 0.28;
  impactPulse.visible = false;
  scene.add(impactPulse);
  const impactLight = new THREE.PointLight(COLORS.red, 0, 18, 2);
  impactLight.position.set(0, 3, 0);
  scene.add(impactLight);

  const routePoints = [new THREE.Vector3(-27, 0.25, 4.2), new THREE.Vector3(-18, 0.25, 4.2), new THREE.Vector3(-10, 0.25, 4.2), new THREE.Vector3(-7, 0.25, 4.2)];
  const routeLine = createLine(routePoints, COLORS.cyan, 0.92);
  routeLine.visible = false;
  scene.add(routeLine);

  const particleCount = 72;
  const particlePositions = new Float32Array(particleCount * 3);
  const particleVelocities = Array.from({ length: particleCount }, () => new THREE.Vector3());
  const particleGeometry = new THREE.BufferGeometry();
  particleGeometry.setAttribute("position", new THREE.BufferAttribute(particlePositions, 3));
  const particles = new THREE.Points(particleGeometry, new THREE.PointsMaterial({ color: 0xffb153, size: 0.16, transparent: true, opacity: 0.95, sizeAttenuation: true }));
  particles.visible = false;
  scene.add(particles);

  let particleLife = 0;
  let lastImpactToken = -1;
  let lastFrame = performance.now();
  let frameHandle = 0;
  let frameCount = 0;

  function resetParticles(token) {
    lastImpactToken = token;
    particleLife = 1.45;
    particles.visible = true;
    for (let index = 0; index < particleCount; index += 1) {
      const offset = index * 3;
      particlePositions[offset] = (Math.random() - 0.5) * 1.2;
      particlePositions[offset + 1] = 0.65 + Math.random() * 0.8;
      particlePositions[offset + 2] = (Math.random() - 0.5) * 1.2;
      particleVelocities[index].set((Math.random() - 0.5) * 7, 2 + Math.random() * 6, (Math.random() - 0.5) * 7);
    }
    particleGeometry.attributes.position.needsUpdate = true;
  }

  function updateParticles(delta) {
    if (particleLife <= 0) {
      particles.visible = false;
      return;
    }
    particleLife -= delta;
    for (let index = 0; index < particleCount; index += 1) {
      const offset = index * 3;
      const velocity = particleVelocities[index];
      velocity.y -= 8.5 * delta;
      particlePositions[offset] += velocity.x * delta;
      particlePositions[offset + 1] = Math.max(0.18, particlePositions[offset + 1] + velocity.y * delta);
      particlePositions[offset + 2] += velocity.z * delta;
    }
    particles.material.opacity = clamp01(particleLife / 0.55);
    particleGeometry.attributes.position.needsUpdate = true;
  }

  function ambulancePoint(progress) {
    const clamped = clamp01(progress);
    const totalSegments = routePoints.length - 1;
    const scaled = clamped * totalSegments;
    const index = Math.min(totalSegments - 1, Math.floor(scaled));
    return routePoints[index].clone().lerp(routePoints[index + 1], scaled - index);
  }

  function updateVehicles(state) {
    carA.position.set(state.carA.x, 0, state.carA.z);
    carA.rotation.y = state.carA.rotation;
    carB.position.set(state.carB.x, 0, state.carB.z);
    carB.rotation.y = state.carB.rotation;
    carALabel.position.set(state.carA.x, 3.45, state.carA.z);
    carBLabel.position.set(state.carB.x, 3.45, state.carB.z);

    const ambulancePosition = ambulancePoint(state.ambulanceProgress);
    ambulance.position.copy(ambulancePosition);
    ambulance.position.y = 0;
    ambulanceLabel.position.set(ambulancePosition.x, 4.25, ambulancePosition.z);
    ambulance.visible = true;
    ambulanceLabel.visible = true;

    const emergencyActive = state.phase === "DISPATCHED" || state.phase === "RESPONDER_ARRIVED";
    ambulance.userData.emergencyLights.forEach((bulb, index) => {
      const active = emergencyActive && Math.floor(state.elapsed * 5) % 2 === index;
      bulb.material.emissiveIntensity = active ? 5 : 0.05;
    });
  }

  function updateDetectionVisuals(state) {
    const suspected = ["VISION_DETECTED", "AUDIO_DETECTED", "FUSION_VERIFYING"].includes(state.phase);
    const confirmed = ["CRITICAL_CONFIRMED", "DISPATCHED", "RESPONDER_ARRIVED"].includes(state.phase);
    crashMarker.visible = suspected || confirmed;
    crashMarker.material.color.setHex(confirmed ? COLORS.red : COLORS.amber);
    crashMarker.material.opacity = confirmed ? 0.9 : 0.48 + Math.sin(state.elapsed * 8) * 0.3;
    crashMarker.scale.setScalar(1 + Math.sin(state.elapsed * 5) * 0.08);

    cctvScan.visible = ["VISION_DETECTED", "AUDIO_DETECTED", "FUSION_VERIFYING", "CRITICAL_CONFIRMED"].includes(state.phase);
    if (cctvScan.visible) cctvScan.material.opacity = 0.38 + Math.sin(state.elapsed * 10) * 0.25;

    const audioActive = ["AUDIO_DETECTED", "FUSION_VERIFYING"].includes(state.phase);
    audioPath.visible = audioActive;
    audioPulse.visible = audioActive;
    if (audioActive) {
      const progress = (state.phaseElapsed * 1.45) % 1;
      audioPulse.position.lerpVectors(new THREE.Vector3(0, 0.55, 0), new THREE.Vector3(12, 4, -11), progress);
      hardware.micRing.scale.setScalar(1 + Math.sin(state.elapsed * 13) * 0.28);
      hardware.micRing.material.emissiveIntensity = 1.2 + Math.sin(state.elapsed * 13) * 0.7;
    } else {
      audioPulse.visible = false;
      hardware.micRing.scale.setScalar(1);
      hardware.micRing.material.emissiveIntensity = 0.8;
    }

    impactPulse.visible = state.phase === "IMPACT" && state.phaseElapsed < 0.8;
    if (impactPulse.visible) {
      const scale = 1 + state.phaseElapsed * 8;
      impactPulse.scale.setScalar(scale);
      impactPulse.material.opacity = 1 - state.phaseElapsed / 0.8;
      impactLight.intensity = Math.max(0, 14 * (1 - state.phaseElapsed / 0.5));
    } else {
      impactLight.intensity = 0;
    }

    routeLine.visible = state.phase === "DISPATCHED" || state.phase === "RESPONDER_ARRIVED";
    trafficLights.forEach((light) => {
      const emergency = CRASHED_PHASES.has(state.phase);
      light.userData.bulbs.red.material.emissiveIntensity = emergency ? 2.4 : 0.05;
      light.userData.bulbs.green.material.emissiveIntensity = emergency ? 0.05 : 1.8;
    });
  }

  function updateCamera(state, delta) {
    const incidentFocus = CRASHED_PHASES.has(state.phase);
    let desiredPosition = incidentFocus ? new THREE.Vector3(20, 17, 21) : new THREE.Vector3(27, 23, 28);
    let desiredTarget = new THREE.Vector3(0, 0.8, 0);
    if ((state.phase === "DISPATCHED" || state.phase === "RESPONDER_ARRIVED") && state.followIncident) {
      const ambulancePosition = ambulancePoint(state.ambulanceProgress);
      desiredTarget = ambulancePosition.clone().setY(0.8);
      desiredPosition = ambulancePosition.clone().add(new THREE.Vector3(16, 14, 17));
    }
    const smoothing = state.reducedMotion ? 1 : Math.min(1, delta * 2.8);
    camera.position.lerp(desiredPosition, smoothing);
    cameraTarget.lerp(desiredTarget, smoothing);
    if (state.phase === "IMPACT" && !state.reducedMotion && state.phaseElapsed < 0.45) {
      const intensity = (1 - state.phaseElapsed / 0.45) * 0.22;
      camera.position.x += (Math.random() - 0.5) * intensity;
      camera.position.y += (Math.random() - 0.5) * intensity;
    }
    camera.lookAt(cameraTarget);
  }

  function renderEvidenceReplay(state, now) {
    if (!state.modalOpen) return;
    const rect = evidenceCanvas.getBoundingClientRect();
    const width = Math.max(320, Math.round(rect.width));
    const height = Math.max(180, Math.round(rect.height));
    if (evidenceCanvas.width !== width || evidenceCanvas.height !== height) evidenceRenderer.setSize(width, height, false);

    const savedA = { position: carA.position.clone(), rotation: carA.rotation.y };
    const savedB = { position: carB.position.clone(), rotation: carB.rotation.y };
    const replayElapsed = (now - state.modalOpenedAt) % 3600;
    const replayProgress = clamp01(replayElapsed / 2200);
    const eased = replayProgress * replayProgress * (3 - 2 * replayProgress);
    carA.position.set(-11 + 10.7 * eased, 0, -1.15);
    carA.rotation.y = eased > 0.88 ? 0.2 * ((eased - 0.88) / 0.12) : 0;
    carB.position.set(1.15, 0, 11 - 10.7 * eased);
    carB.rotation.y = -Math.PI / 2 - (eased > 0.88 ? 0.28 * ((eased - 0.88) / 0.12) : 0);
    evidenceRenderer.render(scene, cctvCamera);
    carA.position.copy(savedA.position);
    carA.rotation.y = savedA.rotation;
    carB.position.copy(savedB.position);
    carB.rotation.y = savedB.rotation;
  }

  function resize() {
    const rect = container.getBoundingClientRect();
    const width = Math.max(1, Math.round(rect.width));
    const height = Math.max(1, Math.round(rect.height));
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
  }

  const resizeObserver = new ResizeObserver(resize);
  resizeObserver.observe(container);
  resize();

  function frame(now) {
    const delta = Math.min(0.05, Math.max(0, (now - lastFrame) / 1000));
    lastFrame = now;
    onFrame(delta, now);
    const state = getState();

    if (state.impactToken !== lastImpactToken) resetParticles(state.impactToken);
    if (state.phase === "NORMAL") {
      particleLife = 0;
      particles.visible = false;
    }
    updateVehicles(state);
    updateParticles(delta);
    updateDetectionVisuals(state);
    updateCamera(state, delta);
    renderer.render(scene, camera);
    renderEvidenceReplay(state, now);

    frameCount += 1;
    renderer.domElement.dataset.frameCount = String(frameCount);
    if (frameCount % 90 === 0) {
      const gl = renderer.getContext();
      const sample = new Uint8Array(4);
      gl.readPixels(Math.floor(renderer.domElement.width / 2), Math.floor(renderer.domElement.height / 2), 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, sample);
      renderer.domElement.dataset.pixelRgba = Array.from(sample).join(",");
      renderer.domElement.dataset.nonblank = String(sample[0] + sample[1] + sample[2] > 8);
    }
    frameHandle = requestAnimationFrame(frame);
  }
  frameHandle = requestAnimationFrame(frame);

  return {
    destroy() {
      cancelAnimationFrame(frameHandle);
      resizeObserver.disconnect();
      renderer.dispose();
      evidenceRenderer.dispose();
      renderer.domElement.remove();
    }
  };
}

function clamp01(value) {
  return Math.max(0, Math.min(1, value));
}
