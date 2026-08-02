# Acceptance evidence (tracked, redacted)

Small, machine-readable evidence envelopes for the acceptance surfaces, reduced
from real E2E and live-probe runs. These are **tracked** and deliberately tiny: only scalar
booleans / counts / enums survive the reduction. No raw logs, prompts, chat
content, usernames, tokens, absolute user paths, emails or binaries are stored —
`scripts/lib/evidence.mjs` runs every string through `sanitize` (secrets +
emails) and `redactPaths` (home/temp/drive paths) as a backstop.

## Files

- `schema.json` — JSON Schema for every envelope (including `subject_scheme` +
  `subject_fingerprint`).
- `shared-state.json` — **passed** installed-Hermes shared-state E2E
  (`e2e-hermes-shared-state.mjs`, provider-free) against a **throwaway**
  `HERMES_HOME`: shared Session, Scheduler, Skill and Plugin state, with the live
  profile byte-untouched.
- `thin-installer.json` — **passed** hermetic thin network installer
  (`e2e-thin-network-installer.ps1`): download → SHA-256 → safe-extract.
- `approval.json` — **passed** against the current attested packaged build. It proves
  the approval wiring (the
  companion wrapper delegates to the official `approval.respond`; no competing
  engine) **and** the live denial probe against the isolated packaged runtime.
  Produced by `e2e-installed-isolated.mjs`.
- `packaged-e2e.json` — **passed** against the current attested packaged build. It proves the packaged
  companion boots against an isolated, harness-owned temp `HERMES_HOME`, the
  isolated session count is 0, the live profile is unchanged, and teardown leaves
  no residual. Produced by `e2e-installed-isolated.mjs`.
- `telegram.json` — **passed** from a redacted live native-Hermes round trip.
  It proves a valid bot, polling with no competing webhook, inbound delivery to
  Hermes and an outbound agent reply. The wrapper owns no Telegram policy or
  transport. The pass-proof rule enforces the no-conflict / no-mutation /
  single-chat invariants over the scalar-only reduction.

## Real-loader proof (opt-in, passing — no committed envelope)

The `shared-state` envelope's plugin-loading step runs a **unit contract harness**
(`scripts/lib/probes/hermes/contract-harness.mjs`) that *models* the Hermes
runtime-loader — it is never accepted as proof that the **real** renderer loads
the plugin. Two real anchors cover that instead:

- `verify:plugin` (`scripts/verify-plugin.mjs`) checks every SDK symbol / `host`
  door / `PluginContext` method / contribution area / loader-discovery fact our
  `plugin.js` relies on against the **installed Hermes 0.19.1 Desktop source**,
  or against the checked-in real-source snapshot
  (`scripts/hermes-desktop-contract.json`, `npm run gen:hermes-contract`) on a
  clean machine. `verify:plugin:release` additionally requires the real source
  and a byte-for-byte (sha256) snapshot match. These changed files now sit in the
  `approval` + `shared-state` subject sets, so a contract/verifier edit
  invalidates those passes until recaptured.
- `scripts/e2e-real-loader.mjs` (`npm run test:e2e:real-loader`,
  `HERMES_BUSINESS_REAL_LOADER=1`) launches the real installed Hermes Desktop
  against a fully-isolated throwaway sandbox (allowlisted child env re-homing every
  home/cache/config var; `hermes://` protocol subtree snapshot/restored byte-exact
  via a durable, crash-recoverable backup; owned descendants reaped by identity;
  exact temp root removed). It seeds a PAUSED cron job and PROVES the paused-
  inclusive companion door surfaces it, then separates two claims: the loader
  **CONTRACT** (contributions rendered) and the user-path **CLICK-PATH acceptance**
  (a real user-input path navigates/opens the tab).
  - Latest hardened run (installed Hermes 0.19.1): the run now **passes end to end**
    (`ok:true`, exit 0). The loader CONTRACT passes, the seeded paused row renders
    through the companion backend (no active-only fallback), and user-path
    acceptance is reached through a genuine **keyboard** path — not force/dispatch/
    hash. It tries a normal sidebar pointer click first (short budget, so it
    auto-upgrades to `sidebar-pointer` if the environment ever makes it hittable),
    then the official **Ctrl+K command palette** → type `לעסק` → the plugin's
    contributed `business.open` (PALETTE_AREA) row auto-highlights → **Enter** runs
    `host.navigate('/business')`; the Automations (`משימות`) tab is then opened by
    keyboard **Enter**. The earlier "pointer intercepted by a `data-sidebar="group"`
    overlay" was **not** a proven Hermes product bug: the root cause is
    Playwright/Electron synthetic-pointer coordinate behavior under a non-unity
    `devicePixelRatio` (~0.9), which offsets the hit-test to a full-size ancestor
    for two unrelated widgets alike (a tooling/DPR artifact, not per-widget CSS);
    keyboard input is coordinate-free and drives the real affordances reliably.
    This is a **test-run PASS, not committed release evidence**: the script prints
    `ok:true` but deliberately writes **no** envelope — there is no `real-loader.json`
    and `capture-evidence.mjs` has no real-loader path, so this proof is kept
    separate from the public-release evidence set. The hash-router / `dispatchEvent`
    fallbacks stay diagnostic-only; if both official input paths ever fail, the run
    fails closed as a blocked user-path (never a contract-only pass). Registry
    restore verified byte-exact, zero owned survivors, no temp residue, no
    live-profile access.

