import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'
import { describe, expect, it, vi } from 'vitest'

const pluginPath = path.resolve(process.cwd(), 'hermes-plugin/business-shell/plugin.js')
const pluginSource = readFileSync(pluginPath, 'utf8')

type Storage = {
  get: (key: string, fallback?: unknown) => unknown
  set: (key: string, value: unknown) => void
}

function createStorage(): Storage {
  const values = new Map<string, unknown>()
  return {
    get(key, fallback) {
      return values.has(key) ? values.get(key) : fallback
    },
    set(key, value) {
      values.set(key, value)
    }
  }
}

function loadShippedPlugin(host: Record<string, unknown>) {
  const withoutImports = pluginSource
    .replace(/^import React, \{[^}]+\} from 'react'\r?\n/m, '')
    .replace(/import\s*\{[\s\S]*?\}\s*from '@hermes\/plugin-sdk'\r?\n/, '')
    .replace('export default {', 'globalThis.__plugin = {')
  const prelude = `
    const React = { createElement: (...args) => ({ args }) }
    const useEffect = () => {}
    const useMemo = fn => fn()
    const useState = initial => [typeof initial === 'function' ? initial() : initial, () => {}]
    const Badge = Button = Input = Loader = StatusDot = Textarea = () => null
    const PALETTE_AREA = 'palette'
    const ROUTES_AREA = 'routes'
    const SIDEBAR_NAV_AREA = 'sidebar'
    const evaluateRuntimeReadiness = async () => ({ ready: true })
    const useValue = value => value
    const host = globalThis.__host
  `
  const context = vm.createContext({
    __host: host,
    console,
    Date,
    JSON,
    Promise,
    setTimeout,
    clearTimeout
  })
  vm.runInContext(
    `${prelude}\n${withoutImports}\nglobalThis.__helpers = { friendlyToolName, humanSchedule, guidedSetupPrompt, startGuidedSetup, readPausedCronCache }`,
    context,
    { filename: pluginPath }
  )
  return context as typeof context & {
    __helpers: {
      friendlyToolName: (name: string) => string
      humanSchedule: (schedule: unknown) => string
      guidedSetupPrompt: (snapshot?: Record<string, unknown>) => string
      startGuidedSetup: (storage: Storage, options?: { force?: boolean }) => Promise<Record<string, unknown>>
      readPausedCronCache: (storage: Storage) => unknown[]
    }
    __plugin: { id: string; register: (ctx: unknown) => void }
  }
}

describe('shipped Hermes Desktop Plugin', () => {
  it('loads as plain JavaScript and exposes the expected plugin identity and friendly copy', () => {
    const runtime = loadShippedPlugin({})
    expect(runtime.__plugin.id).toBe('business-shell')
    expect(runtime.__helpers.friendlyToolName('google_calendar.list_events')).toBe('בודק את היומן…')
    expect(runtime.__helpers.friendlyToolName('google_workspace.gmail_search')).toBe('עובד עם המייל…')
    expect(runtime.__helpers.humanSchedule('0 8 * * 0-4')).toContain('08:00')
    expect(runtime.__helpers.humanSchedule({ display: '0 8 * * 0-4' })).toContain('08:00')
  })

  it('creates one real guided session and resumes it idempotently', async () => {
    const request = vi.fn(async (method: string) => {
      if (method === 'skills.manage') return { skills: [{ name: 'business-bootstrap' }] }
      if (method === 'cron.manage') return { jobs: [] }
      if (method === 'session.create') {
        return { session_id: 'runtime-1', stored_session_id: 'stored-1' }
      }
      return { status: 'streaming' }
    })
    const navigate = vi.fn()
    const runtime = loadShippedPlugin({
      request,
      navigate,
      notify: vi.fn(),
      state: {
        gateway: { get: () => 'open' },
        model: { get: () => 'gpt-test' },
        profile: { get: () => 'default' }
      }
    })
    const storage = createStorage()

    await runtime.__helpers.startGuidedSetup(storage)
    await runtime.__helpers.startGuidedSetup(storage)

    expect(request.mock.calls.map(call => call[0])).toEqual([
      'skills.manage',
      'cron.manage',
      'session.create',
      'prompt.submit'
    ])
    expect(navigate).toHaveBeenLastCalledWith('/stored-1')
    const prompt = runtime.__helpers.guidedSetupPrompt()
    expect(prompt).toContain('/business-bootstrap')
    expect(prompt).toContain('WRAPPER_VERIFIED_SNAPSHOT')
    expect(prompt).toContain('Never run hermes doctor')
  })

  it('expires the local paused-task compatibility cache instead of keeping ghost tasks forever', () => {
    const runtime = loadShippedPlugin({})
    const storage = createStorage()
    storage.set('pausedCronJobs', [
      { id: 'fresh', cachedAt: new Date().toISOString() },
      { id: 'legacy-without-expiry' },
      { id: 'expired', cachedAt: '2020-01-01T00:00:00.000Z' }
    ])

    expect(runtime.__helpers.readPausedCronCache(storage).map(job => (job as { id: string }).id)).toEqual(['fresh'])
  })

  it('imports only symbols present in the installed Hermes Plugin SDK when Hermes is available', () => {
    const sdkPath = path.join(
      process.env.LOCALAPPDATA || '',
      'hermes',
      'hermes-agent',
      'apps',
      'desktop',
      'src',
      'sdk',
      'index.ts'
    )
    if (!existsSync(sdkPath)) return
    const sdk = readFileSync(sdkPath, 'utf8')
    const importBlock = pluginSource.match(/import\s*\{([\s\S]*?)\}\s*from '@hermes\/plugin-sdk'/)?.[1] || ''
    const imported = importBlock
      .split(',')
      .map(value => value.trim())
      .filter(Boolean)
    expect(imported.length).toBeGreaterThan(0)
    for (const symbol of imported) {
      expect(sdk, `Hermes Plugin SDK is missing ${symbol}`).toMatch(new RegExp(`\\b${symbol}\\b`))
    }
  })
})
