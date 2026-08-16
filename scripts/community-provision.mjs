// Community-capability provisioning CLI — SINGLE HOME (2026-08-16 decision:
// one Hermes install, one gateway, one WhatsApp connection, one HERMES_HOME).
//
//   node scripts/community-provision.mjs plan   --contract <community.yaml> [--home <HERMES_HOME>]
//   node scripts/community-provision.mjs apply  --contract <community.yaml> [--home <HERMES_HOME>]
//   node scripts/community-provision.mjs verify --contract <community.yaml> [--home <HERMES_HOME>]
//   optional: --engine-dir <dir> --engine-repo <url> --engine-ref <tag> --engine-sha <40-char-sha>
//
// `--home` defaults to %HERMES_HOME% and then %LOCALAPPDATA%\hermes — the
// official install this capability is added to. Nothing is cloned and no venv
// is created: the plan gates on the official editable install, overlays the
// reviewed engine SHA (temporary until upstream PR #85490 merges), creates the
// space profiles via Hermes' own `profile create`, and applies the generator.
//
// plan:   print the step plan with each step's current check status. No effects.
// apply:  execute unsatisfied steps in order (fail-closed on the first nonzero
//         exit). Re-running on a healthy deployment executes nothing.
// verify: run all checks, including the report-only auth/pairing state, and
//         exit 1 when provisioning is incomplete.
//
// This CLI is the REAL executor; the planning/verification core is pure
// (scripts/lib/community/provision.mjs) and fully unit-tested with fakes.
// Never starts a gateway. Auth (interactive OAuth device flow) and WhatsApp QR
// pairing are companion-UI concerns — verified and reported here, never run.

import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { contractSpaces, parseContract, validateContract } from './lib/community/contract.mjs'
import {
  ProvisionRefusedError,
  ProvisionStepError,
  applyPlan,
  assertSafeDeploymentPaths,
  buildPlan,
  discoverTool,
  normalizeDeployment,
  verifyDeployment,
  windowsCommandLine
} from './lib/community/provision.mjs'

function usage(message) {
  if (message) console.error(`community-provision: ${message}`)
  console.error(
    'usage: node scripts/community-provision.mjs <plan|apply|verify> --contract <community.yaml> [--home <HERMES_HOME>] [--engine-dir <dir>] [--engine-repo <url>] [--engine-ref <ref>] [--engine-sha <40-char-sha>]'
  )
  process.exit(2)
}

function defaultHome(env = process.env) {
  const fromEnv = (env.HERMES_HOME ?? '').trim()
  if (fromEnv) return fromEnv
  const localAppData = (env.LOCALAPPDATA ?? '').trim()
  return localAppData ? path.join(localAppData, 'hermes') : null
}

function parseArgs(argv) {
  const [command, ...rest] = argv
  if (!['plan', 'apply', 'verify'].includes(command ?? '')) {
    usage(`unknown command ${JSON.stringify(command ?? '')}`)
  }
  const opts = { command }
  for (let i = 0; i < rest.length; i++) {
    const arg = rest[i]
    if (arg === '--contract') opts.contract = rest[++i]
    else if (arg === '--home') opts.home = rest[++i]
    else if (arg === '--engine-dir') opts.engineDir = rest[++i]
    else if (arg === '--engine-repo') opts.engineRepo = rest[++i]
    else if (arg === '--engine-ref') opts.engineRef = rest[++i]
    else if (arg === '--engine-sha') opts.engineSha = rest[++i]
    else usage(`unknown argument ${JSON.stringify(arg)}`)
  }
  if (!opts.contract) usage('--contract <community.yaml> is required')
  if (!opts.home) {
    opts.home = defaultHome()
    if (!opts.home) usage('--home is required when neither HERMES_HOME nor LOCALAPPDATA is set')
  }
  return opts
}

// ---------------------------------------------------------------------------
// Real executor
// ---------------------------------------------------------------------------

