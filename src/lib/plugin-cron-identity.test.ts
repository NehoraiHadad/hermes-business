import { describe, expect, it } from 'vitest'
import { cronJobId as electronCronJobId } from '../../electron/cron-identity.cjs'
import { CRON_JOB_ID_CASES } from '../../shared/cron-identity-contract.js'
import { loadShippedPlugin } from './plugin-test-harness'

// Bundle-safe drift guard for cron-job identity. The browser plugin can only
// import 'react' and '@hermes/plugin-sdk', so it carries its OWN copy of cronJobId
// (hermes-plugin/business-shell/src/helpers.js) — it can't share the Electron
// CommonJS module. Instead of comparing source text (fragile) we pin the REAL
// shipped bundle to the same cross-runtime contract the Electron copy is pinned to
// (electron/cron-identity.test.ts). Loading the artifact also catches a stale
// plugin.js. If either copy drifts from the contract, its own test fails.

describe('shipped plugin cronJobId stays in sync with the Electron canonical', () => {
  const runtime = loadShippedPlugin({})
  const pluginCronJobId = runtime.__helpers.cronJobId

  it.each(CRON_JOB_ID_CASES)('bundle satisfies the shared contract: $label', ({ job, id }) => {
    expect(pluginCronJobId(job)).toBe(id)
  })

  it.each(CRON_JOB_ID_CASES)('bundle agrees with the Electron copy: $label', ({ job }) => {
    expect(pluginCronJobId(job)).toBe(electronCronJobId(job))
  })
})
