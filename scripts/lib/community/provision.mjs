// Community-mode provisioning core: deployment descriptor → step plan.
// PURE — every effect and every filesystem/command probe goes through an
// injected io interface, so the whole planner is unit-testable without disk,
// network, git, python or schtasks (docs/specs/community-mode.md §6).
//
// SINGLE-HOME MODEL (user decision 2026-08-16): community is a CAPABILITY of
// the user's ONE Hermes installation — one engine, one gateway, one WhatsApp
// connection, one HERMES_HOME. Nothing is cloned and no venv is created here;
// the official Tachles bootstrap installs official Hermes (`pip install -e .`
// into <engine>/venv — editable, so a git checkout below takes effect without
// a reinstall), and this plan only ADDS the community capability:
//   1. official-install  GATE (no commands): the official editable git
//                        checkout + venv must already exist. A ZIP/non-git
//                        install fails closed here — the overlay would
//                        otherwise silently have no effect.
//   2. engine-overlay    TEMPORARY until upstream PR #85490 merges: fetch the
//                        reviewed fork tag BY URL (no remote bookkeeping —
//                        idempotent) and detach-checkout the pinned SHA in the
//                        SAME official checkout. The desktop updater already
//                        classifies a detached/non-upstream checkout as
//                        'pinned' and refuses to auto-update over it. When
//                        the PR lands in an official release, this step is
//                        deleted and `git checkout main` restores stock.
//   2b. engine-deps      the checkout can cross an engine version (a live
//                        0.19.x install overlaid with the 0.20.1-based fork
//                        REALLY happens — verified 2026-08-16 on the live
//                        machine: cryptography 48→50, Pillow, nemo-relay pins
//                        moved). Editable code takes effect instantly but the
//                        venv's pinned deps do NOT — so when the installed
//                        dist version != the checkout's pyproject version,
//                        re-run the OFFICIAL installer command
//                        (`uv pip install -e .`; uv honors the pyproject's
//                        [tool.uv] override-dependencies, which plain pip
//                        cannot). pip is only the fallback when uv is absent.
//   3. profile-create    one `hermes profile create <slug> --no-alias
//                        --no-skills` per contract space — Hermes' OWN profile
//                        lifecycle, never a hand-rolled mkdir.
//   4. home-generate     community generator apply (scripts/community-generate.mjs
//                        — REUSED as a child process, never reimplemented). It
//                        merges ADDITIVELY into the existing home (see
//                        buildGatewayConfig) — a pre-existing business
//                        deployment keeps working.
//   5. gateway-service   hermes gateway install as a Windows auto-start
//                        (Scheduled Task /SC ONLOGON w/ restart handling, or the
//                        engine's Startup-folder fallback on locked-down boxes).
//                        HERMES_HOME is threaded via the child process env: the
//                        engine's install() → _write_task_script() reads
//                        get_hermes_home() (env HERMES_HOME —
//                        hermes_constants.py:_hermes_home_from_env) and BAKES it
//                        into the generated launchers, so the logon task always
//                        starts the gateway on THIS home.
//   6. auth-state        REPORT-ONLY: auth.json presence + provider state.
//                        Interactive OAuth is the companion UI's concern.
//   7. pairing-state     REPORT-ONLY: WhatsApp creds.json presence. QR pairing
//                        is likewise a UI concern.
//
// Fail-closed rules:
//   * apply stops at the FIRST failing command; later steps are not attempted.
//   * after a step's commands run, its check() is re-evaluated — a command that
//     "succeeded" without producing the satisfied state is an error, not a pass.
//   * safety: refuses any engineDir/homeDir inside (or containing) the
//     read-only reference checkouts or the manual pilot.
//
// io interface (all injected):
//   io.isDir(absPath)  -> boolean
//   io.isFile(absPath) -> boolean
//   io.readFile(absPath) -> string | null (null = absent; real errors throw)
//   io.probe({ argv, cwd?, env? }) -> { code, stdout, stderr }   read-only cmds
//   io.run({ argv, cwd?, env? })   -> { code }                   effectful cmds

import path from 'node:path'
import { fileURLToPath } from 'node:url'

