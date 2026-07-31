// Thin, verified wrappers over the Hermes 0.19.1 native configuration REST
// surface. Every call targets the ONE existing `default` profile/runtime — this
// module never spawns a second runtime and never edits SOUL.md. The `api`
// function is injectable so the contract can be unit-tested without a live
// Hermes.

const CONFIG_ENDPOINT = '/api/config'
const BACKENDS_ENDPOINT = '/api/tools/terminal/backends'
const BACKEND_ENDPOINT = '/api/tools/terminal/backend'

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

// Recursive merge that mirrors the server-side deep-merge of PUT /api/config:
// nested objects are merged key-by-key; arrays and scalars replace wholesale.
function deepMerge(base, patch) {
  if (!isPlainObject(base)) return patch
  if (!isPlainObject(patch)) return patch
  const result = { ...base }
  for (const [key, value] of Object.entries(patch)) {
    result[key] = isPlainObject(value) && isPlainObject(result[key]) ? deepMerge(result[key], value) : value
  }
  return result
}

function defaultApi() {
  return require('./runtime.cjs').hermesApi
}

// GET /api/config returns either the config object directly or `{config: {...}}`
// depending on the build. Normalize both to the bare config object.
async function getConfig(api = defaultApi()) {
  const payload = await api(`${CONFIG_ENDPOINT}?profile=default`)
  return isPlainObject(payload) && isPlainObject(payload.config) ? payload.config : payload || {}
}

// PUT /api/config with {config, profile} deep-merges server-side. We send only
// the delta the caller wants changed; untouched keys are preserved.
async function putConfig(partial, api = defaultApi()) {
  return api(CONFIG_ENDPOINT, {
    method: 'PUT',
    body: { config: partial, profile: 'default' }
  })
}

async function listTerminalBackends(api = defaultApi()) {
  const payload = await api(BACKENDS_ENDPOINT)
  if (Array.isArray(payload)) return payload
  if (payload && Array.isArray(payload.backends)) return payload.backends
  return []
}

async function setTerminalBackend(backend, api = defaultApi()) {
  return api(BACKEND_ENDPOINT, { method: 'PUT', body: { backend } })
}

// Docker isolation may only be trusted when the backend explicitly reports
// status === 'ready'. Missing/stopped/unavailable Docker returns ready:false so
// callers fail closed. We never start Docker from here.
async function dockerReadiness(api = defaultApi()) {
  let backends = []
  try {
    backends = await listTerminalBackends(api)
  } catch (error) {
    return { ready: false, present: false, status: 'unavailable', detail: String(error.message || error) }
  }
  const docker = backends.find(item => (item.id || item.name || item.backend) === 'docker')
  if (!docker) return { ready: false, present: false, status: 'missing', detail: 'Docker backend not registered' }
  const status = String(docker.status || docker.state || 'unknown')
  return {
    ready: status === 'ready',
    present: true,
    status,
    detail: docker.detail || docker.message || null
  }
}

module.exports = {
  deepMerge,
  getConfig,
  putConfig,
  listTerminalBackends,
  setTerminalBackend,
  dockerReadiness,
  CONFIG_ENDPOINT,
  BACKENDS_ENDPOINT,
  BACKEND_ENDPOINT
}
