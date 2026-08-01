import { readFileSync } from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'

// Shared harness: evaluate the SHIPPED business-shell bundle (the exact artifact
// Hermes Desktop loads) in a bare VM and expose its top-level helpers. Both
// plugin-source.test.ts and plugin-cron-listing.test.ts drive this one loader so
// they assert against the real generated code, never a re-authored copy.

export const pluginPath = path.resolve(process.cwd(), 'hermes-plugin/business-shell/plugin.js')
export const pluginSource = readFileSync(pluginPath, 'utf8')

export type Storage = {
  get: (key: string, fallback?: unknown) => unknown
  set: (key: string, value: unknown) => void
  remove: (key: string) => void
}

export function createStorage(): Storage {
  const values = new Map<string, unknown>()
  return {
    get: (key, fallback) => (values.has(key) ? values.get(key) : fallback),
    set: (key, value) => void values.set(key, value),
    remove: key => void values.delete(key)
  }
}

export interface PluginHelpers {
  friendlyToolName: (name: string) => string
  humanSchedule: (schedule: unknown) => string
  guidedSetupPrompt: (snapshot?: Record<string, unknown>) => string
  startGuidedSetup: (storage: Storage, options?: { force?: boolean }) => Promise<Record<string, unknown>>
  summarizeCronJobs: (result: unknown) => { jobs: unknown[]; pausedListingSupported: boolean }
  purgeLegacyPausedCache: (storage: Storage) => number
  isJobPaused: (job: unknown) => boolean
  setPluginRest: (rest: unknown) => void
  hasPausedInclusiveDoor: () => boolean
  loadScheduledTasks: () => Promise<{ jobs: unknown[]; pausedListingSupported: boolean; source: string }>
}

export type LoadedPlugin = vm.Context & {
  __helpers: PluginHelpers
  __plugin: { id: string; register: (ctx: unknown) => void }
}

export function loadShippedPlugin(host: Record<string, unknown>): LoadedPlugin {
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
  const context = vm.createContext({ __host: host, console, Date, JSON, Promise, setTimeout, clearTimeout })
  vm.runInContext(
    `${prelude}\n${withoutImports}\nglobalThis.__helpers = { friendlyToolName, humanSchedule, guidedSetupPrompt, startGuidedSetup, summarizeCronJobs, purgeLegacyPausedCache, isJobPaused, setPluginRest, hasPausedInclusiveDoor, loadScheduledTasks }`,
    context,
    { filename: pluginPath }
  )
  return context as LoadedPlugin
}
