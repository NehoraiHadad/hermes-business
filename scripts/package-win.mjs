// The Windows packaging pipeline — one orchestrator for all three channels.
//
//   node scripts/package-win.mjs --channel public|qa|pilot [--dry-run]
//
// This replaces the twin ~400-character `package:win` / `package:win:qa` shell
// one-liners in package.json. Those were byte-for-byte identical apart from the
// build script and the channel argument, which meant every ordering rule — the
// two-phase signing sequence, "promotion is the LAST action" — had to be kept in
// step by hand across both, and could only be tested by searching for substrings
// in a giant string.
//
// NOTHING about the stages changed: same programs, same arguments, same order,
// same fail-fast-on-first-non-zero semantics as `&&` chaining. Only the place
// they are declared moved. The channel-dependent parts are exactly the two that
// were channel-dependent before:
//   * `build` (public, pilot) vs `build:qa` (QA, which enables the demo transport)
//   * `--channel <c>` on finalize-payload / sign-release / e2e-exact-artifact /
//     finalize-release
//
// `pilot` (docs/specs/versioning.md §13 stage 5) is a THIRD, distributable Alpha
// channel added alongside public/qa: it runs the exact same 12-stage plan as
// public (real build, full attestation/binding-chain/ledger/lock-attest rigor),
// but finalize-payload/sign-release skip signing for it (like qa — no cert
// exists yet) with a pilot-specific honest log line, and the preflight gate
// (scripts/lib/release/preflight.mjs) independently verifies the attestation
// proves a REAL production build was packaged, never a `build:qa` one — see
// scripts/lib/release/channel-policy.mjs for the exact rigor/tolerance split.
//
// `packagingStages()` is exported and side-effect free so scripts/packaging-
// config.test.ts can assert the ordering contract directly on the plan, for
// EVERY channel, instead of on substring positions in a package.json string.

import { existsSync } from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { parseChannel, CHANNELS } from './lib/parse-channel.mjs'

const repoRoot = path.resolve(fileURLToPath(new URL('..', import.meta.url)))

const npmStage = (script, extra = []) => ({ id: `npm:${script}`, kind: 'npm', script, args: extra })
const nodeStage = (script, args = []) => ({ id: script, kind: 'node', script, args })
const builderStage = (args) => ({ id: `electron-builder ${args.join(' ')}`, kind: 'electron-builder', args })

/**
 * The ordered packaging plan for a channel. Pure: builds no files, spawns
 * nothing, reads no environment.
 *
 * @param {'public'|'qa'|'pilot'} channel
 */
export function packagingStages(channel) {
  if (!CHANNELS.includes(channel)) throw new Error(`unknown channel ${JSON.stringify(channel)}`)
  // QA builds through `build:qa` (vite --mode qa) so the demo transport ships.
  // public AND pilot use the REAL production `build` — pilot ships a real,
  // fixtures-stripped renderer to outside testers (docs/specs/versioning.md §13
  // stage 5); it must NEVER take the qa shortcut. gen-build-attestation.mjs
  // below independently verifies this from the compiled dist/ output rather than
  // trusting this selection, so a future typo here would fail the pilot gate
  // loudly instead of silently shipping a qa-mode Alpha.
  const buildScript = channel === 'qa' ? 'build:qa' : 'build'
  return [
    // Fail-closed release preflight BEFORE anything is built or written.
    npmStage('verify:release'),
    npmStage(buildScript),
    nodeStage('scripts/gen-build-attestation.mjs'),
    // Phase 1: unsigned payload directory.
    builderStage(['--win', 'dir']),
    // Phase 2: sign + verify + embed the release manifest into the payload.
    nodeStage('scripts/finalize-payload.mjs', ['--channel', channel]),
    // Phase 3: wrap the ALREADY-finalized payload into the installer.
    builderStage(['--prepackaged', 'release/win-unpacked', '--win', 'nsis']),
    nodeStage('scripts/verify-no-update-metadata.mjs', ['release']),
    nodeStage('scripts/gen-lock-attest.mjs'),
    // The installer itself is signed only after NSIS produced it.
    nodeStage('scripts/sign-release.mjs', ['--channel', channel]),
    nodeStage('scripts/gen-release-report.mjs'),
    // Exact-artifact capture runs BEFORE promotion...
    nodeStage('scripts/e2e-exact-artifact.mjs', ['--channel', channel]),
    // ...and promotion is the LAST action: no fallible verifier may follow it.
    nodeStage('scripts/finalize-release.mjs', ['--channel', channel])
  ]
}

/** Resolve one stage to the concrete command line that runs it. */
export function stageCommand(stage, { root = repoRoot, platform = process.platform } = {}) {
  if (stage.kind === 'npm') {
    return {
      command: platform === 'win32' ? 'npm.cmd' : 'npm',
      args: ['run', stage.script, ...stage.args],
      shell: platform === 'win32'
    }
  }
  if (stage.kind === 'node') {
    return { command: process.execPath, args: [path.join(root, stage.script), ...stage.args], shell: false }
  }
  // electron-builder is invoked through its own CLI entry rather than the
  // node_modules/.bin shim: a .cmd shim cannot be spawned without a shell.
  return {
    command: process.execPath,
    args: [path.join(root, 'node_modules', 'electron-builder', 'cli.js'), ...stage.args],
    shell: false
  }
}

export function describePlan(channel) {
  return packagingStages(channel)
    .map((stage, index) => {
      const { command, args } = stageCommand(stage)
      const pretty = args.map(arg => (path.isAbsolute(arg) ? path.relative(repoRoot, arg) : arg))
      const shown = command === process.execPath ? `node ${pretty.join(' ')}` : `${command} ${pretty.join(' ')}`
      return `${String(index + 1).padStart(2, ' ')}. ${shown}`
    })
    .join('\n')
}

function main(argv) {
  let channel
  try {
    channel = parseChannel(argv)
  } catch (error) {
    console.error(`package-win: ${error?.message || error}`)
    console.error('usage: node scripts/package-win.mjs --channel public|qa|pilot [--dry-run]')
    return 1
  }
  const stages = packagingStages(channel)

  if (argv.includes('--dry-run')) {
    console.log(`package-win plan (channel=${channel}):\n${describePlan(channel)}`)
    return 0
  }

  const builderCli = path.join(repoRoot, 'node_modules', 'electron-builder', 'cli.js')
  if (!existsSync(builderCli)) {
    console.error(`electron-builder is not installed (${builderCli} missing). Run npm install first.`)
    return 1
  }

  for (const [index, stage] of stages.entries()) {
    const { command, args, shell } = stageCommand(stage)
    console.log(`\n[package:win ${channel}] (${index + 1}/${stages.length}) ${stage.id}`)
    const result = spawnSync(command, args, { cwd: repoRoot, stdio: 'inherit', shell, windowsHide: true })
    if (result.error) {
      console.error(`[package:win ${channel}] stage "${stage.id}" could not start: ${result.error.message}`)
      return 1
    }
    if (result.status !== 0) {
      // Same fail-fast semantics as the `&&` chain this replaced: stop here, and
      // never run a later stage (in particular never promote) after a failure.
      console.error(
        `[package:win ${channel}] stage "${stage.id}" failed with exit code ${result.status ?? `signal ${result.signal}`}.`
      )
      return result.status || 1
    }
  }
  console.log(`\n[package:win ${channel}] all ${stages.length} stages completed.`)
  return 0
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exit(main(process.argv.slice(2)))
}
