import { describe, expect, it } from 'vitest'
import {
  deepMerge,
  dockerReadiness,
  getConfig,
  listTerminalBackends,
  putConfig,
  setTerminalBackend
} from './hermes-config.cjs'

function recorder(response: unknown = {}) {
  const calls: Array<{ endpoint: string; init?: { method?: string; body?: unknown } }> = []
  const api = async (endpoint: string, init?: { method?: string; body?: unknown }) => {
    calls.push({ endpoint, init })
    return typeof response === 'function' ? (response as (e: string) => unknown)(endpoint) : response
  }
  return { api, calls }
}

describe('deepMerge', () => {
  it('merges nested objects and replaces arrays/scalars wholesale', () => {
    const merged = deepMerge(
      { a: { x: 1, y: 2 }, list: [1, 2], keep: 'yes' },
      { a: { y: 9, z: 3 }, list: [3] }
    )
    expect(merged).toEqual({ a: { x: 1, y: 9, z: 3 }, list: [3], keep: 'yes' })
  })

  it('lets a null patch replace an object (deep-merge cannot delete keys)', () => {
    expect(deepMerge({ display: { personality: 'x' } }, { display: { personality: null } })).toEqual({
      display: { personality: null }
    })
  })
})

describe('getConfig', () => {
  it('normalizes both {config} and bare-object responses', async () => {
    expect(await getConfig(recorder({ config: { a: 1 } }).api)).toEqual({ a: 1 })
    expect(await getConfig(recorder({ a: 2 }).api)).toEqual({ a: 2 })
  })
})

describe('putConfig', () => {
  it('sends {config, profile:default} with PUT', async () => {
    const { api, calls } = recorder({ ok: true })
    await putConfig({ approvals: { mode: 'manual' } }, api)
    expect(calls[0]).toEqual({
      endpoint: '/api/config',
      init: { method: 'PUT', body: { config: { approvals: { mode: 'manual' } }, profile: 'default' } }
    })
  })
})

describe('listTerminalBackends', () => {
  it('accepts array and {backends} shapes', async () => {
    expect(await listTerminalBackends(recorder([{ id: 'local' }]).api)).toEqual([{ id: 'local' }])
    expect(await listTerminalBackends(recorder({ backends: [{ id: 'docker' }] }).api)).toEqual([{ id: 'docker' }])
  })
})

describe('setTerminalBackend', () => {
  it('PUTs the backend to the dedicated endpoint', async () => {
    const { api, calls } = recorder({ ok: true })
    await setTerminalBackend('docker', api)
    expect(calls[0]).toEqual({
      endpoint: '/api/tools/terminal/backend',
      init: { method: 'PUT', body: { backend: 'docker' } }
    })
  })
})

describe('dockerReadiness (fail-closed)', () => {
  it('is ready only when the docker backend reports status ready', async () => {
    const ready = await dockerReadiness(recorder([{ id: 'docker', status: 'ready' }]).api)
    expect(ready).toMatchObject({ ready: true, present: true, status: 'ready' })
  })

  it('is not ready when docker is stopped', async () => {
    const stopped = await dockerReadiness(recorder([{ id: 'docker', status: 'stopped' }]).api)
    expect(stopped).toMatchObject({ ready: false, present: true, status: 'stopped' })
  })

  it('reports missing when docker backend is absent', async () => {
    const missing = await dockerReadiness(recorder([{ id: 'local', status: 'ready' }]).api)
    expect(missing).toMatchObject({ ready: false, present: false, status: 'missing' })
  })

  it('reports unavailable when the runtime call throws', async () => {
    const throwing = async () => {
      throw new Error('runtime down')
    }
    expect(await dockerReadiness(throwing)).toMatchObject({ ready: false, present: false, status: 'unavailable' })
  })
})
