import { computeLayout, computeWaypoints, computeLaneLayout } from './AutoLayoutEngine';

/**
 * BPMNBuilder — deterministic generation of BPMN 2.0 XML from validated ProcessSpec.
 *
 * Supports:
 *   - Multi-pool collaboration with message flows
 *   - Empty participants (black-box pools without processRef)
 *   - Boundary events (attached to tasks)
 *   - Event sub-processes (triggeredByEvent)
 *   - Data store references
 *   - Associations to text annotations
 *   - Color differentiation by actor/lane
 */

var BPMN_NS = 'http://www.omg.org/spec/BPMN/20100524/MODEL';
var BPMNDI_NS = 'http://www.omg.org/spec/BPMN/20100524/DI';
var DC_NS = 'http://www.omg.org/spec/DD/20100524/DC';
var DI_NS = 'http://www.omg.org/spec/DD/20100524/DI';
var CAMUNDA_NS = 'http://camunda.org/schema/1.0/bpmn';
var ZEEBE_NS = 'urn:zeebe';
var XSI_NS = 'http://www.w3.org/2001/XMLSchema-instance';
var BIOC_NS = 'http://bpmn.io/schema/bpmn/biocolor/1.0';
var COLOR_NS = 'http://www.omg.org/spec/BPMN/non-normative/color/1.0';

function escapeXml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Color palette for actors/lanes. Each lane gets a distinct fill+stroke color.
 */
var ACTOR_COLORS = [
  { fill: '#bbdefb', stroke: '#0d4372' },   // Blue
  { fill: '#ffe0b2', stroke: '#6b3c00' },   // Orange
  { fill: '#c8e6c9', stroke: '#205022' },   // Green
  { fill: '#f8bbd0', stroke: '#7a1f3e' },   // Pink
  { fill: '#e1bee7', stroke: '#4a148c' },   // Purple
  { fill: '#b2dfdb', stroke: '#004d40' },   // Teal
  { fill: '#fff9c4', stroke: '#5d4037' },   // Yellow
  { fill: '#d7ccc8', stroke: '#3e2723' },   // Brown
  { fill: '#ffcdd2', stroke: '#831311' },   // Red
  { fill: '#b3e5fc', stroke: '#01579b' }    // Light blue
];

function getActorColorMap(lanes) {
  var map = {};
  lanes.forEach(function(lane, i) {
    map[lane.id] = ACTOR_COLORS[i % ACTOR_COLORS.length];
  });
  return map;
}

/**
 * Build BPMN 2.0 XML string from a validated ProcessSpec.
 */
