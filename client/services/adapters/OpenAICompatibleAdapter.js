/**
 * OpenAI-compatible adapter for LM Studio, Ollama, llama.cpp, vLLM, etc.
 * Sends POST /chat/completions with standard OpenAI format.
 */

export default class OpenAICompatibleAdapter {
  constructor(config) {
    this.id = config.id || 'openai-compatible';
    this.name = config.name || 'OpenAI Compatible';
    this.baseURL = (config.baseURL || 'http://127.0.0.1:1234/v1').replace(/\/+$/, '');
    this.apiKey = config.apiKey || 'lm-studio';
    this.model = config.model || 'default';
    this.temperature = config.temperature !== undefined ? config.temperature : 0.2;
    this.maxTokens = config.maxTokens || 4096;
    this.timeoutMs = config.timeoutMs || 60000;
  }

  /**
   * Ensure baseURL ends with /v1 for OpenAI-compatible endpoints.
   */
  _resolveBaseURL() {
    var url = this.baseURL;
    if (!url.endsWith('/v1') && !url.endsWith('/v1/')) {
      return url + '/v1';
    }
    return url;
  }

  /**
   * Generate a ProcessSpec by sending a chat completion request.
   */
  async generateProcessSpec(userPrompt, systemPrompt) {
    var baseURL = this._resolveBaseURL();
    var url = baseURL + '/chat/completions';

    var body = {
      model: this.model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt }
      ],
      temperature: this.temperature,
      max_tokens: this.maxTokens
    };

    // NOTE: Do NOT set response_format here. LM Studio rejects 'json_object'
    // (only supports 'json_schema' or 'text'). The system prompt already
    // instructs the model to output pure JSON, and extractJSON() handles
    // any surrounding markdown or prose in the response.

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
          'Authorization': 'Bearer ' + this.apiKey
        },
        body: JSON.stringify(body),
        signal: controller.signal
      });

      if (!response.ok) {
        var errorText = await response.text();
        throw new Error('LLM request failed (' + response.status + '): ' + errorText);
      }

      var data = await response.json();

      if (!data.choices || !data.choices[0] || !data.choices[0].message) {
        throw new Error('Invalid response format from LLM provider');
      }

      return data.choices[0].message.content;
    } finally {
      clearTimeout(timeout);
    }
  }

  /**
   * Test connectivity by listing models.
   */
  async testConnection() {
    var baseURL = this._resolveBaseURL();
    var url = baseURL + '/models';

    try {
      var response = await fetch(url, {
        method: 'GET',
        headers: {
          'Authorization': 'Bearer ' + this.apiKey
        },
        signal: AbortSignal.timeout(5000)
      });
      return response.ok;
    } catch (e) {
      return false;
    }
  }
}
