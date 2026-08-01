// HIGH 5 — produce a VERIFIED clean-install / lockfile-integrity attestation.
//
// A self-asserted `{ verified: true }` proves nothing. This tool records provenance
// that the final gate can independently re-check: the SHA256 of the exact
// package-lock.json on disk (which the gate re-compares against the same file), the
// node + npm tool versions that ran the install, and — the real integrity signal —
// that a CLEAN `npm ci` succeeded in a THROWAWAY tree (the only npm mode that fails
// on a lock/package.json mismatch and never mutates the lockfile).
//
//   node scripts/gen-lock-attest.mjs            # runs `npm ci` in a temp tree
//   node scripts/gen-lock-attest.mjs --no-ci    # records lock hash + tool versions
//                                               # only; ci_clean stays false → the
//                                               # public gate still fails closed.
//
// Writes release/lock-attest.json. Never mutates the repo's node_modules or lockfile.

import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { repoRoot } from './lib/source-fingerprint.mjs'
import { LOCK_ATTEST_SCHEME } from './lib/release/lock-attest.mjs'

const root = repoRoot()
const runCi = !process.argv.includes('--no-ci')
const lockPath = path.join(root, 'package-lock.json')
const lockBuf = readFileSync(lockPath)
const package_lock_sha256 = createHash('sha256').update(lockBuf).digest('hex')

function toolVersion(args) {
  try { return execFileSync(process.platform === 'win32' ? 'npm.cmd' : 'npm', args, { cwd: root }).toString().trim() } catch { return null }
}

let ci_clean = false
let ci_detail = 'not attempted (--no-ci)'
if (runCi) {
  // Clean install into a throwaway tree carrying ONLY package.json + package-lock.json
  // so a mismatch fails and the real lockfile/node_modules are never touched.
  const tmp = mkdtempSync(path.join(os.tmpdir(), 'lock-ci-'))
  try {
    copyFileSync(path.join(root, 'package.json'), path.join(tmp, 'package.json'))
    copyFileSync(lockPath, path.join(tmp, 'package-lock.json'))
    execFileSync(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['ci', '--ignore-scripts', '--no-audit', '--no-fund'], { cwd: tmp, stdio: 'inherit' })
    // The lockfile must be byte-identical after `npm ci` (ci never rewrites it).
    const after = createHash('sha256').update(readFileSync(path.join(tmp, 'package-lock.json'))).digest('hex')
    ci_clean = after === package_lock_sha256
    ci_detail = ci_clean ? 'npm ci succeeded; lockfile unchanged' : 'npm ci rewrote the lockfile (mismatch)'
  } catch (e) {
    ci_detail = `npm ci failed: ${e.message}`
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
}

const attestation = {
  scheme: LOCK_ATTEST_SCHEME,
  package_lock_sha256,
  node_version: process.version,
  npm_version: toolVersion(['--version']),
  ci_clean,
  ci_detail,
  generated_at: new Date().toISOString()
}
mkdirSync(path.join(root, 'release'), { recursive: true })
writeFileSync(path.join(root, 'release', 'lock-attest.json'), `${JSON.stringify(attestation, null, 2)}\n`)
console.log(`Wrote release/lock-attest.json — lock ${package_lock_sha256.slice(0, 16)}…, node ${attestation.node_version}, npm ${attestation.npm_version}, ci_clean=${ci_clean}.`)
if (!ci_clean) console.log('  NOTE: ci_clean is false; the public lock-integrity gate will fail closed until a clean `npm ci` is attested.')
