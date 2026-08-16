import { describe, expect, it } from 'vitest'
import path from 'node:path'
import {
  DEFAULT_ENGINE_REF,
  DEFAULT_ENGINE_REPO_URL,
  DEFAULT_ENGINE_SHA,
  ProvisionRefusedError,
  ProvisionStepError,
  applyPlan,
  assertSafeDeploymentPaths,
  buildPlan,
  defaultForbiddenRoots,
  discoverTool,
  isInsideOrEqual,
  normalizeDeployment,
  venvPythonPath,
  verifyDeployment,
  windowsCommandLine
} from './provision.mjs'

// The ONE real HERMES_HOME (single-home model, 2026-08-16 decision).
const HOME = 'C:\\Users\\u\\AppData\\Local\\hermes'

function descriptor(overrides = {}) {
  return normalizeDeployment(
    {
      homeDir: HOME,
      contractPath: 'C:\\Users\\u\\AppData\\Local\\hermes\\tachles\\community.yaml',
      ...overrides
    },
    { platform: 'win32' }
  )
}

const TOOLS = { git: ['git'], node: ['node'] }
const GEN = 'C:\\repo\\scripts\\community-generate.mjs'
const SPACES = [{ slug: 'village' }, { slug: 'private' }]

function plan(d = descriptor(), spaces = SPACES) {
  return buildPlan(d, TOOLS, { generatorScript: GEN, spaces })
}

/**
 * A stateful fake deployment machine: probes/checks consult `state`, run()
 * mutates it the way the real commands would. Fully in-memory.
 */
function fakeMachine(initial = {}) {
  const d = initial.deployment ?? descriptor()
  const state = {
    officialCheckout: false, // <engine>/.git exists (official git install)
    venv: false, // official venv interpreter exists
    headSha: '', // current HEAD of the official checkout
    profiles: {}, // slug -> exists
    homeGenerated: false,
    gatewayInstalled: false,
    files: {}, // absPath -> content (auth.json / creds.json)
    failOn: null, // argv-join substring -> exit 1
    ...initial
  }
  const runs = []
  const io = {
    isDir(p) {
      if (p === path.join(d.engineDir, '.git')) return state.officialCheckout
      const m = /profiles[\\/]([^\\/]+)$/.exec(p)
      if (m && p === path.join(d.homeDir, 'profiles', m[1])) return Boolean(state.profiles[m[1]])
      return false
    },
    isFile(p) {
      if (p === d.venvPython) return state.venv
      return Object.prototype.hasOwnProperty.call(state.files, p)
    },
    readFile(p) {
      return Object.prototype.hasOwnProperty.call(state.files, p) ? state.files[p] : null
    },
    probe(spec) {
      const line = spec.argv.join(' ')
      if (line.includes('rev-parse HEAD')) {
        return state.officialCheckout && state.headSha
          ? { code: 0, stdout: `${state.headSha}\n`, stderr: '' }
          : { code: 128, stdout: '', stderr: 'not a git repo' }
      }
      if (line.includes('verify')) {
        return { code: state.homeGenerated ? 0 : 1, stdout: '', stderr: '' }
      }
      if (line.includes('is_installed')) {
        return { code: state.gatewayInstalled ? 0 : 1, stdout: '', stderr: '' }
      }
      throw new Error(`unexpected probe: ${line}`)
    },
    run(spec) {
      const line = spec.argv.join(' ')
      runs.push(spec)
      if (state.failOn && line.includes(state.failOn)) return { code: 1 }
      if (line.includes('fetch')) {
        /* objects fetched */
      } else if (line.includes('checkout --detach')) state.headSha = d.engineSha
      else if (line.includes('profile create')) {
        const slug = spec.argv[spec.argv.indexOf('create') + 1]
        state.profiles[slug] = true
      } else if (line.includes('generate')) state.homeGenerated = true
      else if (line.includes('gateway install')) state.gatewayInstalled = true
      else throw new Error(`unexpected run: ${line}`)
      return { code: 0 }
    }
  }
  return { io, state, runs, deployment: d }
}

