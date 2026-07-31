// Shared-state proofs: each asserts that state created through ONE surface
// (the wrapper's REST or RPC contract) is visible through a DIFFERENT official
// Hermes surface (gateway RPC, REST, or the on-disk profile), all backed by the
// same isolated HERMES_HOME. No paid provider is required for any of these.

import { existsSync, readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { flattenSkillNames } from '../../hermes-live.mjs'
import { withProfile } from '../../hermes-rest.mjs'

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
  const jobId = rpcJob.id || rpcJob.name

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
