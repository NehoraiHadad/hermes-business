# Forensic report — QA isolated approval run mutated the live Hermes profile

**Status:** live profile mutated by a failed QA run. **No auto-restore performed**
(no exact before-byte snapshot exists). Mutations are benign / safe-direction.
Paths are shown relative to `<LOCALAPPDATA>\hermes`; no config contents,
credentials or absolute user paths are reproduced.

## Root cause

`HERMES_BUSINESS_E2E_APPROVAL=1 npm run test:e2e:installed-isolated` reported
`runtime_mode=live`, `ws_on_isolated_port=false`, `isolated_session_count=72`,
`isolated_home_populated=false`, yet still ran the approval flow, and teardown
reported `live_home_untouched=false`, `live_config_unchanged=false`.

The packaged companion requested the Electron single-instance lock with the
**default userData** namespace. Electron keys that lock on the userData
directory. With the user's **live companion already running** (holding the
default-userData lock and the live gateway on port 9119), the QA launch did not
obtain an isolated runtime: the renderer ended up bound to the **live gateway on
the default port**. `runtime_mode` never left its initial `live` value, the WS
URL pointed at 9119, and `session.list` returned the live profile's 72 sessions.

The isolated script then ran the approval block **without first asserting any
isolation invariant**, so it seeded credentials, created a session, toggled
`approvals.mode`, and submitted a prompt — all against the **live** gateway.

## Live-profile changes attributed to the failed run

Window of the last failed run: boot screenshot `~22:57:46Z`, run userData dir
`~22:58:38Z` (all times UTC, 2026-07-31).

| Path (rel. `<LOCALAPPDATA>\hermes`) | Change | mtime (UTC) | Attribution |
| --- | --- | --- | --- |
| `config.yaml` | rewritten — `approvals.mode` set to `manual` by the probe's `config.set` | 2026-07-31T22:58:14Z | ours (high); concurrent live-gateway writes also touch this file |
| `state.db` | one session row created (`session.create` + denied turn) | 2026-07-31T22:58:59Z | ours (high) |
| `sessions/` (on-disk dir) | **no** structural add/remove (name-set stable, newest entry 13:26Z) | — | not structurally changed |

- **Current derived `approvals.mode` = `manual`** (safe direction — more
  prompting, never less). This matches the value the probe writes.
- **config.yaml** — size 5663, sha256 `55a689bb…2f9128` (current/after). The
  before-marker retained only a sha256 fingerprint, **not the bytes**.
- The guarded command never executed: the approval was **denied** and the turn
  interrupted; the probe target file is **absent**. No side-effect ran.

## Why no restore was performed

Restoration was **withheld** and is the correct call:

1. **No exact before-byte snapshot exists.** The harness before-marker is a
   sha256 + name/size inventory, not the original `config.yaml` bytes. No
   `.bak`/snapshot/history artifact was found anywhere under the live home,
   `state`, `logs`, `business`, `cache`, or `desktop`.
2. **The mutation is not conclusively isolatable.** The live gateway (PID
   confirmed listening on 9119) was writing `config.yaml` and `state.db`
   concurrently (skills snapshot, model caches, tokens refreshed in the same
   minute). Overwriting either file would risk destroying legitimate live state.
3. **The residue is benign.** `approvals.mode=manual` is the safe direction, and
   the created session is a denied, side-effect-free turn.

**Recommended manual action for the operator:** confirm `approvals.mode` is the
value you want (it is currently `manual`); optionally delete the single denied
QA session from the live history. Do **not** restore from any guessed snapshot.

## Fixes landed with this report

- Packaged app sets a QA-only Electron userData/single-instance namespace under
  the throwaway HERMES_HOME **before** `requestSingleInstanceLock()` — the live
  instance can no longer intercept a QA launch. Production is unchanged.
- Fail-fast invariants (`runtime_mode==qa-isolated`, WS on the isolated port,
  diagnostics HERMES_HOME == temp home, baseline session count == 0) abort the
  isolated run **before** any seed/prompt/approval/provider/action.
- Session counting only ever talks to the proven-isolated gateway URL.
- The harness preserves a redacted forensic report on any live mutation and
  never auto-restores.
- `docs/evidence/approval.json` and `docs/evidence/packaged-e2e.json` reverted to
  `blocked`; the evidence verifier now rejects a non-isolated / live-touched pass.

## Addendum — second corrective pass (forensic report `live-mutation-21092.json`)

A later, INDEPENDENT **non-approval** run (`HERMES_BUSINESS_E2E_APPROVAL` unset)
reported `runtime_mode=live`, `ws_on_isolated_port=false`,
`diagnostics_home_is_temp=false`, `isolated_session_count=null`,
`aborted_precondition=true`. The fail-fast gate worked: **no approval ran, no
session was created, no config was written by our run.** The preserved report
(`docs/evidence/forensics/live-mutation-21092.json`) shows the profile
inventories **byte-for-byte identical** before/after (`sessions` 2, `cron` 7,
`skills` 19, `plugins` 1) with **no structural add/remove**. Only
`config.yaml`'s sha256 moved (`55a689bb…` → `54e82428…`).

**Root cause of this run:** default executable resolution launched the **stale
installed build** at `%LOCALAPPDATA%\Programs\hermes-business` (exe mtime
2026-07-31 17:25Z) instead of the freshly rebuilt `release/win-unpacked` (exe
mtime 2026-08-01 02:16Z). The installed build predates the QA-namespace fix, so
`runtime_mode` never left `live` and the harness aborted before any query.

**Attribution of the `config.yaml` drift:** the concurrently-running **live
gateway** on port 9119 (which our aborted run never issued a write to). The
name-set/inventory stability plus a session-count-only-invariant of 0 for our
side confirm our run made no structural change.

**Restore decision:** **none.** As before, the before-marker is a sha256
fingerprint, not the original bytes, and a live gateway was writing `config.yaml`
concurrently. There is no exact before-byte snapshot, so restoration would risk
destroying legitimate live state. **No live file was modified by this corrective
pass** — the fixes below make the stale-artifact launch impossible in the first
place.

## Fixes landed with the second corrective pass

- The isolated suite now targets **only** `release/win-unpacked` of the current
  working tree via `resolvePackagedArtifact()` — **no installed-app fallback and
  no `HERMES_BUSINESS_EXE` escape hatch**, so a stale installed build can never be
  selected.
- Every prepared artifact carries an **attested manifest** (app version + source
  HEAD + a deterministic fingerprint of the packaged main-process sources + a
  per-build nonce). `verifyArtifactCurrent()` refuses to launch — **before** any
  Electron process starts — if the artifact does not correspond to current source.
- The **running** app exposes an executable QA proof (`runtimeState.qa`): the
  namespace was applied **before** the single-instance lock, and the embedded
  attestation nonce matches the pre-launch manifest. The harness reads this from
  the live binary (not source), so it proves the launched binary is the attested
  one.
- Harness output now includes `artifact_attested`, `artifact_kind:
  win-unpacked-current` and `qa_namespace_applied`; the evidence verifier requires
  all three (and `artifact_kind === win-unpacked-current`) for a `packaged-e2e` or
  `approval` pass.
- New prepare command `npm run build:test-packaged` (electron-builder `--win dir`
  + attestation); the isolated test **requires** it and fails fast with a clear
  message if the artifact is missing or stale.
- Regression coverage (`scripts/lib/build-attestation.test.mjs`): a stale build
  (source drifted from the artifact) is rejected before launch; resolution never
  returns an installed path.
