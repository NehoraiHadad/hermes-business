// Community-mode M1 provisioning CLI (docs/specs/community-mode.md §6, M1).
//
//   node scripts/community-provision.mjs plan   --root <installRoot> --contract <community.yaml> [--home <dir>]
//   node scripts/community-provision.mjs apply  --root <installRoot> --contract <community.yaml> [--home <dir>]
//   node scripts/community-provision.mjs verify --root <installRoot> --contract <community.yaml> [--home <dir>]
//   optional: --engine-repo <url> --engine-ref <tag>
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
// pairing are wizard concerns (M2) — verified and reported here, never run.

import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import {
  ProvisionRefusedError,
  ProvisionStepError,
  applyPlan,
  assertSafeDeploymentPaths,
  buildPlan,
  discoverPython,
  discoverTool,
  normalizeDeployment,
  verifyDeployment,
  windowsCommandLine
} from './lib/community/provision.mjs'

function usage(message) {
  if (message) console.error(`community-provision: ${message}`)
  console.error(
    'usage: node scripts/community-provision.mjs <plan|apply|verify> --root <installRoot> --contract <community.yaml> [--home <dir>] [--engine-repo <url>] [--engine-ref <ref>]'
  )
  process.exit(2)
}

function parseArgs(argv) {
  const [command, ...rest] = argv
  if (!['plan', 'apply', 'verify'].includes(command ?? '')) {
    usage(`unknown command ${JSON.stringify(command ?? '')}`)
  }
  const opts = { command }
  for (let i = 0; i < rest.length; i++) {
    const arg = rest[i]
    if (arg === '--root') opts.root = rest[++i]
    else if (arg === '--contract') opts.contract = rest[++i]
    else if (arg === '--home') opts.home = rest[++i]
    else if (arg === '--engine-repo') opts.engineRepo = rest[++i]
    else if (arg === '--engine-ref') opts.engineRef = rest[++i]
    else usage(`unknown argument ${JSON.stringify(arg)}`)
  }
  if (!opts.root) usage('--root <installRoot> is required')
  if (!opts.contract) usage('--contract <community.yaml> is required')
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

function discoverTools() {
  const probe = spec => spawnSpec(spec, { capture: true })
  const missing = []
  const git = discoverTool(probe, 'git')
  if (!git) missing.push('git — install from https://git-scm.com/download/win, then re-run')
  const python = discoverPython(probe)
  if (!python) {
    missing.push('Python 3.11–3.13 — install with `winget install Python.Python.3.13` (the engine refuses 3.14+), then re-run')
  }
  const npm = discoverTool(probe, 'npm')
  if (!npm) missing.push('npm — install Node.js from https://nodejs.org (or `winget install OpenJS.NodeJS.LTS`), then re-run')
  return {
    missing,
    tools: {
      git: git?.argv ?? ['git'],
      python: python?.argv ?? ['py', '-3.13'],
      npm: npm?.argv ?? ['npm'],
      node: [process.execPath]
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
      installRoot: opts.root,
      contractPath: opts.contract,
      homeDir: opts.home,
      engineRepoUrl: opts.engineRepo,
      engineRef: opts.engineRef
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

  const { missing, tools } = discoverTools()
  if (missing.length > 0) {
    for (const m of missing) console.error(`community-provision: missing prerequisite: ${m}`)
    if (opts.command === 'apply') {
      console.error('community-provision: refusing to apply with missing prerequisites (fail-closed)')
      process.exit(1)
    }
    console.error('community-provision: continuing with nominal tool names — statuses below may be incomplete')
  }

  const steps = buildPlan(deployment, tools)

  console.log(`deployment: root=${deployment.installRoot}`)
  console.log(`            engine=${deployment.engineRepoUrl} @ ${deployment.engineRef}`)
  console.log(`            home=${deployment.homeDir}`)
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
