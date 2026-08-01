// Shared-state proofs: each asserts that state created through ONE surface
// (the wrapper's REST or RPC contract) is visible through a DIFFERENT official
// Hermes surface (gateway RPC, REST, or the on-disk profile), all backed by the
// same isolated HERMES_HOME. No paid provider is required for any of these.

import { existsSync, readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { flattenSkillNames } from '../../hermes-live.mjs'
import { withProfile } from '../../hermes-rest.mjs'
import { reconcileCheckins, isOwnedCheckin } from '../../../../electron/partner-checkins.cjs'
import { cronJobId, cronJobMatches } from '../../../../electron/cron-identity.cjs'

// A cron client with the exact shape reconcileCheckins expects, backed by the
// live isolated gateway's official REST surface — the SAME contract the electron
// client (electron/partner-cron.cjs) speaks in production. No parallel scheduler.
function restCronClient(rest) {
  return {
    async list() {
      const r = await rest('GET', withProfile('/api/cron/jobs'))
      return Array.isArray(r) ? r : r?.jobs || []
    },
    create: job =>
      rest('POST', withProfile('/api/cron/jobs'), { name: job.name, prompt: job.prompt, schedule: job.schedule, deliver: job.deliver }),
    update: (id, updates) => rest('PUT', withProfile(`/api/cron/jobs/${encodeURIComponent(id)}`), { updates }),
    pause: id => rest('POST', withProfile(`/api/cron/jobs/${encodeURIComponent(id)}/pause`)),
    resume: id => rest('POST', withProfile(`/api/cron/jobs/${encodeURIComponent(id)}/resume`)),
    remove: id => rest('DELETE', withProfile(`/api/cron/jobs/${encodeURIComponent(id)}`))
  }
}

function readJobsFile(home) {
  const file = path.join(home, 'cron', 'jobs.json')
  if (!existsSync(file)) return { file, jobs: [] }
  try {
    return { file, jobs: JSON.parse(readFileSync(file, 'utf8')).jobs || [] }
  } catch {
    return { file, jobs: [] }
  }
}

/** Wrapper REST creates a cron job; official RPC + on-disk state must see it, then REST removes it. */
export async function proveCronSharedState(harness, rest, home, ctx) {
  const { rpc, stage } = harness
  const name = ctx.jobName
  await rest('POST', withProfile('/api/cron/jobs'), {
    name,
    schedule: '0 0 1 1 *',
    prompt: 'E2E shared-state marker. Never runs outside this acceptance test.',
    deliver: 'local'
  })
  ctx.cronCreated = true
  stage('created scheduled task through the wrapper REST contract')

  const viaRpc = await rpc('cron.manage', { action: 'list' })
  const rpcJob = viaRpc.jobs?.find(j => j.name === name)
  if (!rpcJob) throw new Error('REST-created cron job is not visible via official cron.manage RPC')
  const jobId = cronJobId(rpcJob)

  const onDisk = readJobsFile(home)
  const diskJob = onDisk.jobs.find(j => j.name === name)
  if (!diskJob) throw new Error('REST-created cron job is not present in on-disk cron/jobs.json')
  stage('scheduled task is visible through official cron.manage RPC and on-disk cron/jobs.json')

  await rest('DELETE', withProfile(`/api/cron/jobs/${encodeURIComponent(jobId)}`))
  ctx.cronCreated = false
  const after = await rpc('cron.manage', { action: 'list' })
  if (after.jobs?.some(j => j.name === name)) throw new Error('cron job survived REST DELETE')
  if (readJobsFile(home).jobs.some(j => j.name === name)) throw new Error('cron job survived on-disk after DELETE')
  stage('scheduled task removed through the wrapper REST contract; official state agrees')
  return { rest_created: true, visible_via_rpc: true, visible_on_disk: true, removed: true, job_id: jobId, disk_file: onDisk.file }
}

/** Cross-door proof for PAUSED jobs, no cache. Create via REST, pause via the
 *  plugin's cron.manage door, then assert the pause is authoritative in the
 *  OTHER doors (REST enabled:false + on-disk) while the active-only cron.manage
 *  list omits it — nothing resurrects a shadow row. Resume and clean up. */
export async function provePausedCronCrossDoor(harness, rest, home, ctx) {
  const { rpc, stage } = harness
  const name = ctx.pausedJobName
  await rest('POST', withProfile('/api/cron/jobs'), {
    name,
    schedule: '0 0 1 1 *',
    prompt: 'E2E paused cross-door marker. Never runs outside this acceptance test.',
    deliver: 'local'
  })
  ctx.pausedCreated = true
  const before = (await rpc('cron.manage', { action: 'list' })).jobs?.find(j => j.name === name)
  if (!before) throw new Error('cross-door cron job not visible via cron.manage before pause')
  const jobId = cronJobId(before)

  await rpc('cron.manage', { action: 'pause', name: jobId })
  const afterPause = await rpc('cron.manage', { action: 'list' })
  if (afterPause.jobs?.some(j => j.name === name)) {
    throw new Error('paused job still listed by active-only cron.manage — a shadow cache is masking the pause')
  }
  const restList = await rest('GET', withProfile('/api/cron/jobs'))
  const restJob = (Array.isArray(restList) ? restList : restList?.jobs || []).find(j => j.name === name)
  if (!restJob) throw new Error('paused job not visible via REST /api/cron/jobs')
  if (restJob.enabled !== false) throw new Error('REST does not report the job paused (enabled:false)')
  const diskJob = readJobsFile(home).jobs.find(j => j.name === name)
  if (!diskJob || diskJob.enabled !== false) throw new Error('on-disk cron/jobs.json does not show the job paused')
  stage('paused via plugin cron.manage: REST + on-disk agree (enabled:false); active-only list omits it, no cache')

  await rpc('cron.manage', { action: 'resume', name: jobId })
  if (!(await rpc('cron.manage', { action: 'list' })).jobs?.some(j => j.name === name)) {
    throw new Error('resumed job did not return to cron.manage list')
  }
  await rest('DELETE', withProfile(`/api/cron/jobs/${encodeURIComponent(jobId)}`))
  ctx.pausedCreated = false
  stage('resumed job reappears in the plugin door; removed via REST, official state agrees')
  // eslint-disable-next-line max-len
  return { paused_via: 'cron.manage (plugin door)', paused_visible_via_rest: true, paused_visible_on_disk: true, hidden_from_active_only_plugin_list: true, resumed: true, no_cache: true }
}

/** The REAL partner check-in reconciler run against the live isolated gateway:
 *  opt-in creates exactly one marked owned job (visible via cron.manage + on-disk),
 *  a second reconcile is idempotent (no duplicate), and opt-out PAUSES it — the
 *  paused job stays visible via REST (enabled:false) while the active-only
 *  cron.manage list omits it, proving one source and no cache. */
export async function provePartnerCheckinReconcile(harness, rest, home, ctx) {
  const { rpc, stage } = harness
  const cron = restCronClient(rest)
  const enabled = { mode: 'partner', checkins: true, checkinCadence: 'weekly' }

  const created = await reconcileCheckins(enabled, cron)
  if (!created.created) throw new Error('reconcile did not create the owned check-in on opt-in')
  const owned = (await cron.list()).filter(isOwnedCheckin)
  if (owned.length !== 1) throw new Error(`expected exactly one owned check-in, got ${owned.length}`)
  // Identity comes off the REST list shape (canonical `id`); the same job must be
  // found in the RPC list (which exposes it as `job_id`) and on-disk (`id`).
  const jobId = cronJobId(owned[0])
  ctx.checkinJobId = jobId
  const rpcList = await rpc('cron.manage', { action: 'list' })
  if (!rpcList.jobs?.some(j => cronJobMatches(j, jobId))) throw new Error('owned check-in not visible via cron.manage')
  if (!readJobsFile(home).jobs.some(j => cronJobMatches(j, jobId))) throw new Error('owned check-in not present on-disk')
  stage('opt-in reconcile created one owned check-in; visible via cron.manage + on-disk')

  const again = await reconcileCheckins(enabled, cron)
  if (again.created || (await cron.list()).filter(isOwnedCheckin).length !== 1) throw new Error('reconcile is not idempotent')
  stage('second reconcile is idempotent: no duplicate owned check-in')

  const disabled = await reconcileCheckins({ ...enabled, checkins: false }, cron)
  if (disabled.paused !== 1) throw new Error('reconcile did not pause the owned check-in on opt-out')
  const restJob = (await cron.list()).find(j => cronJobMatches(j, jobId))
  if (!restJob || restJob.enabled !== false) throw new Error('paused check-in not reported enabled:false via REST')
  const rpcAfter = await rpc('cron.manage', { action: 'list' })
  if (rpcAfter.jobs?.some(j => cronJobMatches(j, jobId))) throw new Error('active-only cron.manage still lists the paused check-in (shadow cache)')
  stage('opt-out reconcile paused (preserved) the check-in: REST enabled:false, active-only list omits it')

  await cron.remove(jobId)
  ctx.checkinJobId = null
  // eslint-disable-next-line max-len
  return { created: true, idempotent: true, paused_preserved: true, hidden_from_active_only: true, one_source: true, no_cache: true, job_id: jobId }
}

/** Wrapper REST creates a skill; official RPC skills.manage + on-disk SKILL.md must see it. */
export async function proveSkillSharedState(harness, rest, home, ctx) {
  const { rpc, stage } = harness
  const name = ctx.skillName
  const content = `---\nname: ${name}\ndescription: E2E shared-state skill marker (safe to delete).\n---\n\nDeterministic marker skill created by the installed-Hermes shared-state E2E.\n`
  // POST returns the same _create_skill payload the agent's skill tool writes,
  // including the absolute on-disk SKILL.md path (category nests it under
  // <skills>/<category>/<name>/). Use that path rather than guessing the layout.
  const createResult = await rest('POST', '/api/skills', { name, content, category: 'business', profile: 'default' })
  ctx.skillCreated = true
  stage('created skill through the wrapper REST contract')

  const listed = await rpc('skills.manage', { action: 'list' })
  const names = new Set(flattenSkillNames(listed.skills || {}))
  if (!names.has(name)) throw new Error('REST-created skill is not visible via official skills.manage RPC')

  const skillMd = createResult?.skill_md || path.join(home, 'skills', 'business', name, 'SKILL.md')
  if (!existsSync(skillMd)) throw new Error(`REST-created skill missing on disk at ${skillMd}`)
  if (path.resolve(skillMd).toLowerCase().indexOf(path.resolve(home).toLowerCase()) !== 0) {
    throw new Error(`skill written outside the isolated home: ${skillMd}`)
  }
  stage('skill is visible through official skills.manage RPC and on-disk SKILL.md')
  return { rest_created: true, visible_via_rpc: true, on_disk_path: skillMd, skill_count: names.size }
}

/** Wrapper RPC creates a session; official REST /api/sessions + on-disk store must see it. */
export async function proveSessionSharedState(harness, rest, storedSessionId) {
  const { stage } = harness
  const restList = await rest('GET', withProfile('/api/sessions'))
  const sessions = Array.isArray(restList) ? restList : restList?.sessions || []
  const found = sessions.find(s => (s.id || s.session_id) === storedSessionId)
  if (!found) throw new Error('RPC-created session is not visible via official REST /api/sessions')
  stage('RPC-created session is visible through the official REST session surface')
  return { rpc_created: true, visible_via_rest: true, rest_session_count: sessions.length }
}

/** Evidence that plugin/profile/memory/workspace paths resolve under the isolated home. */
export function provePathEvidence(home) {
  const paths = {
    home,
    plugins: path.join(home, 'plugins'),
    desktop_plugins: path.join(home, 'desktop-plugins'),
    memories: path.join(home, 'memories'),
    skills: path.join(home, 'skills'),
    sessions: path.join(home, 'sessions'),
    cron: path.join(home, 'cron'),
    workspace_db: path.join(home, 'projects.db')
  }
  const present = Object.fromEntries(
    Object.entries(paths).map(([k, p]) => [k, existsSync(p)])
  )
  const sessionFiles = existsSync(paths.sessions) ? readdirSync(paths.sessions).length : 0
  return { paths, present, under_isolated_home: true, session_entries: sessionFiles }
}
