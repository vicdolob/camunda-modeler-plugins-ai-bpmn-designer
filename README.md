# camunda-modeler-plugins-ai-bpmn-designer
A Camunda Desktop Modeler plugin that generates BPMN 2.0 diagrams from natural language descriptions using a local or cloud LLM.  Built for **Camunda Desktop Modeler 5.46+** (Windows/macOS/Linux).

---

## How It Works

```
Natural Language Description
         │
         ▼
    ┌─────────┐
    │   LLM   │  Generates ProcessSpec JSON (structured intermediate representation)
    └────┬────┘
         │
         ▼
┌─────────────────┐
│   Validator     │  Schema + graph integrity check; self-correction on failure
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│  BPMNBuilder    │  Deterministic BPMN 2.0 XML + DI generation
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│  Modeler Bridge │  importXML() into the active diagram tab
└─────────────────┘
```

**Key principle:** The LLM never generates XML directly — only a structured `ProcessSpec` JSON. A deterministic builder converts it into valid BPMN 2.0 XML with diagram interchange (DI) layout. This eliminates hallucinated namespaces, broken ID references, and malformed `sequenceFlow` targets that are common when LLMs generate XML directly.

---

## Features

- **Create BPMN from text** — Describe a business process in natural language, get a valid BPMN 2.0 diagram on the canvas
- **Update existing diagrams** — Submit incremental instructions to modify a previously generated diagram
- **Enhance Prompt** — Send your description to the LLM for improvement (clearer task types, explicit gateways, error handling) before generation
- **Agent loop with self-correction** — On validation failure, automatically retries with an error-aware correction prompt (configurable 1–5 attempts)
- **Dual protocol support** — OpenAI Chat Completions API **and** Anthropic Messages API in a single plugin
- **LM Studio** — Pre-configured for local inference via OpenAI-compatible endpoint
- **Z.ai (GLM-5.1)** — Pre-configured for the Anthropic-compatible endpoint at `https://api.z.ai/api/anthropic`
- **Anthropic Cloud** — Pre-configured for Claude models
- **Camunda 7 / Camunda 8** — Toggle between `camunda:` and `zeebe:` namespace prefixes
- **Rollback** — One-click revert to the last successfully imported diagram
- **ProcessSpec preview** — Collapsible JSON view of the intermediate representation
- **Test Connection** — Verify LLM endpoint connectivity before generating
- **Editable prompt instructions** — Enhancement rules live in a separate `.md` file you can customize

---

## Installation

### Prerequisites

- Camunda Desktop Modeler 5.46.1 or later
- Node.js 18+ and npm (for building only)
- A running LLM endpoint (LM Studio, Z.ai, OpenAI, Anthropic, etc.)

### Build

```bash
git clone https://github.com/your-org/ai-bpmn-designer.git
cd ai-bpmn-designer
npm install
npm run build
```

> **Note:** If your project path contains special characters (like `!!`), the build will fail due to a webpack limitation. Use a temp directory without special characters:
>
> ```bash
> TEMP_DIR=/tmp/ai-bpmn-designer-build
> cp -r client node_modules package.json webpack.config.js "$TEMP_DIR/"
> cd "$TEMP_DIR" && npx webpack --mode production
> cp dist/client.js dist/style.css /path/to/ai-bpmn-designer/dist/
> ```

### Install into Camunda Modeler

