/**
 * Auto-Layout Engine v2 — Sugiyama-style deterministic layout.
 *
 * Improvements over v1:
 *   - No overlapping nodes: each node gets a unique Y-slot per branch
 *   - Parallel branches spread vertically with proper spacing
 *   - Gateways centered between their predecessor/successor groups
 *   - Orthogonal edge routing with smart waypoints
 *   - No disconnected/orphan nodes placed on top of others
 */

var X_STEP = 200;
var Y_STEP = 120;
var START_X = 180;
var START_Y = 120;
var LANE_PADDING = 50;
var LANE_HEIGHT = 220;
var MIN_GAP_X = 40;
var MIN_GAP_Y = 30;

// --- Node dimensions by type ---
function getNodeDimensions(type) {
  switch (type) {
    case 'startEvent':
    case 'endEvent':
      return { width: 36, height: 36 };
    case 'exclusiveGateway':
    case 'parallelGateway':
      return { width: 50, height: 50 };
    case 'intermediateThrowEvent':
    case 'intermediateCatchEvent':
      return { width: 36, height: 36 };
    default:
      return { width: 100, height: 80 };
  }
}

// --- Graph analysis helpers ---

function buildAdjacency(nodes, flows) {
  var outgoing = {};
  var incoming = {};
  var nodeSet = {};
  nodes.forEach(function(n) {
    outgoing[n.id] = [];
    incoming[n.id] = [];
    nodeSet[n.id] = n;
  });
  flows.forEach(function(f) {
    if (outgoing[f.sourceRef] && nodeSet[f.targetRef]) {
      outgoing[f.sourceRef].push(f.targetRef);
    }
    if (incoming[f.targetRef] && nodeSet[f.sourceRef]) {
      incoming[f.targetRef].push(f.sourceRef);
    }
  });
  return { outgoing: outgoing, incoming: incoming, nodeSet: nodeSet };
}

// --- Step 1: Topological sort (BFS from start events) ---

function topoSort(nodes, flows) {
  var adj = buildAdjacency(nodes, flows);
  var inDegree = {};
  nodes.forEach(function(n) { inDegree[n.id] = 0; });
  flows.forEach(function(f) {
    if (inDegree[f.targetRef] !== undefined) inDegree[f.targetRef]++;
  });

  var queue = nodes
    .filter(function(n) { return n.type === 'startEvent'; })
    .map(function(n) { return n.id; });
  if (queue.length === 0) {
    nodes.forEach(function(n) { if (inDegree[n.id] === 0) queue.push(n.id); });
  }

  var order = [];
  var visited = {};
  while (queue.length > 0) {
    var curr = queue.shift();
    if (visited[curr]) continue;
    visited[curr] = true;
    order.push(curr);
    (adj.outgoing[curr] || []).forEach(function(next) {
      inDegree[next]--;
      if (inDegree[next] === 0) queue.push(next);
    });
  }
  // Handle cycles
  nodes.forEach(function(n) {
    if (!visited[n.id]) order.push(n.id);
  });
  return order;
}

// --- Step 2: Layer assignment (longest path from source) ---

function assignLayers(nodes, flows) {
  var order = topoSort(nodes, flows);
  var predMap = {};
  flows.forEach(function(f) {
    if (!predMap[f.targetRef]) predMap[f.targetRef] = [];
    predMap[f.targetRef].push(f.sourceRef);
  });

  var layers = {};
  order.forEach(function(id) {
    var preds = predMap[id] || [];
    var maxL = -1;
    preds.forEach(function(p) {
      if (layers[p] !== undefined && layers[p] > maxL) maxL = layers[p];
    });
    layers[id] = maxL + 1;
  });
  return layers;
}

// --- Step 3: Branch detection and Y-assignment ---
// Key idea: trace each path from start events, assign Y-slots
// so parallel branches get different Y positions.