/** An official Hermes install is already present (bootstrap ran). */
const officialState = () => ({ officialCheckout: true, venv: true, headSha: 'f'.repeat(40) })

const provisionedState = () => ({
  officialCheckout: true,
  venv: true,
  headSha: DEFAULT_ENGINE_SHA,
  profiles: { village: true, private: true },
  homeGenerated: true,
  gatewayInstalled: true
})

// ---------------------------------------------------------------------------

describe('normalizeDeployment (single home)', () => {
  it('derives the OFFICIAL layout from the one HERMES_HOME', () => {
    const d = descriptor()
    expect(d.homeDir).toBe(HOME)
    expect(d.engineDir).toBe(path.join(HOME, 'hermes-agent'))
    expect(d.venvDir).toBe(path.join(HOME, 'hermes-agent', 'venv'))
    expect(d.venvPython).toBe(path.join(HOME, 'hermes-agent', 'venv', 'Scripts', 'python.exe'))
    expect(d.engineRepoUrl).toBe(DEFAULT_ENGINE_REPO_URL)
    expect(d.engineRef).toBe(DEFAULT_ENGINE_REF)
    expect(d.engineSha).toBe(DEFAULT_ENGINE_SHA)
  })

  it('honors explicit engineDir/repo/ref overrides', () => {
    const customSha = 'a'.repeat(40)
    const d = descriptor({
      engineDir: 'D:\\hermes\\hermes-agent',
      engineRef: 'v9.9.9',
      engineRepoUrl: 'https://example.com/x.git',
      engineSha: customSha
    })
    expect(d.engineDir).toBe('D:\\hermes\\hermes-agent')
    expect(d.engineRef).toBe('v9.9.9')
    expect(d.engineRepoUrl).toBe('https://example.com/x.git')
    expect(d.engineSha).toBe(customSha)
  })

  it('requires homeDir and contractPath', () => {
    expect(() => normalizeDeployment({ contractPath: 'x' })).toThrow(ProvisionRefusedError)
    expect(() => normalizeDeployment({ homeDir: HOME })).toThrow(/contractPath/)
  })

  it('requires a full immutable engine SHA', () => {
    expect(() => descriptor({ engineSha: '2c9b24e' })).toThrow(/40-character commit SHA/)
  })

  it('refuses a homeDir nested inside the engine checkout', () => {
    expect(() =>
      normalizeDeployment(
        { homeDir: 'D:\\x\\engine\\home', engineDir: 'D:\\x\\engine', contractPath: 'D:\\c.yaml' },
        { platform: 'win32' }
      )
    ).toThrow(/inside the engine checkout/)
  })

  it('venvPythonPath is platform-aware', () => {
    expect(venvPythonPath('C:\\v', 'win32')).toBe('C:\\v\\Scripts\\python.exe')
    expect(venvPythonPath('/v', 'linux')).toBe(path.join('/v', 'bin', 'python'))
  })
})

