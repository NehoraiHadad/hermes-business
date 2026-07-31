const { getConfig: _getConfig, putConfig, setTerminalBackend, dockerReadiness } = require('./hermes-config.cjs')

// Computes and applies the truthful Hermes-native sandbox tier over the single
// `default` profile. Three tiers: off (no isolation), guard (local + write-root),
// docker (real isolation, only when Docker reports ready). Docker readiness is
// enforced fail-closed: if Docker is missing/stopped/unavailable we DO NOT start
// it and DO NOT silently pretend — we fall back to local guard and report it.

function containerPathFor(index) {
  return `/mnt/root${index}`
}

// Docker volume spec: host:container[:ro]. Windows drive-letter host paths
// (C:\...) are passed through as Docker itself expects them.
function mountsFor(roots) {
  return roots.map((root, index) => {
    const container = containerPathFor(index)
    const ro = root.access !== 'rw'
    return { host: root.path, container, ro, spec: `${root.path}:${container}${ro ? ':ro' : ''}` }
  })
}

// Kept in the app's Hebrew UI language and intentionally identical to the demo
// mirror in src/lib/partner.ts, so desktop and demo explain the guarantees the
// same way. The wording is deliberately precise — it never over-promises Docker.
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
    return 'שמירה מקומית: HERMES_WRITE_SAFE_ROOT מגביל כתיבה/מחיקה/העברה לתיקיות שנבחרו בלבד — הוא אינו מגביל קריאה או הרצת טרמינל. האישורים נשארים ידניים ושכבת החסימה של פקודות מסוכנות פעילה.'
  }
  return 'ללא בידוד: הטרמינל רץ מקומית ללא הגבלת נתיב כתיבה. אישור ידני הוא ההגנה היחידה.'
}

// Pure resolution of the requested tier against live Docker readiness.
function computeSandboxPlan(settings, dockerStatus) {
  const roots = settings.roots || []
  const mounts = mountsFor(roots)
  const hasWritable = roots.some(root => root.access === 'rw')
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
  const safeApprovals = { mode: 'manual', cron_mode: 'deny' }

  const config =
    effective === 'docker'
      ? {
          terminal: { backend: 'docker' },
          docker_mount_cwd_to_workspace: false,
          docker_network: network,
          docker_forward_env: [],
          docker_volumes: mounts.map(mount => mount.spec),
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
    approvalSemantics: approvalSemantics(effective, roots.length > 0, hasWritable)
  }
}

// Applies the plan to the live runtime. Reads Docker readiness first (never
// starts Docker), PUTs the config delta, and pins the terminal backend through
// the dedicated endpoint so both config and backend registry agree.
async function applySandbox(settings, options = {}) {
  const api = options.api
  const readiness = options.dockerReadiness || dockerReadiness
  const dockerStatus = settings.sandbox === 'docker' ? await readiness(api) : { ready: false, status: 'not-requested' }
  const plan = computeSandboxPlan(settings, dockerStatus)
  await putConfig(plan.config, api)
  await setTerminalBackend(plan.backend, api)
  return { ...plan, dockerStatus }
}

module.exports = { computeSandboxPlan, applySandbox, mountsFor, approvalSemantics }
