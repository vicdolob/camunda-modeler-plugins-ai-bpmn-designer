/**
 * BPMN Reverse Parser — parses existing BPMN 2.0 XML back into ProcessSpec.
 *
 * This enables the Update mode to work with manually edited diagrams:
 *   1. User creates diagram via AI (or manually in Camunda Modeler)
 *   2. User edits the diagram on canvas (move, rename, add/remove elements)
 *   3. User switches to Update mode and enters an instruction
 *   4. Plugin calls this parser: BPMN XML → ProcessSpec
 *   5. ProcessSpec + instruction → LLM → updated ProcessSpec → new BPMN XML
 *
 * Uses DOMParser (available in Electron/Chromium environment).
 */

var BPMN_NS = 'http://www.omg.org/spec/BPMN/20100524/MODEL';

/**
 * Map BPMN XML element local names to ProcessSpec node types.
 */
var ELEMENT_TYPE_MAP = {
  'startEvent': 'startEvent',
  'endEvent': 'endEvent',
  'userTask': 'userTask',
  'serviceTask': 'serviceTask',
  'scriptTask': 'scriptTask',
  'businessRuleTask': 'businessRuleTask',
  'manualTask': 'manualTask',
  'receiveTask': 'receiveTask',
  'sendTask': 'sendTask',
  'exclusiveGateway': 'exclusiveGateway',
  'parallelGateway': 'parallelGateway',
  'intermediateCatchEvent': 'intermediateCatchEvent',
  'intermediateThrowEvent': 'intermediateThrowEvent',
  'callActivity': 'callActivity',
  'subProcess': 'subProcess',
  'task': 'task'
};

/**
 * Extract text content from <bpmn:documentation> child elements.
 */
function extractDocumentation(element) {
  var docElements = element.getElementsByTagNameNS(BPMN_NS, 'documentation');
  if (docElements.length > 0) {
    return docElements[0].textContent || '';
  }
  return null;
}

/**
 * Extract Camunda/Zeebe extension properties from an element.
 */
function extractProperties(element) {
  var props = {};
  // Camunda 7 attributes on the element itself
  var assignee = element.getAttribute('camunda:assignee');
  if (assignee) props['camunda:assignee'] = assignee;
  var delegateExpression = element.getAttribute('camunda:delegateExpression');
  if (delegateExpression) props['camunda:delegateExpression'] = delegateExpression;
  var formKey = element.getAttribute('camunda:formKey');
  if (formKey) props['camunda:formKey'] = formKey;

  // Zeebe extension elements
  var extElements = element.getElementsByTagNameNS(BPMN_NS, 'extensionElements');
  if (extElements.length > 0) {
    var zeebeTaskDefs = extElements[0].getElementsByTagName('zeebe:taskDefinition');
    for (var i = 0; i < zeebeTaskDefs.length; i++) {
      var type = zeebeTaskDefs[i].getAttribute('type');
      if (type) props['zeebe:taskDefinitionType'] = type;
    }
  }

  return Object.keys(props).length > 0 ? props : undefined;
}

/**
 * Parse a BPMN 2.0 XML string into a ProcessSpec object.
 */
