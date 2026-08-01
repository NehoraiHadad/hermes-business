// Shared helpers for the durable, redacted evidence under docs/evidence/.
//
// Evidence files are small machine-readable envelopes: a fixed metadata header
// (schema version, app/Hermes versions, git commit + state, capture tool) plus a
// compact, scalar-only `summary` reduced from an E2E's JSON output. Raw logs,
// prompts, chat content, usernames, tokens, absolute user paths, emails and
// binaries are never persisted — reducers pick only booleans/counts/enums, and
// every string still passes through `sanitize` + `redactPaths` as a backstop.

import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { sanitize } from './e2e-harness.mjs'

export const SCHEMA_VERSION = 1
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')

/** Strip absolute user paths (home dir, temp dir, any drive-letter path) so no
 * machine-local filesystem layout or username leaks into evidence. */
export function redactPaths(value) {
  // tmpdir before homedir: on Windows tmpdir lives *inside* homedir
  // (…\Users\<user>\AppData\Local\Temp), so replacing homedir first would mask
  // the more-specific tmpdir match.
  return String(value == null ? '' : value)
    .split(os.tmpdir()).join('<tmp>')
    .split(os.homedir()).join('<home>')
    .replace(/[A-Za-z]:\\[^\s"']*/g, '<path>')
    .replace(/\/(?:Users|home)\/[^\s"'/]+/g, '<home>')
}

/** Deep-redact every string in a value through sanitize (secrets+emails) and
 * redactPaths. Objects/arrays are walked; scalars are coerced safely. */
export function redactDeep(value) {
  if (Array.isArray(value)) return value.map(redactDeep)
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, redactDeep(v)]))
  }
  if (typeof value === 'string') return redactPaths(sanitize(value))
  return value
}

/** Current git HEAD + whether the working tree is clean at HEAD. */
export function gitInfo() {
  try {
    const head = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT }).toString().trim()
    const dirty = execFileSync('git', ['status', '--porcelain'], { cwd: ROOT }).toString().trim().length > 0
    return { git_head: head, git_state: dirty ? 'working-tree' : 'committed' }
  } catch {
    return { git_head: 'unknown', git_state: 'working-tree' }
  }
}

export function appVersion() {
  return JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version
}

export function hermesRange() {
  try {
    return JSON.parse(readFileSync(path.join(ROOT, 'hermes-compat.json'), 'utf8')).range || null
  } catch {
    return null
  }
}

/** Build a complete evidence envelope for one category. `summary` is reduced,
 * scalar-only data; it is deep-redacted here as a final backstop. */
export function buildEnvelope(category, summary, { tool, status = 'passed', capturedAt = null } = {}) {
  return {
    schema_version: SCHEMA_VERSION,
    category,
    status,
    app_version: appVersion(),
    hermes_range: hermesRange(),
    ...gitInfo(),
    captured_at: capturedAt,
    tool: tool || null,
    redacted: true,
    summary: redactDeep(summary)
  }
}

export const EVIDENCE_DIR = path.join(ROOT, 'docs', 'evidence')
export const ROOT_DIR = ROOT