## Regenerate

```powershell
# safe, isolated suites
$env:HERMES_E2E_NO_LLM = '1'; node scripts/e2e-hermes-shared-state.mjs > raw-shared.json
node scripts/capture-evidence.mjs shared-state raw-shared.json

npm run package:thin-installer:qa > raw-thin.json   # emits JSON on stdout
node scripts/capture-evidence.mjs thin-installer raw-thin.json

# packaged companion, isolated runtime + REAL approval deny (needs the built
# win-unpacked exe; point HERMES_BUSINESS_EXE at it). Emits the raw JSON report.
$env:HERMES_BUSINESS_EXE = "...\release\win-unpacked\תכל'ס.exe"
$env:HERMES_BUSINESS_E2E_APPROVAL = '1'
node scripts/e2e-installed-isolated.mjs > raw-iso.json
node scripts/capture-evidence.mjs packaged-e2e raw-iso.json
node scripts/capture-evidence.mjs approval --isolated raw-iso.json

# telegram.json has no scripted capture: it is hand-reduced and redacted from a
# manual live probe (never touching live config/env), then held to the same gate.

# verify schema + redaction + version/commit correspondence + pass-proof gate
npm run verify:evidence
```

## Subject fingerprint (git_state-independent freshness)

Git provenance alone left a gap: a `working-tree` envelope only needed its
`git_head` to be a reachable base, so **stale uncommitted evidence could pass as
current** even after the code it attests changed. The subject fingerprint closes
this.

`scripts/lib/subject-registry.mjs` is the single declarative registry mapping
each category to the exact repository files it attests (`EVIDENCE_SUBJECTS`), and
the complete packaged-source input set of a release artifact (`PACKAGED_INPUTS`).
The sets are split **by purpose**, not by directory:

- `APP_RUNTIME_INPUTS` — the sources that actually ship inside the artifact.
- `BUILD_PIPELINE_INPUTS` — the scripts that deterministically transform / sign /
  attest those bytes (`scripts/after-pack.cjs`, `scripts/build-plugin.mjs`, the
  build-attestation generator + lib). `PACKAGED_INPUTS = APP_RUNTIME + BUILD_PIPELINE`,
  so a build-transform change invalidates a prepared artifact too.
- `THIN_INSTALLER_INPUTS` — every implementation + contract/probe source that makes
  the thin-installer evidence meaningful: the NSIS script, the bootstrap scripts,
  the whole `installer/lib/**` library, the build/verify scripts, the hermetic
  thin-installer + NSIS-contract harnesses with their `scripts/lib/**.ps1` helpers,
  and `hermes-compat.json` (release compatibility is decided against it).

At capture, `buildEnvelope` stamps `subject_scheme` + a deterministic
`subject_fingerprint` (repo-relative POSIX paths, per-file content sha256, sorted,
`scripts/lib/subject-hash.mjs`). At verify, `checkSubjectFreshness`
(`scripts/lib/evidence-subject.mjs`) recomputes it over the working tree and
requires equality for any `passed` envelope — **regardless of `git_state`**.

- Relevant drift (a subject file changed) → mismatch → the pass is rejected with
  the category's recapture hint.
- `docs/evidence/*` is in **no** subject set, so refreshing the evidence itself
  never self-invalidates.
- A missing/unreadable subject, an unknown category, or a `passed` envelope
  lacking a valid `subject_fingerprint`/current `subject_scheme` (e.g. legacy
  evidence) **fails closed** — it can never masquerade as current.

## Provenance rule (git_state × git_head)

`git_state` is `working-tree` when captured before committing the changes under
review; it flips to `committed` once the evidence is captured from a clean tree.
Correspondence (`scripts/lib/git-provenance.mjs`) then classifies how the
recorded `git_head` relates to the current `HEAD`:

- **committed** stays valid only when `git_head` **is** `HEAD`, or when every
  commit from `git_head` to `HEAD` touches **only** durable evidence envelopes
  (`docs/evidence/*.json`). This resolves the refresh paradox: committing the
  envelopes themselves advances `HEAD` yet keeps them valid, while **any**
  code / config / app / Hermes-compat change since `git_head` invalidates them
  and forces a re-capture. The allowlist is intentionally narrow — the
  `forensics/` subdir and prose docs are excluded so anything outside the
  machine-checked envelopes fails closed.
- **working-tree** records an uncommitted snapshot, so `git_head` is only a
  *base*: it must be `HEAD` or a real ancestor. A bogus, stale, or non-ancestor
  head now fails closed (previously working-tree skipped the check entirely).
