import { describe, expect, it } from 'vitest'
import path from 'node:path'
import {
  DEFAULT_ENGINE_REF,
  DEFAULT_ENGINE_REPO_URL,
  ProvisionRefusedError,
  ProvisionStepError,
  applyPlan,
  assertSafeDeploymentPaths,
  buildPlan,
  defaultForbiddenRoots,
  discoverPython,
  discoverTool,
  isInsideOrEqual,
  normalizeDeployment,
  venvPythonPath,
  verifyDeployment,
  windowsCommandLine
} from './provision.mjs'

const ROOT = 'C:\\HermesCommunity'

function descriptor(overrides = {}) {
  return normalizeDeployment(
    {
      installRoot: ROOT,
      contractPath: 'C:\\HermesCommunity\\community.yaml',
      ...overrides
    },
    { platform: 'win32' }
  )
}

const TOOLS = {
  git: ['git'],
  python: ['py', '-3.13'],
  npm: ['npm'],
  node: ['node']
}

const GEN = 'C:\\repo\\scripts\\community-generate.mjs'

function plan(d = descriptor()) {
  return buildPlan(d, TOOLS, { generatorScript: GEN })
}

/**
 * A stateful fake deployment machine: probes/checks consult `state`, run()
 * mutates it the way the real commands would. Fully in-memory.
 */
function fakeMachine(initial = {}) {
  const d = initial.deployment ?? descriptor()
  const state = {
    cloned: false,
    headSha: '',
    refSha: 'abc123abc123abc123',
    venv: false,
    engineInstalled: false,
    bridgeDeps: false,
    homeGenerated: false,
    gatewayInstalled: false,
    files: {}, // absPath -> content (auth.json / creds.json)
    failOn: null, // step-shaped predicate: argv join substring -> exit code
    ...initial
  }
  const runs = []
  const io = {
    isDir(p) {
      if (p === path.join(d.engineDir, '.git')) return state.cloned
      if (p === path.join(d.bridgeDir, 'node_modules', '@whiskeysockets', 'baileys')) return state.bridgeDeps
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
        return state.cloned && state.headSha
          ? { code: 0, stdout: `${state.headSha}\n`, stderr: '' }
          : { code: 128, stdout: '', stderr: 'not a git repo' }
      }
      if (line.includes('rev-parse')) {
        return state.cloned
          ? { code: 0, stdout: `${state.refSha}\n`, stderr: '' }
          : { code: 128, stdout: '', stderr: 'not a git repo' }
      }
      if (line.includes('import hermes_cli')) {
        return { code: state.engineInstalled ? 0 : 1, stdout: '', stderr: '' }
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
      if (line.includes('clone')) state.cloned = true
      else if (line.includes('checkout --detach')) state.headSha = state.refSha
      else if (line.includes('fetch')) {
        /* tags fetched */
      } else if (line.includes('-m venv')) state.venv = true
      else if (line.includes('pip install')) state.engineInstalled = true
      else if (line.includes('npm ci')) state.bridgeDeps = true
      else if (line.includes('generate')) state.homeGenerated = true
      else if (line.includes('gateway install')) state.gatewayInstalled = true
      else throw new Error(`unexpected run: ${line}`)
      return { code: 0 }
    }
  }
  return { io, state, runs, deployment: d }
}

const provisionedState = () => ({
  cloned: true,
  headSha: 'abc123abc123abc123',
  venv: true,
  engineInstalled: true,
  bridgeDeps: true,
  homeGenerated: true,
  gatewayInstalled: true
})

// ---------------------------------------------------------------------------

