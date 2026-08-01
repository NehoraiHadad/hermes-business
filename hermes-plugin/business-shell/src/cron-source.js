import { host } from '@hermes/plugin-sdk'
import { summarizeCronJobs } from './helpers.js'
import { resolveBackendPayload } from './cron-normalize.js'

// Single source of truth for the scheduled-task LIST, active + paused.
//
// The desktop PluginContext hands each plugin a `rest(path)` door that is
// namespace-locked BY CONSTRUCTION to that plugin's own backend at
// /api/plugins/<id> (Hermes apps/desktop/src/contrib/plugin.ts::PluginContext
// -> hermes.ts::pluginRest: it rejects '..' and cannot address a core route or
// another plugin's namespace). Our companion backend
// (hermes-plugin/business-shell/dashboard/plugin_api.py) answers `/cron/jobs`
// by calling Hermes' authoritative scheduler `list_jobs(include_disabled=True)`
// — the SAME store the core /api/cron/jobs route reads. So this door is a
// paused-inclusive view of the one official scheduler: no parallel store, no
// cache. Mutations stay official scheduler operations on the cron.manage RPC.
export const PLUGIN_BACKEND_NAMESPACE = '/api/plugins/business-shell'

let pluginRest = null

// The plugin's `register(ctx)` installs the real namespace-scoped door here.
// Kept module-local (like the imported `host`) so the screens don't need `ctx`
// threaded through every prop. A non-function (older SDK, missing door) simply
// disables the paused-inclusive path and we fall back honestly.
export function setPluginRest(rest) {
  pluginRest = typeof rest === 'function' ? rest : null
}

export function hasPausedInclusiveDoor() {
  return typeof pluginRest === 'function'
}

// Load scheduled tasks with capability detection.
//   Preferred: the companion backend door (paused-inclusive, authoritative).
//   Fallback:  the active-only cron.manage gateway RPC — used when the backend
//              is unavailable (older Hermes, the companion plugin not
//              installed/enabled, an OAuth remote where ctx.rest is a no-op, or
//              any transport error).
// Both doors read live official Hermes state; neither is a cache. Returns
// { jobs, pausedListingSupported, source } so the UI can render paused rows
// inline when supported and degrade honestly when not.
export async function loadScheduledTasks() {
  if (pluginRest) {
    try {
      const payload = await pluginRest('/cron/jobs')
      // resolveBackendPayload returns null (degrade) on a null/malformed/non-array/
      // missing-flag or explicitly-degraded body, so the UI falls back to the
      // active-only door and shows its honest notice instead of hiding a fallback
      // behind an empty list. Only a well-formed non-degraded body is trusted.
      const resolved = resolveBackendPayload(payload)
      if (resolved) {
        return { ...resolved, source: 'plugin-backend' }
      }
    } catch {
      // fall through to the active-only gateway door
    }
  }
  const viaRpc = await host.request('cron.manage', { action: 'list' })
  return { ...summarizeCronJobs(viaRpc), source: 'cron.manage' }
}