describe('safety: forbidden roots (never touch the reference checkouts / pilot)', () => {
  const forbidden = defaultForbiddenRoots()

  it('protects the read-only development surfaces, NOT the live install (it is the target now)', () => {
    expect(forbidden).toEqual([
      'C:\\projects\\hermes-agent',
      'C:\\projects\\hermes-agent-community-release',
      'C:\\projects\\hermes-agent-upstream-audit',
      'C:\\projects\\hermes-community-pilot'
    ])
    // The single-home model deliberately targets %LOCALAPPDATA%\hermes.
    expect(() => assertSafeDeploymentPaths({ engineDir: path.join(HOME, 'hermes-agent'), homeDir: HOME }, forbidden)).not.toThrow()
  })

  it.each([
    ['C:\\projects\\hermes-agent', 'the reference checkout itself'],
    ['C:\\projects\\hermes-agent\\deploy', 'inside the reference checkout'],
    ['C:\\PROJECTS\\HERMES-AGENT\\x', 'case-insensitively inside'],
    ['C:\\projects\\hermes-agent-community-release', 'the fork release worktree'],
    ['C:\\projects\\hermes-community-pilot\\v2', 'inside the pilot']
  ])('refuses engineDir %s (%s)', dir => {
    expect(() => assertSafeDeploymentPaths({ engineDir: dir, homeDir: 'C:\\ok\\home' }, forbidden)).toThrow(
      ProvisionRefusedError
    )
  })

  it('refuses a homeDir inside a protected root even when engineDir is safe', () => {
    expect(() =>
      assertSafeDeploymentPaths(
        { engineDir: path.join(HOME, 'hermes-agent'), homeDir: 'C:\\projects\\hermes-community-pilot\\home' },
        forbidden
      )
    ).toThrow(/homeDir/)
  })

  it('refuses an engineDir that CONTAINS a protected root', () => {
    expect(() => assertSafeDeploymentPaths({ engineDir: 'C:\\projects', homeDir: 'C:\\ok' }, forbidden)).toThrow(
      /contains protected directory/
    )
  })

  it('allows sibling directories that merely share a name prefix', () => {
    expect(isInsideOrEqual('C:\\projects\\hermes-agent-two', 'C:\\projects\\hermes-agent')).toBe(false)
    expect(() =>
      assertSafeDeploymentPaths(
        { engineDir: 'C:\\projects\\hermes-agent-two', homeDir: 'C:\\projects\\hermes-agent-two\\home' },
        forbidden
      )
    ).not.toThrow()
  })

  it('requires non-empty paths', () => {
    expect(() => assertSafeDeploymentPaths({ engineDir: '', homeDir: 'C:\\x' }, forbidden)).toThrow(/required/)
  })
})

describe('plan construction (single-home overlay model)', () => {
  it('produces the steps in dependency order, one profile-create per space', () => {
    expect(plan().map(s => s.id)).toEqual([
      'official-install',
      'engine-overlay',
      'profile-create:village',
      'profile-create:private',
      'home-generate',
      'gateway-service',
      'auth-state',
      'pairing-state'
    ])
  })

  it('marks auth/pairing as report-only with no commands', () => {
    const reportSteps = plan().filter(s => s.kind === 'report')
    expect(reportSteps.map(s => s.id)).toEqual(['auth-state', 'pairing-state'])
    for (const s of reportSteps) expect(s.commands).toEqual([])
  })

  it('the official-install GATE has no commands: nothing can ever create the official install from here', () => {
    const gate = plan().find(s => s.id === 'official-install')
    expect(gate.kind).toBe('execute')
    expect(gate.commands).toEqual([])
  })

  it('overlays by fetching the tag BY URL and detaching onto the exact SHA — no clone, no venv, no pip', () => {
    const d = descriptor()
    const steps = plan(d)
    const overlay = steps.find(s => s.id === 'engine-overlay')
    expect(overlay.commands.map(c => c.argv)).toEqual([
      ['git', 'fetch', DEFAULT_ENGINE_REPO_URL, `refs/tags/${DEFAULT_ENGINE_REF}`],
      ['git', 'checkout', '--detach', DEFAULT_ENGINE_SHA]
    ])
    for (const c of overlay.commands) expect(c.cwd).toBe(d.engineDir)
    const allArgv = steps.flatMap(s => s.commands.map(c => c.argv.join(' ')))
    expect(allArgv.some(l => l.includes('clone'))).toBe(false)
    expect(allArgv.some(l => l.includes('-m venv'))).toBe(false)
    expect(allArgv.some(l => l.includes('pip install'))).toBe(false)
    expect(allArgv.some(l => l.includes('npm ci'))).toBe(false)
  })

  it('creates each space profile through Hermes\u2019 OWN profile lifecycle under the one HERMES_HOME', () => {
    const d = descriptor()
    const create = plan(d).find(s => s.id === 'profile-create:village')
    const [cmd] = create.commands
    expect(cmd.argv).toEqual([
      d.venvPython,
      '-m',
      'hermes_cli.main',
      'profile',
      'create',
      'village',
      '--no-alias',
      '--no-skills'
    ])
    expect(cmd.env.HERMES_HOME).toBe(d.homeDir)
    expect(cmd.env.HERMES_NONINTERACTIVE).toBe('1')
  })

  it('threads HERMES_HOME into the gateway service install via the child env', () => {
    const d = descriptor()
    const gw = plan(d).find(s => s.id === 'gateway-service')
    const [cmd] = gw.commands
    expect(cmd.argv).toEqual([
      d.venvPython,
      '-m',
      'hermes_cli.main',
      'gateway',
      'install',
      '--no-start-now',
      '--start-on-login'
    ])
    expect(cmd.env.HERMES_HOME).toBe(d.homeDir)
    expect(cmd.env.HERMES_NONINTERACTIVE).toBe('1')
    expect(cmd.argv).toContain('--no-start-now')
  })

  it('applies the generator through the existing CLI with --init (reuse, not reimplementation)', () => {
    const d = descriptor()
    const gen = plan(d).find(s => s.id === 'home-generate')
    expect(gen.commands[0].argv).toEqual(['node', GEN, 'generate', '--contract', d.contractPath, '--home', d.homeDir, '--init'])
  })
})

