'use strict'

// Curator + learning insights bridge.
//
// Reads Hermes' official read-only endpoints and hands the raw payloads to the
// renderer, which reshapes them into friendly notifications. We deliberately do
// NOT synthesize any numbers here: if an endpoint is unreachable (gateway not
// running, older Hermes) the field is null and `available` is false, so the UI
// shows nothing rather than fabricating a "the agent learned…" message.
//
// `hermesApi` is required lazily (inside the default) so importing this module
// in a unit test never pulls in the Electron runtime; tests inject their own
// `api`, exactly like the other electron helper modules.

// GET wrapper that resolves to null on any failure (endpoint missing, gateway
// down, non-2xx). Never throws, so one missing endpoint can't sink the other.
async function safeGet(api, endpoint) {
  try {
    const result = await api(endpoint, { method: 'GET' })
    return result == null ? null : result
  } catch {
    return null
  }
}

// Fetch the curator status and learning graph in parallel. `available` is true
// only when at least one official payload came back, so the renderer can tell
// "nothing learned yet" from "Hermes isn't reporting".
async function getCuratorInsights(api) {
  const call = api || require('./runtime.cjs').hermesApi
  const [curator, learning] = await Promise.all([
    safeGet(call, '/api/curator'),
    safeGet(call, '/api/learning/graph?profile=default')
  ])
  return {
    available: curator !== null || learning !== null,
    curator: curator || null,
    learning: learning || null
  }
}

module.exports = { getCuratorInsights }
