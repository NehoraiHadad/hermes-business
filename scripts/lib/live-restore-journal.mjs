// Crash-safe restore journal for E2E probes that mutate LIVE user state.
//
// Two of the installed-UI probes deliberately flip real settings (the WhatsApp
// reply policy, the Business Partner mode/sandbox) to prove the UI actually
// persists them, then put the original back in a `finally`. A `finally` only
// survives an orderly exit: kill the Electron app, hit Ctrl-C, or crash node, and
// the operator is left with a silently mutated live profile and no record of what
// it used to be.
//
// This module adds the missing durable step, in the spirit of
// electron/update-journal-store.cjs:
//
//   1. capture the current value
//   2. ATOMICALLY write it to a journal file (temp + rename) BEFORE mutating
//   3. ... probe runs, mutating live state ...
//   4. restore, VERIFY the restore actually took, and only then clear the journal
//
// If step 3 or 4 dies, the journal survives. The next run of the same probe
// recovers FIRST — before it mutates anything again — and refuses to continue
// until the recovery is verified.
//
// Honesty rules, deliberately non-negotiable:
//   * a failed restore is NEVER swallowed; it throws (probes exit non-zero)
//   * a failed restore NEVER clears the journal, so the next run retries
//   * a restore that "succeeds" but does not read back equal is a FAILURE

import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

export const JOURNAL_VERSION = 1

/**
 * Directory holding the journals. Under the OS temp root (the scripts' own state
 * area) but deliberately NOT named like a Hermes E2E home — it is bookkeeping
 * about the live profile, never a profile itself, and must survive between runs.
 */
export function journalDir(env = process.env) {
  return env.HERMES_BUSINESS_RESTORE_JOURNAL_DIR || path.join(os.tmpdir(), 'hermes-business-restore-journal')
}

function safeKey(key) {
  const clean = String(key || '').trim()
  if (!clean || !/^[a-z0-9][a-z0-9-]*$/i.test(clean)) {
    throw new Error(`restore-journal key must match /^[a-z0-9][a-z0-9-]*$/ (got ${JSON.stringify(key)})`)
  }
  return clean
}

/** Absolute path of one subject's journal file. */
export function journalPath(key, { dir = journalDir() } = {}) {
  return path.join(dir, `${safeKey(key)}.json`)
}

/** Atomically persist the pre-mutation value. Returns the journal record. */
export function writeRestoreJournal(key, value, { dir = journalDir(), meta = {} } = {}) {
  const file = journalPath(key, { dir })
  const record = {
    version: JOURNAL_VERSION,
    key: safeKey(key),
    capturedAt: new Date().toISOString(),
    pid: process.pid,
    ...meta,
    value
  }
  mkdirSync(dir, { recursive: true })
  const staging = `${file}.${process.pid}.tmp`
  writeFileSync(staging, JSON.stringify(record, null, 2), 'utf8')
  renameSync(staging, file)
  return record
}

/**
 * Read a pending journal. Returns null when there is none. A malformed or
 * wrong-version journal is surfaced as an error rather than silently dropped —
 * silently dropping it would discard the only record of a live mutation.
 */
export function readRestoreJournal(key, { dir = journalDir() } = {}) {
  const file = journalPath(key, { dir })
  if (!existsSync(file)) return null
  let parsed
  try {
    parsed = JSON.parse(readFileSync(file, 'utf8'))
  } catch (error) {
    throw new Error(
      `Restore journal ${file} is unreadable (${error?.message || error}). It records a LIVE mutation ` +
        'from an earlier crashed run — inspect and remove it by hand before re-running.'
    )
  }
  if (!parsed || parsed.version !== JOURNAL_VERSION || parsed.key !== safeKey(key)) {
    throw new Error(`Restore journal ${file} has an unexpected shape: ${JSON.stringify(parsed)?.slice(0, 300)}`)
  }
  return parsed
}

/** Drop a journal once its value has been verifiably restored. */
export function clearRestoreJournal(key, { dir = journalDir() } = {}) {
  rmSync(journalPath(key, { dir }), { force: true })
}

/** Every pending journal key (diagnostics / operator tooling). */
export function pendingRestoreKeys({ dir = journalDir() } = {}) {
  if (!existsSync(dir)) return []
  return readdirSync(dir)
    .filter(name => name.endsWith('.json'))
    .map(name => name.slice(0, -'.json'.length))
}

function sameValue(a, b) {
  return JSON.stringify(a) === JSON.stringify(b)
}

async function restoreAndVerify(key, value, { restore, capture, equals = sameValue, label }) {
  await restore(value)
  const readback = await capture()
  if (!equals(readback, value)) {
    throw new Error(
      `Restoring ${label} did not take: expected ${JSON.stringify(value)} but the live value reads back as ` +
        `${JSON.stringify(readback)}. The journal is KEPT at ${journalPath(key)} — the live profile is still mutated.`
    )
  }
  return readback
}

/**
 * Crash recovery. If a journal from an earlier run exists, put its value back
 * BEFORE the caller mutates anything, verify it, and clear it. Returns
 * `{ recovered: boolean, value? }`. Throws loudly if the recovery fails.
 */
export async function recoverPendingRestore(key, { capture, restore, equals, dir = journalDir(), label = key, scope = null, log = console }) {
  const pending = readRestoreJournal(key, { dir })
  if (!pending) return { recovered: false }
  // A journal belongs to the PROFILE it was captured from. Restoring a value
  // captured against an isolated QA home into the operator's live profile (or
  // vice versa) would be a mutation of its own, so a scope mismatch refuses
  // rather than guesses.
  if (scope !== null && String(pending.scope ?? '') !== String(scope)) {
    throw new Error(
      `Restore journal ${journalPath(key, { dir })} was captured against a different profile ` +
        `(${pending.scope ?? '<unknown>'}), not ${scope}. Re-run this suite against that profile, or ` +
        'inspect and remove the journal by hand.'
    )
  }
  log.warn?.(
    `Recovering an unfinished ${label} restore from ${pending.capturedAt} (pid ${pending.pid}); ` +
      'a previous run was interrupted while the live profile was mutated.'
  )
  await restoreAndVerify(key, pending.value, { restore, capture, equals, label })
  clearRestoreJournal(key, { dir })
  return { recovered: true, value: pending.value }
}

/**
 * Run `body` with the live value of `key` journalled and guaranteed-restored.
 *
 * Order: recover any stale journal → capture → journal → body → restore+verify →
 * clear. A restore failure always throws, and never clears the journal, even when
 * `body` itself already failed (both errors are reported).
 */
export async function withLiveRestore(
  { key, capture, restore, equals, dir = journalDir(), label = key, scope = null, log = console },
  body
) {
  const recovery = await recoverPendingRestore(key, { capture, restore, equals, dir, label, scope, log })
  const original = await capture()
  writeRestoreJournal(key, original, { dir, meta: { label, scope } })

  let bodyError = null
  let result
  try {
    result = await body(original)
  } catch (error) {
    bodyError = error
  }

  try {
    await restoreAndVerify(key, original, { restore, capture, equals, label })
    clearRestoreJournal(key, { dir })
  } catch (restoreError) {
    if (bodyError) {
      const combined = new Error(
        `${label}: the probe failed AND the live value could not be restored.\n` +
          `  probe error:   ${bodyError?.message || bodyError}\n` +
          `  restore error: ${restoreError?.message || restoreError}`
      )
      combined.cause = bodyError
      throw combined
    }
    throw restoreError
  }

  if (bodyError) throw bodyError
  return { result, original, recovered: recovery.recovered }
}
