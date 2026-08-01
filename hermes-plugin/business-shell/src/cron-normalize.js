// Pure, dependency-free normalization for the scheduled-task backend payload.
// Kept out of cron-source.js (which imports the runtime-only @hermes/plugin-sdk)
// so the degrade/fallback decision is unit-testable in a bare VM.

// Extract the jobs array from a backend payload, or null when the payload is
// malformed (not an object/array, or missing a `jobs` array). Returning null —
// rather than [] — lets the caller DEGRADE to the active-only door instead of
// silently claiming paused-inclusive support over an empty/garbage response.
export function extractJobs(payload) {
  if (Array.isArray(payload)) return payload
  if (payload && typeof payload === 'object' && Array.isArray(payload.jobs)) return payload.jobs
  return null
}

// Decide whether a companion-backend payload can be TRUSTED as the paused-
// inclusive source. Returns { jobs, pausedListingSupported: true } on a well-
// formed, non-degraded body with a real jobs array (possibly empty), or null to
// signal "degrade to the active-only cron.manage door". Degrades on:
//   - null / non-object-or-array payload
//   - an explicit degraded:true or paused_listing_supported:false body
//   - a payload with no `jobs` array (missing/garbage flag or shape)
export function resolveBackendPayload(payload) {
  const explicitlyDegraded =
    payload == null ||
    (typeof payload === 'object' &&
      !Array.isArray(payload) &&
      (payload.degraded === true || payload.paused_listing_supported === false))
  if (explicitlyDegraded) return null
  const jobs = extractJobs(payload)
  if (!jobs) return null
  return { jobs, pausedListingSupported: true }
}