describe('per-step checks', () => {
  it('official-install: satisfied only with BOTH the git checkout and the venv interpreter', () => {
    const m = fakeMachine()
    const gate = plan(m.deployment).find(s => s.id === 'official-install')
    expect(gate.check(m.io)).toMatchObject({ satisfied: false, detail: expect.stringMatching(/ZIP\/non-git/) })
    m.state.officialCheckout = true
    expect(gate.check(m.io)).toMatchObject({ satisfied: false, detail: expect.stringMatching(/venv/) })
    m.state.venv = true
    expect(gate.check(m.io).satisfied).toBe(true)
  })

  it('engine-overlay: satisfied only when HEAD equals the pinned SHA', () => {
    const m = fakeMachine({ ...officialState(), headSha: DEFAULT_ENGINE_SHA })
    const step = plan(m.deployment).find(s => s.id === 'engine-overlay')
    expect(step.check(m.io).satisfied).toBe(true)
    m.state.headSha = 'f'.repeat(40)
    const off = step.check(m.io)
    expect(off.satisfied).toBe(false)
    expect(off.detail).toMatch(/!=/)
    m.state.officialCheckout = false
    expect(step.check(m.io).satisfied).toBe(false)
  })

  it('profile-create: satisfied when the profile directory exists', () => {
    const m = fakeMachine(officialState())
    const step = plan(m.deployment).find(s => s.id === 'profile-create:village')
    expect(step.check(m.io).satisfied).toBe(false)
    m.state.profiles.village = true
    expect(step.check(m.io).satisfied).toBe(true)
  })

  it('home-generate: delegates to the generator verify exit code', () => {
    const m = fakeMachine()
    const step = plan(m.deployment).find(s => s.id === 'home-generate')
    expect(step.check(m.io).satisfied).toBe(false)
    m.state.homeGenerated = true
    expect(step.check(m.io).satisfied).toBe(true)
  })

  it('gateway-service: uses the engine is_installed predicate under HERMES_HOME', () => {
    const m = fakeMachine({ venv: true })
    const step = plan(m.deployment).find(s => s.id === 'gateway-service')
    expect(step.check(m.io).satisfied).toBe(false)
    m.state.gatewayInstalled = true
    expect(step.check(m.io).satisfied).toBe(true)
  })

  it('auth-state: missing / degraded / ok around the openai-codex provider', () => {
    const m = fakeMachine()
    const authPath = path.join(m.deployment.homeDir, 'auth.json')
    const step = plan(m.deployment).find(s => s.id === 'auth-state')
    expect(step.check(m.io)).toMatchObject({ status: 'missing', satisfied: false })

    m.state.files[authPath] = 'not json {'
    expect(step.check(m.io)).toMatchObject({ status: 'degraded' })

    m.state.files[authPath] = JSON.stringify({ version: 1, providers: {} })
    expect(step.check(m.io)).toMatchObject({ status: 'missing' })

    m.state.files[authPath] = JSON.stringify({ version: 1, providers: { anthropic: {} } })
    const degraded = step.check(m.io)
    expect(degraded.status).toBe('degraded')
    expect(degraded.detail).toMatch(/openai-codex missing/)

    m.state.files[authPath] = JSON.stringify({ version: 1, providers: { 'openai-codex': { type: 'oauth' } } })
    expect(step.check(m.io)).toMatchObject({ status: 'ok', satisfied: true })
  })

  it('pairing-state: checks preferred then legacy session dirs, degraded on empty creds', () => {
    const m = fakeMachine()
    const step = plan(m.deployment).find(s => s.id === 'pairing-state')
    expect(step.check(m.io)).toMatchObject({ status: 'missing' })

    const legacy = path.join(m.deployment.homeDir, 'whatsapp', 'session', 'creds.json')
    m.state.files[legacy] = '{"noiseKey":"x"}'
    expect(step.check(m.io)).toMatchObject({ status: 'ok' })

    const preferred = path.join(m.deployment.homeDir, 'platforms', 'whatsapp', 'session', 'creds.json')
    m.state.files[preferred] = ''
    expect(step.check(m.io)).toMatchObject({ status: 'degraded' })
  })
})

