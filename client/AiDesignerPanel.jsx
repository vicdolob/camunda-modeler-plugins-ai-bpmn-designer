import React, { useState, useCallback, useRef, useEffect } from 'react';
import Fill from 'camunda-modeler-plugin-helpers/components/Fill';
import { SYSTEM_PROMPT, CREATE_TEMPLATE, UPDATE_TEMPLATE, CORRECTION_TEMPLATE, ENHANCE_INSTRUCTION, ENHANCE_USER_TEMPLATE } from './prompts/index';
import { validate, extractJSON } from './services/ProcessSpecValidator';
import { buildBPMN } from './services/BPMNBuilder';
import { parseBpmnXml, getCurrentBpmnXml } from './services/BpmnReverseParser';
import LLMAdapterRegistry from './services/LLMAdapterRegistry';
import './style.css';

var PIPELINE_STEPS = [
  { key: 'prompt', label: 'Prompt' },
  { key: 'llm', label: 'LLM' },
  { key: 'validate', label: 'Validate' },
  { key: 'build', label: 'Build' },
  { key: 'import', label: 'Import' }
];

function AIDesignerPanel(props) {
  var _props$subscribe = props.subscribe,
    subscribe = _props$subscribe === undefined ? function() {} : _props$subscribe,
    _props$triggerAction = props.triggerAction,
    triggerAction = _props$triggerAction === undefined ? function() {} : _props$triggerAction,
    _props$displayNotific = props.displayNotification,
    displayNotification = _props$displayNotific === undefined ? function() {} : _props$displayNotific;

  // --- State ---
  var _useState = useState('create'),
    mode = _useState[0],
    setMode = _useState[1];

  var _useState2 = useState(''),
    promptText = _useState2[0],
    setPromptText = _useState2[1];

  var _useState3 = useState('idle'),
    pipelineStatus = _useState3[0],
    setPipelineStatus = _useState3[1];

  var _useState4 = useState(-1),
    activeStep = _useState4[0],
    setActiveStep = _useState4[1];

  var _useState5 = useState(null),
    error = _useState5[0],
    setError = _useState5[1];

  var _useState6 = useState(null),
    currentSpec = _useState6[0],
    setCurrentSpec = _useState6[1];

  var _useState7 = useState(null),
    lastValidXml = _useState7[0],
    setLastValidXml = _useState7[1];

  var _useState8 = useState(false),
    showSpecPreview = _useState8[0],
    setShowSpecPreview = _useState8[1];

  var _useState9 = useState('camunda7'),
    platform = _useState9[0],
    setPlatform = _useState9[1];

  var _useState10 = useState(false),
    showSettings = _useState10[0],
    setShowSettings = _useState10[1];

  var _useState11 = useState(''),
    connectionStatus = _useState11[0],
    setConnectionStatus = _useState11[1];

  var _useStateMaxAtt = useState(3),
    maxAttempts = _useStateMaxAtt[0],
    setMaxAttempts = _useStateMaxAtt[1];

  var _useStateCurAtt = useState(0),
    currentAttempt = _useStateCurAtt[0],
    setCurrentAttempt = _useStateCurAtt[1];

  var _useStateEnhancing = useState(false),
    isEnhancing = _useStateEnhancing[0],
    setIsEnhancing = _useStateEnhancing[1];

  var registryRef = useRef(new LLMAdapterRegistry());
  var isGenerating = pipelineStatus === 'running';

  // --- Settings state ---
  var registry = registryRef.current;
  var activeProfile = registry.getActiveProfile();

  var _useState12 = useState({ ...activeProfile }),
    profileForm = _useState12[0],
    setProfileForm = _useState12[1];

  useEffect(function() {
    setProfileForm({ ...registry.getActiveProfile() });
  }, [showSettings]);

  // --- Pipeline step updater ---
  var setStep = useCallback(function(stepIndex, status) {
    setActiveStep(stepIndex);
  }, []);

  // --- Generate BPMN (Agent Loop with self-correction) ---
  var handleGenerate = useCallback(async function() {
    if (!promptText.trim()) return;

    setPipelineStatus('running');
    setError(null);
    setCurrentSpec(null);
    setCurrentAttempt(0);

    var adapter = registry.getActiveAdapter();
    var systemPrompt = SYSTEM_PROMPT;

    // Build initial user prompt
    var originalPrompt;
    var resolvedSpec = currentSpec; // Start with cached spec

    if (mode === 'create') {
      originalPrompt = CREATE_TEMPLATE.replace('{userText}', promptText);
    } else {
      // Update mode: if no cached ProcessSpec, reverse-parse current diagram
      if (!resolvedSpec) {
        try {
          setStep(0, 'active');
          var currentXml = await getCurrentBpmnXml();
          resolvedSpec = parseBpmnXml(currentXml);
          setCurrentSpec(resolvedSpec); // Cache for future updates
        } catch (parseErr) {
          throw new Error('Cannot read current diagram for update: ' + parseErr.message + '\nTry switching to Create mode instead.');
        }
      }
      var currentSpecJSON = resolvedSpec ? JSON.stringify(resolvedSpec, null, 2) : '{}';
      originalPrompt = UPDATE_TEMPLATE
        .replace('{currentSpecJSON}', currentSpecJSON)
        .replace('{userText}', promptText);
    }

    var lastRawResponse = '';
    var accumulatedErrors = [];
    var attemptHistory = [];

    for (var attempt = 1; attempt <= maxAttempts; attempt++) {
      setCurrentAttempt(attempt);

      try {
        // Step 0: Prompt
        setStep(0, 'active');

        // Decide which prompt to send: original or correction
        var userPrompt;
        if (attempt === 1) {
          userPrompt = originalPrompt;
        } else {
          userPrompt = CORRECTION_TEMPLATE
            .replace('{originalPrompt}', originalPrompt)
            .replace('{previousOutput}', lastRawResponse.substring(0, 3000))
            .replace('{errors}', accumulatedErrors.join('\n'));
        }

        // Step 1: LLM
        setStep(1, 'active');
        var rawResponse = await adapter.generateProcessSpec(userPrompt, systemPrompt);
        lastRawResponse = rawResponse;

        // Step 2: Validate
        setStep(2, 'active');
        var spec;
        try {
          spec = extractJSON(rawResponse);
        } catch (parseErr) {
          accumulatedErrors = ['JSON parse error: ' + parseErr.message];
          attemptHistory.push({ attempt: attempt, stage: 'parse', error: accumulatedErrors[0] });
          if (attempt < maxAttempts) continue;
          throw new Error('Failed to parse LLM response as JSON after ' + attempt + ' attempt(s):\n' + parseErr.message + '\n\nRaw response:\n' + rawResponse.substring(0, 500));
        }

        var report = validate(spec);
        if (!report.valid) {
          accumulatedErrors = report.errors.map(function(e) {
            return '[' + (e.path || '?') + '] ' + e.message;
          });
          attemptHistory.push({ attempt: attempt, stage: 'validate', errors: accumulatedErrors });
          if (attempt < maxAttempts) continue;
          throw new Error('ProcessSpec validation failed after ' + attempt + ' attempt(s):\n' + accumulatedErrors.map(function(e) { return '  - ' + e; }).join('\n'));
        }

        setCurrentSpec(spec);

        if (report.warnings.length > 0) {
          console.warn('[AI BPMN Designer] Validation warnings:', report.warnings);
        }

        // Step 3: Build XML
        setStep(3, 'active');
        var xml = buildBPMN(spec, platform);

        // Step 4: Import
        setStep(4, 'active');
        var bridge = window.__aiBpmnDesignerBridge;
        if (!bridge || !bridge.modeler) {
          throw new Error('No active BPMN modeler found. Please open a BPMN diagram tab first.');
        }

        try {
          await bridge.importXML(xml);
          setLastValidXml(xml);
        } catch (importErr) {
          accumulatedErrors = ['BPMN import error: ' + (importErr.message || importErr)];
          attemptHistory.push({ attempt: attempt, stage: 'import', error: accumulatedErrors[0] });
          if (attempt < maxAttempts) continue;
          throw new Error('BPMN import error after ' + attempt + ' attempt(s): ' + (importErr.message || importErr));
        }

        // SUCCESS
        setPipelineStatus('done');
        setStep(4, 'done');
        var msg = attempt > 1
          ? 'Diagram generated on attempt ' + attempt + ' of ' + maxAttempts + '!'
          : 'Diagram generated successfully!';
        displayNotification({ type: 'success', title: 'AI BPMN Designer', content: msg });
        return; // exit the loop on success

      } catch (err) {
        // Network/timeout errors — these cannot be fixed by self-correction
        if (err.name === 'AbortError' || (err.message && err.message.indexOf('timed out') >= 0)) {
          setPipelineStatus('error');
          setError('Request timed out. Try increasing the timeout in settings or using a faster model.');
          displayNotification({ type: 'error', title: 'AI BPMN Designer', content: 'Timeout.' });
          return;
        }

        // If this was the last attempt, show the final error
        if (attempt >= maxAttempts) {
          setPipelineStatus('error');
          setError(err.message || String(err));
          displayNotification({ type: 'error', title: 'AI BPMN Designer', content: 'Generation failed after ' + maxAttempts + ' attempts.' });
          return;
        }

        // Otherwise the loop continues with self-correction
        attemptHistory.push({ attempt: attempt, stage: 'unknown', error: err.message });
      }
    }
  }, [promptText, mode, currentSpec, platform, registry, maxAttempts]);

  // --- Test connection ---
  var handleTestConnection = useCallback(async function() {
    setConnectionStatus('testing');
    try {
      var ok = await registry.testConnection(profileForm);
      setConnectionStatus(ok ? 'ok' : 'fail');
    } catch (e) {
      setConnectionStatus('fail');
    }
  }, [registry, profileForm]);

  // --- Save settings ---
  var handleSaveSettings = useCallback(function() {
    registry.saveProfile(profileForm);
    registry.setActiveProfile(profileForm.id);
    setShowSettings(false);
    setConnectionStatus('');
  }, [registry, profileForm]);

  // --- Rollback ---
  var handleRollback = useCallback(async function() {
    if (!lastValidXml) return;
    try {
      var bridge = window.__aiBpmnDesignerBridge;
      if (bridge && bridge.modeler) {
        await bridge.importXML(lastValidXml);
      }
    } catch (e) {
      setError('Rollback failed: ' + e.message);
    }
  }, [lastValidXml]);

  // --- Enhance Prompt ---
  var handleEnhance = useCallback(async function() {
    if (!promptText.trim()) return;

    setIsEnhancing(true);
    setError(null);

    try {
      var adapter = registry.getActiveAdapter();
      var enhanceSystemPrompt = ENHANCE_INSTRUCTION;
      var enhanceUserPrompt = ENHANCE_USER_TEMPLATE.replace('{userText}', promptText);

      var rawResponse = await adapter.generateProcessSpec(enhanceUserPrompt, enhanceSystemPrompt);

      // The LLM should return plain text (enhanced description), not JSON.
      // But some models might wrap it in markdown — strip that.
      var enhanced = rawResponse.trim();
      // Remove markdown code blocks if present
      var codeBlockMatch = enhanced.match(/^```(?:\w*)\s*\n?([\s\S]*?)\n?\s*```$/);
      if (codeBlockMatch) {
        enhanced = codeBlockMatch[1].trim();
      }

      if (enhanced.length > 0) {
        setPromptText(enhanced);
        displayNotification({ type: 'success', title: 'AI BPMN Designer', content: 'Prompt enhanced!' });
      } else {
        setError('Enhancement returned empty result. Try again or edit manually.');
      }
    } catch (err) {
      setError('Enhancement failed: ' + (err.message || String(err)));
    } finally {
      setIsEnhancing(false);
    }
  }, [promptText, registry]);

  // --- Render Pipeline Status ---
  var renderPipeline = function() {
    return (
      React.createElement('div', { className: 'ai-pipeline' },
        PIPELINE_STEPS.map(function(step, i) {
          var cls = 'ai-pipeline-step';
          if (pipelineStatus === 'running' && i === activeStep) cls += ' active';
          else if (pipelineStatus === 'done' && i <= activeStep) cls += ' done';
          else if (pipelineStatus === 'error' && i === activeStep) cls += ' error';

          return (
            React.createElement(React.Fragment, { key: step.key },
              i > 0 && React.createElement('span', { className: 'ai-pipeline-arrow' }, '→'),
              React.createElement('span', { className: cls },
                pipelineStatus === 'running' && i === activeStep && React.createElement('span', { className: 'ai-spinner' }),
                ' ',
                step.label
              )
            )
          );
        }),
        // Show attempt counter when in agent loop
        currentAttempt > 0 && React.createElement('span', {
          style: { marginLeft: '8px', fontSize: '10px', color: '#999', whiteSpace: 'nowrap' }
        }, pipelineStatus === 'done'
          ? '(attempt ' + currentAttempt + '/' + maxAttempts + ')'
          : pipelineStatus === 'running'
            ? '(attempt ' + currentAttempt + '/' + maxAttempts + '...)'
            : '(failed after ' + currentAttempt + ' attempts)'
        )
      )
    );
  };

  // --- Render Settings ---
  var renderSettings = function() {
    var allProfiles = registry.getConfig().profiles;

    return (
      React.createElement('div', { className: 'ai-settings' },
        // Profile selector
        React.createElement('div', { className: 'ai-form-group' },
          React.createElement('label', null, 'Profile'),
          React.createElement('select', {
            value: profileForm.id,
            onChange: function(e) {
              var selected = allProfiles.find(function(p) { return p.id === e.target.value; });
              if (selected) setProfileForm({ ...selected });
            }
          },
            allProfiles.map(function(p) {
              return React.createElement('option', { key: p.id, value: p.id }, p.name + ' (' + (p.adapterType === 'anthropic' ? 'Anthropic' : 'OpenAI') + ')');
            })
          )
        ),

        // Provider type
        React.createElement('div', { className: 'ai-form-group' },
          React.createElement('label', null, 'Provider Type'),
          React.createElement('select', {
            value: profileForm.adapterType,
            onChange: function(e) {
              var newType = e.target.value;
              var updates = { adapterType: newType };
              // Auto-fill sensible defaults when switching type
              if (newType === 'anthropic' && profileForm.adapterType !== 'anthropic') {
                if (!profileForm.baseURL || profileForm.baseURL.indexOf('127.0.0.1') >= 0) {
                  updates.baseURL = 'https://api.anthropic.com';
                }
              } else if (newType === 'openai-compatible' && profileForm.adapterType !== 'openai-compatible') {
                if (profileForm.baseURL.indexOf('anthropic') >= 0 || profileForm.baseURL.indexOf('z.ai') >= 0) {
                  updates.baseURL = 'http://127.0.0.1:1234/v1';
                }
              }
              setProfileForm(Object.assign({}, profileForm, updates));
            }
          },
            React.createElement('option', { value: 'openai-compatible' }, 'OpenAI Compatible (LM Studio, Ollama, etc.)'),
            React.createElement('option', { value: 'anthropic' }, 'Anthropic / Z.ai / LM Studio Anthropic')
          )
        ),

        // Adapter-specific hint
        profileForm.adapterType === 'anthropic' && React.createElement('div', {
          style: { fontSize: '11px', color: '#666', padding: '4px 0', lineHeight: '1.4' }
        },
          'Uses /v1/messages endpoint with x-api-key header. Compatible with Z.ai (',
          React.createElement('code', { style: { fontSize: '10px' } }, 'https://api.z.ai/api/anthropic'),
          '), Anthropic cloud, and LM Studio Anthropic mode.'
        ),

        React.createElement('div', { className: 'ai-form-group' },
          React.createElement('label', null, 'Profile Name'),
          React.createElement('input', {
            type: 'text',
            value: profileForm.name,
            onChange: function(e) { setProfileForm(Object.assign({}, profileForm, { name: e.target.value })); }
          })
        ),
        React.createElement('div', { className: 'ai-form-group' },
          React.createElement('label', null, 'Base URL'),
          React.createElement('input', {
            type: 'text',
            value: profileForm.baseURL,
            onChange: function(e) { setProfileForm(Object.assign({}, profileForm, { baseURL: e.target.value })); },
            placeholder: profileForm.adapterType === 'anthropic' ? 'https://api.anthropic.com' : 'http://127.0.0.1:1234/v1'
          })
        ),
        React.createElement('div', { className: 'ai-form-group' },
          React.createElement('label', null, 'API Key'),
          React.createElement('input', {
            type: 'password',
            value: profileForm.apiKey,
            onChange: function(e) { setProfileForm(Object.assign({}, profileForm, { apiKey: e.target.value })); },
            placeholder: profileForm.adapterType === 'anthropic' ? 'sk-ant-... or Z.ai key' : 'lm-studio or your key'
          })
        ),
        React.createElement('div', { className: 'ai-form-group' },
          React.createElement('label', null, 'Model'),
          React.createElement('input', {
            type: 'text',
            value: profileForm.model,
            onChange: function(e) { setProfileForm(Object.assign({}, profileForm, { model: e.target.value })); },
            placeholder: profileForm.adapterType === 'anthropic' ? 'GLM-5.1, claude-sonnet-4-6, etc.' : 'qwen/qwen3.5-9b, gpt-4o, etc.'
          })
        ),
        React.createElement('div', { className: 'ai-form-row' },
          React.createElement('div', { className: 'ai-form-group' },
            React.createElement('label', null, 'Temperature'),
            React.createElement('input', {
              type: 'number',
              min: '0', max: '1', step: '0.1',
              value: profileForm.temperature,
              onChange: function(e) { setProfileForm(Object.assign({}, profileForm, { temperature: parseFloat(e.target.value) || 0.2 })); }
            })
          ),
          React.createElement('div', { className: 'ai-form-group' },
            React.createElement('label', null, 'Max Tokens'),
            React.createElement('input', {
              type: 'number',
              min: '256', max: '32768', step: '256',
              value: profileForm.maxTokens,
              onChange: function(e) { setProfileForm(Object.assign({}, profileForm, { maxTokens: parseInt(e.target.value) || 4096 })); }
            })
          )
        ),
        React.createElement('div', { className: 'ai-form-group' },
          React.createElement('label', null, 'Timeout (ms)'),
          React.createElement('input', {
            type: 'number',
            min: '5000', max: '300000', step: '5000',
            value: profileForm.timeoutMs,
            onChange: function(e) { setProfileForm(Object.assign({}, profileForm, { timeoutMs: parseInt(e.target.value) || 60000 })); }
          })
        ),
        React.createElement('div', { className: 'ai-form-row' },
          React.createElement('button', {
            className: 'ai-btn',
            onClick: handleTestConnection,
            disabled: connectionStatus === 'testing'
          },
            connectionStatus === 'testing' ? 'Testing...' : 'Test Connection'
          ),
          connectionStatus && React.createElement('span', {
            className: 'ai-connection-status ' + connectionStatus
          },
            connectionStatus === 'ok' ? 'Connected' : connectionStatus === 'fail' ? 'Failed' : 'Testing...'
          )
        ),
        React.createElement('div', { className: 'ai-form-row' },
          React.createElement('button', { className: 'ai-btn ai-btn-primary', onClick: handleSaveSettings }, 'Save'),
          React.createElement('button', { className: 'ai-btn', onClick: function() { setShowSettings(false); setConnectionStatus(''); } }, 'Cancel')
        )
      )
    );
  };

  // --- Panel Content ---
  var panelContent = React.createElement('div', { className: 'ai-designer-panel' },
    // Header
    React.createElement('div', { className: 'ai-designer-header' },
      React.createElement('span', { className: 'ai-title' },
        React.createElement('svg', { viewBox: '0 0 24 24' },
          React.createElement('path', { d: 'M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z' })
        ),
        'AI BPMN Designer'
      ),
      React.createElement('button', {
        className: 'ai-btn',
        style: { padding: '4px 8px', fontSize: '11px' },
        onClick: function() { setShowSettings(!showSettings); setConnectionStatus(''); },
        title: 'Settings'
      }, '⚙')
    ),

    // Settings panel (toggleable)
    showSettings ? renderSettings() : React.createElement(React.Fragment, null,
      // Mode tabs
      React.createElement('div', { className: 'ai-designer-tabs' },
        React.createElement('button', {
          className: 'ai-designer-tab' + (mode === 'create' ? ' active' : ''),
          onClick: function() { setMode('create'); }
        }, 'Create'),
        React.createElement('button', {
          className: 'ai-designer-tab' + (mode === 'update' ? ' active' : ''),
          onClick: function() { setMode('update'); }
        }, 'Update')
      ),

      // Body
      React.createElement('div', { className: 'ai-designer-body' },
        // Prompt input
        React.createElement('textarea', {
          value: promptText,
          onChange: function(e) { setPromptText(e.target.value); },
          placeholder: mode === 'create'
            ? 'Describe your business process...\nExample: Employee submits a vacation request. Manager reviews it. If approved, HR records it; if rejected, employee is notified.'
            : 'Enter update instruction...\nExample: Add a compliance review task before manager approval.',
          disabled: isGenerating || isEnhancing
        }),

        // Platform + Max Attempts
        React.createElement('div', { className: 'ai-platform-toggle' },
          React.createElement('label', null, 'Platform:'),
          React.createElement('select', {
            value: platform,
            onChange: function(e) { setPlatform(e.target.value); }
          },
            React.createElement('option', { value: 'camunda7' }, 'Camunda 7'),
            React.createElement('option', { value: 'camunda8' }, 'Camunda 8')
          ),
          React.createElement('label', { style: { marginLeft: '12px' } }, 'Max attempts:'),
          React.createElement('select', {
            value: maxAttempts,
            onChange: function(e) { setMaxAttempts(parseInt(e.target.value)); }
          },
            [1, 2, 3, 4, 5].map(function(n) {
              return React.createElement('option', { key: n, value: n }, n);
            })
          )
        ),

        // Pipeline status
        (pipelineStatus !== 'idle') && renderPipeline(),

        // Action buttons
        React.createElement('div', { className: 'ai-designer-actions' },
          React.createElement('button', {
            className: 'ai-btn ai-btn-primary',
            onClick: handleGenerate,
            disabled: isGenerating || isEnhancing || !promptText.trim()
          },
            isGenerating ? 'Generating...' : (mode === 'create' ? 'Generate BPMN' : 'Apply Update')
          ),
          React.createElement('button', {
            className: 'ai-btn',
            onClick: handleEnhance,
            disabled: isGenerating || isEnhancing || !promptText.trim(),
            title: 'Send your description to LLM to get an improved, more detailed version'
          },
            isEnhancing ? 'Enhancing...' : 'Enhance Prompt'
          ),
          lastValidXml && React.createElement('button', {
            className: 'ai-btn ai-btn-danger',
            onClick: handleRollback,
            disabled: isGenerating || isEnhancing
          }, 'Rollback')
        ),

        // Error display
        error && React.createElement('div', { className: 'ai-error-display' },
          React.createElement('h4', null, 'Error'),
          React.createElement('pre', { style: { whiteSpace: 'pre-wrap', fontSize: '11px', maxHeight: '200px', overflow: 'auto' } }, error)
        ),

        // Spec preview
        currentSpec && React.createElement('div', { className: 'ai-spec-preview' },
          React.createElement('div', {
            className: 'ai-spec-preview-header',
            onClick: function() { setShowSpecPreview(!showSpecPreview); }
          },
            'ProcessSpec Preview ' + (showSpecPreview ? '▼' : '▶'),
            React.createElement('span', { style: { fontSize: '10px', color: '#999' } },
              currentSpec.nodes ? currentSpec.nodes.length + ' nodes, ' : '',
              currentSpec.flows ? currentSpec.flows.length + ' flows' : ''
            )
          ),
          showSpecPreview && React.createElement('div', { className: 'ai-spec-preview-content' },
            JSON.stringify(currentSpec, null, 2)
          )
        )
      )
    )
  );

  // --- Main Render with Fill slots ---
  return React.createElement(React.Fragment, null,
    // Toolbar button
    React.createElement(Fill, { slot: 'toolbar' },
      React.createElement('button', {
        className: 'ai-toolbar-btn',
        title: 'AI BPMN Designer',
        style: {
          background: 'none',
          border: '1px solid #d0d0d0',
          borderRadius: '3px',
          cursor: 'pointer',
          padding: '4px 8px',
          fontSize: '12px',
          display: 'flex',
          alignItems: 'center',
          gap: '4px'
        }
      },
        React.createElement('svg', { width: '16', height: '16', viewBox: '0 0 24 24', fill: '#1890ff' },
          React.createElement('path', { d: 'M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z' })
        ),
        'AI'
      )
    ),
    // Bottom panel
    React.createElement(Fill, { slot: 'bottom-panel', type: 'ai-bpmn-designer', label: 'AI BPMN Designer' },
      panelContent
    )
  );
}

export default AIDesignerPanel;
