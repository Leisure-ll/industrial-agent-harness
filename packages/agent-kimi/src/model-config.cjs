const fs = require('node:fs');
const path = require('node:path');

const defaults = Object.freeze({
  provider: 'kimi',
  endpoint: 'https://api.moonshot.cn/v1',
  model: 'kimi-k2-thinking-turbo',
  contextSize: 262144,
  thinking: true,
  imageInput: false,
  imageInputMode: 'auto',
});

function trustedPlaintextHosts() {
  return (process.env.HARNESS_TRUSTED_PLAINTEXT_HOSTS || '')
    .split(',')
    .map(entry => entry.trim().toLowerCase())
    .filter(Boolean);
}

function validateProfile(value) {
  if (!value || !['kimi', 'openai_legacy'].includes(value.provider))
    throw Error('Choose Kimi API or OpenAI-compatible API.');
  const endpoint = new URL(String(value.endpoint));
  if (endpoint.username || endpoint.password || endpoint.search || endpoint.hash)
    throw Error('API endpoint cannot include credentials, query, or fragment.');
  const host = endpoint.hostname.toLowerCase();
  const trusted = trustedPlaintextHosts();
  const trustedPlaintext =
    endpoint.protocol === 'http:' &&
    (['localhost', '127.0.0.1', '[::1]'].includes(host) ||
      trusted.includes(host) ||
      (endpoint.port && trusted.includes(`${host}:${endpoint.port}`)));
  if (endpoint.protocol !== 'https:' && !trustedPlaintext)
    throw Error(
      'API endpoint must use HTTPS, except on localhost or hosts listed in HARNESS_TRUSTED_PLAINTEXT_HOSTS.',
    );
  const model = String(value.model || '').trim();
  if (!model || model.length > 128 || /[\r\n]/.test(model))
    throw Error('Enter a valid model name.');
  // MiniMax's documented /v1 endpoint uses Chat Completions, not Moonshot's
  // Kimi extension. Repair existing profiles as well as new settings saves.
  // Custom gateways keep their explicitly selected protocol.
  const minimaxChatCompletions =
    ['api.minimaxi.com', 'api.minimax.io', 'api.minimax.cn'].includes(host) &&
    !endpoint.port &&
    /^\/v1\/?$/.test(endpoint.pathname) &&
    /^minimax-/i.test(model);
  const provider = minimaxChatCompletions ? 'openai_legacy' : value.provider;
  const contextSize = Number(value.contextSize);
  if (!Number.isInteger(contextSize) || contextSize < 8192 || contextSize > 2000000)
    throw Error('Context size must be between 8192 and 2000000.');
  if (
    value.imageInputMode !== undefined &&
    !['auto', 'enabled', 'disabled'].includes(value.imageInputMode)
  )
    throw Error('Choose Auto, Enabled or Disabled for image input.');
  if (value.imageInput !== undefined && typeof value.imageInput !== 'boolean')
    throw Error('Image input must be enabled or disabled.');
  // Existing official MiniMax M3 profiles predate the image-input field.
  // https://platform.minimax.cn/docs/api-reference/text-openai-api
  const knownImageModel =
    provider === 'openai_legacy' &&
    ['api.minimaxi.com', 'api.minimax.io', 'api.minimax.cn'].includes(endpoint.hostname) &&
    /^minimax-m3(?:\.1-flash-preview)?$/i.test(model);
  const imageInputMode =
    value.imageInputMode ??
    (value.imageInput === undefined ? 'auto' : value.imageInput ? 'enabled' : 'disabled');
  return {
    provider,
    endpoint: endpoint.toString().replace(/\/$/, ''),
    model,
    contextSize,
    thinking: Boolean(value.thinking),
    imageInputMode,
    imageInput: imageInputMode === 'auto' ? knownImageModel : imageInputMode === 'enabled',
  };
}

// Keep requested output comfortably inside the configured context window.
const MODEL_MAX_COMPLETION_TOKENS = 65536;

function thinkingEffort(profile) {
  if (!profile.thinking) return 'off';
  // Upstream encodes Moonshot's own thinking extension for Kimi. Generic
  // Chat Completions must use the model default rather than assuming every
  // vendor supports the same high reasoning_effort tier.
  return profile.provider === 'kimi' ? 'high' : 'on';
}

function configToml(profile) {
  const value = validateProfile(profile);
  const quote = JSON.stringify;
  const modelCapabilities = [
    ...(value.thinking ? ['thinking'] : []),
    ...(value.imageInput ? ['image_in'] : []),
  ];
  return `default_model = "industrial"\ndefault_permission_mode = "manual"\ntelemetry = false\nauto_session_title = false\n\n[thinking]\nenabled = ${value.thinking}\neffort = ${quote(thinkingEffort(value))}\n\n[watch]\nenabled = false\n\n[providers.industrial]\ntype = ${quote(value.provider === 'openai_legacy' ? 'openai' : value.provider)}\nbase_url = ${quote(value.endpoint)}\napi_key_env = "HARNESS_MODEL_API_KEY"\n\n[models.industrial]\nprovider = "industrial"\nmodel = ${quote(value.model)}\nmax_context_size = ${value.contextSize}\nmax_output_size = ${Math.min(MODEL_MAX_COMPLETION_TOKENS, Math.floor(value.contextSize / 4))}\ncapabilities = ${JSON.stringify(modelCapabilities)}\n`;
}

function sessionEnv(profile, apiKey) {
  const value = validateProfile(profile);
  if (!apiKey) throw Error('Set a model API key before running Kimi.');
  const completionCap = {
    HARNESS_MODEL_API_KEY: apiKey,
    KIMI_CODE_NO_AUTO_UPDATE: '1',
  };
  return value.provider === 'kimi'
    ? {
        KIMI_BASE_URL: value.endpoint,
        KIMI_API_KEY: apiKey,
        KIMI_MODEL_NAME: value.model,
        ...completionCap,
      }
    : { OPENAI_BASE_URL: value.endpoint, OPENAI_API_KEY: apiKey, ...completionCap };
}

function saveProfile(directory, profile) {
  const value = validateProfile(profile);
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  const file = path.join(directory, 'model-profile.json');
  fs.writeFileSync(file, JSON.stringify(value, null, 2), { mode: 0o600 });
  fs.chmodSync(file, 0o600);
  return value;
}

function readProfile(directory) {
  try {
    return validateProfile(
      JSON.parse(fs.readFileSync(path.join(directory, 'model-profile.json'), 'utf8')),
    );
  } catch {
    return { ...defaults };
  }
}

function writeCliConfig(directory, profile) {
  const shareDir = path.join(directory, 'kimi-share');
  fs.mkdirSync(shareDir, { recursive: true, mode: 0o700 });
  const file = path.join(shareDir, 'config.toml');
  fs.writeFileSync(file, configToml(profile), { mode: 0o600 });
  fs.chmodSync(file, 0o600);
  return shareDir;
}

module.exports = {
  defaults,
  validateProfile,
  thinkingEffort,
  configToml,
  sessionEnv,
  saveProfile,
  readProfile,
  writeCliConfig,
};
