import { host } from '@hermes/plugin-sdk'
import { flattenSkillNames } from './helpers.js'

// The guided first-run flow. Instead of a giant static prompt, the trusted
// wrapper performs a bounded inspection through official host APIs, then opens
// one real Hermes session pointed at the /business-bootstrap Skill.

export const GUIDED_SETUP_VERSION = 2

export function guidedSetupPrompt(snapshot = {}) {
  return [
    '/business-bootstrap',
    'הקמת העוזר לעסק.',
    'This is the first-run setup for a non-technical business owner.',
    'The trusted Hermes Desktop wrapper already performed the bounded inspection below through official APIs.',
    'Use this verified snapshot and do not repeat its checks before asking the first missing question.',
    'Never run hermes doctor, broad scans, connectivity suites, update checks, or CLI --help discovery during onboarding.',
    'Resume existing durable business context instead of asking for facts Hermes already knows.',
    'Ask only the next one or two closely related questions. Prefer Hermes native structured question UI when it is available.',
    'Do not dump the full questionnaire, do not request secrets in chat, and do not perform external actions without explicit approval.',
    'Persist stable facts through Hermes Memory/Profile and maintain a business-context Skill.',
    'After understanding the business, recommend exactly one existing Hermes Skill or messaging connection with the clearest immediate value, explain why, and wait for approval before setup.',
    'Verify every completed connection with a safe read-only check.',
    `WRAPPER_VERIFIED_SNAPSHOT=${JSON.stringify(snapshot)}`,
    'Begin now with a short explanation and the first missing question.'
  ].join('\n')
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
    const snapshot = {
      gateway: host.state.gateway.get(),
      model: host.state.model.get() || null,
      profile: host.state.profile.get() || 'default',
      skills: [...new Set(flattenSkillNames(skillsResult?.skills || skillsResult))].slice(0, 100),
      scheduled_tasks: cronJobs.length
    }
    const created = await host.request('session.create', {
      title: 'הקמת העוזר לעסק',
      source: 'desktop'
    })
    await host.request('prompt.submit', {
      session_id: created.session_id,
      text: guidedSetupPrompt(snapshot)
    })
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
