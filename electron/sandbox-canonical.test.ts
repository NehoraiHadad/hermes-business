import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { classifyRoot, effectiveRoots, persistedRoots, denyAllSafeRoot } from './sandbox-roots.cjs'
import { computeSandboxPlan, planSandbox, applyResolvedPlan } from './sandbox-config.cjs'
import { writeRootEnv } from './partner-settings.cjs'

// One resolver, every consumer. These prove a symlink/junction writable root is
// resolved to its ONE canonical real target for the guard env, the Docker binds,
// the persisted settings AND the live UI state — and that the raw link path never
// leaks into any of them. A non-reparse Hebrew/spaces dir stays untouched.

let home: string
let previousHome: string | undefined

beforeEach(() => {
  previousHome = process.env.HERMES_BUSINESS_HOME
  // Canonicalize the suite root: on an 8.3-short TEMP (CI runners) the raw
  // mkdtemp path is an alias, and every "non-reparse dirs are unchanged"
  // assertion below would see selected != realpath through no fault of its own.
  home = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'hermes-canonical-')))
  process.env.HERMES_BUSINESS_HOME = home
})
afterEach(() => {
  if (previousHome === undefined) delete process.env.HERMES_BUSINESS_HOME
  else process.env.HERMES_BUSINESS_HOME = previousHome
  fs.rmSync(home, { recursive: true, force: true })
})

function dir(...parts: string[]) {
  const p = path.join(home, ...parts)
  fs.mkdirSync(p, { recursive: true })
  return p
}
function makeLink(target: string, link: string, ctx: { skip: () => void }): boolean {
  try {
    fs.symlinkSync(target, link, process.platform === 'win32' ? 'junction' : 'dir')
    return true
  } catch {
    ctx.skip() // OS/permissions cannot create a reparse point here — honest skip.
    return false
  }
}

describe('canonical link resolution across every consumer', () => {
  it('a junction/symlink writable root becomes its real target for guard, docker, persist and state — the raw link never appears', ctx => {
    const target = dir('יעד אמיתי')
    const link = path.join(home, 'link root')
    if (!makeLink(target, link, ctx)) return
    const real = fs.realpathSync.native(target)
    const guard = { mode: 'partner', sandbox: 'guard', roots: [{ path: link, access: 'rw' }] }

    // 1) guard write-safe root — real target only, never the link.
    const env = writeRootEnv(guard)
    expect(env).toBe(real)
    expect(env).not.toContain(link)

    // 2) Docker bind specs — real target only.
    const dplan = computeSandboxPlan({ ...guard, sandbox: 'docker' }, { ready: true, status: 'ready' })
    expect(dplan.config.terminal.docker_volumes).toEqual([`${real}:/mnt/root0`])
    expect(dplan.mounts.map(m => m.host)).toEqual([real])
    expect(JSON.stringify(dplan)).not.toContain(link.replace(/\\/g, '\\\\'))

    // 3) Persisted settings + 4) effective UI state (getPartnerState uses these).
    expect(persistedRoots(guard)).toEqual([{ path: real, access: 'rw' }])
    expect(effectiveRoots(guard)).toEqual([{ path: real, access: 'rw' }])

    // classifyRoot keeps the selection for display but hands the real target on.
    expect(classifyRoot({ path: link, access: 'rw' })).toMatchObject({
      selected: link,
      path: real,
      reparse: true,
      valid: true
    })
  })

  it('a link to a missing target and a link to a file both fail closed — identically for guard and docker', ctx => {
    // Link whose target no longer exists.
    const gone = path.join(home, 'gone')
    fs.mkdirSync(gone)
    const deadLink = path.join(home, 'dead link')
    if (!makeLink(gone, deadLink, ctx)) return
    fs.rmSync(gone, { recursive: true, force: true })
    expect(classifyRoot({ path: deadLink, access: 'rw' }).valid).toBe(false)

    // Link to a regular file, not a directory.
    const file = path.join(home, 'a-file.txt')
    fs.writeFileSync(file, 'x')
    const fileLink = path.join(home, 'file link')
    if (!makeLink(file, fileLink, ctx)) return
    // A reparse point aimed at a file is invalid; the exact reason is OS-specific
    // (dir-symlink → 'not-a-directory'; Windows junction-to-file → 'unresolvable').
    expect(classifyRoot({ path: fileLink, access: 'rw' }).valid).toBe(false)

    for (const bad of [deadLink, fileLink]) {
      const settings = { mode: 'partner', sandbox: 'guard', roots: [{ path: bad, access: 'rw' }] }
      // Guard fails closed to the deny-all sentinel (never null / unrestricted)...
      expect(writeRootEnv(settings)).toBe(denyAllSafeRoot(home))
      // ...and docker surfaces it as invalid (planSandbox then rejects it).
      const dplan = computeSandboxPlan({ ...settings, sandbox: 'docker' }, { ready: true, status: 'ready' })
      expect(dplan.invalidRoots).toHaveLength(1)
      expect(dplan.mounts).toHaveLength(0)
    }
  })

  it('a plain Hebrew + spaces directory (no reparse) is unchanged across every consumer', () => {
    const p = dir('תיקיה עם רווחים')
    const real = fs.realpathSync.native(p) // equals path.resolve for a non-reparse dir
    const settings = { mode: 'partner', sandbox: 'guard', roots: [{ path: p, access: 'rw' }] }
    expect(classifyRoot({ path: p, access: 'rw' })).toMatchObject({ selected: p, path: real, reparse: false, valid: true })
    expect(writeRootEnv(settings)).toBe(real)
    expect(persistedRoots(settings)).toEqual([{ path: real, access: 'rw' }])
    expect(effectiveRoots(settings)).toEqual([{ path: real, access: 'rw' }])
    const dplan = computeSandboxPlan({ ...settings, sandbox: 'docker' }, { ready: true, status: 'ready' })
    expect(dplan.config.terminal.docker_volumes).toEqual([`${real}:/mnt/root0`])
  })
})

describe('TOCTOU: roots are re-verified immediately before apply', () => {
  function fakeApi() {
    const calls: string[] = []
    const api = async (endpoint: string, init?: { method?: string }) => {
      if (init?.method === 'PUT' || init?.method === 'POST') calls.push(endpoint)
      return {}
    }
    return { api, calls }
  }

  it('guard: a writable root deleted between plan and apply fails closed and writes nothing', async () => {
    const out = dir('out')
    const { api, calls } = fakeApi()
    const plan = await planSandbox({ mode: 'partner', sandbox: 'guard', roots: [{ path: out, access: 'rw' }] }, { api })
    fs.rmSync(out, { recursive: true, force: true }) // vanishes after validation
    await expect(applyResolvedPlan(plan, api)).rejects.toThrow(/לא תקינות/)
    expect(calls).toHaveLength(0)
  })

  it('docker: a bind root deleted between plan and apply fails closed before any config write', async () => {
    const out = dir('bind')
    const { api, calls } = fakeApi()
    const plan = await planSandbox({ mode: 'partner', sandbox: 'docker', roots: [{ path: out, access: 'rw' }] }, {
      api,
      dockerReadiness: async () => ({ ready: true, status: 'ready' })
    })
    fs.rmSync(out, { recursive: true, force: true })
    await expect(applyResolvedPlan(plan, api)).rejects.toThrow(/לא תקינות/)
    expect(calls).toHaveLength(0)
  })
})