export function buildBPMN(spec, platform, options) {
  platform = platform || 'camunda7';
  options = options || {};

  var isCamunda7 = platform === 'camunda7';
  var isCamunda8 = platform === 'camunda8';
  var colorByActor = options.colorByActor || false;

  var positions = computeLayout(spec);
  var lanePositions = computeLaneLayout(spec.lanes || [], positions, spec.nodes || []);

  var processId = spec.process.id;
  var processName = escapeXml(spec.process.name);
  var isExecutable = spec.process.isExecutable !== false;

  // Build color map if coloring is enabled
  var actorColorMap = colorByActor ? getActorColorMap(spec.lanes || []) : null;

  var xmlParts = [];

  // --- XML Header ---
  xmlParts.push('<?xml version="1.0" encoding="UTF-8"?>');
  xmlParts.push('<bpmn:definitions');
  xmlParts.push('  xmlns:bpmn="' + BPMN_NS + '"');
  xmlParts.push('  xmlns:bpmndi="' + BPMNDI_NS + '"');
  xmlParts.push('  xmlns:dc="' + DC_NS + '"');
  xmlParts.push('  xmlns:di="' + DI_NS + '"');
  xmlParts.push('  xmlns:xsi="' + XSI_NS + '"');
  if (isCamunda7) {
    xmlParts.push('  xmlns:camunda="' + CAMUNDA_NS + '"');
  }
  if (isCamunda8) {
    xmlParts.push('  xmlns:zeebe="' + ZEEBE_NS + '"');
  }
  xmlParts.push('  xmlns:bioc="' + BIOC_NS + '"');
  xmlParts.push('  xmlns:color="' + COLOR_NS + '"');
  xmlParts.push('  id="Definitions_1"');
  xmlParts.push('  targetNamespace="' + BPMN_NS + '">');

  // --- Collaboration (if participants or message flows exist) ---
  var participants = spec.participants || [];
  var messageFlows = spec.messageFlows || [];

  if (participants.length > 0 || messageFlows.length > 0) {
    xmlParts.push('  <bpmn:collaboration id="Collaboration_1">');

    // Participants — some may be empty pools (no processRef)
    participants.forEach(function(p) {
      var pAttrs = ' id="' + escapeXml(p.id) + '" name="' + escapeXml(p.name) + '"';
      // Only add processRef if explicitly set (not null/undefined and not empty)
      if (p.processRef) {
        pAttrs += ' processRef="' + escapeXml(p.processRef) + '"';
      }
      xmlParts.push('    <bpmn:participant' + pAttrs + ' />');
    });

    // Message flows
    messageFlows.forEach(function(mf) {
      var mfAttrs = ' id="' + escapeXml(mf.id) + '" sourceRef="' + escapeXml(mf.sourceRef) + '" targetRef="' + escapeXml(mf.targetRef) + '"';
      if (mf.name) mfAttrs += ' name="' + escapeXml(mf.name) + '"';
      xmlParts.push('    <bpmn:messageFlow' + mfAttrs + ' />');
    });

    xmlParts.push('  </bpmn:collaboration>');
  }

  // --- Process ---
  xmlParts.push('  <bpmn:process id="' + escapeXml(processId) + '" name="' + processName + '"' + (isExecutable ? ' isExecutable="true"' : '') + '>');

  // --- LaneSet ---
  var lanes = spec.lanes || [];
  if (lanes.length > 0) {
    xmlParts.push('    <bpmn:laneSet id="LaneSet_1">');
    lanes.forEach(function(lane) {
      // Only include nodes that are NOT boundary events (they can't be in lanes)
      var flowNodeRefs = spec.nodes
        .filter(function(n) {
          return n.laneRef === lane.id && n.type !== 'boundaryEvent';
        })
        .map(function(n) { return '        <bpmn:flowNodeRef>' + escapeXml(n.id) + '</bpmn:flowNodeRef>'; })
        .join('\n');
      xmlParts.push('      <bpmn:lane id="' + escapeXml(lane.id) + '" name="' + escapeXml(lane.name) + '">');
      if (flowNodeRefs) xmlParts.push(flowNodeRefs);
      xmlParts.push('      </bpmn:lane>');
    });
    xmlParts.push('    </bpmn:laneSet>');
  }

  // --- Nodes ---
  (spec.nodes || []).forEach(function(node) {
    var id = escapeXml(node.id);
    var name = escapeXml(node.name);
    var attrs = ' id="' + id + '"' + (name ? ' name="' + name + '"' : '');
    var doc = node.documentation ? escapeXml(node.documentation) : null;

    switch (node.type) {
      case 'startEvent':
        xmlParts.push(buildStartEvent(attrs, node, doc));
        break;

      case 'endEvent':
        xmlParts.push(buildEndEvent(attrs, node, doc));
        break;

      case 'userTask':
        xmlParts.push(buildTask('bpmn:userTask', node, attrs, platform, doc));
        break;

      case 'serviceTask':
        xmlParts.push(buildTask('bpmn:serviceTask', node, attrs, platform, doc));
        break;

      case 'scriptTask':
        xmlParts.push(buildTask('bpmn:scriptTask', node, attrs, platform, doc));
        break;

      case 'businessRuleTask':
        xmlParts.push(buildTask('bpmn:businessRuleTask', node, attrs, platform, doc));
        break;

      case 'manualTask':
        xmlParts.push(wrapWithDoc('bpmn:manualTask' + attrs, doc));
        break;

      case 'sendTask':
        xmlParts.push(buildTask('bpmn:sendTask', node, attrs, platform, doc));
        break;

      case 'receiveTask':
        xmlParts.push(buildTask('bpmn:receiveTask', node, attrs, platform, doc));
        break;

      case 'exclusiveGateway':
        xmlParts.push(wrapWithDoc('bpmn:exclusiveGateway' + attrs, doc));
        break;

      case 'parallelGateway':
        xmlParts.push(wrapWithDoc('bpmn:parallelGateway' + attrs, doc));
        break;

      case 'intermediateCatchEvent':
        xmlParts.push(buildIntermediateCatchEvent(attrs, node, doc));
        break;

      case 'intermediateThrowEvent':
        xmlParts.push(buildIntermediateThrowEvent(attrs, node, doc));
        break;

      case 'callActivity':
        xmlParts.push(wrapWithDoc('bpmn:callActivity' + attrs, doc));
        break;

      case 'subProcess':
        xmlParts.push('    <bpmn:subProcess' + attrs + '>');
        if (doc) xmlParts.push('      <bpmn:documentation>' + doc + '</bpmn:documentation>');
        xmlParts.push('    </bpmn:subProcess>');
        break;

      case 'eventSubProcess':
        xmlParts.push('    <bpmn:subProcess' + attrs + ' triggeredByEvent="true">');
        if (doc) xmlParts.push('      <bpmn:documentation>' + doc + '</bpmn:documentation>');
        xmlParts.push('    </bpmn:subProcess>');
        break;

      case 'boundaryEvent':
        xmlParts.push(buildBoundaryEvent(attrs, node, doc));
        break;

      default:
        xmlParts.push(wrapWithDoc('bpmn:task' + attrs, doc));
    }
  });

  // --- Sequence Flows ---
  (spec.flows || []).forEach(function(flow) {
    var id = escapeXml(flow.id);
    var attrs = ' id="' + id + '" sourceRef="' + escapeXml(flow.sourceRef) + '" targetRef="' + escapeXml(flow.targetRef) + '"';
    var nameAttr = flow.name ? ' name="' + escapeXml(flow.name) + '"' : '';
    var flowDoc = flow.documentation ? escapeXml(flow.documentation) : null;

    if (flow.condition || flowDoc) {
      xmlParts.push('    <bpmn:sequenceFlow' + attrs + nameAttr + '>');
      if (flowDoc) {
        xmlParts.push('      <bpmn:documentation>' + flowDoc + '</bpmn:documentation>');
      }
      if (flow.condition) {
        xmlParts.push('      <bpmn:conditionExpression xsi:type="bpmn:tFormalExpression">' + escapeXml(flow.condition) + '</bpmn:conditionExpression>');
      }
      xmlParts.push('    </bpmn:sequenceFlow>');
    } else {
      xmlParts.push('    <bpmn:sequenceFlow' + attrs + nameAttr + ' />');
    }
  });

  // --- Data Objects ---
  (spec.dataObjects || []).forEach(function(dobj) {
    xmlParts.push('    <bpmn:dataObject id="' + escapeXml(dobj.id) + '" name="' + escapeXml(dobj.name) + '" />');
  });

  // --- Data Store References ---
  (spec.dataStoreReferences || []).forEach(function(ds) {
    xmlParts.push('    <bpmn:dataStoreReference id="' + escapeXml(ds.id) + '" name="' + escapeXml(ds.name) + '" />');
  });

  // --- Artifacts ---
  (spec.artifacts || []).forEach(function(art) {
    if (art.type === 'textAnnotation') {
      xmlParts.push('    <bpmn:textAnnotation id="' + escapeXml(art.id) + '">');
      xmlParts.push('      <bpmn:text>' + escapeXml(art.text || '') + '</bpmn:text>');
      xmlParts.push('    </bpmn:textAnnotation>');
    } else if (art.type === 'group') {
      xmlParts.push('    <bpmn:group id="' + escapeXml(art.id) + '" categoryValueRef="" />');
    } else if (art.type === 'association') {
      var assocAttrs = ' id="' + escapeXml(art.id) + '"';
      if (art.sourceRef) assocAttrs += ' sourceRef="' + escapeXml(art.sourceRef) + '"';
      if (art.targetRef) assocAttrs += ' targetRef="' + escapeXml(art.targetRef) + '"';
      xmlParts.push('    <bpmn:association' + assocAttrs + ' />');
    }
  });

  xmlParts.push('  </bpmn:process>');

  // --- DI (Diagram Interchange) ---
  // When collaboration exists, BPMNPlane must reference the collaboration, not the process
  var planeElement = participants.length > 0 ? 'Collaboration_1' : processId;
  xmlParts.push('  <bpmndi:BPMNDiagram id="BPMNDiagram_1">');
  xmlParts.push('    <bpmndi:BPMNPlane id="BPMNPlane_1" bpmnElement="' + escapeXml(planeElement) + '">');

  // Participant shapes (for collaboration diagrams)
  var participantPositions = computeParticipantLayout(participants, positions, spec.nodes || [], lanePositions);
  participants.forEach(function(p) {
    var pp = participantPositions[p.id];
    if (pp) {
      xmlParts.push('      <bpmndi:BPMNShape id="' + escapeXml(p.id) + '_di" bpmnElement="' + escapeXml(p.id) + '" isHorizontal="true">');
      xmlParts.push('        <dc:Bounds x="' + pp.x + '" y="' + pp.y + '" width="' + pp.width + '" height="' + pp.height + '" />');
      xmlParts.push('      </bpmndi:BPMNShape>');
    }
  });

  // Lane shapes
  lanes.forEach(function(lane) {
    var lp = lanePositions[lane.id];
    if (lp) {
      xmlParts.push('      <bpmndi:BPMNShape id="' + escapeXml(lane.id) + '_di" bpmnElement="' + escapeXml(lane.id) + '" isHorizontal="true">');
      xmlParts.push('        <dc:Bounds x="' + lp.x + '" y="' + lp.y + '" width="' + lp.width + '" height="' + lp.height + '" />');
      xmlParts.push('      </bpmndi:BPMNShape>');
    }
  });

  // Node shapes (with optional color)
  (spec.nodes || []).forEach(function(node) {
    var pos = positions[node.id];
    if (!pos) return;

    var isEvent = ['startEvent', 'endEvent', 'intermediateCatchEvent', 'intermediateThrowEvent'].indexOf(node.type) >= 0;
    var isGateway = ['exclusiveGateway', 'parallelGateway'].indexOf(node.type) >= 0;
    var isBoundary = node.type === 'boundaryEvent';

    var shapeAttrs = ' id="' + escapeXml(node.id) + '_di" bpmnElement="' + escapeXml(node.id) + '"';
    if (isBoundary) {
      shapeAttrs += '';
    }

    // Color attributes
    var colorAttrs = '';
    if (colorByActor && node.laneRef && actorColorMap && actorColorMap[node.laneRef]) {
      var colors = actorColorMap[node.laneRef];
      colorAttrs = ' bioc:stroke="' + colors.stroke + '" bioc:fill="' + colors.fill + '"' +
        ' color:background-color="' + colors.fill + '" color:border-color="' + colors.stroke + '"';
    }

    xmlParts.push('      <bpmndi:BPMNShape' + shapeAttrs + colorAttrs + '>');
    xmlParts.push('        <dc:Bounds x="' + pos.x + '" y="' + pos.y + '" width="' + pos.width + '" height="' + pos.height + '" />');
    xmlParts.push('      </bpmndi:BPMNShape>');
  });

  // Data store reference shapes
  (spec.dataStoreReferences || []).forEach(function(ds) {
    var dsPos = positions[ds.id];
    if (dsPos) {
      xmlParts.push('      <bpmndi:BPMNShape id="' + escapeXml(ds.id) + '_di" bpmnElement="' + escapeXml(ds.id) + '">');
      xmlParts.push('        <dc:Bounds x="' + dsPos.x + '" y="' + dsPos.y + '" width="' + dsPos.width + '" height="' + dsPos.height + '" />');
      xmlParts.push('      </bpmndi:BPMNShape>');
    }
  });

  // Text annotation shapes
  (spec.artifacts || []).forEach(function(art) {
    if (art.type === 'textAnnotation') {
      var artPos = positions[art.id];
      if (artPos) {
        xmlParts.push('      <bpmndi:BPMNShape id="' + escapeXml(art.id) + '_di" bpmnElement="' + escapeXml(art.id) + '">');
        xmlParts.push('        <dc:Bounds x="' + artPos.x + '" y="' + artPos.y + '" width="' + artPos.width + '" height="' + artPos.height + '" />');
        xmlParts.push('      </bpmndi:BPMNShape>');
      }
    }
  });

  // Flow edges
  (spec.flows || []).forEach(function(flow) {
    var srcPos = positions[flow.sourceRef];
    var tgtPos = positions[flow.targetRef];
    if (!srcPos || !tgtPos) return;

    var waypoints = computeWaypoints(srcPos, tgtPos);
    xmlParts.push('      <bpmndi:BPMNEdge id="' + escapeXml(flow.id) + '_di" bpmnElement="' + escapeXml(flow.id) + '">');
    waypoints.forEach(function(wp) {
      xmlParts.push('        <di:waypoint x="' + Math.round(wp.x) + '" y="' + Math.round(wp.y) + '" />');
    });
    xmlParts.push('      </bpmndi:BPMNEdge>');
  });

  // Message flow edges
  messageFlows.forEach(function(mf) {
    var srcPos = positions[mf.sourceRef] || participantPositions[mf.sourceRef];
    var tgtPos = positions[mf.targetRef] || participantPositions[mf.targetRef];
    if (!srcPos || !tgtPos) return;

    var waypoints = computeWaypoints(srcPos, tgtPos);
    xmlParts.push('      <bpmndi:BPMNEdge id="' + escapeXml(mf.id) + '_di" bpmnElement="' + escapeXml(mf.id) + '">');
    waypoints.forEach(function(wp) {
      xmlParts.push('        <di:waypoint x="' + Math.round(wp.x) + '" y="' + Math.round(wp.y) + '" />');
    });
    xmlParts.push('      </bpmndi:BPMNEdge>');
  });

  // Association edges
  (spec.artifacts || []).forEach(function(art) {
    if (art.type === 'association' && art.sourceRef && art.targetRef) {
      var srcPos = positions[art.sourceRef];
      var tgtPos = positions[art.targetRef];
      if (!srcPos || !tgtPos) return;

      var waypoints = computeWaypoints(srcPos, tgtPos);
      xmlParts.push('      <bpmndi:BPMNEdge id="' + escapeXml(art.id) + '_di" bpmnElement="' + escapeXml(art.id) + '">');
      waypoints.forEach(function(wp) {
        xmlParts.push('        <di:waypoint x="' + Math.round(wp.x) + '" y="' + Math.round(wp.y) + '" />');
      });
      xmlParts.push('      </bpmndi:BPMNEdge>');
    }
  });

  xmlParts.push('    </bpmndi:BPMNPlane>');
  xmlParts.push('  </bpmndi:BPMNDiagram>');
  xmlParts.push('</bpmn:definitions>');

  return xmlParts.join('\n');
}

