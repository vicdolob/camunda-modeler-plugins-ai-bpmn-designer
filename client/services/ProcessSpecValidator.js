import schema from '../schema/process-spec-v1.json';

/**
 * ProcessSpec Validator — validates the LLM output against the schema
 * and enforces graph integrity constraints.
 */

function validateSchema(spec) {
  var errors = [];

  if (!spec || typeof spec !== 'object') {
    return [{ message: 'ProcessSpec is not a valid object', path: '' }];
  }

  if (spec.specVersion !== '1.0') {
    errors.push({ message: 'Invalid or missing specVersion (must be "1.0")', path: 'specVersion' });
  }

  if (!spec.process || !spec.process.id || !spec.process.name) {
    errors.push({ message: 'Missing required process.id or process.name', path: 'process' });
  }

  if (!Array.isArray(spec.nodes) || spec.nodes.length < 2) {
    errors.push({ message: 'Must have at least 2 nodes', path: 'nodes' });
  }

  if (!Array.isArray(spec.flows) || spec.flows.length < 1) {
    errors.push({ message: 'Must have at least 1 flow', path: 'flows' });
  }

  return errors;
}

function validateIds(spec) {
  var errors = [];
  var idSet = {};
  var allIds = [];

  function checkId(id, path) {
    if (!id) {
      errors.push({ message: 'Missing ID', path: path });
      return;
    }
    if (idSet[id]) {
      errors.push({ message: 'Duplicate ID: ' + id, path: path });
    }
    idSet[id] = true;
    allIds.push(id);
  }

  (spec.nodes || []).forEach(function(n, i) {
    checkId(n.id, 'nodes[' + i + '].id');
  });

  (spec.flows || []).forEach(function(f, i) {
    checkId(f.id, 'flows[' + i + '].id');
  });

  (spec.dataObjects || []).forEach(function(d, i) {
    checkId(d.id, 'dataObjects[' + i + '].id');
  });

  (spec.artifacts || []).forEach(function(a, i) {
    checkId(a.id, 'artifacts[' + i + '].id');
  });

  return { errors: errors, allIds: allIds };
}

