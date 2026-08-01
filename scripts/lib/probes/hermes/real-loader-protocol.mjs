// Windows `hermes://` protocol-registration isolation — a crash-safe transaction.
//
// The installed Hermes Desktop registers itself as the default `hermes://` handler
// UNCONDITIONALLY on every launch (apps/desktop/electron/main.ts:11705 ->
// app.setAsDefaultProtocolClient('hermes')), writing HKCU\Software\Classes\hermes.
// There is NO upstream skip flag. So we snapshot that subtree's EXACT content
// before launch and restore it verbatim after, verifying byte-for-byte. The .reg
// backup is written to a DURABLE recovery dir OUTSIDE the deletable sandbox and is
// deleted only once an exact restore is proven; a crashed run's backup is replayed
// on the next launch (idempotent watchdog). A restore that cannot be verified
// HARD-FAILS and preserves the backup — we never claim ok or drop the only backup.

import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync, rmSync, readdirSync } from 'node:fs'
import path from 'node:path'

export const HERMES_PROTOCOL_KEY = 'HKCU\\Software\\Classes\\hermes'

function reg(args) {
  return spawnSync('reg', args, { encoding: 'utf8', windowsHide: true })
}

/** Tri-state query: 'present' | 'absent' | 'error'. A non-zero exit is 'absent'
 *  ONLY when stderr says the key was not found; anything else (access denied, a
 *  transport failure) is 'error' so the caller can fail closed instead of assuming
 *  the key does not exist. */
export function queryKey(key = HERMES_PROTOCOL_KEY) {
  const out = reg(['query', key])
  if (out.status === 0) return 'present'
  const err = `${out.stderr || ''}${out.stdout || ''}`.toLowerCase()
  if (out.status == null) return 'error' // spawn failed entirely
  if (err.includes('unable to find') || err.includes('was not found') || err.includes('cannot find')) return 'absent'
  return 'error'
}

/** Read + normalize a .reg export (strip BOM, CRLF, trailing blanks) so two
 *  exports of identical content compare equal. Returns null if unreadable. */
export function normalizeRegContent(text) {
  if (text == null) return null
  return String(text)
    .replace(/^﻿/, '')
    .split(/\r?\n/)
    .map(line => line.replace(/\s+$/, ''))
    .filter((line, i, arr) => !(line === '' && i === arr.length - 1))
    .join('\n')
    .trim()
}

function exportContent(key, scratchFile) {
  const out = reg(['export', key, scratchFile, '/y'])
  if (out.status !== 0 || !existsSync(scratchFile)) {
    return { ok: false, content: null, error: (out.stderr || out.stdout || 'reg export failed').trim() }
  }
  try {
    // `reg export` writes the .reg file as UTF-16LE (BOM + NUL-interleaved chars),
    // NOT UTF-8 — decode it as such or every comparison sees garbage.
    return { ok: true, content: normalizeRegContent(readFileSync(scratchFile, 'utf16le')) }
  } catch (e) {
    return { ok: false, content: null, error: String(e?.message || e) }
  }
}

/**
 * Snapshot the protocol subtree's EXACT content to a durable backupFile. Fails
 * closed (ok:false) when the key exists but cannot be captured, or when the query
 * itself errored — in either case the caller must refuse to launch. When the key
 * is absent there is nothing to export (existed:false).
 */
export function snapshotProtocol({ backupFile, key = HERMES_PROTOCOL_KEY }) {
  if (!path.isAbsolute(backupFile)) throw new Error('snapshotProtocol: backupFile must be absolute')
  const state = queryKey(key)
  if (state === 'error') return { ok: false, existed: null, backupFile, key, error: 'registry query errored' }
  if (state === 'absent') {
    // Persist an existence marker so a crashed run can still delete the app's
    // creation on recovery. No .reg backup exists for an absent key.
    writeMeta(backupFile, { key, existed: false, content: null })
    return { ok: true, existed: false, backupFile, key, content: null }
  }
  const exported = exportContent(key, backupFile)
  if (!exported.ok) return { ok: false, existed: true, backupFile, key, error: exported.error }
  writeMeta(backupFile, { key, existed: true, content: exported.content })
  return { ok: true, existed: true, backupFile, key, content: exported.content }
}

/** PURE restore decision — unit-testable without touching the registry. Encodes
 *  the concurrent-change guard: we only re-point/delete the key when the CURRENT
 *  content is either the snapshot itself or a write made by OUR launched exe
 *  (identified by `handlerHint`). A change by another actor is left untouched. */