/**
 * Build a start event, optionally with an event definition (message, timer, etc.)
 */
function buildStartEvent(attrs, node, doc) {
  var eventType = node.eventType;
  if (!eventType) {
    return wrapWithDoc('bpmn:startEvent' + attrs, doc);
  }
  var lines = ['    <bpmn:startEvent' + attrs + '>'];
  if (doc) lines.push('      <bpmn:documentation>' + doc + '</bpmn:documentation>');
  lines.push('      <bpmn:' + eventType + 'EventDefinition />');
  lines.push('    </bpmn:startEvent>');
  return lines.join('\n');
}

/**
 * Build an end event, optionally with an event definition (error, terminate, etc.)
 */
function buildEndEvent(attrs, node, doc) {
  var eventType = node.eventType;
  if (!eventType) {
    return wrapWithDoc('bpmn:endEvent' + attrs, doc);
  }
  var lines = ['    <bpmn:endEvent' + attrs + '>'];
  if (doc) lines.push('      <bpmn:documentation>' + doc + '</bpmn:documentation>');
  lines.push('      <bpmn:' + eventType + 'EventDefinition />');
  lines.push('    </bpmn:endEvent>');
  return lines.join('\n');
}

/**
 * Build an intermediate catch event with event definition.
 */
function buildIntermediateCatchEvent(attrs, node, doc) {
  var eventType = node.eventType || 'message';
  var lines = ['    <bpmn:intermediateCatchEvent' + attrs + '>'];
  if (doc) lines.push('      <bpmn:documentation>' + doc + '</bpmn:documentation>');
  lines.push('      <bpmn:' + eventType + 'EventDefinition />');
  lines.push('    </bpmn:intermediateCatchEvent>');
  return lines.join('\n');
}