describe('applyPlan: sequencing, idempotency, failure propagation', () => {
  it('FAILS CLOSED with no official install: the gate aborts before ANY command runs', () => {
    const m = fakeMachine()
    let caught
    try {
      applyPlan(plan(m.deployment), m.io)
    } catch (err) {
      caught = err
    }
    expect(caught).toBeInstanceOf(ProvisionStepError)
    expect(caught.stepId).toBe('official-install')
    expect(caught.message).toMatch(/still unsatisfied/)
    expect(m.runs).toHaveLength(0) // the overlay/generator/gateway never ran
  })

  it('adds the capability to an official install end-to-end in step order', () => {
    const m = fakeMachine(officialState())
    const outcome = applyPlan(plan(m.deployment), m.io)
    expect(outcome.executed).toEqual([
      'engine-overlay',
      'profile-create:village',
      'profile-create:private',
      'home-generate',
      'gateway-service'
    ])
    expect(outcome.skipped).toEqual(['official-install'])
    expect(m.runs.map(r => r.argv.join(' ')).some(l => l.includes('gateway install'))).toBe(true)
  })

  it('is a no-op on a healthy deployment: nothing executed, all skipped', () => {
    const m = fakeMachine(provisionedState())
    const outcome = applyPlan(plan(m.deployment), m.io)
    expect(outcome.executed).toEqual([])
    expect(outcome.skipped).toHaveLength(6)
    expect(m.runs).toHaveLength(0)
  })

  it('executes only the unsatisfied tail after partial provisioning', () => {
    const m = fakeMachine({ ...officialState(), headSha: DEFAULT_ENGINE_SHA, profiles: { village: true, private: true } })
    const outcome = applyPlan(plan(m.deployment), m.io)
    expect(outcome.skipped).toEqual([
      'official-install',
      'engine-overlay',
      'profile-create:village',
      'profile-create:private'
    ])
    expect(outcome.executed).toEqual(['home-generate', 'gateway-service'])
  })

  it('FAILS CLOSED: a nonzero exit in the overlay aborts before any later step runs', () => {
    const m = fakeMachine({ ...officialState(), failOn: 'checkout --detach' })
    let caught
    try {
      applyPlan(plan(m.deployment), m.io)
    } catch (err) {
      caught = err
    }
    expect(caught).toBeInstanceOf(ProvisionStepError)
    expect(caught.stepId).toBe('engine-overlay')
    expect(caught.exitCode).toBe(1)
    expect(caught.message).toMatch(/later steps not attempted/)
    const lines = m.runs.map(r => r.argv.join(' '))
    expect(lines.filter(l => l.includes('profile create'))).toHaveLength(0)
    expect(lines.filter(l => l.includes('gateway install'))).toHaveLength(0)
  })

  it('FAILS CLOSED: a command that "succeeds" without satisfying its check is an error', () => {
    const m = fakeMachine(officialState())
    // fetch+checkout return exit 0 but HEAD never moves:
    const io = { ...m.io, run: spec => (m.runs.push(spec), { code: 0 }) }
    expect(() => applyPlan(plan(m.deployment), io)).toThrow(/still unsatisfied/)
    expect(m.runs).toHaveLength(2) // fetch + checkout, aborted at the post-check
  })

  it('never executes report-only steps, but carries their status in the results', () => {
    const m = fakeMachine(provisionedState())
    const outcome = applyPlan(plan(m.deployment), m.io)
    const reports = outcome.results.filter(r => r.action === 'report')
    expect(reports.map(r => r.id)).toEqual(['auth-state', 'pairing-state'])
    expect(reports.every(r => r.status === 'missing')).toBe(true)
    expect(m.runs).toHaveLength(0)
  })
})

