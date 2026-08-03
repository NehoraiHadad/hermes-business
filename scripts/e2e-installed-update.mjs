// Packaged update-FLOW E2E — isolated and deterministic by default.
//
// The previous version of this script clicked "עדכן עכשיו" and performed a REAL
// Hermes update (0.19.0 -> 0.19.1) against the live profile every run. That is
// destructive, non-deterministic (depends on what the remote release feed
// serves) and mutates shared state — unsafe for CI or a developer machine.
//
// This version proves the update-flow WIRING without mutating anything:
//   1. Launch the installed companion in a throwaway user-data-dir.
//   2. Snapshot Hermes state (sessions/skills/cron).
//   3. Drive the "בדוק עדכון" (check) button and read /api/hermes/update/check.
//   4. Assert the response is well-formed and the panel reflects it.
//   5. Snapshot again and assert the CHECK did not mutate state (checks are
//      read-only by contract).
//   6. Assert no renderer errors.
// It never clicks the apply button, so no backup/update/health-restart runs.
//
// The real destructive apply path is preserved but OFF by default. It runs only
// when HERMES_BUSINESS_E2E_DESTRUCTIVE_UPDATE=1 is set explicitly — that flag
// performs a live, irreversible Hermes update and must only be used on a
// disposable machine with an isolated HERMES_HOME.
//
// Executable resolution honors HERMES_BUSINESS_EXE (point it at
// release/win-unpacked to test a freshly built artifact without touching the
// installed copy).

import { safeJson } from './lib/e2e-harness.mjs'
import { assertNoRendererErrors, withProbeApp } from './lib/probe-app.mjs'
import { assertSafeInstalledE2E } from './lib/e2e-safety.mjs'

assertSafeInstalledE2E()

const DESTRUCTIVE = process.env.HERMES_BUSINESS_E2E_DESTRUCTIVE_UPDATE === '1'

async function snapshot(page) {
  return page.evaluate(async () => {
    const [skillsResult, cronResult, runtime] = await Promise.all([
      window.hermesDesktop.api('/api/skills?profile=default'),
      window.hermesDesktop.api('/api/cron/jobs?profile=default'),
      window.hermesDesktop.getRuntime()
    ])
    const sessions = await new Promise((resolve, reject) => {
      const socket = new WebSocket(runtime.wsUrl)
      const timer = window.setTimeout(() => reject(new Error('session.list timed out')), 20_000)
      socket.addEventListener('open', () => socket.send(JSON.stringify({
        jsonrpc: '2.0', id: 'update-state', method: 'session.list', params: { limit: 100 }
      })))
      socket.addEventListener('message', event => {
        const frame = JSON.parse(String(event.data))
        if (frame.id !== 'update-state') return
        window.clearTimeout(timer)
        socket.close()
        if (frame.error) reject(new Error(frame.error.message))
        else resolve(frame.result?.sessions || [])
      })
      socket.addEventListener('error', () => reject(new Error('session.list socket failed')))
    })
    const skills = Array.isArray(skillsResult) ? skillsResult : skillsResult.skills || []
    const jobs = Array.isArray(cronResult) ? cronResult : cronResult.jobs || []
    return { sessionCount: sessions.length, skillCount: skills.length, cronCount: jobs.length }
  })
}

await withProbeApp({ prefix: 'hermes-business-update', collectErrors: true }, async probe => {
  const { page } = probe

  const before = await snapshot(page)
  await page.locator('.main-nav__item').filter({ hasText: 'תמיכה ותקינות' }).click()
  await page.getByRole('button', { name: 'בדוק עדכון' }).click()

  // Read the raw check result and assert it is well-formed (deterministic shape,
  // not a specific version). A check must never mutate Hermes state.
  const check = await page.evaluate(() =>
    window.hermesDesktop.api('/api/hermes/update/check?force=true')
  )
  const wellFormed =
    check && typeof check === 'object' &&
    (typeof check.update_available === 'boolean' ||
      typeof check.current_version === 'string' ||
      typeof check.message === 'string')
  if (!wellFormed) throw new Error(`update/check returned an unexpected shape: ${JSON.stringify(check)}`)

  // The panel must reflect the check outcome ("יש עדכון" or "מעודכן").
  await page.locator('.version-panel .up-to-date').first().waitFor({ state: 'visible', timeout: 30_000 })

  const after = await snapshot(page)
  const preserved =
    after.sessionCount === before.sessionCount &&
    after.skillCount === before.skillCount &&
    after.cronCount === before.cronCount
  if (!preserved) {
    throw new Error(`update/check mutated state: ${JSON.stringify({ before, after })}`)
  }

  let destructiveApplied = false
  if (DESTRUCTIVE && check.update_available && check.can_apply) {
    // Opt-in, irreversible: perform the real update and wait for the success
    // banner. Only reachable behind the explicit env flag.
    page.once('dialog', dialog => dialog.accept())
    await page.getByRole('button', { name: 'עדכן עכשיו' }).click()
    await page.getByText('Hermes עודכן ובדיקת התקינות עברה בהצלחה', { exact: true }).waitFor({
      state: 'visible', timeout: 600_000
    })
    destructiveApplied = true
  }

  assertNoRendererErrors(probe, 'the update flow')

  console.log(safeJson({
    ok: true,
    mode: DESTRUCTIVE ? 'destructive-apply' : 'check-only',
    isolated_user_data: true,
    state_preserved_across_check: preserved,
    update_available: Boolean(check.update_available),
    can_apply: Boolean(check.can_apply),
    destructive_applied: destructiveApplied,
    before,
    after
  }))
})
