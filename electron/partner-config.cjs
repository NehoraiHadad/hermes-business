const { getConfig, putConfig, setTerminalBackend } = require('./hermes-config.cjs')

// Durable, transaction-safe backup/restore of EXACTLY the Hermes `default`-profile
// config fields Business Partner mode owns and mutates — nothing outside this list
// is ever read, written, or restored, so unrelated user config is never touched.
//
// Each field records the value that reproduces STOCK Hermes behaviour when the
// field was ABSENT before partner mode was enabled. Hermes' PUT deep-merges and
// cannot delete a key (see hermes-config.deepMerge), so "absent" cannot be undone
// by removal — it is restored to its documented default instead. The defaults are
// verified against hermes_cli/config_defaults.py (approvals.mode 'smart',
// approvals.cron_mode 'deny', delegation.subagent_auto_approve False, terminal
// backend 'local', terminal.docker_* []/True/[]/False). Restoring a captured
// PRESENT value always takes precedence; the default is only the absent fallback.
//
// Docker fields are nested under `terminal` because that is where Hermes reads
// them (config_defaults terminal.docker_volumes, env TERMINAL_DOCKER_VOLUMES) —
// see sandbox-config.cjs.
const OWNED_FIELDS = [
  { path: ['display', 'personality'], absentDefault: null },
  { path: ['approvals', 'mode'], absentDefault: 'smart' },
  { path: ['approvals', 'cron_mode'], absentDefault: 'deny' },
  { path: ['delegation', 'subagent_auto_approve'], absentDefault: false },
  { path: ['terminal', 'backend'], absentDefault: 'local' },
  { path: ['terminal', 'docker_volumes'], absentDefault: [] },
  { path: ['terminal', 'docker_network'], absentDefault: true },
  { path: ['terminal', 'docker_forward_env'], absentDefault: [] },
  { path: ['terminal', 'docker_mount_cwd_to_workspace'], absentDefault: false }
]

const BACKUP_VERSION = 1

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

// Read a nested path, distinguishing an absent key from a present null/false.
function getAt(config, path) {
  let node = config
  for (const key of path) {
    if (!isPlainObject(node) || !(key in node)) return { present: false, value: undefined }
    node = node[key]
  }
  return { present: true, value: node }
}

function setAt(target, path, value) {
  let node = target
  for (let i = 0; i < path.length - 1; i += 1) {
    const key = path[i]
    if (!isPlainObject(node[key])) node[key] = {}
    node = node[key]
  }
  node[path[path.length - 1]] = value
  return target
}

// Snapshot every owned field's PRESENCE and VALUE from a live config object.
function captureOwned(config = {}) {
  return {
    version: BACKUP_VERSION,
    fields: OWNED_FIELDS.map(field => {
      const at = getAt(config, field.path)
      return { path: field.path, present: at.present, value: at.present ? at.value : null }
    })
  }
}

// Build a single deep-merge patch that returns every owned field to its captured
// state. A present field restores its exact captured value; an absent field (and
// a null/malformed backup) restores the documented stock default — the closest
// Hermes deep-merge can get to "as if partner mode never touched it".
function buildRestorePatch(backup) {
  const byPath = new Map()
  const fields = backup && Array.isArray(backup.fields) ? backup.fields : []
  for (const entry of fields) {
    if (entry && Array.isArray(entry.path)) byPath.set(entry.path.join('.'), entry)
  }
  const patch = {}
  for (const field of OWNED_FIELDS) {
    const saved = byPath.get(field.path.join('.'))
    const value = saved && saved.present ? saved.value : field.absentDefault
    setAt(patch, field.path, value)
  }
  return patch
}

function backupTerminalBackend(backup) {
  const patch = buildRestorePatch(backup)
  return (patch.terminal && patch.terminal.backend) || 'local'
}

// One GET → the owned-field snapshot from the live runtime.
async function snapshotOwned(api) {
  return captureOwned(await getConfig(api))
}

// Restore owned fields: one config PUT plus the terminal-backend endpoint so
// config and the backend registry agree. A captured PRESENT field is restored to
// its exact value; a field that was ABSENT before partner mode is set to its
// value-equivalent stock default (Hermes deep-merge cannot delete a key). Used for
// BOTH partner->normal disable and rolling back a partially-applied enable.
async function restoreOwned(backup, api) {
  await putConfig(buildRestorePatch(backup), api)
  await setTerminalBackend(backupTerminalBackend(backup), api)
}

// Transactional restore: snapshot the live owned fields FIRST, then apply the
// desired restore. restoreOwned is two live calls (PUT then backend pin); if the
// second fails the config is half-restored, so on ANY failure we roll the live
// config back to the pre-operation snapshot before rethrowing. Callers must persist
// settings only after this resolves, so a failed disable leaves both config and
// settings on their pre-operation (partner) state — never a half-restored config.
async function restoreOwnedTransactional(backup, api) {
  const preOp = await snapshotOwned(api)
  try {
    await restoreOwned(backup, api)
  } catch (error) {
    try {
      await restoreOwned(preOp, api)
    } catch {
      /* preserve the original failure as the thrown error */
    }
    throw error
  }
}

module.exports = {
  OWNED_FIELDS,
  BACKUP_VERSION,
  getAt,
  setAt,
  captureOwned,
  buildRestorePatch,
  backupTerminalBackend,
  snapshotOwned,
  restoreOwned,
  restoreOwnedTransactional
}
