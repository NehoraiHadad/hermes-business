// Live/temp HERMES_HOME profile marker + forensic diff for the isolated packaged
// E2E. Nothing here launches or owns a runtime — it only OBSERVES a home dir.
//
// The "marker" captures just the profile-defining state the packaged E2E is known
// to mutate (approvals.mode via config.yaml, and the session/cron/skill/plugin
// inventories), so an idle live gateway's background logging/caching never
// produces a false "mutated" verdict. Deliberately excludes logs/cache/audio_cache
// and file mtimes so idle background activity does not perturb it.

import { createHash } from 'node:crypto'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'

const MARKER_DIRS = ['sessions', 'cron', 'skills', 'plugins', 'agents', 'workflows']

/**
 * Profile-defining fingerprint of a Hermes home: a sha256 over the config.yaml
 * bytes plus a stable inventory (immediate child name+size) of the dirs the
 * packaged E2E is known to mutate.
 */
export function hermesHomeMarker(home) {
  const hash = createHash('sha256')
  const inventory = {}
  const dirNames = {}
  const configPath = path.join(home, 'config.yaml')
  const configPresent = existsSync(configPath)
  const configBytes = configPresent ? readFileSync(configPath) : Buffer.from('<absent>')
  const configHash = createHash('sha256').update(configBytes).digest('hex')
  hash.update('config.yaml\0')
  hash.update(configBytes)
  for (const dir of MARKER_DIRS) {
    const full = path.join(home, dir)
    let entries = []
    let names = []
    try {
      names = readdirSync(full).sort()
      entries = names.map(name => {
        let size = 0
        try {
          size = statSync(path.join(full, name)).size
        } catch {
          size = -1
        }
        return `${name}:${size}`
      })
    } catch {
      names = []
    }
    inventory[dir] = names.length
    dirNames[dir] = names
    hash.update(`\0${dir}\0`)
    hash.update(entries.join('|'))
  }
  return {
    digest: hash.digest('hex'),
    configPresent,
    _configHash: configHash,
    _dirNames: dirNames,
    inventory
  }
}

/**
 * Diff two markers into a per-component verdict. `config_changed` and the
 * inventory deltas let a caller distinguish OUR mutations (approvals.mode via
 * config.yaml, a new skill/cron/plugin) from a concurrently-running live
 * gateway's own session bookkeeping.
 */
export function markerDelta(before, after) {
  const addedRemoved = {}
  for (const dir of MARKER_DIRS) {
    const b = new Set(before._dirNames?.[dir] ?? [])
    const a = new Set(after._dirNames?.[dir] ?? [])
    const added = [...a].filter(n => !b.has(n))
    const removed = [...b].filter(n => !a.has(n))
    if (added.length || removed.length) addedRemoved[dir] = { added: added.length, removed: removed.length }
  }
  // A real mutation from the old live-connected suite ADDS a named entry (the
  // durable skill, a new cron job, a new session) or toggles config.yaml. A
  // running live gateway only ever bumps timestamps/sizes INSIDE existing named
  // files — the name set is stable. So we attribute isolation by NAME-SET
  // stability + config-byte identity, ignoring `sessions` churn (the user's own
  // gateway) since our isolated session count is independently proven to be 0.
  const structuralDirs = Object.keys(addedRemoved).filter(dir => dir !== 'sessions')
  return {
    digest_equal: before.digest === after.digest,
    config_changed:
      before.configPresent !== after.configPresent || before._configHash !== after._configHash,
    added_removed: addedRemoved,
    profile_defining_unchanged:
      before._configHash === after._configHash && structuralDirs.length === 0
  }
}
