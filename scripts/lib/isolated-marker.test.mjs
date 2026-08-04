import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { hermesHomeMarker, markerDelta } from './isolated-marker.mjs'
const created = []
afterEach(() => {
  while (created.length) {
    try {
      rmSync(created.pop(), { recursive: true, force: true })
    } catch {
      /* best effort */
    }
  }
})
function seededHome(files = {}) {
  const home = mkdtempSync(path.join(os.tmpdir(), 'marker-'))
  created.push(home)
  writeFileSync(path.join(home, 'config.yaml'), files.config ?? 'x: 1\n')
  return home
}
function put(home, rel, body) {
  const abs = path.join(home, rel)
  mkdirSync(path.dirname(abs), { recursive: true })
  writeFileSync(abs, body)
}
// Shaped like a real Hermes 0.19.1 job: a definition plus the run bookkeeping the
// gateway rewrites under us every tick.
function job(id, overrides = {}) {
  return {
    id,
    name: `job-${id}`,
    prompt: 'daily summary',
    schedule: { kind: 'cron', expr: '0 8 * * *' },
    enabled: true,
    repeat: { times: null, completed: 3 },
    state: 'scheduled',
    last_run_at: '2026-08-04T15:47:15+03:00',
    next_run_at: '2026-08-05T08:00:00+03:00',
    last_status: 'ok',
    provider_snapshot: 'openai-codex',
    model_snapshot: 'gpt-5.6-sol',
    ...overrides
  }
}
function putJobs(home, jobs) {
  put(home, 'cron/jobs.json', JSON.stringify({ jobs, updated_at: '2026-08-04T15:47:15+03:00' }))
}

describe('hermesHomeMarker — stable recursive fingerprint', () => {
  it('digest moves when config.yaml changes (approvals.mode toggle proxy)', () => {
    const home = seededHome({ config: 'approvals:\n  mode: auto\n' })
    const before = hermesHomeMarker(home)
    writeFileSync(path.join(home, 'config.yaml'), 'approvals:\n  mode: manual\n')
    expect(hermesHomeMarker(home).digest).not.toBe(before.digest)
    expect(before.configPresent).toBe(true)
  })

  it('digest moves on a NESTED skills/foo/SKILL.md edit (immediate-dir size is blind to this)', () => {
    const home = seededHome()
    put(home, 'skills/foo/SKILL.md', '# v1')
    const before = hermesHomeMarker(home)
    put(home, 'skills/foo/SKILL.md', '# v2 rewritten body, longer')
    expect(hermesHomeMarker(home).digest).not.toBe(before.digest)
  })

  it('digest is unmoved by pure volatile session churn', () => {
    const home = seededHome()
    put(home, 'sessions/live-gateway-session.json', '{}')
    const before = hermesHomeMarker(home)
    put(home, 'sessions/another.json', '{"turns":[1]}')
    expect(hermesHomeMarker(home).digest).toBe(before.digest)
  })

  it('digest is unmoved by concurrent curator dot-metadata churn inside skills', () => {
    const home = seededHome()
    put(home, 'skills/foo/SKILL.md', '# s')
    const before = hermesHomeMarker(home)
    // The live gateway's Curator rewrites these while our isolated run executes.
    put(home, 'skills/.usage.json', '{"foo":42}')
    put(home, 'skills/.curator_state', 'live-churn')
    expect(hermesHomeMarker(home).digest).toBe(before.digest)
    expect(hermesHomeMarker(home).inventory.skills).toBe(1) // dot-metadata not counted
  })
})

describe('markerDelta — volatile runtime churn PASSES with disclosure', () => {
  it('a same-name cron file resize (next-run/heartbeat) is disclosed, not a mutation', () => {
    const home = seededHome()
    put(home, 'cron/job-a.json', '{"next":1}')
    const before = hermesHomeMarker(home)
    put(home, 'cron/job-a.json', '{"next":222222222}')
    const delta = markerDelta(before, hermesHomeMarker(home))
    expect(delta.profile_defining_unchanged).toBe(true)
    expect(delta.digest_equal).toBe(true)
    expect(delta.volatile_runtime_changes).toEqual({ cron: 1 })
  })

  it("the ticker's own runtime files appearing in cron/ are churn, not a mutation", () => {
    // What actually happened during the 0.4.0-alpha.4 packaged E2E: the operator's
    // live gateway ticked mid-run and created catch_up_occurrences for the first
    // time. No job was added — protecting the cron NAME-SET failed the release for
    // the gateway simply doing its job.
    const home = seededHome()
    putJobs(home, [job('a')])
    const before = hermesHomeMarker(home)
    put(home, 'cron/catch_up_occurrences', '1')
    put(home, 'cron/.tick.lock', '')
    const delta = markerDelta(before, hermesHomeMarker(home))
    expect(delta.added_removed.cron.added).toBe(2)
    expect(delta.volatile_runtime_changes.cron).toBe(2)
    expect(delta.cron_jobs_changed).toBe(false)
    expect(delta.profile_defining_unchanged).toBe(true)
    expect(delta.digest_equal).toBe(true)
  })

  it('a job RUN (last_run_at/next_run_at/status/counter rewrite) is churn, not a mutation', () => {
    const home = seededHome()
    putJobs(home, [job('a')])
    const before = hermesHomeMarker(home)
    putJobs(home, [
      job('a', {
        last_run_at: '2026-08-04T16:47:15+03:00',
        next_run_at: '2026-08-06T08:00:00+03:00',
        last_status: 'error',
        state: 'running',
        fire_claim: 'pid-49104',
        repeat: { times: null, completed: 4 }
      })
    ])
    const delta = markerDelta(before, hermesHomeMarker(home))
    expect(delta.cron_jobs_changed).toBe(false)
    expect(delta.profile_defining_unchanged).toBe(true)
    expect(delta.digest_equal).toBe(true)
  })

  it('concurrent live-gateway session create + growth is disclosed volatility', () => {
    const home = seededHome()
    put(home, 'sessions/existing.json', '{}')
    const before = hermesHomeMarker(home)
    put(home, 'sessions/existing.json', '{"turns":[1,2,3]}')
    put(home, 'sessions/new-live.json', '{}')
    const delta = markerDelta(before, hermesHomeMarker(home))
    expect(delta.added_removed.sessions.added).toBe(1)
    expect(delta.profile_defining_unchanged).toBe(true)
    expect(delta.digest_equal).toBe(true)
    expect(delta.volatile_runtime_changes.sessions).toBe(2)
  })
})

