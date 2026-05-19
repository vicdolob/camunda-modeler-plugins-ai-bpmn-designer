/**
 * BPMN.js additional module that captures the modeler instance reference.
 * Registered via registerBpmnJSPlugin. The modeler registers itself as
 * a 'bpmnjs' value in static modules, so injector.get('bpmnjs') returns
 * the full Modeler instance with importXML/saveXML capabilities.
 */
function AIDesignerBridge(eventBus, injector) {
  try {
    var modeler = injector.get('bpmnjs');

    window.__aiBpmnDesignerBridge = {
      modeler: modeler,
      importXML: function(xml) {
        return modeler.importXML(xml);
      },
      saveXML: function(opts) {
        return modeler.saveXML(opts || { format: true });
      },
      eventBus: eventBus
    };

    eventBus.on('diagram.destroy', function() {
      if (window.__aiBpmnDesignerBridge && window.__aiBpmnDesignerBridge.modeler === modeler) {
        window.__aiBpmnDesignerBridge = null;
      }
    });
  } catch (e) {
    console.warn('[AI BPMN Designer] Could not acquire modeler reference:', e);
  }
}

AIDesignerBridge.$inject = ['eventBus', 'injector'];

export default {
  __init__: ['aiDesignerBridge'],
  aiDesignerBridge: ['type', AIDesignerBridge]
};
