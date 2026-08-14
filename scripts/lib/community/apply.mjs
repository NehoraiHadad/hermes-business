// Thin I/O layer: write a generated artifact map into a HERMES_HOME.
//
// Safety posture:
//   * REFUSES to run unless the target LOOKS like a HERMES_HOME — an existing
//     config.yaml, or an empty/missing directory together with an explicit
//     `init: true`. A non-empty directory without config.yaml is refused
//     unconditionally: it is somebody's data, not a gateway home.
//   * NEVER deletes anything. Removing a group from the contract leaves its
//     old profile directory behind (verify surfaces expected artifacts only;
//     orphan cleanup is a deliberate human action).
//   * Idempotent: a file whose current content already equals the artifact is
//     reported `unchanged` and not rewritten (no mtime churn).
//   * Artifact paths are validated relative + traversal-free before any write.

import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import path from 'node:path'

export class ApplyRefusedError extends Error {
  constructor(message) {
    super(message)
    this.name = 'ApplyRefusedError'
  }
}

/** Reject absolute, empty, or parent-escaping artifact paths (fail-closed). */
export function assertSafeRelPath(relPath) {
  const bad =
    typeof relPath !== 'string' ||
    relPath.trim() === '' ||
    path.isAbsolute(relPath) ||
    /^[a-zA-Z]:/.test(relPath) ||
    relPath.split(/[\\/]/).some(seg => seg === '..' || seg === '')
  if (bad) throw new ApplyRefusedError(`unsafe artifact path: ${JSON.stringify(relPath)}`)
}

/** The HERMES_HOME heuristic shared by apply + CLI messaging. */
export function classifyTarget(homeDir) {
  if (!existsSync(homeDir)) return 'absent'
  if (!statSync(homeDir).isDirectory()) return 'not-a-directory'
  if (existsSync(path.join(homeDir, 'config.yaml'))) return 'hermes-home'
  return readdirSync(homeDir).length === 0 ? 'empty' : 'foreign'
}

/**
 * Write `artifacts` (relPath → content) under `homeDir`.
 * Returns `{ written: [...paths], unchanged: [...paths] }`, both sorted.
 */
export function applyArtifacts(homeDir, artifacts, { init = false } = {}) {
  const kind = classifyTarget(homeDir)
  if (kind === 'not-a-directory') {
    throw new ApplyRefusedError(`target is not a directory: ${homeDir}`)
  }
  if (kind === 'foreign') {
    throw new ApplyRefusedError(
      `target does not look like a HERMES_HOME (non-empty, no config.yaml): ${homeDir} — refusing to write into it`
    )
  }
  if ((kind === 'absent' || kind === 'empty') && !init) {
    throw new ApplyRefusedError(
      `target has no config.yaml yet: ${homeDir} — pass --init to initialize a new HERMES_HOME here`
    )
  }
  for (const relPath of Object.keys(artifacts)) assertSafeRelPath(relPath)

  if (kind === 'absent') mkdirSync(homeDir, { recursive: true })

  const written = []
  const unchanged = []
  for (const relPath of Object.keys(artifacts).sort()) {
    const abs = path.join(homeDir, relPath)
    const content = artifacts[relPath]
    if (existsSync(abs) && readFileSync(abs, 'utf8') === content) {
      unchanged.push(relPath)
      continue
    }
    mkdirSync(path.dirname(abs), { recursive: true })
    writeFileSync(abs, content, 'utf8')
    written.push(relPath)
  }
  return { written, unchanged }
}