export const DEFAULT_ENGINE_REPO_URL = 'https://github.com/NehoraiHadad/hermes-agent.git'
export const DEFAULT_ENGINE_REF = 'community-engine-v0.3.0'
export const DEFAULT_ENGINE_SHA = 'bb2591ab492d577ed597af8f66f6942040858690'


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
  const engineSha = descriptor.engineSha || DEFAULT_ENGINE_SHA
  if (!/^[0-9a-f]{40}$/i.test(engineSha)) {
    throw new ProvisionRefusedError('descriptor.engineSha must be a full 40-character commit SHA')
  }
  if (isInsideOrEqual(home, engineDir)) {
    throw new ProvisionRefusedError('homeDir must not live inside the engine checkout')
  }
  return {
    engineRepoUrl: descriptor.engineRepoUrl || DEFAULT_ENGINE_REPO_URL,
    engineRef: descriptor.engineRef || DEFAULT_ENGINE_REF,
    engineSha: engineSha.toLowerCase(),
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

// Editable installs read hermes_cli SOURCE from the checkout, so importing
// __version__ would always match the checkout and prove nothing. The dist-info
// metadata in site-packages is written at INSTALL time — it is the honest
// "which pyproject were the deps resolved against" signal.
const DIST_VERSION_SNIPPET =
  "from importlib.metadata import version; print(version('hermes-agent'))"

/** Parse `[project] version = "…"` out of a pyproject.toml text. */
export function pyprojectVersion(text) {
  const m = /^version\s*=\s*["']([^"']+)["']/m.exec(text ?? '')
  return m ? m[1] : null
}

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
  const git = tools?.git ?? ['git']
  const node = tools?.node ?? [process.execPath]
  const genScript = generatorScript ?? defaultGeneratorScript()
  const gitDir = path.join(d.engineDir, '.git')

  const steps = []

  // GATE — no commands on purpose: when unsatisfied, applyPlan runs nothing
  // and the re-check still fails, aborting the whole apply with this detail.
  // A ZIP/non-git official install MUST stop here: the overlay would checkout
  // nothing and the plan would otherwise "succeed" on stock engine behavior.
  steps.push({
    id: 'official-install',
    kind: 'execute',
    description: 'verify the official editable Hermes install (git checkout + venv)',
    commands: [],
    check(io) {
      if (!io.isDir(gitDir)) {
        return {
          satisfied: false,
          detail:
            `no git checkout at ${d.engineDir} — install official Hermes first (the Tachles installer does this); ` +
            'a ZIP/non-git Hermes install cannot take the community engine overlay'
        }
      }
      if (!io.isFile(d.venvPython)) {
        return { satisfied: false, detail: `no venv interpreter at ${d.venvPython} — the official install is incomplete` }
      }
      return { satisfied: true, detail: `official editable install present at ${d.engineDir}` }
    }
  })

  // TEMPORARY until upstream #85490 (WhatsApp observer) ships in an official
  // release: overlay the reviewed fork SHA onto the SAME official checkout.
  // Fetching BY URL keeps this idempotent with zero remote bookkeeping, and
  // the editable install means the checkout takes effect with no reinstall.
  steps.push({
    id: 'engine-overlay',
    kind: 'execute',
    description: `overlay ${d.engineRef} at ${d.engineSha.slice(0, 12)} onto the official checkout (temporary until PR #85490 merges)`,
    commands: [
      { argv: [...git, 'fetch', d.engineRepoUrl, `refs/tags/${d.engineRef}`], cwd: d.engineDir },
      { argv: [...git, 'checkout', '--detach', d.engineSha], cwd: d.engineDir }
    ],
    check(io) {
      if (!io.isDir(gitDir)) return { satisfied: false, detail: 'official checkout is not present yet' }
      const head = io.probe({ argv: [...git, 'rev-parse', 'HEAD'], cwd: d.engineDir })
      if (head.code !== 0) return { satisfied: false, detail: 'cannot resolve HEAD in the official checkout' }
      const headSha = head.stdout.trim().toLowerCase()
      return headSha === d.engineSha
        ? { satisfied: true, detail: `HEAD is the pinned overlay ${d.engineRef} (${d.engineSha.slice(0, 12)})` }
        : { satisfied: false, detail: `HEAD ${headSha.slice(0, 12)} != pinned ${d.engineSha.slice(0, 12)}` }
    }
  })

  // The overlay checkout may cross an engine version (live 0.19.x → fork's
  // 0.20.1 base). Editable code switches instantly; the venv's dependency pins
  // do NOT — resync them exactly the way the official installer does. uv is
  // REQUIRED for a correct resolve (the 0.20.1 pyproject relies on [tool.uv]
  // override-dependencies to reconcile cryptography==50 with capped
  // transitive deps); venv pip is only a last-resort fallback.
  const uv = tools?.uv ?? null
  steps.push({
    id: 'engine-deps',
    kind: 'execute',
    description: 'sync venv dependencies to the overlaid checkout (official `uv pip install -e .`)',
    commands: [
      uv
        ? { argv: [...uv, 'pip', 'install', '-e', '.', '--python', d.venvPython], cwd: d.engineDir, env: PYTHON_ENV }
        : { argv: [d.venvPython, '-m', 'pip', 'install', '-e', '.'], cwd: d.engineDir, env: PYTHON_ENV }
    ],
    check(io) {
      const pyproject = io.readFile(path.join(d.engineDir, 'pyproject.toml'))
      if (pyproject == null) return { satisfied: false, detail: `no pyproject.toml at ${d.engineDir} — official checkout incomplete` }
      const want = pyprojectVersion(pyproject)
      if (!want) return { satisfied: false, detail: 'cannot parse the project version from pyproject.toml' }
      const r = io.probe({ argv: [d.venvPython, '-c', DIST_VERSION_SNIPPET], cwd: d.engineDir, env: PYTHON_ENV })
      if (r.code !== 0) {
        return { satisfied: false, detail: 'hermes-agent dist metadata unreadable in the venv — editable install incomplete' }
      }
      const have = (r.stdout ?? '').trim()
      return have === want
        ? { satisfied: true, detail: `venv deps installed against pyproject ${want}` }
        : { satisfied: false, detail: `installed dist ${have} != checkout pyproject ${want} — dependency pins are stale, resync required` }
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
