import React from 'react';
import { registerClientExtension, registerBpmnJSPlugin } from 'camunda-modeler-plugin-helpers';
import AiDesignerPanel from './AiDesignerPanel';
import ModelerBridgeModule from './services/ModelerBridgeModule';

registerClientExtension(AiDesignerPanel);
registerBpmnJSPlugin(ModelerBridgeModule);