describe('normalizeDeployment', () => {
  it('derives the layout with defaults (home under root, pinned fork ref)', () => {
    const d = descriptor()
    expect(d.installRoot).toBe(ROOT)
    expect(d.engineDir).toBe(path.join(ROOT, 'engine'))
    expect(d.venvDir).toBe(path.join(ROOT, 'engine', '.venv'))
    expect(d.venvPython).toBe(path.join(ROOT, 'engine', '.venv', 'Scripts', 'python.exe'))
    expect(d.bridgeDir).toBe(path.join(ROOT, 'engine', 'scripts', 'whatsapp-bridge'))
    expect(d.homeDir).toBe(path.join(ROOT, 'home'))
    expect(d.engineRepoUrl).toBe(DEFAULT_ENGINE_REPO_URL)
    expect(d.engineRef).toBe(DEFAULT_ENGINE_REF)
  })

  it('honors explicit home/repo/ref overrides', () => {
    const d = descriptor({ homeDir: 'D:\\data\\community-home', engineRef: 'v9.9.9', engineRepoUrl: 'https://example.com/x.git' })
    expect(d.homeDir).toBe('D:\\data\\community-home')
    expect(d.engineRef).toBe('v9.9.9')
    expect(d.engineRepoUrl).toBe('https://example.com/x.git')
  })

  it('requires installRoot and contractPath', () => {
    expect(() => normalizeDeployment({ contractPath: 'x' })).toThrow(ProvisionRefusedError)
    expect(() => normalizeDeployment({ installRoot: ROOT })).toThrow(/contractPath/)
  })

  it('venvPythonPath is platform-aware', () => {
    expect(venvPythonPath('C:\\v', 'win32')).toBe('C:\\v\\Scripts\\python.exe')
    expect(venvPythonPath('/v', 'linux')).toBe(path.join('/v', 'bin', 'python'))
  })
})

describe('safety: forbidden roots (never touch live install / reference checkout / pilot)', () => {
  const forbidden = defaultForbiddenRoots({ LOCALAPPDATA: 'C:\\Users\\u\\AppData\\Local' })

  it('lists the three protected surfaces', () => {
    expect(forbidden).toEqual([
      'C:\\projects\\hermes-agent',
      'C:\\projects\\hermes-community-pilot',
      'C:\\Users\\u\\AppData\\Local\\hermes'
    ])
  })

  it.each([
    ['C:\\projects\\hermes-agent', 'the reference checkout itself'],
    ['C:\\projects\\hermes-agent\\deploy', 'inside the reference checkout'],
    ['C:\\PROJECTS\\HERMES-AGENT\\x', 'case-insensitively inside'],
    ['C:\\projects\\hermes-community-pilot\\v2', 'inside the pilot'],
    ['C:\\Users\\u\\AppData\\Local\\hermes\\community', 'inside the live HERMES_HOME']
  ])('refuses installRoot %s (%s)', root => {
    expect(() => assertSafeDeploymentPaths({ installRoot: root, homeDir: 'C:\\ok\\home' }, forbidden)).toThrow(
      ProvisionRefusedError
    )
  })

  it('refuses a homeDir inside a protected root even when installRoot is safe', () => {
    expect(() =>
      assertSafeDeploymentPaths(
        { installRoot: 'C:\\HermesCommunity', homeDir: 'C:\\projects\\hermes-community-pilot\\home' },
        forbidden
      )
    ).toThrow(/homeDir/)
  })

  it('refuses an installRoot that CONTAINS a protected root', () => {
    expect(() => assertSafeDeploymentPaths({ installRoot: 'C:\\projects', homeDir: 'C:\\ok' }, forbidden)).toThrow(
      /contains protected directory/
    )
  })

  it('allows sibling directories that merely share a name prefix', () => {
    expect(isInsideOrEqual('C:\\projects\\hermes-agent-two', 'C:\\projects\\hermes-agent')).toBe(false)
    expect(() =>
      assertSafeDeploymentPaths({ installRoot: 'C:\\projects\\hermes-agent-two', homeDir: 'C:\\projects\\hermes-agent-two\\home' }, forbidden)
    ).not.toThrow()
  })

  it('requires non-empty paths', () => {
    expect(() => assertSafeDeploymentPaths({ installRoot: '', homeDir: 'C:\\x' }, forbidden)).toThrow(/required/)
  })
})

