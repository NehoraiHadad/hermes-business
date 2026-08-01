// Thin electron-main client for the ONE official Hermes cron surface
// (hermes_cli/web_server.py: POST/PUT/DELETE /api/cron/jobs, /{id}/pause|resume).
// It is the SAME store the Companion REST UI and full Hermes read — no parallel
// scheduler, no cache. GET returns paused jobs too (the route lists with
// include_disabled=True), which reconciliation relies on. `api` is injectable so
// the contract is unit-testable without a live Hermes.

const PROFILE = 'default'

function defaultApi() {
  return require('./runtime.cjs').hermesApi
}

function withProfile(pathname) {
  return `${pathname}${pathname.includes('?') ? '&' : '?'}profile=${PROFILE}`
}

function createCronClient(api = defaultApi()) {
  return {
    async list() {
      const payload = await api(withProfile('/api/cron/jobs'))
      if (Array.isArray(payload)) return payload
      return (payload && Array.isArray(payload.jobs) && payload.jobs) || []
    },
    create({ name, prompt, schedule, deliver = 'local' }) {
      return api(withProfile('/api/cron/jobs'), { method: 'POST', body: { name, prompt, schedule, deliver } })
    },
    update(id, updates) {
      return api(withProfile(`/api/cron/jobs/${encodeURIComponent(id)}`), { method: 'PUT', body: { updates } })
    },
    pause(id) {
      return api(withProfile(`/api/cron/jobs/${encodeURIComponent(id)}/pause`), { method: 'POST' })
    },
    resume(id) {
      return api(withProfile(`/api/cron/jobs/${encodeURIComponent(id)}/resume`), { method: 'POST' })
    },
    remove(id) {
      return api(withProfile(`/api/cron/jobs/${encodeURIComponent(id)}`), { method: 'DELETE' })
    }
  }
}

module.exports = { createCronClient, withProfile, PROFILE }
