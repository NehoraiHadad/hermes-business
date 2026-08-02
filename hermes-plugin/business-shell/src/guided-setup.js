import { host } from '@hermes/plugin-sdk'
import { flattenSkillNames } from './helpers.js'
import { buildBootstrapPrompt, buildModelSnapshot } from '../../../shared/onboarding-bootstrap.js'
import { submitBusinessBootstrap } from './bootstrap-session.js'

// The guided first-run flow. Instead of a giant static prompt, the trusted wrapper
// performs a bounded inspection through official host APIs, then opens one real
// Hermes session pointed at the business-bootstrap Skill. The handoff payload comes
// from the single canonical builder so it can never drift from the React wrapper.

export const GUIDED_SETUP_VERSION = 2

export function guidedSetupPrompt(snapshot = {}) {
  return buildBootstrapPrompt({ snapshot })
}

export async function startGuidedSetup(storage, { force = false } = {}) {
  const previous = storage.get('guidedSetup', {})
  if (
    !force &&
    previous?.version === GUIDED_SETUP_VERSION &&
    ['starting', 'active', 'complete'].includes(previous?.status)
  ) {
    if (previous.storedSessionId) host.navigate(`/${encodeURIComponent(previous.storedSessionId)}`)
    return previous
  }

  const startedAt = new Date().toISOString()
  storage.set('guidedSetup', {
    version: GUIDED_SETUP_VERSION,
    status: 'starting',
    startedAt
  })

  try {
    const [skillsResult, cronResult] = await Promise.all([
      host.request('skills.manage', { action: 'list' }).catch(() => ({})),
      host.request('cron.manage', { action: 'list' }).catch(() => ({}))
    ])
    const cronJobs = Array.isArray(cronResult?.jobs)
      ? cronResult.jobs
      : Array.isArray(cronResult)
        ? cronResult
        : []
    const snapshot = buildModelSnapshot({
      gateway: host.state.gateway.get(),
      model: host.state.model.get() || null,
      profile: host.state.profile.get() || 'default',
      skills: [...new Set(flattenSkillNames(skillsResult?.skills || skillsResult))],
      scheduledTasks: cronJobs.length
    })
    const created = await host.request('session.create', {
      title: "הקמת תכל'ס",
      source: 'desktop'
    })
    await submitBusinessBootstrap(created.session_id, guidedSetupPrompt(snapshot))
    const next = {
      version: GUIDED_SETUP_VERSION,
      status: 'active',
      startedAt,
      runtimeSessionId: created.session_id,
      storedSessionId: created.stored_session_id || ''
    }
    storage.set('guidedSetup', next)
    storage.set('onboardingComplete', true)
    host.notify({
      kind: 'success',
      title: 'ההיכרות התחילה',
      message: 'העוזר ישאל בכל פעם שאלה קצרה וישמור את ההתקדמות ב־Hermes.'
    })
    if (created.stored_session_id) host.navigate(`/${encodeURIComponent(created.stored_session_id)}`)
    return next
  } catch (error) {
    storage.set('guidedSetup', {
      version: GUIDED_SETUP_VERSION,
      status: 'failed',
      startedAt,
      error: String(error?.message || error)
    })
    throw error
  }
}