/** npm ships as a .cmd shim on Windows — it needs a cmd.exe line, not spawn(file). */
function needsCmdShell(argv0) {
  if (process.platform !== 'win32') return false
  const base = path.basename(argv0).toLowerCase()
  return base.endsWith('.cmd') || base.endsWith('.bat') || base === 'npm' || base === 'npx'
}

function spawnSpec(spec, { capture }) {
  const options = {
    cwd: spec.cwd,
    env: spec.env ? { ...process.env, ...spec.env } : process.env,
    encoding: 'utf8',
    stdio: capture ? ['ignore', 'pipe', 'pipe'] : ['ignore', 'inherit', 'inherit'],
    windowsHide: true
  }
  const r = needsCmdShell(spec.argv[0])
    ? spawnSync(windowsCommandLine(spec.argv), { ...options, shell: true })
    : spawnSync(spec.argv[0], spec.argv.slice(1), options)
  if (r.error) {
    return { code: -1, stdout: '', stderr: String(r.error.message ?? r.error) }
  }
  return { code: r.status ?? -1, stdout: r.stdout ?? '', stderr: r.stderr ?? '' }
}

const realIo = {
  isDir(p) {
    try {
      return statSync(p).isDirectory()
    } catch {
      return false
    }
  },
  isFile(p) {
    try {
      return statSync(p).isFile()
    } catch {
      return false
    }
  },
  readFile(p) {
    if (!existsSync(p)) return null
    return readFileSync(p, 'utf8')
  },
  probe(spec) {
    return spawnSpec(spec, { capture: true })
  },
  run(spec) {
    // Progress streams straight to the console (git clone, pip, npm ci are
    // long); fail-closed on nonzero exit is enforced by applyPlan.
    return spawnSpec(spec, { capture: false })
  }
}

// ---------------------------------------------------------------------------
// Tool discovery with actionable failures
// ---------------------------------------------------------------------------

