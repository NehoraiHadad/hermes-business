// Cross-runtime cron-identity contract. The SAME scheduler job is exposed with
// different identity keys per Hermes door (REST/disk `id`, RPC `job_id`, human
// `name`), so cronJobId must normalize identically on BOTH surfaces that own a
// copy of it:
//   - Electron main / Node probes      -> electron/cron-identity.cjs (CommonJS)
//   - Rollup-bundled Hermes Desktop UI -> hermes-plugin/business-shell/src/helpers.js
// The two runtimes can't share one module (CJS vs. an ESM file bundled into the
// single-file plugin), so instead of trusting fragile duplication both are pinned
// to THIS one table. electron/cron-identity.test.ts checks the CJS copy and
// src/lib/plugin-cron-identity.test.ts checks the real shipped bundle against it,
// so a drift on either side fails a focused test.

// { job, id }: cronJobId(job) must equal id on every surface.
export const CRON_JOB_ID_CASES = [
  { label: 'prefers the canonical REST/disk id', job: { id: 'a1b2c3d4e5f6', job_id: 'a1b2c3d4e5f6', name: 'nightly brief' }, id: 'a1b2c3d4e5f6' },
  { label: 'falls back to the RPC job_id (cron.manage shape)', job: { job_id: 'a1b2c3d4e5f6', name: 'nightly brief' }, id: 'a1b2c3d4e5f6' },
  { label: 'falls back to the human name', job: { name: 'nightly brief' }, id: 'nightly brief' },
  { label: 'null for an empty job', job: {}, id: null },
  { label: 'null for a null job', job: null, id: null }
]
