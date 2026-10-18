// Community provisioning adds native profiles, config and skills to one Hermes
// home. Hermes alone owns engine acquisition, dependencies and updates.
// Every effect is injected through io; apply stops on the first failed check.
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export class ProvisionRefusedError extends Error {
  constructor(message) {
    super(message)
    this.name = 'ProvisionRefusedError'
  }
}

export class ProvisionStepError extends Error {
  constructor(message, { stepId, command, exitCode, results } = {}) {
    super(message)
    this.name = 'ProvisionStepError'
    this.stepId = stepId
    this.command = command
    this.exitCode = exitCode
    this.results = results ?? []
  }
}

// ---------------------------------------------------------------------------
// Safety: forbidden roots
// ---------------------------------------------------------------------------

/** Directories this provisioner must NEVER touch (spec M1 safety posture).
 * NOTE: the live install (%LOCALAPPDATA%\hermes) is intentionally NOT listed —
 * under the single-home model it IS the target. The read-only development
 * checkouts and the manual pilot stay protected. */
export function defaultForbiddenRoots() {
  return [
    'C:\\projects\\hermes-agent', // read-only engine reference checkout
    'C:\\projects\\hermes-agent-community-release', // fork release worktree
    'C:\\projects\\hermes-agent-upstream-audit', // upstream PR audit worktree
    'C:\\projects\\hermes-community-pilot' // manual pilot deployment
  ]
}

/** Windows-first path identity: resolved, no trailing separators, case-folded. */
function pathKey(p) {
  return path.resolve(p).replace(/[\\/]+$/, '').toLowerCase()
}

export function isInsideOrEqual(candidate, root) {
  const c = pathKey(candidate)
  const r = pathKey(root)
  // Separator-aware prefix check: C:\projects\hermes-agent-two is NOT inside
  // C:\projects\hermes-agent.
  return c === r || c.startsWith(r + path.sep) || c.startsWith(r + '/')
}

/**
 * Refuse deployment paths that overlap a forbidden root — in EITHER direction:
 * a target inside a forbidden root would write into protected state; a target
 * CONTAINING one would put protected state inside a directory this tool treats
 * as its own install area.
 */
