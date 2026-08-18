// Canonical provider readiness. `provider_ready` NEVER means "runtime is running";
// it means a supported provider is actually configured AND usable. We distinguish
// runtime-running, provider-configured, provider-usable and unknown/degraded, and
// fail closed (not ready) whenever we could not verify the truth.

export const DISCONNECTED_LABEL = 'לא מחובר'

export const API_KEY_PROVIDERS = [
  ['OPENROUTER_API_KEY', 'OpenRouter'],
  ['ANTHROPIC_API_KEY', 'Anthropic'],
  ['GEMINI_API_KEY', 'Gemini'],
  ['OPENAI_API_KEY', 'OpenAI']
]

// Short display names for the engine's OAuth catalog, keyed by stable provider
// id. The catalog's `name` is an ENGINE-facing string that may embed English
// status doctrine (observed live: the `claude-code` entry is named
// "Anthropic OAuth: Required Extra Usage Credits to Use Subscription") — the
// user-facing copy register forbids passing that through, so the label a user
// sees is always a short brand name, never the raw catalog sentence.
export const OAUTH_DISPLAY_LABELS = {
  nous: 'Nous',
  'openai-codex': 'Codex',
  anthropic: 'Anthropic',
  'claude-code': 'Claude',
  'minimax-oauth': 'MiniMax',
  'xai-oauth': 'Grok',
  'copilot-acp': 'GitHub Copilot'
}

// Reduce an unknown catalog entry to a short brand-like label: the part before
// the first ':' / '(' qualifier, bounded; when nothing brand-like survives,
// fall back to a generic-but-honest label rather than leaking the raw sentence.
export const GENERIC_PROVIDER_LABEL = 'ספק AI'
export function sanitizeProviderLabel(provider) {
  if (provider && provider.id && OAUTH_DISPLAY_LABELS[provider.id]) return OAUTH_DISPLAY_LABELS[provider.id]
  const raw = String((provider && provider.name) || '').split(/[:(]/)[0].trim()
  if (raw && raw.length <= 24) return raw
  return GENERIC_PROVIDER_LABEL
}

// AMBIENT credential entries: catalog rows whose logged_in state comes from
// ANOTHER tool's machine-scoped credential store (the engine reads Claude
// Code's ~/.claude/.credentials.json and Copilot's CLI login — outside any
// HERMES_HOME), not from a login the user performed in Hermes. They are real,
// usable credentials — but when the user ALSO logged into a provider through
// Hermes itself (auth.json in the home: e.g. openai-codex auth_mode=chatgpt),
// naming the ambient entry as "the" connection misattributes the active
// provider (observed live: an OpenAI-subscription machine captioned
// "Anthropic … מחובר" because the ambient claude-code row listed first).
const AMBIENT_CREDENTIAL_IDS = new Set(['claude-code', 'copilot-acp'])

// Per official source we return a tri-state, never a boolean: 'positive' (this
// source alone proves a provider), 'negative' (inspected, none), or 'unknown' (we
// did not / could not inspect — the value is null). A failed inspection MUST arrive
// here as null, not as [] / {}, or a false 'unavailable' would look like proof.
function inspectOAuth(oauthProviders) {
  if (oauthProviders == null) return { state: 'unknown', label: null }
  const loggedIn = oauthProviders.filter(provider => provider && provider.status && provider.status.logged_in)
  // Hermes-store logins outrank ambient spillover; within a rank, catalog order.
  const oauth = loggedIn.find(provider => !AMBIENT_CREDENTIAL_IDS.has(provider.id)) || loggedIn[0] || null
  return oauth ? { state: 'positive', label: sanitizeProviderLabel(oauth) } : { state: 'negative', label: null }
}

function inspectEnv(env) {
  if (env == null) return { state: 'unknown', label: null }
  const apiKey = API_KEY_PROVIDERS.find(([key]) => env[key] && env[key].is_set)
  return apiKey ? { state: 'positive', label: apiKey[1] } : { state: 'negative', label: null }
}

// Provider credentials are proven only via Hermes' own surfaces: a live OAuth
// session, or redacted env metadata that reports a key `is_set` (never its value).
// Positive proof from EITHER source is enough — one source failing never masks the
// other's proof.
export function resolveProviderReadiness(oauthProviders, env) {
  const oauth = inspectOAuth(oauthProviders)
  if (oauth.state === 'positive') return { connected: true, label: oauth.label }
  const envSource = inspectEnv(env)
  if (envSource.state === 'positive') return { connected: true, label: envSource.label }
  return { connected: false, label: DISCONNECTED_LABEL }
}

// Full honest status with per-source provenance. Positive proof from either source
// ⇒ configured. With no positive proof: if ANY source failed/uninspected (unknown)
// we stay 'unknown' (we cannot prove absence); only when every supported source was
// successfully inspected AND negative do we claim 'unavailable'. An error or an
// incompatible runtime → degraded → unknown. `provider_sources` surfaces the
// inspection state (never errors/secrets) so the agent knows WHY a state was chosen.
export function resolveProviderStatus(input = {}) {
  const { runtime, oauthProviders = null, env = null, error = null } = input
  const running = Boolean(runtime && runtime.running)
  const degraded = Boolean(error) || Boolean(runtime && runtime.compatible === false)
  const oauth = inspectOAuth(oauthProviders)
  const envSource = inspectEnv(env)
  const proof = oauth.state === 'positive' ? oauth : envSource.state === 'positive' ? envSource : null
  const configured = Boolean(proof)
  const anyUnknown = oauth.state === 'unknown' || envSource.state === 'unknown'
  const usable = configured && running && !degraded
  const provider_state = degraded
    ? 'unknown'
    : configured
      ? usable
        ? 'usable'
        : 'configured'
      : anyUnknown
        ? 'unknown'
        : running
          ? 'runtime_only'
          : 'unavailable'
  return {
    provider_ready: usable,
    provider_state,
    provider_label: configured ? proof.label : DISCONNECTED_LABEL,
    runtime_running: running,
    provider_configured: configured,
    provider_usable: usable,
    provider_sources: { oauth: oauth.state, env: envSource.state }
  }
}

// Plugin runtime only exposes a resolved model id (via host.state.model). A present
// model id proves the provider is CONFIGURED, never that the credential is usable —
// only a real round-trip proves that. The wrapper must not claim 'usable' it never
// observed, so provider_ready stays false and the state is 'configured'. This is not
// a false-negative deadlock: the agent-led flow runs inside a live session, and its
// own successful response IS the usability proof (see the bootstrap state semantics).
export function resolveModelReadiness(model) {
  const configured = typeof model === 'string' && model.length > 0
  return {
    provider_ready: false,
    provider_state: configured ? 'configured' : 'unavailable',
    provider_label: configured ? model : DISCONNECTED_LABEL,
    provider_configured: configured
  }
}
