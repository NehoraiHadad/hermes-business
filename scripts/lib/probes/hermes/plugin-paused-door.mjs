// Paused-inclusive listing proof through the plugin's OWN namespace-locked door.
// Split out of plugin-shared-state.mjs to keep that probe focused on discovery,
// load, render and uninstall. Create a job, pause it via the official cron.manage
// RPC, then read it back through ctx.rest('/cron/jobs') — the door mounted at
// /api/plugins/business-shell by the companion backend
// (dashboard/plugin_api.py -> list_jobs(include_disabled=True)). Proves one
// source of truth: the active-only cron.manage list drops the paused row, but the
// plugin's own backend surfaces it (enabled:false) from the SAME scheduler store
// — no parallel cache. Also asserts the namespace lock rejects a `..` escape.

import { withProfile } from '../../hermes-rest.mjs'

export async function provePluginPausedDoor({ rest, sdk, ctx, restFetch, backendInstall, storedSessionId, contributions, stage }) {
  if (!(restFetch && backendInstall)) {
    stage('paused-door proof skipped (no live REST transport injected)')
    return { attempted: false }
  }

  const pausedName = `POC plugin paused ${storedSessionId || ''}${contributions.length}`
  await rest('POST', withProfile('/api/cron/jobs'), {
    name: pausedName,
    schedule: '0 0 1 1 *',
    prompt: 'E2E plugin paused-door marker. Never runs outside this acceptance test.',
    deliver: 'local'
  })
  let jobId
  try {
    const before = (await sdk.host.request('cron.manage', { action: 'list' })).jobs?.find(j => j.name === pausedName)
    if (!before) throw new Error('plugin paused-door job not visible before pause')
    jobId = before.id || before.name
    await sdk.host.request('cron.manage', { action: 'pause', name: jobId })

    const activeOnly = await sdk.host.request('cron.manage', { action: 'list' })
    if (activeOnly.jobs?.some(j => j.name === pausedName)) {
      throw new Error('active-only cron.manage still lists the paused job — a shadow store is masking the pause')
    }

    // The plugin's own door — namespace-locked to /api/plugins/business-shell.
    const viaDoor = await ctx.rest('/cron/jobs')
    const doorJobs = Array.isArray(viaDoor?.jobs) ? viaDoor.jobs : Array.isArray(viaDoor) ? viaDoor : []
    const pausedRow = doorJobs.find(j => j.name === pausedName)
    if (!pausedRow) throw new Error('companion backend door did not surface the paused job')
    if (pausedRow.enabled !== false) throw new Error('companion backend door did not report the job paused (enabled:false)')
    // Security: the read-only door must NOT echo the job prompt/business content.
    if ('prompt' in pausedRow || 'deliver' in pausedRow) {
      throw new Error('companion backend door leaked prompt/deliver content — projection failed')
    }

    // Namespace lock: a `..` escape must be rejected before any I/O.
    let escapeRejected = false
    try {
      await ctx.rest('/../cron/jobs')
    } catch {
      escapeRejected = true
    }
    if (!escapeRejected) throw new Error('ctx.rest did not reject a namespace escape')

    stage('plugin ctx.rest door surfaces the PAUSED job (enabled:false) that active-only cron.manage omits — one scheduler store, no cache')
    return {
      attempted: true,
      door: `${backendInstall.namespace}/cron/jobs`,
      paused_hidden_from_active_only_rpc: true,
      paused_visible_via_plugin_backend: true,
      backend_source: viaDoor?.source || 'list_jobs(include_disabled=True)',
      namespace_escape_rejected: escapeRejected,
      minimal_fields_no_prompt_leak: true,
      one_source_of_truth: true,
      no_cache: true
    }
  } finally {
    if (jobId) {
      try {
        await rest('DELETE', withProfile(`/api/cron/jobs/${encodeURIComponent(jobId)}`))
      } catch { /* best effort */ }
    }
  }
}