/**
 * Build an intermediate throw event with optional event definition.
 */
function buildIntermediateThrowEvent(attrs, node, doc) {
  var eventType = node.eventType;
  if (!eventType) {
    return wrapWithDoc('bpmn:intermediateThrowEvent' + attrs, doc);
  }
  var lines = ['    <bpmn:intermediateThrowEvent' + attrs + '>'];
  if (doc) lines.push('      <bpmn:documentation>' + doc + '</bpmn:documentation>');
  lines.push('      <bpmn:' + eventType + 'EventDefinition />');
  lines.push('    </bpmn:intermediateThrowEvent>');
  return lines.join('\n');
}

/**
 * Build a boundary event attached to a task.
 */
function buildBoundaryEvent(attrs, node, doc) {
  var eventType = node.eventType || 'timer';
  var cancelActivity = node.cancelActivity !== false;
  var bAttrs = attrs + ' attachedToRef="' + escapeXml(node.attachedToRef) + '"' +
    (cancelActivity ? '' : ' cancelActivity="false"');

  var lines = ['    <bpmn:boundaryEvent' + bAttrs + '>'];
  if (doc) lines.push('      <bpmn:documentation>' + doc + '</bpmn:documentation>');
  lines.push('      <bpmn:' + eventType + 'EventDefinition />');
  lines.push('    </bpmn:boundaryEvent>');
  return lines.join('\n');
}