describe('verifyDeployment', () => {
  it('reports ok=false on a machine without the official install', () => {
    const m = fakeMachine()
    const report = verifyDeployment(plan(m.deployment), m.io)
    expect(report.ok).toBe(false)
    expect(report.ready).toBe(false)
    expect(report.steps.filter(s => s.kind === 'execute').every(s => s.status === 'missing')).toBe(true)
  })

  it('provisioned but unauthenticated: ok=true (provisioning done), ready=false (UI pending)', () => {
    const m = fakeMachine(provisionedState())
    const report = verifyDeployment(plan(m.deployment), m.io)
    expect(report.ok).toBe(true)
    expect(report.ready).toBe(false)
    const byId = Object.fromEntries(report.steps.map(s => [s.id, s]))
    expect(byId['auth-state'].status).toBe('missing')
    expect(byId['pairing-state'].status).toBe('missing')
  })

  it('fully ready once auth + pairing exist', () => {
    const m = fakeMachine(provisionedState())
    m.state.files[path.join(m.deployment.homeDir, 'auth.json')] = JSON.stringify({
      version: 1,
      providers: { 'openai-codex': { type: 'oauth' } }
    })
    m.state.files[path.join(m.deployment.homeDir, 'platforms', 'whatsapp', 'session', 'creds.json')] = '{"me":{}}'
    const report = verifyDeployment(plan(m.deployment), m.io)
    expect(report.ok).toBe(true)
    expect(report.ready).toBe(true)
  })
})

describe('tool discovery', () => {
  const probeFrom = table => spec => {
    const key = spec.argv.join(' ')
    return key in table ? table[key] : { code: -1, stdout: '', stderr: 'not found' }
  }

  it('discoverTool reports version or null', () => {
    expect(discoverTool(probeFrom({ 'git --version': { code: 0, stdout: 'git version 2.49.0\n' } }), 'git')).toMatchObject({
      argv: ['git'],
      version: 'git version 2.49.0'
    })
    expect(discoverTool(probeFrom({}), 'npm')).toBeNull()
  })
})

describe('windowsCommandLine (cmd.exe shim rendering)', () => {
  it('quotes arguments containing spaces', () => {
    expect(windowsCommandLine(['C:\\Program Files\\nodejs\\npm.cmd', 'ci'])).toBe('"C:\\Program Files\\nodejs\\npm.cmd" ci')
    expect(windowsCommandLine(['npm', 'ci'])).toBe('npm ci')
  })

  it('fails closed on cmd.exe metacharacters instead of guessing their semantics', () => {
    for (const bad of ['a"b', 'a&b', 'a|b', 'a%b', 'a\nb', 'a^b', 'a<b']) {
      expect(() => windowsCommandLine(['npm', bad])).toThrow(ProvisionRefusedError)
    }
  })
})