function discoverTools(deployment) {
  const probe = spec => spawnSpec(spec, { capture: true })
  const missing = []
  // git is the only REQUIRED external tool: python lives in the official
  // install's venv, and the generator runs under this same node.
  const git = discoverTool(probe, 'git')
  if (!git) missing.push('git — install from https://git-scm.com/download/win, then re-run')
  // uv is PREFERRED for engine-deps (the official installer's own command; it
  // honors [tool.uv] override-dependencies, plain pip cannot). The official
  // install ships it in <home>\bin; fall back to PATH, then to venv pip.
  let uv = null
  const homeUv = path.join(deployment.homeDir, 'bin', process.platform === 'win32' ? 'uv.exe' : 'uv')
  if (realIo.isFile(homeUv)) {
    const r = probe({ argv: [homeUv, '--version'] })
    if (r.code === 0) uv = { argv: [homeUv] }
  }
  if (!uv) uv = discoverTool(probe, 'uv')
  return {
    missing,
    tools: {
      git: git?.argv ?? ['git'],
      node: [process.execPath],
      uv: uv?.argv ?? null
    }
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function main() {
  const opts = parseArgs(process.argv.slice(2))
  if (process.platform !== 'win32') {
    console.error('community-provision: Windows-first tool — gateway service registration uses Scheduled Tasks (schtasks). Aborting on this platform.')
    process.exit(1)
  }

  let deployment
  try {
    deployment = normalizeDeployment({
      contractPath: opts.contract,
      homeDir: opts.home,
      engineDir: opts.engineDir,
      engineRepoUrl: opts.engineRepo,
      engineRef: opts.engineRef,
      engineSha: opts.engineSha
    })
    assertSafeDeploymentPaths(deployment)
  } catch (err) {
    if (err instanceof ProvisionRefusedError) {
      console.error(`community-provision: ${err.message}`)
      process.exit(1)
    }
    throw err
  }

  if (!realIo.isFile(deployment.contractPath)) {
    console.error(`community-provision: contract file not found: ${deployment.contractPath}`)
    process.exit(1)
  }

  // Space profiles come from the validated contract — an invalid contract must
  // fail here, before any step could act on a half-parsed group list.
  let spaces
  try {
    const raw = parseContract(readFileSync(deployment.contractPath, 'utf8'))
    const validated = validateContract(raw, {
      fileExists: source => existsSync(path.resolve(path.dirname(deployment.contractPath), source))
    })
    if (!validated.ok) {
      console.error('community-provision: community.yaml is invalid:')
      for (const e of validated.errors) console.error(`  - ${e}`)
      process.exit(1)
    }
    spaces = contractSpaces(validated.contract)
  } catch (err) {
    console.error(`community-provision: cannot read the community contract: ${err.message}`)
    process.exit(1)
  }

  const { missing, tools } = discoverTools(deployment)
  if (missing.length > 0) {
    for (const m of missing) console.error(`community-provision: missing prerequisite: ${m}`)
    if (opts.command === 'apply') {
      console.error('community-provision: refusing to apply with missing prerequisites (fail-closed)')
      process.exit(1)
    }
    console.error('community-provision: continuing with nominal tool names — statuses below may be incomplete')
  }

  const steps = buildPlan(deployment, tools, { spaces })

  console.log(`deployment: home=${deployment.homeDir} (the ONE HERMES_HOME)`)
  console.log(`            engine=${deployment.engineDir}`)
  console.log(`            overlay=${deployment.engineRepoUrl} @ ${deployment.engineRef} (${deployment.engineSha}) — temporary until PR #85490 merges`)
  console.log(`            contract=${deployment.contractPath}`)
  console.log('')

  if (opts.command === 'plan') {
    steps.forEach((step, i) => {
      const c = step.check(realIo)
      const state = step.kind === 'report' ? `${c.status} (report-only)` : c.satisfied ? 'satisfied' : 'pending'
      console.log(`[${i + 1}] ${step.id} — ${step.description}`)
      console.log(`    state: ${state} — ${c.detail}`)
      for (const cmd of step.commands) {
        console.log(`    would run: ${cmd.argv.join(' ')}${cmd.cwd ? `  (cwd: ${cmd.cwd})` : ''}${cmd.env ? `  (env: ${Object.entries(cmd.env).map(([k, v]) => `${k}=${v}`).join(' ')})` : ''}`)
      }
    })
    return
  }

  if (opts.command === 'verify') {
    const report = verifyDeployment(steps, realIo)
    for (const s of report.steps) {
      console.log(`${s.status.padEnd(9)} ${s.id}${s.kind === 'report' ? ' (report-only)' : ''} — ${s.detail}`)
    }
    if (!report.ok) {
      console.error('community-provision: verify FAILED — provisioning is incomplete (see above); run apply')
      process.exit(1)
    }
    console.log(
      report.ready
        ? 'community-provision: verify OK — deployment fully provisioned, authenticated and paired'
        : 'community-provision: verify OK — provisioning complete; auth/pairing pending (wizard steps, see report-only lines)'
    )
    return
  }

  // apply
  let outcome
  try {
    outcome = applyPlan(steps, realIo, { log: line => console.log(line) })
  } catch (err) {
    if (err instanceof ProvisionStepError) {
      console.error(`community-provision: ${err.message}`)
      process.exit(1)
    }
    throw err
  }
  console.log('')
  if (outcome.executed.length === 0) {
    console.log('community-provision: nothing to do — all provisioning steps already satisfied')
  } else {
    console.log(`community-provision: apply OK — executed ${outcome.executed.length} step(s): ${outcome.executed.join(', ')}; ${outcome.skipped.length} already satisfied`)
  }
  const reports = outcome.results.filter(r => r.action === 'report' && r.status !== 'ok')
  for (const r of reports) {
    console.log(`note: ${r.id} is ${r.status} — ${r.detail}`)
  }
}

main()
