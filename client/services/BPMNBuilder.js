import { computeLayout, computeWaypoints, computeLaneLayout } from './AutoLayoutEngine';

/**
 * BPMNBuilder — deterministic generation of BPMN 2.0 XML from validated ProcessSpec.
 *
 * Generates both semantic elements and DI (Diagram Interchange) layout elements.
 * Uses the AutoLayoutEngine for coordinate computation.
 */

var BPMN_NS = 'http://www.omg.org/spec/BPMN/20100524/MODEL';
var BPMNDI_NS = 'http://www.omg.org/spec/BPMN/20100524/DI';
var DC_NS = 'http://www.omg.org/spec/DD/20100524/DC';
var DI_NS = 'http://www.omg.org/spec/DD/20100524/DI';
var CAMUNDA_NS = 'http://camunda.org/schema/1.0/bpmn';
var ZEEBE_NS = 'urn:zeebe';
var XSI_NS = 'http://www.w3.org/2001/XMLSchema-instance';

function escapeXml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Build BPMN 2.0 XML string from a validated ProcessSpec.
 */
export function buildBPMN(spec, platform) {
  platform = platform || 'camunda7';

  var isCamunda7 = platform === 'camunda7';
  var isCamunda8 = platform === 'camunda8';

  var positions = computeLayout(spec);
  var lanePositions = computeLaneLayout(spec.lanes || [], positions, spec.nodes || []);

  var processId = spec.process.id;
  var processName = escapeXml(spec.process.name);
  var isExecutable = spec.process.isExecutable !== false;

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
  xmlParts.push('  id="Definitions_1"');
  xmlParts.push('  targetNamespace="' + BPMN_NS + '">');

  // --- Collaboration (if participants exist) ---
  var participants = spec.participants || [];
  if (participants.length > 0) {
    xmlParts.push('  <bpmn:collaboration id="Collaboration_1">');
    participants.forEach(function(p) {
      xmlParts.push('    <bpmn:participant id="' + escapeXml(p.id) + '" name="' + escapeXml(p.name) + '" processRef="' + escapeXml(processId) + '" />');
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
      var flowNodeRefs = spec.nodes
        .filter(function(n) { return n.laneRef === lane.id; })
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

    switch (node.type) {
      case 'startEvent':
        xmlParts.push('    <bpmn:startEvent' + attrs + ' />');
        break;

      case 'endEvent':
        xmlParts.push('    <bpmn:endEvent' + attrs + ' />');
        break;

      case 'userTask':
        xmlParts.push(buildTask('bpmn:userTask', node, attrs, platform));
        break;

      case 'serviceTask':
        xmlParts.push(buildTask('bpmn:serviceTask', node, attrs, platform));
        break;

      case 'scriptTask':
        xmlParts.push(buildTask('bpmn:scriptTask', node, attrs, platform));
        break;

      case 'businessRuleTask':
        xmlParts.push(buildTask('bpmn:businessRuleTask', node, attrs, platform));
        break;

      case 'manualTask':
        xmlParts.push('    <bpmn:manualTask' + attrs + ' />');
        break;

      case 'exclusiveGateway':
        xmlParts.push('    <bpmn:exclusiveGateway' + attrs + ' />');
        break;

      case 'parallelGateway':
        xmlParts.push('    <bpmn:parallelGateway' + attrs + ' />');
        break;

      case 'intermediateCatchEvent':
        xmlParts.push('    <bpmn:intermediateCatchEvent' + attrs + ' />');
        break;

      case 'intermediateThrowEvent':
        xmlParts.push('    <bpmn:intermediateThrowEvent' + attrs + ' />');
        break;

      case 'callActivity':
        xmlParts.push('    <bpmn:callActivity' + attrs + ' />');
        break;

      case 'subProcess':
        xmlParts.push('    <bpmn:subProcess' + attrs + '>');
        xmlParts.push('    </bpmn:subProcess>');
        break;

      default:
        xmlParts.push('    <bpmn:task' + attrs + ' />');
    }
  });

  // --- Sequence Flows ---
  (spec.flows || []).forEach(function(flow) {
    var id = escapeXml(flow.id);
    var attrs = ' id="' + id + '" sourceRef="' + escapeXml(flow.sourceRef) + '" targetRef="' + escapeXml(flow.targetRef) + '"';

    if (flow.condition) {
      xmlParts.push('    <bpmn:sequenceFlow' + attrs + '>');
      xmlParts.push('      <bpmn:conditionExpression xsi:type="bpmn:tFormalExpression">' + escapeXml(flow.condition) + '</bpmn:conditionExpression>');
      xmlParts.push('    </bpmn:sequenceFlow>');
    } else {
      var nameAttr = flow.name ? ' name="' + escapeXml(flow.name) + '"' : '';
      xmlParts.push('    <bpmn:sequenceFlow' + attrs + nameAttr + ' />');
    }
  });

  // --- Data Objects ---
  (spec.dataObjects || []).forEach(function(dobj) {
    xmlParts.push('    <bpmn:dataObject id="' + escapeXml(dobj.id) + '" name="' + escapeXml(dobj.name) + '" />');
  });

  // --- Artifacts ---
  (spec.artifacts || []).forEach(function(art) {
    if (art.type === 'textAnnotation') {
      xmlParts.push('    <bpmn:textAnnotation id="' + escapeXml(art.id) + '">');
      xmlParts.push('      <bpmn:text>' + escapeXml(art.text) + '</bpmn:text>');
      xmlParts.push('    </bpmn:textAnnotation>');
    } else if (art.type === 'group') {
      xmlParts.push('    <bpmn:group id="' + escapeXml(art.id) + '" categoryValueRef="" />');
    }
  });

  xmlParts.push('  </bpmn:process>');

  // --- DI (Diagram Interchange) ---
  xmlParts.push('  <bpmndi:BPMNDiagram id="BPMNDiagram_1">');
  xmlParts.push('    <bpmndi:BPMNPlane id="BPMNPlane_1" bpmnElement="' + escapeXml(processId) + '">');

  // Lane shapes
  lanes.forEach(function(lane) {
    var lp = lanePositions[lane.id];
    if (lp) {
      xmlParts.push('      <bpmndi:BPMNShape id="' + escapeXml(lane.id) + '_di" bpmnElement="' + escapeXml(lane.id) + '">');
      xmlParts.push('        <dc:Bounds x="' + lp.x + '" y="' + lp.y + '" width="' + lp.width + '" height="' + lp.height + '" />');
      xmlParts.push('      </bpmndi:BPMNShape>');
    }
  });

  // Node shapes
  (spec.nodes || []).forEach(function(node) {
    var pos = positions[node.id];
    if (!pos) return;

    var isEvent = ['startEvent', 'endEvent', 'intermediateCatchEvent', 'intermediateThrowEvent'].indexOf(node.type) >= 0;
    var isGateway = ['exclusiveGateway', 'parallelGateway'].indexOf(node.type) >= 0;

    xmlParts.push('      <bpmndi:BPMNShape id="' + escapeXml(node.id) + '_di" bpmnElement="' + escapeXml(node.id) + '"' + (isEvent ? '' : '') + '>');
    if (isEvent || isGateway) {
      xmlParts.push('        <dc:Bounds x="' + pos.x + '" y="' + pos.y + '" width="' + pos.width + '" height="' + pos.height + '" />');
    } else {
      xmlParts.push('        <dc:Bounds x="' + pos.x + '" y="' + pos.y + '" width="' + pos.width + '" height="' + pos.height + '" />');
    }
    xmlParts.push('      </bpmndi:BPMNShape>');
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

  xmlParts.push('    </bpmndi:BPMNPlane>');
  xmlParts.push('  </bpmndi:BPMNDiagram>');
  xmlParts.push('</bpmn:definitions>');

  return xmlParts.join('\n');
}

/**
 * Build a task element with extension properties.
 */
function buildTask(tagName, node, attrs, platform) {
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

  // Add camunda assignee as attribute on the task element
  var extraAttrs = '';
  if (platform === 'camunda7' && props['camunda:assignee']) {
    extraAttrs += ' camunda:assignee="' + escapeXml(props['camunda:assignee']) + '"';
  }
  if (platform === 'camunda7' && props['camunda:delegateExpression']) {
    extraAttrs += ' camunda:delegateExpression="' + escapeXml(props['camunda:delegateExpression']) + '"';
  }

  if (hasExtensions && extensionParts.length > 0) {
    var lines = ['    <' + tagName + attrs + extraAttrs + '>'];
    lines.push('      <bpmn:extensionElements>');
    extensionParts.forEach(function(p) { lines.push(p); });
    lines.push('      </bpmn:extensionElements>');
    lines.push('    </' + tagName + '>');
    return lines.join('\n');
  }

  return '    <' + tagName + attrs + extraAttrs + ' />';
}