export function decideRestore({ existed, snapshotContent, currentState, currentContent, handlerHint }) {
  if (currentState === 'error') return { action: 'noop', ok: false, preserveBackup: true, reason: 'current query errored' }
  // `reg export` escapes path backslashes as `\\`; collapse runs on BOTH sides so
  // our launched exe path matches the exported handler command (else we'd wrongly
  // treat our own write as a foreign change and refuse to restore).
  const collapse = s => String(s).toLowerCase().replace(/\\+/g, '\\')
  const ownsCurrent = handlerHint && currentContent && collapse(currentContent).includes(collapse(handlerHint))
  if (existed) {
    if (currentState === 'present' && currentContent === snapshotContent) {
      return { action: 'noop', ok: true, preserveBackup: false, reason: 'already at snapshot' }
    }
    if (currentState === 'absent' || ownsCurrent) return { action: 'import', ok: true, preserveBackup: false }
    return { action: 'noop', ok: false, preserveBackup: true, concurrentChange: true, reason: 'handler changed by another actor' }
  }
  if (currentState === 'absent') return { action: 'noop', ok: true, preserveBackup: false, reason: 'already absent' }
  if (ownsCurrent) return { action: 'delete', ok: true, preserveBackup: false }
  return { action: 'noop', ok: false, preserveBackup: true, concurrentChange: true, reason: 'foreign handler present' }
}

/**
 * Restore the protocol subtree from a snapshot, verifying the result byte-for-byte.
 * Never throws (finally-safe). Returns { restored, matched, concurrentChange,
 * preserveBackup, reason }. The backup is preserved on ANY failure so a later run
 * can replay it. `handlerHint` is the launched exe path used by the concurrent guard.
 */
export function restoreProtocol(snapshot, { handlerHint } = {}) {
  if (!snapshot || snapshot.ok !== true) return { restored: false, preserveBackup: true, reason: 'no valid snapshot' }
  const { key = HERMES_PROTOCOL_KEY, existed, backupFile, content } = snapshot
  const scratch = `${backupFile}.now`
  const before = queryKey(key)
  const cur = before === 'present' ? exportContent(key, scratch) : { ok: true, content: null }
  cleanupScratch(scratch)
  const plan = decideRestore({
    existed,
    snapshotContent: content,
    currentState: before,
    currentContent: cur.content,
    handlerHint
  })
  if (plan.action === 'noop') {
    return { restored: plan.ok, matched: plan.ok, concurrentChange: !!plan.concurrentChange, preserveBackup: plan.preserveBackup, reason: plan.reason }
  }
  reg(['delete', key, '/f'])
  if (plan.action === 'delete') {
    const gone = queryKey(key) === 'absent'
    return { restored: gone, matched: gone, preserveBackup: !gone, recreated: false, reason: gone ? undefined : 'delete unverified' }
  }
  if (!existsSync(backupFile)) return { restored: false, preserveBackup: true, reason: `backup vanished: ${backupFile}` }
  reg(['import', backupFile])
  const after = exportContent(key, scratch)
  cleanupScratch(scratch)
  const matched = after.ok && after.content === content
  return { restored: matched, matched, recreated: true, preserveBackup: !matched, reason: matched ? undefined : 'restored content did not match snapshot' }
}

function metaPath(backupFile) {
  return `${backupFile}.meta.json`
}
function writeMeta(backupFile, meta) {
  try {
    writeFileSync(metaPath(backupFile), JSON.stringify(meta))
  } catch {
    /* best effort; the .reg export is the primary artifact */
  }
}
function cleanupScratch(scratch) {
  try {
    if (existsSync(scratch)) rmSync(scratch, { force: true })
  } catch {
    /* ignore */
  }
}

/** Delete a verified backup + its meta. Only call once restore is proven exact. */
export function discardBackup(backupFile) {
  for (const f of [backupFile, metaPath(backupFile)]) {
    try {
      if (existsSync(f)) rmSync(f, { force: true })
    } catch {
      /* ignore */
    }
  }
}

/**
 * Idempotent crash-recovery watchdog: replay any leftover protocol backups in
 * `recoveryDir` from a run that died before restoring. Each `<name>.reg.meta.json`
 * reconstructs a snapshot; a verified restore discards it, an unverified one is
 * kept for the next attempt. Safe to call on every launch.
 */
export function recoverStaleProtocolBackups(recoveryDir, { handlerHint, listReg } = {}) {
  const list = typeof listReg === 'function' ? listReg : defaultListMeta
  const results = []
  for (const meta of list(recoveryDir)) {
    const snapshot = { ok: true, key: meta.data.key, existed: meta.data.existed, backupFile: meta.backupFile, content: meta.data.content }
    const res = restoreProtocol(snapshot, { handlerHint })
    if (res.restored && !res.preserveBackup) discardBackup(meta.backupFile)
    results.push({ backupFile: meta.backupFile, ...res })
  }
  return results
}

function defaultListMeta(recoveryDir) {
  let names = []
  try {
    names = readdirSync(recoveryDir)
  } catch {
    return []
  }
  const out = []
  for (const name of names) {
    if (!name.endsWith('.meta.json')) continue
    const metaFile = path.join(recoveryDir, name)
    try {
      const data = JSON.parse(readFileSync(metaFile, 'utf8'))
      out.push({ backupFile: metaFile.replace(/\.meta\.json$/, ''), data })
    } catch {
      /* skip malformed meta */
    }
  }
  return out
}
