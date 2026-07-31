// The @hermes/plugin-sdk surface the business-shell plugin imports, bound to the
// LIVE isolated-home gateway. `host.request` is the real WebSocket JSON-RPC door
// (the same `rpc` the shared-state proofs use), so any data the plugin loads is
// literally the same isolated HERMES_HOME state the official surfaces expose —
// there is no second store. UI exports are minimal, SSR-safe components so the
// plugin's route can render to static markup without a browser or a provider.

const atom = value => ({ get: () => value, set: v => (value = v), listen: () => () => {} })

/** Mirror of the SDK's evaluateRuntimeReadiness: reconcile setup.runtime_check
 *  into a ready flag. Provider-free by construction (no model is called). */
async function evaluateRuntimeReadiness(request) {
  try {
    const r = await request('setup.runtime_check', {})
    return { ready: Boolean(r?.ok || r?.ready), model: r?.model || r?.provider || null, raw: r }
  } catch (error) {
    return { ready: false, model: null, error: String(error?.message || error) }
  }
}

/**
 * Build the SDK object. `rpc` is the harness JSON-RPC caller; `state` seeds the
 * readonly host.state atoms. React is the app's singleton (also used to render).
 */
export function buildSdk({ React, rpc, gateway = 'open', profile = 'default', model = null }) {
  const h = React.createElement
  const domProps = p => {
    const { variant, size, tone, codicon, onClick, ...rest } = p || {}
    return { onClick, ...rest }
  }
  const box = tag => function Shim(props = {}) {
    return h(tag, domProps(props), props.children)
  }

  const host = {
    state: { gateway: atom(gateway), model: atom(model), profile: atom(profile), viewport: atom({ width: 0, height: 0, narrow: false }) },
    request: (method, params = {}) => rpc(method, params, 30_000),
    status: () => rpc('status', {}, 30_000).catch(() => ({})),
    logs: () => Promise.resolve({ lines: [] }),
    navigate: () => {},
    notify: () => {},
    notifyError: () => {},
    onEvent: () => () => {},
    restartGateway: () => Promise.resolve()
  }

  return {
    host,
    evaluateRuntimeReadiness,
    useValue: a => (a && typeof a.get === 'function' ? a.get() : a),
    ROUTES_AREA: 'routes',
    SIDEBAR_NAV_AREA: 'sidebar.nav',
    PALETTE_AREA: 'palette',
    Button: box('button'),
    Input: box('input'),
    Textarea: box('textarea'),
    Badge: box('span'),
    StatusDot: box('span'),
    Loader: box('span')
  }
}
