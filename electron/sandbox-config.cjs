const { putConfig, setTerminalBackend, dockerReadiness } = require('./hermes-config.cjs')
const { resolveRoots, effectiveRoots, mountsFor } = require('./sandbox-roots.cjs')

// Computes and applies the truthful Hermes-native sandbox tier over the single
// `default` profile. Three tiers: off (no isolation), guard (local + write-root),
// docker (real isolation, only when Docker reports ready). Docker readiness is
// fail-closed: missing/stopped/unavailable Docker is never started or faked — we
// fall back to local guard and report it. The guard tier's ONLY boundary is
// HERMES_WRITE_SAFE_ROOT, which applies solely to Hermes' native file tools
// (write/patch/delete/move) — NOT reads, terminal-shell writes, code execution, or
// network. Every wording here is precise about that; guard is never a full sandbox.
// Roots are resolved through the ONE canonical resolver (sandbox-roots): Docker
// binds, guard write-root, invalid-root reporting, persisted settings and the live
// UI all see the same real target — never a raw junction/symlink path.

// Kept in the app's Hebrew UI language and intentionally identical to the demo
// mirror in src/lib/partner.ts — never over-promising Docker, never calling guard a
// full sandbox.
function approvalSemantics(effective, hasHostBinds, hasWritable) {
  if (effective === 'docker' && hasHostBinds) {
    return hasWritable
      ? 'בידוד Docker פעיל, אך מכיוון שמחוברות תיקיות מהמחשב (bind mount) כל שכבת אישורי הטרמינל ממשיכה לחול — Docker אינו עוקף אותה. הרשאת קריאה בלבד (:ro) היא ההגנה החזקה ביותר; תיקיות לכתיבה מסתמכות על שמירת נתיבים רגישים חלשה יותר.'
      : 'בידוד Docker פעיל וכל התיקיות מחוברות לקריאה בלבד — שום דבר במחשב אינו ניתן לכתיבה.'
  }
  if (effective === 'docker') {
    return 'בידוד Docker פעיל ללא חיבור תיקיות מהמחשב; שום דבר במחשב אינו ניתן לכתיבה. האישורים נשארים ידניים.'
  }
  if (effective === 'guard') {
    return 'שמירה מקומית (אינו ארגז חול מלא): HERMES_WRITE_SAFE_ROOT מגביל כתיבה/מחיקה/העברה של כלי הקבצים של Hermes לתיקיות שנבחרו בלבד. הוא אינו מגביל קריאה, אינו חוסם כתיבה דרך הטרמינל (shell) או הרצת קוד, ואינו מגביל רשת. האישורים נשארים ידניים ושכבת החסימה של פקודות מסוכנות פעילה.'
  }
  return 'ללא בידוד: הטרמינל רץ מקומית ללא הגבלת נתיב כתיבה. אישור ידני הוא ההגנה היחידה.'
}

