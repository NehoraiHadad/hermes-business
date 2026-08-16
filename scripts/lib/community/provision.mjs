// Community-mode M1 provisioning core: deployment descriptor → step plan.
// PURE — every effect and every filesystem/command probe goes through an
// injected io interface, so the whole planner is unit-testable without disk,
// network, git, python or schtasks (docs/specs/community-mode.md §6, M1).
//
// The plan provisions a COMPLETE community deployment on a Windows machine:
//   1. engine-clone      git clone of the pinned fork
//   2. engine-checkout   fetch tags + detached checkout of the pinned ref
//   3. venv-create       python -m venv <engine>/.venv (engine's own
//                        _detect_venv_dir probes ".venv" under PROJECT_ROOT —
//                        hermes_cli/gateway.py:2623 — so the service launcher
//                        the engine later bakes finds this interpreter)
//   4. engine-install    pip install -e . into the venv
//   5. bridge-deps       npm ci in scripts/whatsapp-bridge
//   6. home-generate     community generator apply (scripts/community-generate.mjs
//                        — REUSED as a child process, never reimplemented; its
//                        own refusal logic guards the HERMES_HOME target)
//   7. gateway-service   hermes gateway install as a Windows auto-start
//                        (Scheduled Task /SC ONLOGON w/ restart handling, or the
//                        engine's Startup-folder fallback on locked-down boxes).
//                        HERMES_HOME is threaded via the child process env: the
//                        engine's install() → _write_task_script() reads
//                        get_hermes_home() (env HERMES_HOME —
//                        hermes_constants.py:_hermes_home_from_env) and BAKES it
//                        into the generated launchers (`set "HERMES_HOME=…"` in
//                        gateway.cmd, `env.Item("HERMES_HOME") = "…"` in
//                        gateway.vbs — hermes_cli/gateway_windows.py:411,496),
//                        so the logon task always starts the gateway on OUR home.
//   8. auth-state        REPORT-ONLY: auth.json presence + openai-codex provider.
//                        `hermes auth add openai-codex --type oauth` is an
//                        INTERACTIVE device flow — a wizard (M2) concern.
//                        Provisioning verifies and reports, never performs it.
//   9. pairing-state     REPORT-ONLY: WhatsApp creds.json presence. QR pairing
//                        is likewise a wizard concern.
//
// Fail-closed rules:
//   * apply stops at the FIRST failing command; later steps are not attempted.
//   * after a step's commands run, its check() is re-evaluated — a command that
//     "succeeded" without producing the satisfied state is an error, not a pass.
//   * safety: refuses any installRoot/homeDir inside (or containing) the live
//     business install (%LOCALAPPDATA%\hermes), the read-only engine reference
//     checkout, or the manual community pilot.
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
export const DEFAULT_ENGINE_REF = 'community-engine-v0.2.2'
export const DEFAULT_ENGINE_SHA = 'af04eb8bb85e0a5b6333cd0104921b7e49bcf1f9'

// Python range the engine accepts (pyproject.toml: requires-python >=3.11,<3.14),
// newest-first so the venv gets the best interpreter available.
export const PYTHON_MINORS = [13, 12, 11]

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

