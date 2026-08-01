// APPROVAL CASE for the isolated packaged E2E. Opt-in via
// HERMES_BUSINESS_E2E_APPROVAL=1. Runs ONLY after the isolation preconditions
// have proven the runtime is isolated, so every side effect is scoped to our own
// throwaway temp home. Drives a REAL, denied approval over the official gateway
// RPC/event path — never a synthetic renderer modal.

import { copyFileSync, existsSync } from 'node:fs'
import path from 'node:path'
import { elicitAndDenyApproval, waitForRuntimeRunning } from '../installed-app.mjs'

/**
 * Seed the model credential into the isolated home so the REAL agent can run one
 * local turn, restart the runtime to pick it up, then submit a prompt that must
 * elicit an approval — which we DENY over `approval.respond`. The QA emptiness
 * check already validated the home at first boot (memoized), so seeding here does
 * not weaken the contract: it operates only on our own temp dir.
 * Returns the scalar approval report block.
 */
export async function runApprovalCase({ page, liveHome, tempHome, probePath }) {
  const seeded = []
  for (const name of ['auth.json', 'config.yaml']) {
    const src = path.join(liveHome, name)
    if (existsSync(src)) {
      try {
        copyFileSync(src, path.join(tempHome, name))
        seeded.push(name)
      } catch {
        /* ignore */
      }
    }
  }
  await page.evaluate(() => window.hermesDesktop.restartRuntime())
  await waitForRuntimeRunning(page, { timeoutMs: 60_000 })

  const prompt = [
    'בדיקת מנגנון אישור בלבד — אל תעשה שום דבר אחר.',
    `השתמש בכלי terminal כדי ליצור קובץ בנתיב המדויק הזה: ${probePath}`,
    `הפעל בדיוק: powershell.exe -NoProfile -Command "Set-Content -LiteralPath '${probePath}' -Value ok"`,
    'אל תשנה את הפקודה ואל תנסה דרך אחרת. המתן להחלטת המשתמש.'
  ].join(' ')

  const trace = await elicitAndDenyApproval(page, { text: prompt, timeoutMs: 180_000 })
  const noSideEffect = !existsSync(probePath)
  return {
    enabled: true,
    creds_seeded: seeded.length > 0,
    official_method: 'approval.respond',
    via_real_event_path: trace.requested && trace.events.includes('approval.request'),
    requested: trace.requested,
    request_command_present: trace.requestCommandPresent,
    denied: trace.denied,
    deny_resolved_count: trace.denyResolvedCount,
    no_side_effect: noSideEffect,
    renderer_modal_faked: false,
    error: trace.error || null
  }
}