export function parseBpmnXml(xmlString) {
  var parser = new DOMParser();
  var doc = parser.parseFromString(xmlString, 'application/xml');

  // Check for parse errors
  var parseError = doc.querySelector('parsererror');
  if (parseError) {
    throw new Error('XML parse error: ' + parseError.textContent.substring(0, 200));
  }

  var spec = {
    specVersion: '1.0',
    process: { id: '', name: '', isExecutable: true },
    participants: [],
    lanes: [],
    nodes: [],
    flows: [],
    dataObjects: [],
    artifacts: []
  };

  // Find the process element
  var processElements = doc.getElementsByTagNameNS(BPMN_NS, 'process');
  if (processElements.length === 0) {
    throw new Error('No <process> element found in BPMN XML');
  }

  var process = processElements[0];
  spec.process.id = process.getAttribute('id') || 'Process_1';
  spec.process.name = process.getAttribute('name') || spec.process.id;
  spec.process.isExecutable = process.getAttribute('isExecutable') !== 'false';

  // Parse participants from collaboration
  var collaborationElements = doc.getElementsByTagNameNS(BPMN_NS, 'collaboration');
  if (collaborationElements.length > 0) {
    var participants = collaborationElements[0].getElementsByTagNameNS(BPMN_NS, 'participant');
    for (var pi = 0; pi < participants.length; pi++) {
      spec.participants.push({
        id: participants[pi].getAttribute('id'),
        name: participants[pi].getAttribute('name') || participants[pi].getAttribute('id')
      });
    }
  }

  // Parse lanes
  var laneElements = process.getElementsByTagNameNS(BPMN_NS, 'lane');
  for (var li = 0; li < laneElements.length; li++) {
    var lane = laneElements[li];
    var laneNodeRefs = lane.getElementsByTagNameNS(BPMN_NS, 'flowNodeRef');
    var flowNodeRefs = [];
    for (var ri = 0; ri < laneNodeRefs.length; ri++) {
      flowNodeRefs.push(laneNodeRefs[ri].textContent);
    }
    spec.lanes.push({
      id: lane.getAttribute('id'),
      name: lane.getAttribute('name') || lane.getAttribute('id'),
      participantRef: null,
      _flowNodeRefs: flowNodeRefs  // Temporary for node→lane mapping
    });
  }

  // Build a map of node ID → lane ID
  var nodeToLane = {};
  spec.lanes.forEach(function(lane) {
    (lane._flowNodeRefs || []).forEach(function(ref) {
      nodeToLane[ref] = lane.id;
    });
    delete lane._flowNodeRefs;
  });

  // Parse flow nodes (tasks, events, gateways)
  for (var ci = 0; ci < process.childNodes.length; ci++) {
    var child = process.childNodes[ci];
    if (child.nodeType !== 1) continue; // Skip text nodes

    var localName = child.localName;
    var nodeType = ELEMENT_TYPE_MAP[localName];

    if (!nodeType) continue;

    var nodeId = child.getAttribute('id');
    var nodeName = child.getAttribute('name') || '';
    var laneRef = nodeToLane[nodeId] || null;
    var documentation = extractDocumentation(child);
    var properties = extractProperties(child);

    var nodeObj = {
      id: nodeId,
      type: nodeType,
      name: nodeName,
      laneRef: laneRef
    };

    if (documentation) nodeObj.documentation = documentation;
    if (properties) nodeObj.properties = properties;

    spec.nodes.push(nodeObj);
  }

  // Also check nested elements (e.g., subProcess children)
  var subProcessElements = process.getElementsByTagNameNS(BPMN_NS, 'subProcess');
  for (var si = 0; si < subProcessElements.length; si++) {
    var sp = subProcessElements[si];
    for (var sci = 0; sci < sp.childNodes.length; sci++) {
      var spChild = sp.childNodes[sci];
      if (spChild.nodeType !== 1) continue;
      var spLocalName = spChild.localName;
      var spNodeType = ELEMENT_TYPE_MAP[spLocalName];
      // Sub-process internal nodes are not added to the top-level process
      // for now — this is a v1 limitation
    }
  }

  // Parse sequence flows
  var flowElements = process.getElementsByTagNameNS(BPMN_NS, 'sequenceFlow');
  for (var fi = 0; fi < flowElements.length; fi++) {
    var flow = flowElements[fi];
    var flowId = flow.getAttribute('id');
    var flowName = flow.getAttribute('name') || null;
    var sourceRef = flow.getAttribute('sourceRef');
    var targetRef = flow.getAttribute('targetRef');
    var flowDoc = extractDocumentation(flow);

    // Extract condition
    var condition = null;
    var condExprs = flow.getElementsByTagNameNS(BPMN_NS, 'conditionExpression');
    if (condExprs.length > 0) {
      condition = condExprs[0].textContent || null;
    }

    var flowObj = {
      id: flowId,
      sourceRef: sourceRef,
      targetRef: targetRef,
      condition: condition,
      name: flowName
    };

    if (flowDoc) flowObj.documentation = flowDoc;
    spec.flows.push(flowObj);
  }

  // Parse data objects
  var dataObjects = process.getElementsByTagNameNS(BPMN_NS, 'dataObject');
  for (var di = 0; di < dataObjects.length; di++) {
    var dobj = dataObjects[di];
    spec.dataObjects.push({
      id: dobj.getAttribute('id'),
      name: dobj.getAttribute('name') || dobj.getAttribute('id')
    });
  }

  // Parse text annotations
  var textAnnotations = process.getElementsByTagNameNS(BPMN_NS, 'textAnnotation');
  for (var ti = 0; ti < textAnnotations.length; ti++) {
    var ta = textAnnotations[ti];
    var text = '';
    var textEls = ta.getElementsByTagNameNS(BPMN_NS, 'text');
    if (textEls.length > 0) text = textEls[0].textContent || '';
    spec.artifacts.push({
      id: ta.getAttribute('id'),
      type: 'textAnnotation',
      text: text
    });
  }

  return spec;
}

/**
 * Extract the current BPMN XML from the active modeler tab.
 */
export async function getCurrentBpmnXml() {
  var bridge = window.__aiBpmnDesignerBridge;
  if (!bridge || !bridge.modeler) {
    throw new Error('No active BPMN modeler found');
  }

  var result = await bridge.saveXML({ format: true });
  return result.xml;
}
