/**
 * Deterministic auto-layout engine for BPMN diagrams.
 * Distributes nodes left-to-right with swimlane-aware vertical placement.
 */
var X_STEP = 180;
var Y_STEP = 100;
var START_X = 160;
var START_Y = 80;
var LANE_HEIGHT = 200;
var GATEWAY_OFFSET_X = 90;

/**
 * Compute topological ordering of nodes from flows.
 */
function topoSort(nodes, flows) {
  var inDegree = {};
  var adj = {};
  var nodeMap = {};

  nodes.forEach(function(n) {
    inDegree[n.id] = 0;
    adj[n.id] = [];
    nodeMap[n.id] = n;
  });

  flows.forEach(function(f) {
    if (adj[f.sourceRef]) {
      adj[f.sourceRef].push(f.targetRef);
      inDegree[f.targetRef] = (inDegree[f.targetRef] || 0) + 1;
    }
  });

  // Start with start events first
  var queue = nodes
    .filter(function(n) { return n.type === 'startEvent'; })
    .map(function(n) { return n.id; });

  // If no start events found, use zero-in-degree nodes
  if (queue.length === 0) {
    nodes.forEach(function(n) {
      if (inDegree[n.id] === 0) queue.push(n.id);
    });
  }

  var order = [];
  while (queue.length > 0) {
    var curr = queue.shift();
    order.push(curr);
    (adj[curr] || []).forEach(function(next) {
      inDegree[next]--;
      if (inDegree[next] === 0) queue.push(next);
    });
  }

  // Add any remaining nodes (cycles)
  nodes.forEach(function(n) {
    if (order.indexOf(n.id) === -1) order.push(n.id);
  });

  return order;
}

/**
 * Compute layer assignment using longest-path approach.
 */
function assignLayers(nodes, flows) {
  var order = topoSort(nodes, flows);
  var layers = {};
  var nodeMap = {};
  var flowMap = {};

  nodes.forEach(function(n) { nodeMap[n.id] = n; });

  flows.forEach(function(f) {
    if (!flowMap[f.targetRef]) flowMap[f.targetRef] = [];
    flowMap[f.targetRef].push(f.sourceRef);
  });

  order.forEach(function(id) {
    var preds = flowMap[id] || [];
    var maxPredLayer = -1;
    preds.forEach(function(p) {
      if (layers[p] !== undefined && layers[p] > maxPredLayer) {
        maxPredLayer = layers[p];
      }
    });
    layers[id] = maxPredLayer + 1;
  });

  return layers;
}

/**
 * Assign Y positions within lanes.
 */
function assignYPositions(nodes, lanes) {
  var yPositions = {};
  var laneGroups = {};
  var noLane = [];

  nodes.forEach(function(n) {
    if (n.laneRef) {
      if (!laneGroups[n.laneRef]) laneGroups[n.laneRef] = [];
      laneGroups[n.laneRef].push(n);
    } else {
      noLane.push(n);
    }
  });

  var currentY = START_Y;

  lanes.forEach(function(lane) {
    var group = laneGroups[lane.id] || [];
    group.forEach(function(n) {
      yPositions[n.id] = currentY;
    });
    currentY += LANE_HEIGHT;
  });

  noLane.forEach(function(n) {
    if (yPositions[n.id] === undefined) {
      yPositions[n.id] = START_Y;
    }
  });

  return yPositions;
}

/**
 * Main layout function. Returns a map of nodeId -> { x, y, width, height }.
 */
export function computeLayout(spec) {
  var nodes = spec.nodes || [];
  var flows = spec.flows || [];
  var lanes = spec.lanes || [];

  var layers = assignLayers(nodes, flows);
  var yPositions = assignYPositions(nodes, lanes);

  // Group nodes by layer for Y-centering of gateways
  var layerGroups = {};
  nodes.forEach(function(n) {
    var l = layers[n.id] || 0;
    if (!layerGroups[l]) layerGroups[l] = [];
    layerGroups[l].push(n);
  });

  var positions = {};

  nodes.forEach(function(n) {
    var layer = layers[n.id] || 0;
    var x = START_X + layer * X_STEP;
    var y = yPositions[n.id] || START_Y;
    var width, height;

    switch (n.type) {
      case 'startEvent':
      case 'endEvent':
        width = 36;
        height = 36;
        break;
      case 'exclusiveGateway':
      case 'parallelGateway':
        width = 50;
        height = 50;
        // Center gateways vertically between predecessors and successors
        x += GATEWAY_OFFSET_X;
        break;
      case 'intermediateThrowEvent':
      case 'intermediateCatchEvent':
        width = 36;
        height = 36;
        break;
      default:
        width = 100;
        height = 80;
    }

    positions[n.id] = { x: x, y: y, width: width, height: height, type: n.type };
  });

  return positions;
}

/**
 * Compute waypoints for a flow edge.
 */
export function computeWaypoints(sourcePos, targetPos) {
  var sx = sourcePos.x + sourcePos.width / 2;
  var sy = sourcePos.y + sourcePos.height / 2;
  var tx = targetPos.x + targetPos.width / 2;
  var ty = targetPos.y + targetPos.height / 2;

  var ex = sourcePos.x + sourcePos.width;
  var iy = targetPos.x;

  if (Math.abs(sy - ty) < 5) {
    return [
      { x: ex, y: sy },
      { x: iy, y: ty }
    ];
  }

  var midX = Math.round((ex + iy) / 2);
  return [
    { x: ex, y: sy },
    { x: midX, y: sy },
    { x: midX, y: ty },
    { x: iy, y: ty }
  ];
}

/**
 * Compute DI bounds for lanes.
 */
export function computeLaneLayout(lanes, positions, nodes) {
  if (!lanes.length) return {};

  var minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  nodes.forEach(function(n) {
    var p = positions[n.id];
    if (p) {
      if (p.x - 40 < minX) minX = p.x - 40;
      if (p.y - 40 < minY) minY = p.y - 40;
      if (p.x + p.width + 40 > maxX) maxX = p.x + p.width + 40;
      if (p.y + p.height + 40 > maxY) maxY = p.y + p.height + 40;
    }
  });

  if (minX === Infinity) { minX = 0; minY = 0; maxX = 800; maxY = 400; }

  var totalHeight = maxY - minY + 40;
  var laneHeight = Math.max(LANE_HEIGHT, totalHeight / lanes.length);

  var lanePositions = {};
  lanes.forEach(function(lane, i) {
    lanePositions[lane.id] = {
      x: minX - 30,
      y: minY + i * laneHeight,
      width: maxX - minX + 60,
      height: laneHeight
    };
  });

  return lanePositions;
}
