// Canonical double for `window.hermesDesktop` (docs/specs/component-tests.md
// §4.2). ONE bridge object lives for the whole test file: hermes-client.ts's
// singleton (src/lib/hermes-client.ts) captures method PRESENCE when it is
// constructed (createHermesDesktop(...) is Object.assign'd once), so swapping
// in a brand-new object after that point would never be seen by an
// already-built client. Every per-test behavior change must go through
// `stubBridge`/`resetBridge`, which mutate THIS object's vi.fn
// implementations in place — never reassign `window.hermesDesktop`.
//
// Defaults are fail-closed, not happy-path: lifecycle calls report "not
// running" (the gate falls back to onboarding, exactly like a fresh install),
// "unknown" reads report the honest-unknown shape the app's own fail-closed
// parsers already know how to render as "not proven" (interpretWhatsappGuard,
// health.ts, ...), and every remaining side-effecting/no-safe-default method
// rejects loudly — a test that exercises one without stubbing it fails on
// contact instead of silently sailing through on fabricated data.
import { vi } from 'vitest'

type BridgeMethodName = keyof HermesDesktopBridge
type BridgeMock = HermesDesktopBridge & Record<string, ReturnType<typeof vi.fn>>

/** Runtime shape meaning "not installed / not running" — every test's starting point. */
export const FAIL_CLOSED_RUNTIME: HermesRuntime = {
  installed: false,
  running: false,
  starting: false,
  mode: 'desktop',
  version: null,
  error: null,
  wsUrl: ''
}

const FAIL_CLOSED_WINDOW_STATE: AssistantWindowState = {
  mode: 'full',
  alwaysOnTop: false,
  visible: true
}

/** Helper for tests that need a live runtime; wsUrl stays empty so the transport never attempts a real socket. */
export function runningRuntime(overrides: Partial<HermesRuntime> = {}): HermesRuntime {
  return {
    installed: true,
    running: true,
    starting: false,
    mode: 'desktop',
    version: '0.19.1',
    error: null,
    wsUrl: '',
    ...overrides
  }
}

// Runtime lifecycle: resolve to "not running" so gates fall back to
// onboarding, exactly like the real app when Hermes isn't installed/started.
const RUNTIME_LIFECYCLE_METHODS = ['getRuntime', 'startRuntime', 'restartRuntime'] as const

// Honest "unknown" reads: the app's fail-closed parsers already know how to
// render these as "not proven" rather than as a positive result.
const HONEST_UNKNOWN_DEFAULTS: Record<string, () => unknown> = {
  getWhatsappGuard: () => null,
  getWhatsappGuardActivation: () => null,
  getProviderEvidence: () => null,
  getGoogleStatus: () => ({ available: false, authenticated: false }),
  probeCodexGrant: () => ({ ok: false, reachable: false, message: 'not probed (test default)' }),
  probeProvider: () => ({ ok: false, reachable: false }),
  getVersions: () => ({}),
  getRecentLogs: () => ({ lines: [] })
}

// Side-effecting calls, or reads with no safe "unknown" shape: reject loudly
// so a test that touches one without stubbing it fails on contact (or drives
// the component's own honest catch path — exactly what we want to observe).
//
// NOTE (deviation from docs/specs/component-tests.md §4.2, documented per the
// implementation task): `getPartnerFeed` was added to `HermesDesktopBridge`
// (docs/specs/partner-feed.md §4.1) after this spec's table was written, so it
// is absent from the §4.2 "everything else" row. It is grouped here, next to
// the pre-existing `getPartnerState`, because it is a side-effecting
// main-process aggregation call with no safe unknown-but-honest shape of its
// own (unlike e.g. `getWhatsappGuard: null`) — the same reasoning the spec
// applies to every other data-fetch method in this bucket.
const NOT_STUBBED_METHODS = [
  'api',
  'applyUpdate',
  'installHermes',
  'openFull',
  'openExternal',
  'chooseFile',
  'chooseFolder',
  'getCuratorInsights',
  'getPartnerFeed',
  'getPartnerState',
  'applyPartnerMode',
  'startGoogleSetup',
  'finishGoogleSetup',
  'ensureGateway',
  'getWhatsappPolicy',
  'getWhatsappDirectory',
  'setWhatsappPolicy',
  'ensureWhatsappPolicy',
  'recordProviderEvidence',
  'createDiagnostics',
  'setWindowMode',
  'setAlwaysOnTop',
  'hideWindow'
] as const

