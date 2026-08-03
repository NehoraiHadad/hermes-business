import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

// The preload cannot be imported like a normal module: it runs in the sandboxed
// renderer, where Electron hands the script a `require` polyfill that resolves
// only its own loadable modules. This loader mirrors that runner exactly (see
// Electron's `runPreloadScript`/`preloadRequire`), which means the test exercises
// the REAL electron/preload.cjs and fails if a relative `require` is ever added
// to it — that would throw `module not found` in production.

const PRELOAD_PATH = fileURLToPath(new URL('./preload.cjs', import.meta.url))
const BRIDGE_TYPE_PATH = fileURLToPath(new URL('../src/vite-env.d.ts', import.meta.url))

type Bridge = Record<string, (...args: unknown[]) => unknown>
type InvokeImpl = (channel: string, args: unknown[]) => unknown

function loadPreload(invokeImpl: InvokeImpl = () => undefined) {
  const source = readFileSync(PRELOAD_PATH, 'utf8')
  const calls: Array<{ channel: string; args: unknown[] }> = []
  const requested: string[] = []
  const listeners: Array<{ channel: string; listener: (...args: unknown[]) => void }> = []
  const removed: Array<{ channel: string; listener: (...args: unknown[]) => void }> = []
  let exposedKey: string | null = null
  let bridge: Bridge | null = null

  const electron = {
    contextBridge: {
      exposeInMainWorld(key: string, api: Bridge) {
        exposedKey = key
        bridge = api
      }
    },
    ipcRenderer: {
      async invoke(channel: string, ...args: unknown[]) {
        calls.push({ channel, args })
        return invokeImpl(channel, args)
      },
      on(channel: string, listener: (...args: unknown[]) => void) {
        listeners.push({ channel, listener })
      },
      removeListener(channel: string, listener: (...args: unknown[]) => void) {
        removed.push({ channel, listener })
      }
    }
  }

  const preloadRequire = (name: string) => {
    requested.push(name)
    if (name === 'electron') return electron
    throw new Error(`module not found: ${name}`)
  }

  const moduleObject = { exports: {} as Record<string, unknown> }
  // eslint-disable-next-line no-new-func
  const run = new Function('require', 'module', 'exports', source)
  run(preloadRequire, moduleObject, moduleObject.exports)

  if (!bridge) throw new Error('preload did not expose a bridge')
  return { bridge: bridge as Bridge, calls, requested, listeners, removed, exposedKey }
}

/** Method names declared on HermesDesktopBridge in src/vite-env.d.ts. */
function declaredBridgeMembers(): string[] {
  const source = readFileSync(BRIDGE_TYPE_PATH, 'utf8')
  const block = source.split('type HermesDesktopBridge = {')[1]?.split('\n  }')[0]
  if (!block) throw new Error('could not locate HermesDesktopBridge in vite-env.d.ts')
  return [...block.matchAll(/^ {4}(\w+)\??:/gm)].map(match => match[1])
}

/** Exactly how Electron surfaces a throw from an ipcMain.handle handler. */
function wrapLikeElectron(channel: string, thrown: string) {
  return new Error(`Error invoking remote method '${channel}': ${thrown}`)
}

describe('preload bridge (sandboxed contract)', () => {
  it('requires nothing but electron, as the sandboxed preload runtime allows', () => {
    const { requested, exposedKey } = loadPreload()
    expect(requested).toEqual(['electron'])
    expect(exposedKey).toBe('hermesDesktop')
  })

  // Bridge methods that are wired end-to-end (preload + an ipcMain.handle in
  // ipc.cjs) but are not yet declared on HermesDesktopBridge because no renderer
  // consumer calls them yet. Pinned explicitly so the drift stays visible instead
  // of silently growing; the entry is removed once src/vite-env.d.ts declares it.
  // Currently EMPTY: every bridged method is declared. Keep it that way — a new
  // preload method should come with its type, not a new pin.
  const UNDECLARED_BRIDGE_METHODS: string[] = []

  it('implements every method declared in src/vite-env.d.ts, and nothing undeclared beyond the pinned list', () => {
    const { bridge } = loadPreload()
    const implemented = Object.keys(bridge)
    for (const declared of declaredBridgeMembers()) expect(implemented).toContain(declared)
    expect(implemented.filter(name => !declaredBridgeMembers().includes(name)).sort()).toEqual(
      [...UNDECLARED_BRIDGE_METHODS].sort()
    )
  })

  it('forwards channel and arguments unchanged and returns the handler result', async () => {
    const { bridge, calls } = loadPreload((channel, args) => ({ channel, args }))
    await expect(bridge.api('/api/status', { method: 'GET' })).resolves.toEqual({
      channel: 'hermes:api',
      args: ['/api/status', { method: 'GET' }]
    })
    await bridge.applyPartnerMode({ mode: 'partner' })
    await bridge.chooseFile([{ name: 'JSON', extensions: ['json'] }])
    expect(calls).toEqual([
      { channel: 'hermes:api', args: ['/api/status', { method: 'GET' }] },
      { channel: 'hermes:partner:apply', args: [{ mode: 'partner' }] },
      { channel: 'hermes:choose-file', args: [[{ name: 'JSON', extensions: ['json'] }]] }
    ])
  })

  // Partner visibility feed channel (docs/specs/partner-feed.md §11 stage 2): the
  // bridge method exists and goes through the same invoke() as every other
  // channel, with no extra arguments.
  it('exposes getPartnerFeed on hermes:partner:feed via invoke', async () => {
    const snapshot = { available: true, cron: { ok: true, jobs: [] } }
    const { bridge, calls } = loadPreload(() => snapshot)
    await expect(bridge.getPartnerFeed()).resolves.toBe(snapshot)
    expect(calls).toEqual([{ channel: 'hermes:partner:feed', args: [] }])
  })
})

