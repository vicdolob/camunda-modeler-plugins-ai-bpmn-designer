import OpenAICompatibleAdapter from './adapters/OpenAICompatibleAdapter';
import AnthropicAdapter from './adapters/AnthropicAdapter';

/**
 * LLM Adapter Registry — manages provider profiles and creates adapters.
 */
var STORAGE_KEY = 'ai-bpmn-designer-config';

var DEFAULT_CONFIG = {
  activeProfileId: 'local-lmstudio',
  profiles: [
    {
      id: 'local-lmstudio',
      name: 'LM Studio (Local)',
      adapterType: 'openai-compatible',
      baseURL: 'http://127.0.0.1:1234/v1',
      apiKey: 'sk-lm-LP9Lwccf:f86O4o3UmLGTUnq4MGB4',
      model: 'qwen/qwen3.5-9b',
      temperature: 0.2,
      maxTokens: 4096,
      timeoutMs: 60000
    },
    {
      id: 'zai-glm',
      name: 'Z.ai (GLM)',
      adapterType: 'anthropic',
      baseURL: 'https://api.z.ai/api/anthropic',
      apiKey: '',
      model: 'GLM-5.1',
      temperature: 0.2,
      maxTokens: 4096,
      timeoutMs: 60000
    },
    {
      id: 'anthropic-cloud',
      name: 'Anthropic Cloud',
      adapterType: 'anthropic',
      baseURL: 'https://api.anthropic.com',
      apiKey: '',
      model: 'claude-sonnet-4-6',
      temperature: 0.2,
      maxTokens: 4096,
      timeoutMs: 30000
    }
  ]
};

function loadConfig() {
  try {
    var stored = localStorage.getItem(STORAGE_KEY);
    if (stored) return JSON.parse(stored);
  } catch (e) { /* ignore */ }
  return JSON.parse(JSON.stringify(DEFAULT_CONFIG));
}

function saveConfig(config) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
  } catch (e) { /* ignore */ }
}

/**
 * Create an adapter instance from a profile config.
 */
function createAdapter(profile) {
  switch (profile.adapterType) {
    case 'anthropic':
      return new AnthropicAdapter(profile);
    case 'openai-compatible':
    default:
      return new OpenAICompatibleAdapter(profile);
  }
}

export default class LLMAdapterRegistry {
  constructor() {
    this._config = loadConfig();
  }

  getConfig() {
    return this._config;
  }

  getActiveProfile() {
    var config = this._config;
    return config.profiles.find(function(p) {
      return p.id === config.activeProfileId;
    }) || config.profiles[0];
  }

  getActiveAdapter() {
    return createAdapter(this.getActiveProfile());
  }

  setActiveProfile(profileId) {
    this._config.activeProfileId = profileId;
    saveConfig(this._config);
  }

  saveProfile(profile) {
    var idx = this._config.profiles.findIndex(function(p) { return p.id === profile.id; });
    if (idx >= 0) {
      this._config.profiles[idx] = profile;
    } else {
      this._config.profiles.push(profile);
    }
    saveConfig(this._config);
  }

  deleteProfile(profileId) {
    this._config.profiles = this._config.profiles.filter(function(p) { return p.id !== profileId; });
    if (this._config.activeProfileId === profileId && this._config.profiles.length > 0) {
      this._config.activeProfileId = this._config.profiles[0].id;
    }
    saveConfig(this._config);
  }

  async testConnection(profile) {
    var adapter = createAdapter(profile || this.getActiveProfile());
    return adapter.testConnection();
  }
}
