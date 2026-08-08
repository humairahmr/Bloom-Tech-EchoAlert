const METERS_PER_UNIT = 15;
const EMERGENCY_SPEED_MPS = 20;

export const ROAD_NODES = Object.freeze({
  S: { id: "S", x: -28, z: 4.2, name: "MED-01 Standby Bay" },
  S2: { id: "S2", x: -28, z: -4.2, name: "MED-02 Hospital Bay" },
  W2: { id: "W2", x: -20, z: -4.2, name: "Hospital Access Road" },
  C2: { id: "C2", x: -10, z: -4.2, name: "Southern Emergency Lane" },
  J2: { id: "J2", x: -4.2, z: -4.2, name: "Intersection 4 South" },
  W: { id: "W", x: -20, z: 4.2, name: "Jalan Tun Abang Haji Openg" },
  C: { id: "C", x: -10, z: 4.2, name: "Jalan Awang Ramli Amit" },
  J: { id: "J", x: -4.2, z: 4.2, name: "Intersection 4" },
  D: { id: "D", x: -4.2, z: 8.2, name: "Incident Staging Point" },
  NW: { id: "NW", x: -20, z: 16, name: "Emergency Access West" },
  NE: { id: "NE", x: -4.2, z: 16, name: "Jalan Central Link" }
});

const EDGE_DEFINITIONS = [
  ["S", "W", "Jalan Tun Abang Haji Openg", 0, true],
  ["S2", "W2", "Hospital Access Road", 0, true],
  ["W2", "C2", "Southern Emergency Lane", 0, true],
  ["C2", "J2", "Jalan Awang Ramli Amit South", 0, true],
  ["J2", "J", "Intersection 4 South", 0, true],
  ["W", "C", "Lebuh Barat", 1, true],
  ["C", "J", "Jalan Awang Ramli Amit", 0, true],
  ["J", "D", "Intersection 4 Access", 0, true],
  ["W", "NW", "Emergency Access West", 0, true],
  ["NW", "NE", "Jalan Central Link", 1, true],
  ["NE", "D", "Medical Priority Lane", 0, true]
];

export function segmentKey(from, to) {
  return [from, to].sort().join("-");
}

export function createRoadGraph(blocked = new Set()) {
  const graph = Object.fromEntries(Object.keys(ROAD_NODES).map((id) => [id, []]));
  EDGE_DEFINITIONS.forEach(([from, to, roadName, congestion, emergencyPriority]) => {
    const a = ROAD_NODES[from];
    const b = ROAD_NODES[to];
    const distance = Math.hypot(b.x - a.x, b.z - a.z) * METERS_PER_UNIT;
    const key = segmentKey(from, to);
    const open = !blocked.has(key);
    const travelTime = distance / EMERGENCY_SPEED_MPS * (1 + congestion * 0.12);
    const edge = { from, to, key, roadName, distance, travelTime, congestion, emergencyPriority, open };
    graph[from].push(edge);
    graph[to].push({ ...edge, from: to, to: from });
  });
  return graph;
}

export function findFastestRoute(startId, destinationId, blocked = new Set()) {
  const graph = createRoadGraph(blocked);
  const open = new Set([startId]);
  const cameFrom = new Map();
  const gScore = new Map(Object.keys(ROAD_NODES).map((id) => [id, Infinity]));
  const fScore = new Map(Object.keys(ROAD_NODES).map((id) => [id, Infinity]));
  gScore.set(startId, 0);
  fScore.set(startId, heuristic(startId, destinationId));

  while (open.size) {
    const current = [...open].sort((a, b) => fScore.get(a) - fScore.get(b))[0];
    if (current === destinationId) return buildRoute(cameFrom, current, graph);
    open.delete(current);

    graph[current].filter((edge) => edge.open).forEach((edge) => {
      const priorityFactor = edge.emergencyPriority ? 0.92 : 1;
      const tentative = gScore.get(current) + edge.travelTime * priorityFactor;
      if (tentative >= gScore.get(edge.to)) return;
      cameFrom.set(edge.to, current);
      gScore.set(edge.to, tentative);
      fScore.set(edge.to, tentative + heuristic(edge.to, destinationId));
      open.add(edge.to);
    });
  }
  return null;
}

function buildRoute(cameFrom, destination, graph) {
  const nodeIds = [destination];
  while (cameFrom.has(nodeIds[0])) nodeIds.unshift(cameFrom.get(nodeIds[0]));
  const segments = [];
  let totalDistance = 0;
  let totalTime = 0;
  for (let index = 0; index < nodeIds.length - 1; index += 1) {
    const from = nodeIds[index];
    const to = nodeIds[index + 1];
    const edge = graph[from].find((candidate) => candidate.to === to);
    segments.push({ ...edge, startDistance: totalDistance, endDistance: totalDistance + edge.distance });
    totalDistance += edge.distance;
    totalTime += edge.travelTime;
  }
  return {
    nodeIds,
    points: nodeIds.map((id) => ({ x: ROAD_NODES[id].x, z: ROAD_NODES[id].z, nodeId: id })),
    segments,
    totalDistance,
    totalTime
  };
}

