// Registry probes: confirm the shared session is listable, count discovered
// skills, and run a full cron create/pause/resume/remove lifecycle. The cron
// probe toggles ctx.cronCreated so the orchestrator's finally can clean up a
// job left behind by a mid-cycle failure.

import { flattenSkillNames } from '../../hermes-live.mjs'
import { cronJobId } from '../../../../electron/cron-identity.cjs'

/** Confirm the stored session id is returned by session.list. */
export async function verifySharedSession(harness, storedSessionId) {
  const { rpc, stage } = harness
  const listed = await rpc('session.list', { limit: 100 })
  const sharedSession = listed.sessions?.find(item => item.id === storedSessionId)
  if (!sharedSession) throw new Error('The new session was not returned by session.list')
  stage('shared session is visible through session.list')
  return sharedSession
}

/** Count the distinct discoverable skills. */
export async function countSkills(harness) {
  const { rpc } = harness
  const skills = await rpc('skills.manage', { action: 'list' })
  return new Set(flattenSkillNames(skills.skills || {})).size
}

/** Exercise the full cron lifecycle, leaving no scheduled task behind. */
export async function runCronCycle(harness, ctx) {
  const { rpc, stage } = harness
  const { jobName } = ctx

  await rpc('cron.manage', {
    action: 'add',
    name: jobName,
    schedule: '0 0 1 1 *',
    prompt: 'POC E2E marker task. Do not run outside this acceptance test.'
  })
  ctx.cronCreated = true
  stage('created scheduled task')

  let cron = await rpc('cron.manage', { action: 'list' })
  const createdJob = cron.jobs?.find(item => item.name === jobName)
  if (!createdJob) throw new Error('The scheduled task was not returned by cron.manage list')
  const jobId = cronJobId(createdJob)
  await rpc('cron.manage', { action: 'pause', name: jobId })
  await rpc('cron.manage', { action: 'resume', name: jobId })
  await rpc('cron.manage', { action: 'remove', name: jobId })
  ctx.cronCreated = false

  cron = await rpc('cron.manage', { action: 'list' })
  if (cron.jobs?.some(item => item.name === jobName)) {
    throw new Error('The scheduled task remained after cleanup')
  }
  stage('completed cron create/pause/resume/remove cycle')
}