function validateGraphIntegrity(spec) {
  var errors = [];
  var warnings = [];
  var nodes = spec.nodes || [];
  var flows = spec.flows || [];
  var nodeMap = {};
  var validNodeIds = {};

  nodes.forEach(function(n) {
    nodeMap[n.id] = n;
    validNodeIds[n.id] = true;
  });

  // Check flow references
  flows.forEach(function(f, i) {
    if (!validNodeIds[f.sourceRef]) {
      errors.push({
        message: 'Flow ' + f.id + ' references non-existent source: ' + f.sourceRef,
        path: 'flows[' + i + '].sourceRef'
      });
    }
    if (!validNodeIds[f.targetRef]) {
      errors.push({
        message: 'Flow ' + f.id + ' references non-existent target: ' + f.targetRef,
        path: 'flows[' + i + '].targetRef'
      });
    }
  });

  // Build adjacency
  var incoming = {};
  var outgoing = {};
  nodes.forEach(function(n) {
    incoming[n.id] = [];
    outgoing[n.id] = [];
  });
  flows.forEach(function(f) {
    if (outgoing[f.sourceRef]) outgoing[f.sourceRef].push(f.id);
    if (incoming[f.targetRef]) incoming[f.targetRef].push(f.id);
  });

  // Check start events
  var startEvents = nodes.filter(function(n) { return n.type === 'startEvent'; });
  if (startEvents.length === 0) {
    errors.push({ message: 'Process must have at least one startEvent', path: 'nodes' });
  }
  if (startEvents.length > 1) {
    warnings.push({ message: 'Multiple start events found — ensure this is intentional', path: 'nodes' });
  }
  startEvents.forEach(function(s) {
    if (incoming[s.id].length > 0) {
      errors.push({
        message: 'startEvent ' + s.id + ' must have no incoming flows',
        path: 'nodes[' + nodes.indexOf(s) + ']'
      });
    }
  });

  // Check end events
  var endEvents = nodes.filter(function(n) { return n.type === 'endEvent'; });
  if (endEvents.length === 0) {
    errors.push({ message: 'Process must have at least one endEvent', path: 'nodes' });
  }
  endEvents.forEach(function(e) {
    if (outgoing[e.id].length > 0) {
      errors.push({
        message: 'endEvent ' + e.id + ' must have no outgoing flows',
        path: 'nodes[' + nodes.indexOf(e) + ']'
      });
    }
  });

  // Check gateways
  nodes.forEach(function(n) {
    if (n.type === 'exclusiveGateway' || n.type === 'parallelGateway') {
      var isSplit = outgoing[n.id].length >= 2;
      var isMerge = incoming[n.id].length >= 2;
      if (!isSplit && !isMerge) {
        warnings.push({
          message: n.type + ' ' + n.id + ' has less than 2 incoming and 2 outgoing flows',
          path: 'nodes[' + nodes.indexOf(n) + ']'
        });
      }
      // Split gateways should have conditions on exclusive gateways
      if (n.type === 'exclusiveGateway' && isSplit) {
        var outFlows = flows.filter(function(f) { return f.sourceRef === n.id; });
        var flowsWithConditions = outFlows.filter(function(f) { return f.condition; });
        if (flowsWithConditions.length < outFlows.length - 1) {
          warnings.push({
            message: 'Exclusive gateway ' + n.id + ' split should have conditions on all but one outgoing flow',
            path: 'nodes[' + nodes.indexOf(n) + ']'
          });
        }
      }
    }
  });

  // Check weak connectivity (all nodes reachable from start)
  if (startEvents.length > 0) {
    var visited = {};
    var queue = [startEvents[0].id];
    visited[startEvents[0].id] = true;
    while (queue.length > 0) {
      var curr = queue.shift();
      (outgoing[curr] || []).forEach(function(fId) {
        var f = flows.find(function(fl) { return fl.id === fId; });
        if (f && !visited[f.targetRef]) {
          visited[f.targetRef] = true;
          queue.push(f.targetRef);
        }
      });
    }
    var unreachable = nodes.filter(function(n) { return !visited[n.id]; });
    if (unreachable.length > 0) {
      warnings.push({
        message: 'Unreachable nodes: ' + unreachable.map(function(n) { return n.id; }).join(', '),
        path: 'nodes'
      });
    }
  }

  // Check lane references
  var laneIds = {};
  (spec.lanes || []).forEach(function(l) { laneIds[l.id] = true; });
  nodes.forEach(function(n) {
    if (n.laneRef && !laneIds[n.laneRef]) {
      errors.push({
        message: 'Node ' + n.id + ' references non-existent lane: ' + n.laneRef,
        path: 'nodes[' + nodes.indexOf(n) + '].laneRef'
      });
    }
  });

  return { errors: errors, warnings: warnings };
}

/**
 * Validate a ProcessSpec and return a detailed report.
 */
export function validate(spec) {
  var schemaErrors = validateSchema(spec);
  if (schemaErrors.length > 0) {
    return {
      valid: false,
      errors: schemaErrors,
      warnings: []
    };
  }

  var idResult = validateIds(spec);
  var graphResult = validateGraphIntegrity(spec);

  var allErrors = idResult.errors.concat(graphResult.errors);
  var allWarnings = graphResult.warnings;

  return {
    valid: allErrors.length === 0,
    errors: allErrors,
    warnings: allWarnings
  };
}

/**
 * Try to extract ProcessSpec JSON from raw LLM text.
 * Handles markdown code blocks, leading/trailing text, etc.
 */
export function extractJSON(rawText) {
  if (!rawText || typeof rawText !== 'string') {
    throw new Error('Empty or invalid LLM response');
  }

  // Try to extract from markdown code block
  var codeBlockMatch = rawText.match(/```(?:json)?\s*\n?([\s\S]*?)\n?\s*```/);
  if (codeBlockMatch) {
    return JSON.parse(codeBlockMatch[1].trim());
  }

  // Try to find JSON object in the text
  var jsonMatch = rawText.match(/\{[\s\S]*\}/);
  if (jsonMatch) {
    return JSON.parse(jsonMatch[0]);
  }

  throw new Error('Could not extract JSON from LLM response');
}
