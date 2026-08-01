import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { applyPartnerMode, getPartnerState } from './business-partner.cjs'
import { readSettings } from './partner-settings.cjs'

const repoRoot = path.resolve(process.cwd())

let home: string
let previousHome: string | undefined

function fakeApi(config: Record<string, unknown> = { display: {}, terminal: { backend: 'local' } }) {
  const puts: Array<{ endpoint: string; body: unknown }> = []
  const api = async (endpoint: string, init?: { method?: string; body?: unknown }) => {
    if (init?.method === 'PUT' || init?.method === 'POST') {
      puts.push({ endpoint, body: init.body })
      return { ok: true }
    }
    if (endpoint.startsWith('/api/config')) return config
    if (endpoint.startsWith('/api/tools/terminal/backends')) return []
    return {}
  }
  return { api, puts }
}

beforeEach(() => {
  previousHome = process.env.HERMES_HOME
  home = fs.mkdtempSync(path.join(os.tmpdir(), 'hermes-partner-orch-'))
  process.env.HERMES_HOME = home
})

afterEach(() => {
  if (previousHome === undefined) delete process.env.HERMES_HOME
  else process.env.HERMES_HOME = previousHome
  fs.rmSync(home, { recursive: true, force: true })
})

describe('applyPartnerMode', () => {
  it('enables the personality, installs the packaged Skill, and persists partner mode', async () => {
    const { api, puts } = fakeApi()
    let restarts = 0
    const result = await applyPartnerMode(
      { mode: 'partner', sandbox: 'guard' },
      { api, restart: async () => (restarts += 1) }
    )

    expect(result.settings.mode).toBe('partner')
    expect(readSettings().mode).toBe('partner')
    // Named personality was switched on via native config.
    expect(puts.some(p => p.endpoint === '/api/config')).toBe(true)
    // Packaged Skill is present in the shared skills tree (visible in full Hermes).
    expect(fs.existsSync(path.join(home, 'skills', 'business', 'business-partner', 'SKILL.md'))).toBe(true)
    // No writable roots => no write-root env change => no runtime restart.
    expect(restarts).toBe(0)
    expect(result.restarted).toBe(false)
  })

  it('restarts the runtime only when the injected write-root actually changes', async () => {
    const { api } = fakeApi()
    let restarts = 0
    const restart = async () => {
      restarts += 1
    }
    await applyPartnerMode(
      { mode: 'partner', sandbox: 'guard', roots: [{ path: 'C:/out', access: 'rw' }] },
      { api, restart }
    )
    expect(restarts).toBe(1)
  })

  it('fails closed: a sandbox-apply failure rolls the personality back and persists nothing', async () => {
    // API that lets the personality PUT succeed but fails the sandbox backend pin.
    const puts: Array<{ endpoint: string; body: unknown }> = []
    const api = async (endpoint: string, init?: { method?: string; body?: unknown }) => {
      if (init?.method === 'PUT' || init?.method === 'POST') {
        puts.push({ endpoint, body: init.body })
        if (endpoint === '/api/tools/terminal/backend') throw new Error('backend pin failed')
        return { ok: true }
      }
      if (endpoint.startsWith('/api/config')) return { display: { personality: 'friendly' } }
      if (endpoint.startsWith('/api/tools/terminal/backends')) return []
      return {}
    }

    await expect(
      applyPartnerMode({ mode: 'partner', sandbox: 'guard' }, { api, restart: async () => {} })
    ).rejects.toThrow('backend pin failed')

    // Nothing persisted: settings remain normal (default), no partner state on disk.
    expect(readSettings().mode).toBe('normal')
    // Personality was rolled back to the captured previous selector ('friendly').
    const restore = puts.filter(p => p.endpoint === '/api/config').at(-1)
    expect(restore?.body).toMatchObject({ config: { display: { personality: 'friendly' } } })
  })

  it('restores normal mode without leaving partner persisted', async () => {
    const { api } = fakeApi({ display: { personality: 'business-partner' }, terminal: { backend: 'local' } })
    await applyPartnerMode({ mode: 'partner', sandbox: 'guard' }, { api, restart: async () => {} })
    await applyPartnerMode({ mode: 'normal' }, { api, restart: async () => {} })
    expect(readSettings().mode).toBe('normal')
    expect(readSettings().personalityBackup).toBeNull()
  })
})

describe('business-partner Skill is shipped by BOTH install paths', () => {
  it('the packaged companion installs it to the canonical skills path on enable', async () => {
    const { api } = fakeApi()
    await applyPartnerMode({ mode: 'partner', sandbox: 'guard' }, { api, restart: async () => {} })
    // Canonical Hermes skills path: skills/<category>/<name>/SKILL.md (visible via /api/skills).
    expect(fs.existsSync(path.join(home, 'skills', 'business', 'business-partner', 'SKILL.md'))).toBe(true)
  })

  it('the packaged companion bundles the SKILL.md source (electron-builder files glob)', () => {
    expect(fs.existsSync(path.join(repoRoot, 'hermes-plugin', 'business-partner', 'SKILL.md'))).toBe(true)
    const pkg = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8'))
    // hermes-plugin/**/* is packaged into the asar so partnerSkillSource() resolves at runtime.
    expect(pkg.build.files).toContain('hermes-plugin/**/*')
  })

  it('the thin bootstrap payload ships and installs it (package.json + NSI + bootstrap.ps1)', () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8'))
    const resources: Array<{ from: string; to: string }> = pkg.build.extraResources
    const entry = resources.find(item => item.to === 'business-bootstrap/business-partner.SKILL.md')
    expect(entry?.from).toBe('hermes-plugin/business-partner/SKILL.md')

    const nsi = fs.readFileSync(path.join(repoRoot, 'installer', 'business-bootstrap.nsi'), 'utf8')
    expect(nsi).toContain('business-partner.SKILL.md')

    const bootstrap = fs.readFileSync(path.join(repoRoot, 'installer', 'bootstrap.ps1'), 'utf8')
    expect(bootstrap).toContain('BusinessInstall.ps1')
    // Local install steps live in the dot-sourced BusinessInstall.ps1 module.
    const payload = fs.readFileSync(path.join(repoRoot, 'installer', 'lib', 'BusinessInstall.ps1'), 'utf8')
    expect(payload).toContain('business-partner.SKILL.md')
    expect(payload).toContain("skills\\business\\business-partner\\SKILL.md")
    expect(payload).toContain('Invoke-PayloadTransaction')
  })
})

describe('getPartnerState', () => {
  it('reports settings plus a computed plan and tolerates a live-config read', async () => {
    const { api } = fakeApi({ display: { personality: 'business-partner' }, terminal: { backend: 'local' } })
    await applyPartnerMode({ mode: 'partner', sandbox: 'guard' }, { api, restart: async () => {} })
    const state = await getPartnerState({ api })
    expect(state.mode).toBe('partner')
    expect(state.personalityActive).toBe(true)
    expect(state.plan.effective).toBe('guard')
    expect(state.backend).toBe('local')
  })
})