1. Locate your Camunda Modeler installation directory
2. Navigate to `resources/plugins/` (create it if it doesn't exist)
3. Copy the entire `ai-bpmn-designer` folder so the structure looks like:

```
resources/plugins/ai-bpmn-designer/
  ├── index.js
  └── dist/
      ├── client.js
      └── style.css
```

4. Restart Camunda Modeler
5. Open a `.bpmn` file — the **AI BPMN Designer** tab appears in the bottom panel

---

## Quick Start

### With LM Studio (Local)

1. Start LM Studio and load a model (e.g., `qwen/qwen3.5-9b`)
2. Enable the local server on `http://127.0.0.1:1234`
3. Open the AI BPMN Designer panel in Camunda Modeler
4. Type a process description, e.g.:

   > Employee submits a vacation request. Manager reviews it. If approved, HR records it; if rejected, the employee is notified.

5. Click **Generate BPMN**

### With Z.ai (Cloud)

1. Click the **⚙** gear icon in the plugin panel
2. Select the **Z.ai (GLM)** profile from the dropdown
3. Enter your Z.ai API key
4. Click **Test Connection** → should show **Connected**
5. Click **Save**
6. Type a process description and click **Generate BPMN**

### With Anthropic Cloud

Same steps as Z.ai, but select the **Anthropic Cloud** profile and use your Anthropic API key (`sk-ant-...`).

---

## Provider Configuration

### Pre-configured Profiles

| Profile | Protocol | Base URL | Models |
|---------|----------|----------|--------|
| LM Studio (Local) | OpenAI Compatible | `http://127.0.0.1:1234/v1` | Any local model |
| Z.ai (GLM) | Anthropic Messages | `https://api.z.ai/api/anthropic` | GLM-5.1, GLM-5-Turbo, GLM-4.7, GLM-4.5-Air |
| Anthropic Cloud | Anthropic Messages | `https://api.anthropic.com` | claude-sonnet-4-6, claude-opus-4-7, claude-haiku-4-5 |

### Other Providers

| Provider | Protocol | Base URL | API Key |
|----------|----------|----------|---------|
| Ollama | OpenAI Compatible | `http://127.0.0.1:11434/v1` | Any string (e.g., `ollama`) |
| OpenAI | OpenAI Compatible | `https://api.openai.com/v1` | `sk-...` |
| Azure OpenAI | OpenAI Compatible | `https://{resource}.openai.azure.com/...` | Azure key |
| vLLM / TGI | OpenAI Compatible | Your endpoint URL | As configured |
| LM Studio (Anthropic mode) | Anthropic Messages | `http://127.0.0.1:1234/v1` | Any string |

### Configurable Parameters

| Parameter | Description | Default |
|-----------|-------------|---------|
| Temperature | LLM creativity (0.0 = strict, 1.0 = creative) | 0.2 |
| Max Tokens | Maximum response length | 4096 |
| Timeout (ms) | Request timeout | 60000 |
| Max Attempts | Self-correction retry count (1–5) | 3 |

---

## Usage

### Create Mode

1. Select the **Create** tab
2. Describe your business process
3. *(Optional)* Click **Enhance Prompt** to get a more detailed, structured description
4. Select **Platform**: Camunda 7 or Camunda 8
5. Set **Max attempts** (1–5)
6. Click **Generate BPMN**
7. Watch the pipeline: `Prompt → LLM → Validate → Build → Import`
8. The diagram appears on the canvas

### Update Mode

1. With a diagram already on the canvas, switch to **Update**
2. Enter an incremental instruction, e.g.:

   > Add a compliance review task before manager approval

3. Click **Apply Update**
4. The existing `ProcessSpec` is sent as context along with your instruction

### Enhance Prompt

Click **Enhance Prompt** to send your description to the LLM for improvement. The LLM will:

- Add explicit start and end events
- Clarify task types (user task, service task, etc.)
- Formulate clear gateway conditions
- Identify parallel branches
- Suggest error/exception handling

The enhanced text replaces the content of the input field. You can edit it before generating.

### Agent Loop (Self-Correction)

When `Max attempts > 1`, the plugin works as an agent:

1. **Attempt 1** — Sends the standard prompt
2. **On failure** (JSON parse error, validation error, import error) — Builds a correction prompt that includes the original request, the failed output, and the specific error messages
3. **Attempt 2+** — Sends the correction prompt, asking the LLM to fix the exact issues
4. **Repeats** until success or max attempts exhausted

The pipeline status shows the current attempt counter: `(attempt 2/3...)`

### Rollback

The **Rollback** button appears after a successful generation. It reverts the diagram to the previous valid state.

---

## Architecture

### ProcessSpec v1.0 Schema

The `ProcessSpec` is the intermediate contract between the LLM and the deterministic builder:

```json
{
  "specVersion": "1.0",
  "process": { "id": "string", "name": "string", "isExecutable": true },
  "participants": [{ "id": "string", "name": "string" }],
  "lanes": [{ "id": "string", "name": "string", "participantRef": "string" }],
  "nodes": [{
    "id": "string",
    "type": "startEvent | endEvent | userTask | serviceTask | exclusiveGateway | parallelGateway | ...",
    "name": "string",
    "laneRef": "string | null",
    "properties": { "camunda:assignee": "string", "zeebe:taskDefinitionType": "string" }
  }],
  "flows": [{
    "id": "string",
    "sourceRef": "string",
    "targetRef": "string",
    "condition": "string | null",
    "name": "string | null"
  }],
  "dataObjects": [{ "id": "string", "name": "string" }],
  "artifacts": [{ "id": "string", "type": "textAnnotation | group", "text": "string" }]
}
```

### Validation Rules

- IDs must be unique across all elements
- `startEvent` nodes have no incoming flows
- `endEvent` nodes have no outgoing flows
- `exclusiveGateway` splits must have ≥2 outgoing flows with conditions
- `parallelGateway` split/merge pairs must be balanced
- All `flow.sourceRef` and `flow.targetRef` must reference existing node IDs
- The flow graph must be weakly connected

### Auto-Layout Engine

The `AutoLayoutEngine` computes DI coordinates using:

- **Topological sort** with longest-path layer assignment for horizontal positioning
- **Lane-aware** vertical placement (`yStep = 100`, `laneHeight = 200`)
- **Orthogonal polylines** for sequence flow edges (2–3 waypoints with mid-point routing)
- **Gateway centering** between predecessor and successor layers

### BPMNBuilder

Generates BPMN 2.0 XML with:

- Correct namespace declarations (`bpmn:`, `bpmndi:`, `dc:`, `di:`, `xsi:`)
- Camunda 7 extensions (`camunda:assignee`, `camunda:delegateExpression`)
- Camunda 8 extensions (`zeebe:taskDefinition`)
- Collaboration diagrams with participants
- LaneSets with flow node references
- Condition expressions on sequence flows
- Data objects and text annotations

---

## Project Structure

```
ai-bpmn-designer/
├── index.js                              Plugin manifest
├── dist/
│   ├── client.js                         Bundled client (~38 KB)
│   └── style.css                         Panel styles (~6.5 KB)
├── client/
│   ├── client.js                         Entry point (registers plugins)
│   ├── AiDesignerPanel.jsx               React UI panel
│   ├── services/
│   │   ├── ModelerBridgeModule.js        bpmn-js module (captures modeler instance)
│   │   ├── AutoLayoutEngine.js           Deterministic left-to-right layout
│   │   ├── ProcessSpecValidator.js       Schema + graph integrity validation
│   │   ├── BPMNBuilder.js               ProcessSpec → BPMN 2.0 XML
│   │   ├── LLMAdapterRegistry.js        Provider profile management
│   │   └── adapters/
│   │       ├── OpenAICompatibleAdapter.js    LM Studio, Ollama, OpenAI, etc.
│   │       └── AnthropicAdapter.js           Anthropic, Z.ai, LM Studio Anthropic
│   ├── schema/
│   │   └── process-spec-v1.json          JSON Schema for ProcessSpec
│   ├── prompts/
│   │   ├── index.js                      System prompt, templates, correction prompt
│   │   └── enhance-prompt.md            Editable enhancement instruction
│   └── style.css                         Source styles
├── package.json
└── webpack.config.js
```

### Customizing the Enhancement Instruction

Edit `client/prompts/enhance-prompt.md` to change how the Enhance Prompt feature works. For example, you can add domain-specific terminology, change the enhancement rules, or adjust the output format. After editing, rebuild the plugin.

---

## Troubleshooting

| Problem | Solution |
|---------|----------|
| Panel doesn't appear | Restart Modeler. Verify `index.js`, `dist/client.js`, `dist/style.css` are in place |
| Test Connection → Failed | Ensure the LLM server is running and the model is loaded |
| "signal is aborted without reason" | Request timed out — increase Timeout in settings or use a faster model |
| "response_format.type must be 'json_schema' or 'text'" | Already fixed — the plugin no longer sends `response_format` |
| "No active BPMN modeler found" | Open or create a `.bpmn` file in Modeler first |
| Invalid JSON from LLM | Try a different model, increase temperature to 0.3–0.4, or increase Max attempts |
| Validation errors persist after retries | The model may be too small — try a larger model or simplify the description |
| Build fails with `!` in path | Use a temp directory without special characters (see Build section) |

---

## Technology Stack

- **UI:** React 18 (using Camunda Modeler's built-in React instance via `camunda-modeler-plugin-helpers`)
- **Plugin Registration:** `registerClientExtension` + `registerBpmnJSPlugin` from `camunda-modeler-plugin-helpers` v6
- **Modeler Integration:** bpmn-js `injector.get('bpmnjs')` → `modeler.importXML()`
- **LLM Protocols:** OpenAI Chat Completions (`/v1/chat/completions`), Anthropic Messages (`/v1/messages`)
- **Bundling:** Webpack 5 with `asset/source` for `.md` imports
- **Bundle Size:** ~44 KB uncompressed (well under the 2 MB limit)

---

## License

MIT