export function assertSafeDeploymentPaths({ engineDir, homeDir }, forbiddenRoots = defaultForbiddenRoots()) {
  for (const [label, target] of [['engineDir', engineDir], ['homeDir', homeDir]]) {
    if (typeof target !== 'string' || target.trim() === '') {
      throw new ProvisionRefusedError(`${label} is required`)
    }
    for (const root of forbiddenRoots) {
      if (isInsideOrEqual(target, root)) {
        throw new ProvisionRefusedError(
          `${label} ${path.resolve(target)} is inside protected directory ${root} — refusing (never touch the live install, the engine reference checkout, or the manual pilot)`
        )
      }
      if (isInsideOrEqual(root, target)) {
        throw new ProvisionRefusedError(
          `${label} ${path.resolve(target)} contains protected directory ${root} — refusing (pick a dedicated directory, e.g. C:\\HermesCommunity)`
        )
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Deployment descriptor
// ---------------------------------------------------------------------------

/** Interpreter path inside a venv (mirrors hermes_constants.venv_python_path). */
export function venvPythonPath(venvDir, platform = process.platform) {
  return platform === 'win32'
    ? path.join(venvDir, 'Scripts', 'python.exe')
    : path.join(venvDir, 'bin', 'python')
}

/**
 * Normalize a deployment descriptor into the absolute-path layout every step
 * agrees on. SINGLE-HOME: the official Tachles/Hermes layout is reused as-is.
 *   <homeDir>                     the ONE real HERMES_HOME
 *   <homeDir>/hermes-agent        the official editable engine checkout
 *   <homeDir>/hermes-agent/venv   the official venv (installer-created)
 * `engineDir` may be overridden for non-standard installs; nothing else may.
 */
export function normalizeDeployment(descriptor, { platform = process.platform } = {}) {
  const { homeDir, contractPath } = descriptor ?? {}
  if (typeof homeDir !== 'string' || homeDir.trim() === '') {
    throw new ProvisionRefusedError('descriptor.homeDir is required (the one real HERMES_HOME)')
  }
  if (typeof contractPath !== 'string' || contractPath.trim() === '') {
    throw new ProvisionRefusedError('descriptor.contractPath is required')
  }
  const home = path.resolve(homeDir)
  const engineDir = path.resolve(descriptor.engineDir || path.join(home, 'hermes-agent'))
  const venvDir = path.join(engineDir, 'venv')
  if (isInsideOrEqual(home, engineDir)) {
    throw new ProvisionRefusedError('homeDir must not live inside the engine checkout')
  }
  return {
    homeDir: home,
    contractPath: path.resolve(contractPath),
    engineDir,
    venvDir,
    venvPython: venvPythonPath(venvDir, platform)
  }
}

// ---------------------------------------------------------------------------
// Tool discovery (probe-injected, pure)
// ---------------------------------------------------------------------------

function probeVersion(probe, argv) {
  try {
    const r = probe({ argv: [...argv, '--version'] })
    if (r && r.code === 0) return `${r.stdout ?? ''}${r.stderr ?? ''}`.trim()
  } catch {
    /* discovery never throws — absence is the answer */
  }
  return null
}

// NOTE: no python discovery here on purpose — the single-home model uses the
// official install's own venv interpreter (deployment.venvPython), never a
// system Python.

export function discoverTool(probe, name) {
  const out = probeVersion(probe, [name])
  return out ? { argv: [name], version: out } : null
}

// ---------------------------------------------------------------------------
// Windows command-line rendering (for .cmd shims like npm — cmd.exe parsing)
// ---------------------------------------------------------------------------

/**
 * Render an argv as one cmd.exe-safe command line (used by the real executor
 * for npm.cmd, which cannot be spawned directly with shell:false). Fail-closed
 * on characters whose cmd.exe semantics we will not gamble on.
 */
export function windowsCommandLine(argv) {
  return argv
    .map(arg => {
      if (/["\r\n%!^&|<>]/.test(arg)) {
        throw new ProvisionRefusedError(`refusing to render cmd.exe argument with unsafe characters: ${JSON.stringify(arg)}`)
      }
      return /[\s]/.test(arg) ? `"${arg}"` : arg
    })
    .join(' ')
}

// ---------------------------------------------------------------------------
// Step plan
// ---------------------------------------------------------------------------

const PYTHON_ENV = Object.freeze({ PYTHONIOENCODING: 'utf-8' })

// The engine's own authoritative "is an auto-start registered for this home?"
// predicate (gateway_windows.is_installed = Scheduled Task OR Startup entry).
// The task name is derived from HERMES_HOME (profile-suffix hash), so this must
// run under the engine, not be re-derived here.
const GATEWAY_INSTALLED_SNIPPET =
  'import sys; from hermes_cli import gateway_windows as g; sys.exit(0 if g.is_installed() else 1)'

function defaultGeneratorScript() {
  return fileURLToPath(new URL('../../community-generate.mjs', import.meta.url))
}

/**
 * Build the M1 step plan for a normalized deployment.
 *
 * `tools` supplies argv prefixes for external tools (from discovery, or fakes
 * in tests): `{ git: ['git'], python: ['py','-3.13'], npm: ['npm'], node: [node] }`.
 *
 * Every step: { id, description, kind: 'execute'|'report', commands, check(io) }.
 * check() returns { satisfied, detail } for execute steps and
 * { satisfied, status: 'ok'|'missing'|'degraded', detail } for report steps.
 */
export function buildPlan(deployment, tools, { generatorScript, spaces = [] } = {}) {
  const d = deployment
  const node = tools?.node ?? [process.execPath]
  const genScript = generatorScript ?? defaultGeneratorScript()

  const steps = []

  // The native install is a prerequisite, regardless of its packaging method.
  steps.push({
    id: 'official-install',
    kind: 'execute',
    description: 'verify the native Hermes install and interpreter',
    commands: [],
    check(io) {
      if (!io.isFile(path.join(d.engineDir, 'hermes_cli', 'main.py'))) {
        return { satisfied: false, detail: 'Install official Hermes first; no native CLI source was found' }
      }
      if (!io.isFile(d.venvPython)) {
        return { satisfied: false, detail: `no venv interpreter at ${d.venvPython} — the official install is incomplete` }
      }
      return { satisfied: true, detail: `native Hermes install present at ${d.engineDir}` }
    }
  })

  // Hermes' OWN profile lifecycle — never a hand-rolled mkdir (user principle
  // 2026-08-16: use native mechanisms wherever one exists). --no-alias keeps
  // PATH clean; --no-skills keeps bundled skills out of group spaces. The
  // generator then writes each profile's fenced config.yaml on top.
  for (const space of spaces) {
    steps.push({
      id: `profile-create:${space.slug}`,
      kind: 'execute',
      description: `hermes profile create ${space.slug} (native profile lifecycle)`,
      commands: [
        {
          argv: [d.venvPython, '-m', 'hermes_cli.main', 'profile', 'create', space.slug, '--no-alias', '--no-skills'],
          cwd: d.engineDir,
          env: { ...PYTHON_ENV, HERMES_HOME: d.homeDir, HERMES_NONINTERACTIVE: '1' }
        }
      ],
      check(io) {
        const dir = path.join(d.homeDir, 'profiles', space.slug)
        return io.isDir(dir)
          ? { satisfied: true, detail: `profile directory present: ${dir}` }
          : { satisfied: false, detail: `no profile directory at ${dir}` }
      }
    })
  }

  steps.push({
    id: 'home-generate',
    kind: 'execute',
    description: `apply community.yaml contract into HERMES_HOME ${d.homeDir}`,
    commands: [
      {
        argv: [...node, genScript, 'generate', '--contract', d.contractPath, '--home', d.homeDir, '--init']
      }
    ],
    check(io) {
      // Delegate to the generator's own verify (reused, not reimplemented):
      // exit 0 = every artifact matches the contract.
      const r = io.probe({
        argv: [...node, genScript, 'verify', '--contract', d.contractPath, '--home', d.homeDir]
      })
      return r.code === 0
        ? { satisfied: true, detail: 'home artifacts match the contract (generator verify)' }
        : { satisfied: false, detail: 'generator verify reports drift/missing artifacts (or the home is not generated yet)' }
    }
  })

  steps.push({
    id: 'gateway-service',
    kind: 'execute',
    description: 'register gateway auto-start for this HERMES_HOME (hermes gateway install; no start now)',
    commands: [
      {
        argv: [d.venvPython, '-m', 'hermes_cli.main', 'gateway', 'install', '--no-start-now', '--start-on-login'],
        cwd: d.engineDir,
        env: { ...PYTHON_ENV, HERMES_HOME: d.homeDir, HERMES_NONINTERACTIVE: '1' }
      }
    ],
    check(io) {
      if (!io.isFile(d.venvPython)) return { satisfied: false, detail: 'venv does not exist yet' }
      const r = io.probe({
        argv: [d.venvPython, '-c', GATEWAY_INSTALLED_SNIPPET],
        cwd: d.engineDir,
        env: { ...PYTHON_ENV, HERMES_HOME: d.homeDir, HERMES_NONINTERACTIVE: '1' }
      })
      return r.code === 0
        ? { satisfied: true, detail: 'gateway auto-start is registered for this home (engine is_installed)' }
        : { satisfied: false, detail: 'no gateway auto-start registered for this home' }
    }
  })

  // ── report-only steps: verified, never performed here (wizard/M2 scope) ──

  steps.push({
    id: 'auth-state',
    kind: 'report',
    description: 'provider auth state (report-only — interactive OAuth is a wizard concern)',
    commands: [],
    check(io) {
      const authPath = path.join(d.homeDir, 'auth.json')
      const text = io.readFile(authPath)
      if (text == null) {
        return {
          satisfied: false,
          status: 'missing',
          detail: `no auth.json in ${d.homeDir} — run the interactive step later: hermes auth add openai-codex --type oauth (with HERMES_HOME set)`
        }
      }
      let providers
      try {
        const parsed = JSON.parse(text)
        providers = parsed && typeof parsed.providers === 'object' && parsed.providers !== null ? parsed.providers : null
      } catch {
        providers = null
      }
      if (providers == null) {
        return { satisfied: false, status: 'degraded', detail: 'auth.json exists but is not a parseable auth store' }
      }
      const names = Object.keys(providers).sort()
      if (names.includes('openai-codex')) {
        return { satisfied: true, status: 'ok', detail: `providers configured: ${names.join(', ')}` }
      }
      return {
        satisfied: false,
        status: names.length === 0 ? 'missing' : 'degraded',
        detail: names.length === 0
          ? 'auth.json has no providers configured'
          : `providers configured: ${names.join(', ')} — openai-codex missing`
      }
    }
  })

  steps.push({
    id: 'pairing-state',
    kind: 'report',
    description: 'WhatsApp pairing state (report-only — QR pairing is a wizard concern)',
    commands: [],
    check(io) {
      // The engine reads the session dir preferred-then-legacy
      // (gateway/whatsapp_identity.py: platforms/whatsapp/session, whatsapp/session).
      const candidates = [
        path.join(d.homeDir, 'platforms', 'whatsapp', 'session', 'creds.json'),
        path.join(d.homeDir, 'whatsapp', 'session', 'creds.json')
      ]
      for (const p of candidates) {
        if (!io.isFile(p)) continue
        const text = io.readFile(p)
        return text != null && text.trim() !== ''
          ? { satisfied: true, status: 'ok', detail: `WhatsApp session credentials present: ${p}` }
          : { satisfied: false, status: 'degraded', detail: `creds.json exists but is empty: ${p}` }
      }
      return {
        satisfied: false,
        status: 'missing',
        detail: 'no WhatsApp creds.json — pair via QR later (wizard/M2, or the bridge pair-only mode)'
      }
    }
  })

  return steps
}

// ---------------------------------------------------------------------------
// Apply + verify
// ---------------------------------------------------------------------------

/**
 * Execute a plan fail-closed:
 *   * report steps are only checked, never executed;
 *   * a satisfied execute step is skipped;
 *   * an unsatisfied step runs its commands in order — first nonzero exit
 *     aborts the whole apply (later steps not attempted);
 *   * after the commands, check() is re-run: still-unsatisfied = hard error.
 *
 * Returns { results, executed, skipped } where results is per-step
 * { id, action: 'executed'|'skipped'|'report', detail, status? } in plan order.
 */
export function applyPlan(steps, io, { log = () => {} } = {}) {
  const results = []
  for (const step of steps) {
    if (step.kind === 'report') {
      const c = step.check(io)
      results.push({ id: step.id, action: 'report', status: c.status, detail: c.detail })
      log(`report    ${step.id}: ${c.status} — ${c.detail}`)
      continue
    }
    const before = step.check(io)
    if (before.satisfied) {
      results.push({ id: step.id, action: 'skipped', detail: before.detail })
      log(`ok        ${step.id}: ${before.detail}`)
      continue
    }
    log(`run       ${step.id}: ${step.description}`)
    for (const command of step.commands) {
      log(`          $ ${command.argv.join(' ')}`)
      const r = io.run(command)
      if (!r || r.code !== 0) {
        throw new ProvisionStepError(
          `step ${step.id} failed: ${JSON.stringify(command.argv.join(' '))} exited with code ${r?.code ?? 'unknown'} — aborting (later steps not attempted)`,
          { stepId: step.id, command, exitCode: r?.code, results }
        )
      }
    }
    const after = step.check(io)
    if (!after.satisfied) {
      throw new ProvisionStepError(
        `step ${step.id}: commands completed but the check is still unsatisfied (${after.detail}) — refusing to continue`,
        { stepId: step.id, results }
      )
    }
    results.push({ id: step.id, action: 'executed', detail: after.detail })
    log(`done      ${step.id}`)
  }
  return {
    results,
    executed: results.filter(r => r.action === 'executed').map(r => r.id),
    skipped: results.filter(r => r.action === 'skipped').map(r => r.id)
  }
}

/**
 * Run every step's check and report per-step status. Execute steps report
 * ok/missing (missing = provisioning incomplete); report steps carry their own
 * ok/missing/degraded. Overall `ok` covers EXECUTE steps only — auth/pairing
 * are wizard-owned and must not fail the provisioning verdict; `ready` is the
 * stricter "everything including auth+pairing" signal for the wizard.
 */
export function verifyDeployment(steps, io) {
  const report = steps.map(step => {
    const c = step.check(io)
    return {
      id: step.id,
      kind: step.kind,
      status: step.kind === 'report' ? c.status : c.satisfied ? 'ok' : 'missing',
      detail: c.detail
    }
  })
  const ok = report.filter(s => s.kind === 'execute').every(s => s.status === 'ok')
  const ready = ok && report.filter(s => s.kind === 'report').every(s => s.status === 'ok')
  return { ok, ready, steps: report }
}