describe('plan construction', () => {
  it('produces the M1 steps in dependency order', () => {
    expect(plan().map(s => s.id)).toEqual([
      'engine-clone',
      'engine-checkout',
      'venv-create',
      'engine-install',
      'bridge-deps',
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

  it('pins the engine via clone + fetch --tags + detached checkout of the ref', () => {
    const d = descriptor()
    const steps = plan(d)
    expect(steps[0].commands[0].argv).toEqual(['git', 'clone', DEFAULT_ENGINE_REPO_URL, d.engineDir])
    expect(steps[1].commands.map(c => c.argv)).toEqual([
      ['git', 'fetch', '--tags', 'origin'],
      ['git', 'checkout', '--detach', DEFAULT_ENGINE_REF]
    ])
    for (const c of steps[1].commands) expect(c.cwd).toBe(d.engineDir)
  })

  it('threads HERMES_HOME into the gateway service install via the child env', () => {
    const d = descriptor()
    const gw = plan(d).find(s => s.id === 'gateway-service')
    const [cmd] = gw.commands
    // The engine's install() bakes get_hermes_home() (= this env var) into the
    // generated Scheduled Task launchers — this env IS the threading mechanism.
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
    // NEVER starts a gateway during provisioning.
    expect(cmd.argv).toContain('--no-start-now')
  })

  it('applies the generator through the existing CLI with --init (reuse, not reimplementation)', () => {
    const d = descriptor()
    const gen = plan(d).find(s => s.id === 'home-generate')
    expect(gen.commands[0].argv).toEqual(['node', GEN, 'generate', '--contract', d.contractPath, '--home', d.homeDir, '--init'])
  })

  it('runs pip and npm ci in the right directories', () => {
    const d = descriptor()
    const steps = plan(d)
    const pip = steps.find(s => s.id === 'engine-install').commands[0]
    expect(pip.argv).toEqual([d.venvPython, '-m', 'pip', 'install', '-e', '.'])
    expect(pip.cwd).toBe(d.engineDir)
    const npm = steps.find(s => s.id === 'bridge-deps').commands[0]
    expect(npm.argv).toEqual(['npm', 'ci'])
    expect(npm.cwd).toBe(d.bridgeDir)
  })
})

describe('per-step checks', () => {
  it('engine-checkout: satisfied only when HEAD equals the pinned ref', () => {
    const m = fakeMachine({ cloned: true, headSha: 'abc123abc123abc123' })
    const step = plan(m.deployment).find(s => s.id === 'engine-checkout')
    expect(step.check(m.io).satisfied).toBe(true)
    m.state.headSha = 'ffff00ffff00ffff00'
    const off = step.check(m.io)
    expect(off.satisfied).toBe(false)
    expect(off.detail).toMatch(/!=/)
    m.state.cloned = false
    expect(step.check(m.io).satisfied).toBe(false)
  })

  it('engine-install: unsatisfied without a venv, satisfied when hermes_cli imports', () => {
    const m = fakeMachine()
    const step = plan(m.deployment).find(s => s.id === 'engine-install')
    expect(step.check(m.io)).toMatchObject({ satisfied: false, detail: expect.stringMatching(/venv/) })
    m.state.venv = true
    expect(step.check(m.io).satisfied).toBe(false)
    m.state.engineInstalled = true
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
  it('provisions a bare machine end-to-end in step order', () => {
    const m = fakeMachine()
    const outcome = applyPlan(plan(m.deployment), m.io)
    expect(outcome.executed).toEqual([
      'engine-clone',
      'engine-checkout',
      'venv-create',
      'engine-install',
      'bridge-deps',
      'home-generate',
      'gateway-service'
    ])
    expect(outcome.skipped).toEqual([])
    // Every effect went through io.run, in plan order.
    expect(m.runs.map(r => r.argv.join(' ')).some(l => l.includes('gateway install'))).toBe(true)
    expect(m.runs[0].argv).toContain('clone')
  })

  it('is a no-op on a healthy deployment: nothing executed, all skipped', () => {
    const m = fakeMachine(provisionedState())
    const outcome = applyPlan(plan(m.deployment), m.io)
    expect(outcome.executed).toEqual([])
    expect(outcome.skipped).toHaveLength(7)
    expect(m.runs).toHaveLength(0)
  })

  it('executes only the unsatisfied tail after partial provisioning', () => {
    const m = fakeMachine({ cloned: true, headSha: 'abc123abc123abc123', venv: true, engineInstalled: true })
    const outcome = applyPlan(plan(m.deployment), m.io)
    expect(outcome.skipped).toEqual(['engine-clone', 'engine-checkout', 'venv-create', 'engine-install'])
    expect(outcome.executed).toEqual(['bridge-deps', 'home-generate', 'gateway-service'])
    expect(m.runs.map(r => r.argv.join(' ')).filter(l => l.includes('clone'))).toHaveLength(0)
  })

  it('FAILS CLOSED: a nonzero exit in step 3 aborts before any later step runs', () => {
    const m = fakeMachine({ failOn: '-m venv' })
    let caught
    try {
      applyPlan(plan(m.deployment), m.io)
    } catch (err) {
      caught = err
    }
    expect(caught).toBeInstanceOf(ProvisionStepError)
    expect(caught.stepId).toBe('venv-create')
    expect(caught.exitCode).toBe(1)
    expect(caught.message).toMatch(/later steps not attempted/)
    // clone + fetch + checkout + venv attempt = 4 runs; pip/npm/generator/gateway never ran.
    const lines = m.runs.map(r => r.argv.join(' '))
    expect(lines.filter(l => l.includes('pip install'))).toHaveLength(0)
    expect(lines.filter(l => l.includes('npm ci'))).toHaveLength(0)
    expect(lines.filter(l => l.includes('gateway install'))).toHaveLength(0)
    // The error carries the results of the steps that did complete.
    expect(caught.results.map(r => r.id)).toEqual(['engine-clone', 'engine-checkout'])
  })

  it('FAILS CLOSED: a command that "succeeds" without satisfying its check is an error', () => {
    const m = fakeMachine()
    // clone returns exit 0 but never creates the .git dir:
    const io = { ...m.io, run: spec => (m.runs.push(spec), { code: 0 }) }
    expect(() => applyPlan(plan(m.deployment), io)).toThrow(/still unsatisfied/)
    expect(m.runs).toHaveLength(1) // aborted at the first step's post-check
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
  it('reports ok+ready=false on a fresh machine', () => {
    const m = fakeMachine()
    const report = verifyDeployment(plan(m.deployment), m.io)
    expect(report.ok).toBe(false)
    expect(report.ready).toBe(false)
    expect(report.steps.filter(s => s.kind === 'execute').every(s => s.status === 'missing')).toBe(true)
  })

  it('provisioned but unauthenticated: ok=true (provisioning done), ready=false (wizard pending)', () => {
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

  it('prefers py -3.13, then walks down, then bare python', () => {
    expect(discoverPython(probeFrom({ 'py -3.13 --version': { code: 0, stdout: 'Python 3.13.5\n' } }))).toMatchObject({
      argv: ['py', '-3.13']
    })
    expect(discoverPython(probeFrom({ 'py -3.12 --version': { code: 0, stdout: 'Python 3.12.9\n' } }))).toMatchObject({
      argv: ['py', '-3.12']
    })
    expect(discoverPython(probeFrom({ 'python --version': { code: 0, stdout: 'Python 3.11.4\n' } }))).toMatchObject({
      argv: ['python']
    })
  })

  it('rejects interpreters outside the engine range (3.14, 3.10)', () => {
    expect(discoverPython(probeFrom({ 'python --version': { code: 0, stdout: 'Python 3.14.0\n' } }))).toBeNull()
    expect(discoverPython(probeFrom({ 'python --version': { code: 0, stdout: 'Python 3.10.11\n' } }))).toBeNull()
    expect(discoverPython(probeFrom({}))).toBeNull()
  })

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