// Pure resolution of the requested tier against live Docker readiness. Never
// throws, so the read/state path stays safe. Mounts are built ONLY from canonical
// valid roots; invalid roots are surfaced separately (planSandbox fails closed).
function computeSandboxPlan(settings, dockerStatus) {
  const rootInfo = resolveRoots(settings)
  const mounts = mountsFor(effectiveRoots(settings))
  const hasWritable = rootInfo.writable.length > 0
  const requested = settings.sandbox

  let effective = requested
  let degraded = false
  let reason = null
  if (requested === 'docker' && !(dockerStatus && dockerStatus.ready)) {
    effective = 'guard'
    degraded = true
    reason = `Docker is ${dockerStatus ? dockerStatus.status : 'unavailable'} — no isolation available; using local guard.`
  }

  const backend = effective === 'docker' ? 'docker' : 'local'
  const network = effective === 'docker' ? settings.network === true : false
  // Safe approval posture, identical in every tier. cron_mode:'deny' (per
  // tools/approval.py) blocks only dangerous commands + execute_code in unattended
  // cron; ordinary check-in research/drafting still runs. 'manual' gates dangerous
  // shell/exec in the live session. Neither is a filesystem or network boundary.
  const safeApprovals = { mode: 'manual', cron_mode: 'deny' }

  // Roots invalid for the EFFECTIVE tier's boundary (guard: writable roots; docker:
  // every root). Reported by the owner's ORIGINAL selection; planSandbox fails closed.
  const invalidForTier =
    effective === 'guard' ? rootInfo.invalidWritable : effective === 'docker' ? rootInfo.invalid : []

  // Docker fields live UNDER `terminal` — where Hermes reads them (config_defaults
  // terminal.docker_volumes; env TERMINAL_DOCKER_VOLUMES), not at the config root.
  const config =
    effective === 'docker'
      ? {
          terminal: {
            backend: 'docker',
            docker_mount_cwd_to_workspace: false,
            docker_network: network,
            docker_forward_env: [],
            docker_volumes: mounts.map(mount => mount.spec)
          },
          approvals: safeApprovals,
          delegation: { subagent_auto_approve: false }
        }
      : {
          terminal: { backend: 'local' },
          approvals: safeApprovals,
          delegation: { subagent_auto_approve: false }
        }

  return {
    requested,
    effective,
    backend,
    isolation: effective === 'docker',
    degraded,
    reason,
    network,
    mounts: effective === 'docker' ? mounts : [],
    config,
    invalidRoots: invalidForTier.map(root => ({ path: root.selected, reason: root.reason })),
    approvalSemantics: approvalSemantics(effective, mounts.length > 0, hasWritable)
  }
}

// Fail closed on invalid roots. Single source for the rejection message, reused by
// pre-validation (planSandbox) and the immediate pre-apply re-check.
function assertRootsValid(plan) {
  if (plan.invalidRoots.length === 0) return
  const detail = plan.invalidRoots.map(root => `${root.path || '(ריק)'} (${root.reason})`).join(', ')
  throw new Error(`תיקיות לא תקינות בארגז החול (${plan.effective}): ${detail}. תקן/הסר אותן לפני החלה.`)
}

// Resolve the plan against live Docker readiness and FAIL CLOSED on invalid roots
// BEFORE any live write, so a rejected config never half-applies. Never starts
// Docker. Carries the source settings + observed dockerStatus so applyResolvedPlan
// can re-verify the roots on disk immediately before it writes.
async function planSandbox(settings, options = {}) {
  const api = options.api
  const readiness = options.dockerReadiness || dockerReadiness
  const dockerStatus = settings.sandbox === 'docker' ? await readiness(api) : { ready: false, status: 'not-requested' }
  const plan = computeSandboxPlan(settings, dockerStatus)
  assertRootsValid(plan)
  return { ...plan, dockerStatus, settings }
}

// Apply an already-resolved plan. TOCTOU guard: re-resolve the roots on disk RIGHT
// NOW (from the plan's source settings) and apply that fresh canonical config, so a
// root deleted/swapped between planning and applying fails closed instead of writing
// a stale mount/env. Then PUT the config and pin the terminal backend to agree.
async function applyResolvedPlan(plan, api) {
  const fresh = plan.settings
    ? computeSandboxPlan(plan.settings, plan.dockerStatus || { ready: false, status: 'not-requested' })
    : plan
  assertRootsValid(fresh)
  await putConfig(fresh.config, api)
  await setTerminalBackend(fresh.backend, api)
  return fresh
}

// Convenience wrapper: resolve + apply in one call (used by unit tests and any
// caller that does not need a separate pre-validation step).
async function applySandbox(settings, options = {}) {
  const plan = await planSandbox(settings, options)
  return applyResolvedPlan(plan, options.api)
}

module.exports = {
  computeSandboxPlan,
  planSandbox,
  applyResolvedPlan,
  applySandbox,
  mountsFor,
  approvalSemantics
}