/**
 * Wrap a self-closing BPMN element with documentation if present.
 */
function wrapWithDoc(tagWithAttrs, doc) {
  if (!doc) {
    return '    <' + tagWithAttrs + ' />';
  }
  return '    <' + tagWithAttrs + '>\n      <bpmn:documentation>' + doc + '</bpmn:documentation>\n    </' + tagWithAttrs.split(' ')[0] + '>';
}

/**
 * Build a task element with extension properties and optional documentation.
 */
function buildTask(tagName, node, attrs, platform, doc) {
  var props = node.properties || {};
  var hasExtensions = false;
  var extensionParts = [];

  if (platform === 'camunda7') {
    Object.keys(props).forEach(function(key) {
      if (key.startsWith('camunda:')) {
        hasExtensions = true;
      }
    });
  } else if (platform === 'camunda8') {
    if (props['zeebe:taskDefinitionType']) {
      hasExtensions = true;
      extensionParts.push('        <zeebe:taskDefinition type="' + escapeXml(props['zeebe:taskDefinitionType']) + '" />');
    }
    if (props['zeebe:taskDefinition']) {
      hasExtensions = true;
      extensionParts.push('        <zeebe:taskDefinition type="' + escapeXml(props['zeebe:taskDefinition']) + '" />');
    }
  }

  var extraAttrs = '';
  if (platform === 'camunda7' && props['camunda:assignee']) {
    extraAttrs += ' camunda:assignee="' + escapeXml(props['camunda:assignee']) + '"';
  }
  if (platform === 'camunda7' && props['camunda:delegateExpression']) {
    extraAttrs += ' camunda:delegateExpression="' + escapeXml(props['camunda:delegateExpression']) + '"';
  }

  var needsBody = hasExtensions || doc;

  if (needsBody) {
    var lines = ['    <' + tagName + attrs + extraAttrs + '>'];
    if (doc) {
      lines.push('      <bpmn:documentation>' + doc + '</bpmn:documentation>');
    }
    if (hasExtensions && extensionParts.length > 0) {
      lines.push('      <bpmn:extensionElements>');
      extensionParts.forEach(function(p) { lines.push(p); });
      lines.push('      </bpmn:extensionElements>');
    }
    lines.push('    </' + tagName + '>');
    return lines.join('\n');
  }

  return '    <' + tagName + attrs + extraAttrs + ' />';
}