function assignYPositions(nodes, flows, layers) {
  var adj = buildAdjacency(nodes, flows);
  var nodeMap = {};
  nodes.forEach(function(n) { nodeMap[n.id] = n; });

  var yPositions = {};
  var visited = {};
  var nextY = START_Y;

  // BFS through layers, assigning Y by branching
  var layerGroups = {};
  nodes.forEach(function(n) {
    var l = layers[n.id] || 0;
    if (!layerGroups[l]) layerGroups[l] = [];
    layerGroups[l].push(n.id);
  });

  // Start events at Y = START_Y
  var startEvents = nodes.filter(function(n) { return n.type === 'startEvent'; });

  // Trace all paths and assign Y using a DFS-like approach
  function traceBranch(nodeId, ySlot, depth) {
    if (visited[nodeId]) return ySlot;
    visited[nodeId] = true;
    yPositions[nodeId] = ySlot;

    var children = adj.outgoing[nodeId] || [];
    var node = nodeMap[nodeId];
    var isGateway = node && (node.type === 'exclusiveGateway' || node.type === 'parallelGateway');

    if (children.length <= 1) {
      // Linear path — continue at same Y
      children.forEach(function(childId) {
        ySlot = traceBranch(childId, ySlot, depth + 1);
      });
    } else {
      // Branch point — spread children vertically
      var childY = ySlot;
      children.forEach(function(childId, i) {
        if (i === 0) {
          childY = traceBranch(childId, childY, depth + 1);
        } else {
          // Each new branch starts Y_STEP below the last branch's lowest point
          var lowestY = findLowestY(yPositions);
          childY = traceBranch(childId, lowestY + Y_STEP, depth + 1);
        }
      });
      ySlot = childY;
    }

    return ySlot;
  }

  function findLowestY(pos) {
    var max = START_Y;
    Object.keys(pos).forEach(function(k) {
      if (pos[k] > max) max = pos[k];
    });
    return max;
  }

  // Start tracing from each start event
  var currentY = START_Y;
  startEvents.forEach(function(se, i) {
    if (i === 0) {
      currentY = traceBranch(se.id, currentY, 0);
    } else {
      var lowestY = findLowestY(yPositions);
      currentY = traceBranch(se.id, lowestY + Y_STEP, 0);
    }
  });

  // Handle unvisited nodes (orphaned / disconnected)
  nodes.forEach(function(n) {
    if (!visited[n.id]) {
      var lowestY = findLowestY(yPositions);
      yPositions[n.id] = lowestY + Y_STEP;
    }
  });

  return yPositions;
}

// --- Step 4: Center gateways between their branch groups ---

function centerGateways(nodes, flows, positions) {
  var adj = buildAdjacency(nodes, flows);

  nodes.forEach(function(n) {
    if (n.type !== 'exclusiveGateway' && n.type !== 'parallelGateway') return;

    var pos = positions[n.id];
    if (!pos) return;

    // Center between predecessors (merge) or successors (split)
    var children = adj.outgoing[n.id] || [];
    var parents = adj.incoming[n.id] || [];

    if (children.length >= 2) {
      // Split gateway: center Y among children
      var childYs = children.map(function(c) { return positions[c] ? positions[c].y : null; }).filter(function(y) { return y !== null; });
      if (childYs.length >= 2) {
        var minY = Math.min.apply(null, childYs);
        var maxY = Math.max.apply(null, childYs);
        pos.y = Math.round((minY + maxY) / 2);
      }
    } else if (parents.length >= 2) {
      // Merge gateway: center Y among parents
      var parentYs = parents.map(function(p) { return positions[p] ? positions[p].y : null; }).filter(function(y) { return y !== null; });
      if (parentYs.length >= 2) {
        var minYp = Math.min.apply(null, parentYs);
        var maxYp = Math.max.apply(null, parentYs);
        pos.y = Math.round((minYp + maxYp) / 2);
      }
    }
  });
}

// --- Step 5: Collision detection and resolution ---

function resolveCollisions(nodes, positions) {
  // Group by layer and ensure minimum Y spacing within each layer
  var layers = {};
  nodes.forEach(function(n) {
    var pos = positions[n.id];
    if (!pos) return;
    // Determine layer from X position
    var layer = pos.x;
    if (!layers[layer]) layers[layer] = [];
    layers[layer].push(n.id);
  });

  Object.keys(layers).forEach(function(layerX) {
    var ids = layers[layerX];
    // Sort by Y position
    ids.sort(function(a, b) {
      return (positions[a].y) - (positions[b].y);
    });

    // Enforce minimum Y gap
    for (var i = 1; i < ids.length; i++) {
      var prevPos = positions[ids[i - 1]];
      var currPos = positions[ids[i]];
      var prevBottom = prevPos.y + prevPos.height + MIN_GAP_Y;
      if (currPos.y < prevBottom) {
        currPos.y = prevBottom;
      }
    }
  });
}

// --- Main layout function ---

export function computeLayout(spec) {
  var nodes = spec.nodes || [];
  var flows = spec.flows || [];
  var lanes = spec.lanes || [];

  var layers = assignLayers(nodes, flows);
  var ySlots = assignYPositions(nodes, flows, layers);

  var positions = {};

  nodes.forEach(function(n) {
    var layer = layers[n.id] || 0;
    var dims = getNodeDimensions(n.type);
    var x = START_X + layer * X_STEP;
    var y = ySlots[n.id] || START_Y;

    positions[n.id] = {
      x: x,
      y: y,
      width: dims.width,
      height: dims.height,
      type: n.type
    };
  });

  // Post-processing
  centerGateways(nodes, flows, positions);
  resolveCollisions(nodes, positions);

  // Adjust for lanes
  adjustForLanes(lanes, positions, nodes);

  return positions;
}

// --- Lane-aware Y adjustment ---