function heuristic(fromId, destinationId) {
  const from = ROAD_NODES[fromId];
  const destination = ROAD_NODES[destinationId];
  return Math.hypot(destination.x - from.x, destination.z - from.z) * METERS_PER_UNIT / EMERGENCY_SPEED_MPS;
}

export function prependCurrentPosition(route, position) {
  if (!route) return null;
  const first = route.points[0];
  const distance = Math.hypot(first.x - position.x, first.z - position.z) * METERS_PER_UNIT;
  if (distance < 2) return route;
  const connector = {
    from: "CURRENT",
    to: first.nodeId,
    key: `CURRENT-${first.nodeId}`,
    roadName: "Emergency merge",
    distance,
    travelTime: distance / EMERGENCY_SPEED_MPS,
    startDistance: 0,
    endDistance: distance,
    emergencyPriority: true,
    open: true
  };
  return {
    ...route,
    nodeIds: ["CURRENT", ...route.nodeIds],
    points: [{ x: position.x, z: position.z, nodeId: "CURRENT" }, ...route.points],
    segments: [connector, ...route.segments.map((segment) => ({
      ...segment,
      startDistance: segment.startDistance + distance,
      endDistance: segment.endDistance + distance
    }))],
    totalDistance: route.totalDistance + distance,
    totalTime: route.totalTime + connector.travelTime
  };
}

export function poseAlongRoute(route, distanceTravelled) {
  if (!route?.segments.length) return { x: ROAD_NODES.S.x, z: ROAD_NODES.S.z, rotation: 0, segmentIndex: 0, segmentProgress: 0 };
  const distance = Math.max(0, Math.min(distanceTravelled, route.totalDistance));
  const segmentIndex = Math.min(route.segments.length - 1, route.segments.findIndex((segment) => distance <= segment.endDistance));
  const segment = route.segments[segmentIndex < 0 ? route.segments.length - 1 : segmentIndex];
  const from = route.points[segmentIndex < 0 ? route.points.length - 2 : segmentIndex];
  const to = route.points[(segmentIndex < 0 ? route.points.length - 2 : segmentIndex) + 1];
  const segmentProgress = Math.max(0, Math.min(1, (distance - segment.startDistance) / Math.max(1, segment.distance)));
  const x = from.x + (to.x - from.x) * segmentProgress;
  const z = from.z + (to.z - from.z) * segmentProgress;
  return { x, z, rotation: Math.atan2(-(to.z - from.z), to.x - from.x), segmentIndex: Math.max(0, segmentIndex), segmentProgress };
}

export function navigationInstruction(route, pose, remainingDistance) {
  if (!route?.segments.length) return { arrow: "UP", manoeuvre: "Route unavailable", distance: 0, roadName: "Awaiting route" };
  if (remainingDistance <= 55) return { arrow: "PIN", manoeuvre: remainingDistance <= 15 ? "Arriving at incident location" : "Incident ahead", distance: remainingDistance, roadName: "Intersection 4" };
  const current = route.segments[pose.segmentIndex];
  const distanceToTurn = Math.max(0, current.endDistance - (route.totalDistance - remainingDistance));
  const next = route.segments[pose.segmentIndex + 1];
  if (!next || distanceToTurn > 70) return { arrow: "UP", manoeuvre: "Continue straight", distance: Math.min(distanceToTurn, remainingDistance), roadName: current.roadName };
  const a = route.points[pose.segmentIndex];
  const b = route.points[pose.segmentIndex + 1];
  const c = route.points[pose.segmentIndex + 2];
  const cross = (b.x - a.x) * (c.z - b.z) - (b.z - a.z) * (c.x - b.x);
  const manoeuvre = Math.abs(cross) < 0.1 ? "Continue straight" : cross > 0 ? "Turn right" : "Turn left";
  return { arrow: cross > 0 ? "RIGHT" : cross < 0 ? "LEFT" : "UP", manoeuvre, distance: distanceToTurn, roadName: next.roadName };
}

export function roadNetworkForMap() {
  return EDGE_DEFINITIONS.map(([from, to]) => ({ from: ROAD_NODES[from], to: ROAD_NODES[to], key: segmentKey(from, to) }));
}

export const navigationConstants = Object.freeze({ metersPerUnit: METERS_PER_UNIT, emergencySpeedMps: EMERGENCY_SPEED_MPS });