describe('preload IPC error normalization', () => {
  const HEBREW = 'עדכון Hermes כבר מתבצע'

  it('strips the Electron wrapper so the Hebrew message from main survives verbatim', async () => {
    const { bridge } = loadPreload(channel => {
      throw wrapLikeElectron(channel, `Error: ${HEBREW}`)
    })
    await expect(bridge.applyUpdate()).rejects.toThrow(HEBREW)
    await expect(bridge.applyUpdate()).rejects.toMatchObject({ message: HEBREW })
  })

  it('strips the wrapper with or without the inner error-class prefix', async () => {
    const cases: Array<[string, string]> = [
      [`Error: ${HEBREW}`, HEBREW],
      [HEBREW, HEBREW],
      [`TypeError: ${HEBREW}`, HEBREW],
      ['Error: External URL is not allowed', 'External URL is not allowed']
    ]
    for (const [thrown, expected] of cases) {
      const { bridge } = loadPreload(channel => {
        throw wrapLikeElectron(channel, thrown)
      })
      await expect(bridge.openExternal('https://x.example')).rejects.toMatchObject({ message: expected })
    }
  })

  it('normalizes EVERY bridged invoke method, not just a hand-picked few', async () => {
    const { bridge } = loadPreload(channel => {
      throw wrapLikeElectron(channel, `Error: ${HEBREW}`)
    })
    const invokeMethods = Object.keys(bridge).filter(name => name !== 'onRuntimeLog')
    expect(invokeMethods.length).toBeGreaterThan(20)
    for (const name of invokeMethods) {
      await expect(bridge[name]()).rejects.toMatchObject({ message: HEBREW })
    }
  })

  it('leaves an unwrapped error object untouched (same instance rethrown)', async () => {
    const original = new Error('offline')
    const { bridge } = loadPreload(() => {
      throw original
    })
    await expect(bridge.getRuntime()).rejects.toBe(original)
  })

  it('never produces an empty message when the wrapper carried no text', async () => {
    const { bridge } = loadPreload(channel => {
      throw wrapLikeElectron(channel, 'Error: ')
    })
    await expect(bridge.getVersions()).rejects.toMatchObject({
      message: "Error invoking remote method 'hermes:versions': Error: "
    })
  })

  it('does not strip a lookalike prefix from inside a message', async () => {
    const message = "התקנה נכשלה: Error invoking remote method 'x': Error: nested"
    const { bridge } = loadPreload(() => {
      throw new Error(message)
    })
    await expect(bridge.installHermes()).rejects.toMatchObject({ message })
  })
})

describe('preload runtime-log subscription', () => {
  it('keeps the subscribe/unsubscribe shape unchanged', () => {
    const { bridge, listeners, removed } = loadPreload()
    const seen: unknown[] = []
    const unsubscribe = bridge.onRuntimeLog((line: unknown) => seen.push(line)) as () => void

    expect(listeners).toHaveLength(1)
    expect(listeners[0].channel).toBe('hermes:runtime-log')
    listeners[0].listener({}, 'a redacted line')
    expect(seen).toEqual(['a redacted line'])

    unsubscribe()
    expect(removed).toEqual([{ channel: 'hermes:runtime-log', listener: listeners[0].listener }])
  })
})