/**
 * Compute layout positions for participants (pools).
 * Each participant that has a processRef wraps around its process's lanes/nodes.
 * Empty participants (no processRef) are placed above the process as separate bands.
 */
function computeParticipantLayout(participants, positions, nodes, lanePositions) {
  if (!participants.length) return {};

  var result = {};
  var nodeIds = Object.keys(positions);

  // Find bounding box of all nodes in the process
  var allMinX = Infinity, allMinY = Infinity, allMaxX = -Infinity, allMaxY = -Infinity;
  nodeIds.forEach(function(nid) {
    var p = positions[nid];
    if (p) {
      if (p.x - 30 < allMinX) allMinX = p.x - 30;
      if (p.y - 30 < allMinY) allMinY = p.y - 30;
      if (p.x + p.width + 30 > allMaxX) allMaxX = p.x + p.width + 30;
      if (p.y + p.height + 30 > allMaxY) allMaxY = p.y + p.height + 30;
    }
  });

  if (allMinX === Infinity) { allMinX = 0; allMinY = 0; allMaxX = 800; allMaxY = 400; }

  // Adjust bounds to include lane positions
  var laneKeys = Object.keys(lanePositions);
  laneKeys.forEach(function(lid) {
    var lp = lanePositions[lid];
    if (lp) {
      if (lp.x < allMinX) allMinX = lp.x;
      if (lp.y < allMinY) allMinY = lp.y;
      if (lp.x + lp.width > allMaxX) allMaxX = lp.x + lp.width;
      if (lp.y + lp.height > allMaxY) allMaxY = lp.y + lp.height;
    }
  });

  // Count empty pools to know how much space to allocate above
  var emptyPools = participants.filter(function(p) { return !p.processRef; });
  var emptyPoolHeight = 60;
  var emptyPoolGap = 80;
  var totalEmptyPoolSpace = emptyPools.length * (emptyPoolHeight + emptyPoolGap);

  // Offset everything down to make room for empty pools above
  var offsetY = totalEmptyPoolSpace;

  // Place empty pools ABOVE the main process
  var emptyPoolIndex = 0;
  participants.forEach(function(p) {
    if (!p.processRef) {
      var emptyY = allMinY - 30 + emptyPoolIndex * (emptyPoolHeight + emptyPoolGap);
      result[p.id] = {
        x: allMinX - 30,
        y: emptyY,
        width: allMaxX - allMinX + 60,
        height: emptyPoolHeight
      };
      emptyPoolIndex++;
    }
  });

  // Main participant wraps the process (shifted down by empty pool space)
  participants.forEach(function(p) {
    if (p.processRef) {
      result[p.id] = {
        x: allMinX - 30,
        y: allMinY - 30 + offsetY,
        width: allMaxX - allMinX + 60,
        height: allMaxY - allMinY + 60
      };
    }
  });

  // Shift all node positions down by offsetY to make room for empty pools
  nodeIds.forEach(function(nid) {
    if (positions[nid]) {
      positions[nid].y += offsetY;
    }
  });

  // Shift lane positions down too
  laneKeys.forEach(function(lid) {
    if (lanePositions[lid]) {
      lanePositions[lid].y += offsetY;
    }
  });

  return result;
}