// Full method inventory, statically checked against HermesDesktopBridge below
// so a future field added to src/vite-env.d.ts and forgotten here becomes a
// tsc error instead of a silent gap in the double.
const ALL_METHOD_NAMES = [
  ...RUNTIME_LIFECYCLE_METHODS,
  'getWindowState',
  ...(Object.keys(HONEST_UNKNOWN_DEFAULTS) as BridgeMethodName[]),
  'onRuntimeLog',
  ...NOT_STUBBED_METHODS
] as const satisfies readonly BridgeMethodName[]

type MissingBridgeMethod = Exclude<BridgeMethodName, (typeof ALL_METHOD_NAMES)[number]>
// If this line fails to compile, HermesDesktopBridge (src/vite-env.d.ts) grew
// a method that ALL_METHOD_NAMES above does not account for yet — add it to
// the right fail-closed group from §4.2 (or to NOT_STUBBED_METHODS with a
// documented reason like the getPartnerFeed note above) before continuing.
const _assertNoMissingBridgeMethod: [MissingBridgeMethod] extends [never] ? true : never = true
void _assertNoMissingBridgeMethod

let runtimeLogListeners: Array<(line: string) => void> = []

function onRuntimeLogDefaultImpl(callback: (line: string) => void): () => void {
  runtimeLogListeners.push(callback)
  return () => {
    runtimeLogListeners = runtimeLogListeners.filter(listener => listener !== callback)
  }
}

/** Simulates a log line arriving from the main process on every registered listener. */
export function emitRuntimeLog(line: string): void {
  runtimeLogListeners.forEach(listener => listener(line))
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function defaultImplFor(name: BridgeMethodName): (...args: any[]) => any {
  if ((RUNTIME_LIFECYCLE_METHODS as readonly string[]).includes(name)) {
    return async () => ({ ...FAIL_CLOSED_RUNTIME })
  }
  if (name === 'getWindowState') {
    return async () => ({ ...FAIL_CLOSED_WINDOW_STATE })
  }
  if (name in HONEST_UNKNOWN_DEFAULTS) {
    const factory = HONEST_UNKNOWN_DEFAULTS[name]
    return async () => factory()
  }
  if (name === 'onRuntimeLog') {
    return onRuntimeLogDefaultImpl
  }
  // NOT_STUBBED_METHODS, and (fail-closed, not open) anything unaccounted for.
  return async () => {
    throw new Error(`hermes test bridge: ${name} not stubbed`)
  }
}

function createBridgeInstance(): BridgeMock {
  const instance: Record<string, ReturnType<typeof vi.fn>> = {}
  for (const name of ALL_METHOD_NAMES) {
    instance[name] = vi.fn(defaultImplFor(name))
  }
  return instance as BridgeMock
}

const bridgeInstance = createBridgeInstance()

/** Installed once by setup-dom; throws if a foreign bridge is already present. */
export function installBridge(): void {
  const existing = window.hermesDesktop
  if (existing && existing !== (bridgeInstance as unknown as HermesDesktopBridge)) {
    throw new Error('hermes test bridge: window.hermesDesktop is already installed by something else')
  }
  window.hermesDesktop = bridgeInstance as unknown as HermesDesktopBridge
}

/** Merges per-test overrides into the ONE bridge object; returns it for assertions. */
export function stubBridge(overrides: Partial<HermesDesktopBridge>): HermesDesktopBridge {
  for (const [name, impl] of Object.entries(overrides)) {
    const mockFn = (bridgeInstance as Record<string, ReturnType<typeof vi.fn>>)[name]
    if (!mockFn) {
      throw new Error(`hermes test bridge: stubBridge got an unknown method "${name}"`)
    }
    mockFn.mockImplementation(impl as (...args: unknown[]) => unknown)
  }
  return bridgeInstance
}

/** Typed access to the bridge for assertions, e.g. expect(bridge().setWhatsappPolicy).toHaveBeenCalled...() */
export function bridge(): BridgeMock {
  return bridgeInstance
}

/** Restores fail-closed defaults and clears call-state (called from afterEach). */
export function resetBridge(): void {
  runtimeLogListeners = []
  for (const name of ALL_METHOD_NAMES) {
    const mockFn = (bridgeInstance as Record<string, ReturnType<typeof vi.fn>>)[name]
    mockFn.mockReset()
    mockFn.mockImplementation(defaultImplFor(name))
  }
}