/** Directories this provisioner must NEVER touch (spec M1 safety posture). */
export function defaultForbiddenRoots(env = process.env) {
  const roots = [
    'C:\\projects\\hermes-agent', // read-only engine reference checkout
    'C:\\projects\\hermes-community-pilot' // manual pilot deployment
  ]
  const localAppData = (env.LOCALAPPDATA ?? '').trim()
  if (localAppData) roots.push(path.join(localAppData, 'hermes')) // live business install
  return roots
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
export function assertSafeDeploymentPaths({ installRoot, homeDir }, forbiddenRoots = defaultForbiddenRoots()) {
  for (const [label, target] of [['installRoot', installRoot], ['homeDir', homeDir]]) {
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
 * agrees on:
 *   <installRoot>/engine        pinned engine checkout
 *   <installRoot>/engine/.venv  its virtualenv
 *   <homeDir>                   HERMES_HOME (default <installRoot>/home)
 */
export function normalizeDeployment(descriptor, { platform = process.platform } = {}) {
  const { installRoot, contractPath } = descriptor ?? {}
  if (typeof installRoot !== 'string' || installRoot.trim() === '') {
    throw new ProvisionRefusedError('descriptor.installRoot is required')
  }
  if (typeof contractPath !== 'string' || contractPath.trim() === '') {
    throw new ProvisionRefusedError('descriptor.contractPath is required')
  }
  const root = path.resolve(installRoot)
  const engineDir = path.join(root, 'engine')
  const venvDir = path.join(engineDir, '.venv')
  const engineSha = descriptor.engineSha || DEFAULT_ENGINE_SHA
  if (!/^[0-9a-f]{40}$/i.test(engineSha)) {
    throw new ProvisionRefusedError('descriptor.engineSha must be a full 40-character commit SHA')
  }
  return {
    installRoot: root,
    engineRepoUrl: descriptor.engineRepoUrl || DEFAULT_ENGINE_REPO_URL,
    engineRef: descriptor.engineRef || DEFAULT_ENGINE_REF,
    engineSha: engineSha.toLowerCase(),
    homeDir: path.resolve(descriptor.homeDir || path.join(root, 'home')),
    contractPath: path.resolve(contractPath),
    engineDir,
    venvDir,
    venvPython: venvPythonPath(venvDir, platform),
    bridgeDir: path.join(engineDir, 'scripts', 'whatsapp-bridge')
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

/** Find a Python 3.11–3.13 launcher: `py -3.13` … then bare python/python3. */
export function discoverPython(probe) {
  const candidates = [
    ...PYTHON_MINORS.map(minor => ['py', `-3.${minor}`]),
    ['python'],
    ['python3']
  ]
  for (const argv of candidates) {
    const out = probeVersion(probe, argv)
    if (!out) continue
    const m = /Python\s+3\.(\d+)\.\d+/.exec(out)
    if (m && PYTHON_MINORS.includes(Number(m[1]))) {
      return { argv, version: out }
    }
  }
  return null
}

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
export function buildPlan(deployment, tools, { generatorScript } = {}) {
  const d = deployment
  const git = tools?.git ?? ['git']
  const python = tools?.python ?? ['py', '-3.13']
  const npm = tools?.npm ?? ['npm']
  const node = tools?.node ?? [process.execPath]
  const genScript = generatorScript ?? defaultGeneratorScript()
  const gitDir = path.join(d.engineDir, '.git')

  const steps = []

  steps.push({
    id: 'engine-clone',
    kind: 'execute',
    description: `clone pinned engine fork into ${d.engineDir}`,
    commands: [{ argv: [...git, 'clone', d.engineRepoUrl, d.engineDir] }],
    check(io) {
      return io.isDir(gitDir)
        ? { satisfied: true, detail: `git checkout present at ${d.engineDir}` }
        : { satisfied: false, detail: `no git checkout at ${d.engineDir}` }
    }
  })

  steps.push({
    id: 'engine-checkout',
    kind: 'execute',
    description: `pin engine to ${d.engineRef} at ${d.engineSha.slice(0, 12)} (fetch tags + detached checkout)`,
    commands: [
      { argv: [...git, 'fetch', '--tags', 'origin'], cwd: d.engineDir },
      { argv: [...git, 'checkout', '--detach', d.engineSha], cwd: d.engineDir }
    ],
    check(io) {
      if (!io.isDir(gitDir)) return { satisfied: false, detail: 'engine is not cloned yet' }
      const head = io.probe({ argv: [...git, 'rev-parse', 'HEAD'], cwd: d.engineDir })
      const want = io.probe({ argv: [...git, 'rev-parse', `${d.engineRef}^{commit}`], cwd: d.engineDir })
      if (head.code !== 0 || want.code !== 0) {
        return { satisfied: false, detail: `pinned ref ${d.engineRef} is not resolvable in the checkout yet` }
      }
      const headSha = head.stdout.trim()
      const wantSha = want.stdout.trim()
      const expectedSha = d.engineSha.toLowerCase()
      return headSha.toLowerCase() === expectedSha && wantSha.toLowerCase() === expectedSha
        ? { satisfied: true, detail: `HEAD is ${d.engineRef} (${expectedSha.slice(0, 12)})` }
        : {
            satisfied: false,
            detail: `HEAD ${headSha.slice(0, 12)} / ${d.engineRef} ${wantSha.slice(0, 12)} != pinned ${expectedSha.slice(0, 12)}`
          }
    }
  })

  steps.push({
    id: 'venv-create',
    kind: 'execute',
    description: `create Python venv at ${d.venvDir}`,
    commands: [{ argv: [...python, '-m', 'venv', d.venvDir], env: { ...PYTHON_ENV } }],
    check(io) {
      return io.isFile(d.venvPython)
        ? { satisfied: true, detail: `venv interpreter present: ${d.venvPython}` }
        : { satisfied: false, detail: `no venv interpreter at ${d.venvPython}` }
    }
  })

  steps.push({
    id: 'engine-install',
    kind: 'execute',
    description: 'pip install -e . (engine + hermes CLI into the venv)',
    commands: [
      { argv: [d.venvPython, '-m', 'pip', 'install', '-e', '.'], cwd: d.engineDir, env: { ...PYTHON_ENV } }
    ],
    check(io) {
      if (!io.isFile(d.venvPython)) return { satisfied: false, detail: 'venv does not exist yet' }
      const r = io.probe({
        argv: [d.venvPython, '-c', 'import hermes_cli'],
        cwd: d.engineDir,
        env: { ...PYTHON_ENV }
      })
      return r.code === 0
        ? { satisfied: true, detail: 'hermes_cli imports from the venv' }
        : { satisfied: false, detail: 'hermes_cli is not importable from the venv' }
    }
  })

  steps.push({
    id: 'bridge-deps',
    kind: 'execute',
    description: `npm ci in ${d.bridgeDir}`,
    commands: [{ argv: [...npm, 'ci'], cwd: d.bridgeDir }],
    check(io) {
      return io.isDir(path.join(d.bridgeDir, 'node_modules', '@whiskeysockets', 'baileys'))
        ? { satisfied: true, detail: 'bridge node_modules present (baileys installed)' }
        : { satisfied: false, detail: 'bridge node_modules missing or incomplete' }
    }
  })

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
