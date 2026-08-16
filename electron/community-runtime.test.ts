import { EventEmitter } from 'node:events'
import { describe, expect, it, vi } from 'vitest'
import { createCommunityRuntime } from './community-runtime.cjs'

function fakeChild() {
  return Object.assign(new EventEmitter(), {
    pid: 42,
    stdout: new EventEmitter(),
    stderr: new EventEmitter()
  })
}

describe('separate community runtime', () => {
  it('starts the pinned web surface and hash-scoped gateway with the community home', async () => {
    const child = fakeChild()
    const spawn = vi.fn(() => child)
    const runCaptured = vi.fn(async () => ({ stdout: '', stderr: '' }))
    const runtime = createCommunityRuntime({
      env: { LOCALAPPDATA: 'C:\\Local' },
      inspect: () => ({
        provisioned: true,
        active: true,
        reason: null,
        layout: { home: 'C:\\Community\\home', engine: 'C:\\Community\\engine', python: 'C:\\Community\\python.exe' }
      }),
      choosePort: async () => 9124,
      waitForHealth: async () => ({}),
      spawn,
      runCaptured,
      log: () => {},
      token: 'private-token'
    })

    const state = await runtime.start()
    expect(state).toMatchObject({ provisioned: true, running: true, gatewayStarted: true })
    expect(spawn).toHaveBeenCalledWith(
      'C:\\Community\\python.exe',
      expect.arrayContaining(['serve', '--port', '9124']),
      expect.objectContaining({ cwd: 'C:\\Community\\engine', env: expect.objectContaining({ HERMES_HOME: 'C:\\Community\\home' }) })
    )
    expect(runCaptured).toHaveBeenCalledWith(
      'C:\\Community\\python.exe',
      ['-m', 'hermes_cli.main', 'gateway', 'start'],
      60_000,
      expect.objectContaining({ HERMES_HOME: 'C:\\Community\\home' })
    )
  })

  it('proxies guided onboarding calls only after the separate runtime is healthy', async () => {
    const child = fakeChild()
    const fetch = vi.fn(async () => ({ ok: true, text: async () => '{"pairing_id":"p1"}' }))
    const runtime = createCommunityRuntime({
      env: {},
      inspect: () => ({ provisioned: true, active: true, reason: null, layout: { home: 'h', engine: 'e', python: 'p' } }),
      choosePort: async () => 9121,
      waitForHealth: async () => ({}),
      spawn: () => child,
      runCaptured: async () => ({}),
      fetch,
      log: () => {},
      token: 'token'
    })
    await expect(runtime.api('/api/messaging/whatsapp/onboarding/start', { method: 'POST', body: { mode: 'bot' } }))
      .resolves.toEqual({ pairing_id: 'p1' })
    expect(fetch).toHaveBeenCalledWith(
      'http://127.0.0.1:9121/api/messaging/whatsapp/onboarding/start',
      expect.objectContaining({ method: 'POST', body: '{"mode":"bot"}' })
    )
  })

  it('regenerates every routed profile and restarts the community gateway after model selection', async () => {
    const child = fakeChild()
    const runCaptured = vi.fn(async () => ({}))
    const runtime = createCommunityRuntime({
      env: {},
      inspect: () => ({
        provisioned: true,
        active: true,
        reason: null,
        layout: { contract: 'c.yaml', home: 'home', engine: 'engine', python: 'python.exe' }
      }),
      choosePort: async () => 9121,
      waitForHealth: async () => ({}),
      spawn: () => child,
      runCaptured,
      fetch: async () => ({ ok: true, text: async () => '{"ok":true}' }),
      generatorPath: () => 'community-generate.mjs',
      log: () => {}
    })

    await runtime.api('/api/model/set', {
      method: 'POST',
      body: { scope: 'main', provider: 'openai-codex', model: 'gpt-5' }
    })

    expect(runCaptured).toHaveBeenNthCalledWith(
      2,
      process.execPath,
      ['community-generate.mjs', 'generate', '--contract', 'c.yaml', '--home', 'home'],
      60_000,
      expect.objectContaining({ HERMES_HOME: 'home', ELECTRON_RUN_AS_NODE: '1' })
    )
    expect(runCaptured).toHaveBeenNthCalledWith(
      3,
      'python.exe',
      ['-m', 'hermes_cli.main', 'gateway', 'restart'],
      60_000,
      expect.objectContaining({ HERMES_HOME: 'home' })
    )
  })

  it('does nothing before a community contract has been provisioned', async () => {
    const runtime = createCommunityRuntime({
      inspect: () => ({ provisioned: false, active: false, target: 'business', layout: null, reason: 'not provisioned' }),
      spawn: vi.fn()
    })
    await expect(runtime.start()).resolves.toMatchObject({ provisioned: false, active: false, target: 'business', running: false })
  })

  it('fails closed without getting stuck when no private port is available', async () => {
    const runtime = createCommunityRuntime({
      inspect: () => ({ provisioned: true, active: true, reason: null, layout: { home: 'h', engine: 'e', python: 'p' } }),
      choosePort: async () => { throw new Error('no port') },
      spawn: vi.fn()
    })
    await expect(runtime.start()).resolves.toMatchObject({ running: false, starting: false, error: 'no port' })
  })

  it('retries a failed gateway start without spawning a second web surface', async () => {
    const child = fakeChild()
    const spawn = vi.fn(() => child)
    const runCaptured = vi.fn()
      .mockRejectedValueOnce(new Error('scheduled task unavailable'))
      .mockResolvedValueOnce({ stdout: '', stderr: '' })
    const runtime = createCommunityRuntime({
      env: {},
      inspect: () => ({
        provisioned: true,
        active: true,
        reason: null,
        layout: { home: 'h', engine: 'e', python: 'p' }
      }),
      choosePort: async () => 9121,
      waitForHealth: async () => ({}),
      spawn,
      runCaptured,
      log: () => {}
    })

    await expect(runtime.start()).resolves.toMatchObject({
      running: true,
      gatewayStarted: false,
      error: expect.stringContaining('scheduled task unavailable')
    })
    await expect(runtime.start()).resolves.toMatchObject({ running: true, gatewayStarted: true, error: null })
    expect(spawn).toHaveBeenCalledOnce()
    expect(runCaptured).toHaveBeenCalledTimes(2)
  })

  it('surfaces a failed model-sync gateway restart as not started', async () => {
    const child = fakeChild()
    const runCaptured = vi.fn()
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({})
      .mockRejectedValueOnce(new Error('restart denied'))
    const inspect = () => ({
      provisioned: true,
      active: true,
      reason: null,
      layout: { contract: 'c', home: 'h', engine: 'e', python: 'p' }
    })
    const runtime = createCommunityRuntime({
      inspect,
      choosePort: async () => 9121,
      waitForHealth: async () => ({}),
      spawn: () => child,
      runCaptured,
      fetch: async () => ({ ok: true, text: async () => '{"ok":true}' }),
      generatorPath: () => 'generate.mjs',
      log: () => {}
    })

    await expect(runtime.api('/api/model/set', { method: 'POST', body: {} })).rejects.toThrow('restart denied')
    expect(runtime.status()).toMatchObject({ running: true, gatewayStarted: false, error: expect.stringContaining('restart denied') })
  })
})