function adjustForLanes(lanes, positions, nodes) {
  if (!lanes.length) return;

  var laneNodeMap = {};
  var noLaneNodes = [];
  nodes.forEach(function(n) {
    if (n.laneRef) {
      if (!laneNodeMap[n.laneRef]) laneNodeMap[n.laneRef] = [];
      laneNodeMap[n.laneRef].push(n);
    } else {
      noLaneNodes.push(n);
    }
  });

  // Find Y range for each lane's nodes
  var laneYRanges = {};
  lanes.forEach(function(lane) {
    var laneNodes = laneNodeMap[lane.id] || [];
    if (laneNodes.length === 0) return;
    var minY = Infinity, maxY = -Infinity;
    laneNodes.forEach(function(n) {
      var p = positions[n.id];
      if (p) {
        if (p.y < minY) minY = p.y;
        if (p.y + p.height > maxY) maxY = p.y + p.height;
      }
    });
    if (minY === Infinity) return;
    laneYRanges[lane.id] = { min: minY, max: maxY };
  });

  // Stack lanes vertically if they overlap
  var currentLaneY = 0;
  var laneOffsets = {};
  lanes.forEach(function(lane, i) {
    var range = laneYRanges[lane.id];
    if (!range) {
      laneOffsets[lane.id] = 0;
      return;
    }
    if (i === 0) {
      laneOffsets[lane.id] = 0;
      currentLaneY = range.max + LANE_PADDING;
    } else {
      var offset = currentLaneY - range.min;
      if (offset > 0) {
        // Push this lane's nodes down
        (laneNodeMap[lane.id] || []).forEach(function(n) {
          if (positions[n.id]) positions[n.id].y += offset;
        });
        currentLaneY = range.max + offset + LANE_PADDING;
      } else {
        currentLaneY = range.max + LANE_PADDING;
      }
      laneOffsets[lane.id] = offset;
    }
  });
}

// --- Waypoint computation ---

export function computeWaypoints(sourcePos, targetPos) {
  // Right edge of source, left edge of target
  var srcRightX = sourcePos.x + sourcePos.width;
  var srcCenterY = sourcePos.y + sourcePos.height / 2;
  var tgtLeftX = targetPos.x;
  var tgtCenterY = targetPos.y + targetPos.height / 2;

  // Same row — straight line
  if (Math.abs(srcCenterY - tgtCenterY) < 5 && srcRightX <= tgtLeftX) {
    return [
      { x: srcRightX, y: srcCenterY },
      { x: tgtLeftX, y: tgtCenterY }
    ];
  }

  // Source is to the left — orthogonal routing
  if (srcRightX < tgtLeftX) {
    var midX = Math.round((srcRightX + tgtLeftX) / 2);
    return [
      { x: srcRightX, y: srcCenterY },
      { x: midX, y: srcCenterY },
      { x: midX, y: tgtCenterY },
      { x: tgtLeftX, y: tgtCenterY }
    ];
  }

  // Backwards edge (target is to the left of source) — route around
  var routeX = Math.max(sourcePos.x + sourcePos.width + 50, targetPos.x + targetPos.width + 50);
  return [
    { x: srcRightX, y: srcCenterY },
    { x: routeX, y: srcCenterY },
    { x: routeX, y: tgtCenterY },
    { x: tgtLeftX, y: tgtCenterY }
  ];
}

// --- Lane DI layout ---

export function computeLaneLayout(lanes, positions, nodes) {
  if (!lanes.length) return {};

  var minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  nodes.forEach(function(n) {
    var p = positions[n.id];
    if (p) {
      if (p.x - 50 < minX) minX = p.x - 50;
      if (p.y - 40 < minY) minY = p.y - 40;
      if (p.x + p.width + 50 > maxX) maxX = p.x + p.width + 50;
      if (p.y + p.height + 40 > maxY) maxY = p.y + p.height + 40;
    }
  });

  if (minX === Infinity) { minX = 0; minY = 0; maxX = 800; maxY = 400; }

  var lanePositions = {};

  // Group nodes by lane
  var laneNodeMap = {};
  nodes.forEach(function(n) {
    if (n.laneRef) {
      if (!laneNodeMap[n.laneRef]) laneNodeMap[n.laneRef] = [];
      laneNodeMap[n.laneRef].push(n);
    }
  });

  var currentY = minY - 20;
  lanes.forEach(function(lane) {
    var laneNodes = laneNodeMap[lane.id] || [];
    var laneMinY = Infinity, laneMaxY = -Infinity;
    laneNodes.forEach(function(n) {
      var p = positions[n.id];
      if (p) {
        if (p.y - 20 < laneMinY) laneMinY = p.y - 20;
        if (p.y + p.height + 20 > laneMaxY) laneMaxY = p.y + p.height + 20;
      }
    });
    if (laneMinY === Infinity) laneMinY = currentY;
    if (laneMaxY === -Infinity) laneMaxY = currentY + LANE_HEIGHT;

    var h = Math.max(LANE_HEIGHT, laneMaxY - laneMinY);
    lanePositions[lane.id] = {
      x: minX - 30,
      y: currentY,
      width: maxX - minX + 60,
      height: h
    };
    currentY += h + 5;
  });

  return lanePositions;
}