describe('markerDelta — stable/profile mutations FAIL closed', () => {
  it('a nested skill CONTENT edit fails and is classed as content, not structural', () => {
    const home = seededHome()
    put(home, 'skills/foo/SKILL.md', '# v1')
    const before = hermesHomeMarker(home)
    put(home, 'skills/foo/SKILL.md', '# v2 rewritten body')
    const delta = markerDelta(before, hermesHomeMarker(home))
    expect(delta.stable_content_changed).toEqual({ skills: 1 })
    expect(delta.stable_structural_changed).toEqual({})
    expect(delta.profile_defining_unchanged).toBe(false)
    expect(delta.digest_equal).toBe(false)
    expect(delta.volatile_runtime_changes).toEqual({})
  })

  it('a plugin nested SAME-SIZE byte rewrite fails (size-blind detection would pass)', () => {
    const home = seededHome()
    put(home, 'plugins/business-whatsapp-policy/policy.py', 'AAAAAAAA')
    const before = hermesHomeMarker(home)
    put(home, 'plugins/business-whatsapp-policy/policy.py', 'BBBBBBBB') // identical length
    const delta = markerDelta(before, hermesHomeMarker(home))
    expect(delta.stable_content_changed).toEqual({ plugins: 1 })
    expect(delta.profile_defining_unchanged).toBe(false)
    expect(delta.digest_equal).toBe(false)
  })

  it('a nested add fails as structural, and a config toggle fails as config', () => {
    const home = seededHome({ config: 'approvals:\n  mode: auto\n' })
    put(home, 'skills/foo/SKILL.md', '# s')
    const before = hermesHomeMarker(home)
    put(home, 'skills/foo/nested/new.md', 'added')
    let delta = markerDelta(before, hermesHomeMarker(home))
    expect(delta.stable_structural_changed.skills).toBeGreaterThanOrEqual(1)
    expect(delta.profile_defining_unchanged).toBe(false)
    writeFileSync(path.join(home, 'config.yaml'), 'approvals:\n  mode: manual\n')
    delta = markerDelta(before, hermesHomeMarker(home))
    expect(delta.config_changed).toBe(true)
    expect(delta.digest_equal).toBe(false)
  })

  it('a NEW cron JOB in jobs.json fails (it is only a few bytes of one file)', () => {
    const home = seededHome()
    putJobs(home, [job('a')])
    const before = hermesHomeMarker(home)
    putJobs(home, [job('a'), job('b')])
    const delta = markerDelta(before, hermesHomeMarker(home))
    expect(delta.cron_jobs_changed).toBe(true)
    expect(delta.cron_jobs_before).toBe(1)
    expect(delta.cron_jobs_after).toBe(2)
    expect(delta.profile_defining_unchanged).toBe(false)
    expect(delta.digest_equal).toBe(false)
  })

  it("a REDEFINED job (same id, new prompt/schedule) fails — the count alone would miss it", () => {
    const home = seededHome()
    putJobs(home, [job('a', { prompt: 'summarize sales' })])
    const before = hermesHomeMarker(home)
    putJobs(home, [job('a', { prompt: 'message every contact' })])
    const delta = markerDelta(before, hermesHomeMarker(home))
    expect(delta.cron_jobs_before).toBe(delta.cron_jobs_after)
    expect(delta.cron_jobs_changed).toBe(true)
    expect(delta.profile_defining_unchanged).toBe(false)
  })

  it('an UNREADABLE jobs.json fails closed even though the fingerprint is stable', () => {
    const home = seededHome()
    putJobs(home, [job('a')])
    const before = hermesHomeMarker(home)
    put(home, 'cron/jobs.json', '{ truncated mid-writ')
    const delta = markerDelta(before, hermesHomeMarker(home))
    expect(delta.cron_jobs_unreadable).toBe(true)
    expect(delta.profile_defining_unchanged).toBe(false)
  })

  it('profile_defining_unchanged and digest_equal never disagree', () => {
    const home = seededHome()
    put(home, 'plugins/p/p.json', '{"a":1}')
    const before = hermesHomeMarker(home)
    put(home, 'plugins/p/p.json', '{"a":22}') // same-path content rewrite
    const delta = markerDelta(before, hermesHomeMarker(home))
    expect(delta.profile_defining_unchanged).toBe(delta.digest_equal)
    expect(delta.profile_defining_unchanged).toBe(false)
  })
})
