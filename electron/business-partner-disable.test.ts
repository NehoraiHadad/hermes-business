import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { applyPartnerMode } from './business-partner.cjs'
import { readSettings } from './partner-settings.cjs'

// Focused failure-injection suite for the transactional partner->normal disable.
// restoreOwned is two live calls (config PUT then terminal-backend pin); a failure
// of either must roll the live config back to the pre-disable (partner) state AND
// leave persisted settings on 'partner' — never a half-disabled config with normal
// settings. A no-op cron keeps the check-in reconcile out of the picture.
const noopCron = {
  list: async () => [] as any[],
  create: async () => ({ id: 'x' }),
  update: async () => {},
  pause: async () => {},
  resume: async () => {},
  remove: async () => {}
}

function isObj(v: unknown): v is Record<string, any> {
  return Boolean(v) && typeof v === 'object' && !Array.isArray(v)
}
function deepMerge(target: any, patch: any) {
  for (const key of Object.keys(patch || {})) {
    if (isObj(patch[key])) {
      if (!isObj(target[key])) target[key] = {}
      deepMerge(target[key], patch[key])
    } else target[key] = patch[key]
  }
  return target
}

// Live config the fake runtime holds; PUTs mutate it so a later GET (snapshotOwned)
// sees the real partner state, exactly like Hermes' deep-merged config store.
function makeApi() {
  let config: any = {
    display: { personality: 'friendly' },
    approvals: { mode: 'smart', cron_mode: 'approve' },
    terminal: { backend: 'local' }
  }
  const puts: Array<{ endpoint: string; body: any }> = []
  let failEndpoint: string | null = null
  const api = async (endpoint: string, init?: { method?: string; body?: any }) => {
    if (init?.method === 'PUT' || init?.method === 'POST') {
      puts.push({ endpoint, body: init.body })
      if (failEndpoint && endpoint === failEndpoint) throw new Error(`${endpoint} failed`)
      if (endpoint === '/api/config') deepMerge(config, init.body.config)
      if (endpoint === '/api/tools/terminal/backend') deepMerge(config, { terminal: { backend: init.body.backend } })
      return { ok: true }
    }
    if (endpoint.startsWith('/api/config')) return JSON.parse(JSON.stringify(config))
    if (endpoint.startsWith('/api/tools/terminal/backends')) return []
    return {}
  }
  return { api, puts, arm: (e: string) => (failEndpoint = e), personality: () => config.display?.personality }
}

let home: string
let previousHome: string | undefined

beforeEach(() => {
  previousHome = process.env.HERMES_BUSINESS_HOME
  home = fs.mkdtempSync(path.join(os.tmpdir(), 'hermes-partner-disable-'))
  process.env.HERMES_BUSINESS_HOME = home
})

afterEach(() => {
  if (previousHome === undefined) delete process.env.HERMES_BUSINESS_HOME
  else process.env.HERMES_BUSINESS_HOME = previousHome
  fs.rmSync(home, { recursive: true, force: true })
})

async function enablePartner(api: any) {
  await applyPartnerMode({ mode: 'partner', sandbox: 'guard' }, { api, cron: noopCron, restart: async () => {} })
  expect(readSettings().mode).toBe('partner')
}

describe('transactional disable failure injection', () => {
  it('keeps settings + config on partner when the restore config PUT fails', async () => {
    const rt = makeApi()
    await enablePartner(rt.api)
    rt.arm('/api/config') // fail the disable-time restore (and its rollback) PUT
    await expect(
      applyPartnerMode({ mode: 'normal' }, { api: rt.api, cron: noopCron, restart: async () => {} })
    ).rejects.toThrow(/\/api\/config failed/)
    // Nothing persisted to normal — still partner on disk.
    expect(readSettings().mode).toBe('partner')
    expect(readSettings().configBackup).not.toBeNull()
    // The failing PUT never applied, so the live personality is still partner.
    expect(rt.personality()).toBe('business-partner')
  })

  it('rolls the config back to partner and keeps settings partner when the backend pin fails', async () => {
    const rt = makeApi()
    await enablePartner(rt.api)
    rt.arm('/api/tools/terminal/backend') // restore PUT succeeds, backend pin fails
    await expect(
      applyPartnerMode({ mode: 'normal' }, { api: rt.api, cron: noopCron, restart: async () => {} })
    ).rejects.toThrow(/backend failed/)
    // Settings stay partner (persist only on complete success)...
    expect(readSettings().mode).toBe('partner')
    // ...and the pre-disable snapshot was restored, so config is partner again,
    // not the half-restored 'friendly' the first PUT briefly wrote.
    expect(rt.personality()).toBe('business-partner')
  })
})
