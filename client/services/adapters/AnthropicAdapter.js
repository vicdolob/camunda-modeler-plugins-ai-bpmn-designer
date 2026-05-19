/**
 * Anthropic Messages API adapter.
 * Works with:
 *   - Anthropic directly (https://api.anthropic.com)
 *   - Z.ai (https://api.z.ai/api/anthropic)
 *   - LM Studio Anthropic-compatible endpoint
 *   - Any gateway exposing the Anthropic Messages format
 *
 * Key differences from OpenAI Chat Completions:
 *   - Endpoint: /v1/messages
 *   - Auth header: x-api-key (not Authorization: Bearer)
 *   - Required header: anthropic-version
 *   - System prompt is a top-level field, not a message role
 *   - max_tokens is required
 *   - Response shape: content[0].text
 */

var ANTHROPIC_VERSION = '2023-06-01';

export default class AnthropicAdapter {
  constructor(config) {
    this.id = config.id || 'anthropic';
    this.name = config.name || 'Anthropic';
    this.baseURL = (config.baseURL || 'https://api.anthropic.com').replace(/\/+$/, '');
    this.apiKey = config.apiKey || '';
    this.model = config.model || 'claude-sonnet-4-6';
    this.temperature = config.temperature !== undefined ? config.temperature : 0.2;
    this.maxTokens = config.maxTokens || 4096;
    this.timeoutMs = config.timeoutMs || 60000;
  }

  /**
   * Build the full URL for /v1/messages.
   * Handles baseURL variants:
   *   https://api.anthropic.com                    → .../v1/messages
   *   https://api.anthropic.com/v1                 → .../v1/messages
   *   https://api.z.ai/api/anthropic               → .../api/anthropic/v1/messages
   *   https://api.z.ai/api/anthropic/v1            → .../api/anthropic/v1/messages
   */
  _resolveMessagesURL() {
    var url = this.baseURL;

    // If the URL already ends with /v1 or /v1/, just append /messages
    if (url.endsWith('/v1') || url.endsWith('/v1/')) {
      return url.replace(/\/+$/, '') + '/messages';
    }

    // Otherwise append /v1/messages
    return url + '/v1/messages';
  }

  /**
   * Generate a ProcessSpec via Anthropic Messages API.
   */
  async generateProcessSpec(userPrompt, systemPrompt) {
    var url = this._resolveMessagesURL();

    var body = {
      model: this.model,
      max_tokens: this.maxTokens,
      temperature: this.temperature,
      system: systemPrompt,
      messages: [
        { role: 'user', content: userPrompt }
      ]
    };

    var controller = new AbortController();
    var self = this;
    var timeout = setTimeout(function() {
      controller.abort(new Error('Request timed out after ' + self.timeoutMs + 'ms'));
    }, this.timeoutMs);

    try {
      var response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': this.apiKey,
          'anthropic-version': ANTHROPIC_VERSION
        },
        body: JSON.stringify(body),
        signal: controller.signal
      });

      if (!response.ok) {
        var errorText = await response.text();
        throw new Error('Anthropic request failed (' + response.status + '): ' + errorText);
      }

      var data = await response.json();

      // Anthropic response: { content: [{ type: "text", text: "..." }], ... }
      if (!data.content || !Array.isArray(data.content) || data.content.length === 0) {
        throw new Error('Invalid Anthropic response: missing content array');
      }

      var textBlock = data.content.find(function(block) { return block.type === 'text'; });
      if (!textBlock || !textBlock.text) {
        throw new Error('Invalid Anthropic response: no text block found');
      }

      return textBlock.text;
    } finally {
      clearTimeout(timeout);
    }
  }

  /**
   * Test connectivity via /v1/models (or the provider's equivalent).
   */
  async testConnection() {
    var url = this.baseURL;
    if (url.endsWith('/v1') || url.endsWith('/v1/')) {
      url = url.replace(/\/+$/, '') + '/models';
    } else {
      url = url + '/v1/models';
    }

    try {
      var response = await fetch(url, {
        method: 'GET',
        headers: {
          'x-api-key': this.apiKey,
          'anthropic-version': ANTHROPIC_VERSION
        },
        signal: AbortSignal.timeout(8000)
      });
      return response.ok;
    } catch (e) {
      // Some Anthropic-compatible endpoints don't have /models.
      // Try a lightweight messages request as fallback.
      try {
        var msgUrl = this._resolveMessagesURL();
        var probe = await fetch(msgUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': this.apiKey,
            'anthropic-version': ANTHROPIC_VERSION
          },
          body: JSON.stringify({
            model: this.model,
            max_tokens: 1,
            messages: [{ role: 'user', content: 'hi' }]
          }),
          signal: AbortSignal.timeout(8000)
        });
        // Even a 400 from a real endpoint means the server is reachable
        return probe.status !== 0;
      } catch (e2) {
        return false;
      }
    }
  }
}
