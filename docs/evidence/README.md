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
  Machine-written by the exact-artifact stage (`scripts/e2e-exact-artifact.mjs`)
  from an `e2e-installed-isolated.mjs` run.
- `packaged-e2e.json` — **passed** against the current attested packaged build. It proves the packaged
  companion boots against an isolated, harness-owned temp `HERMES_HOME`, the
  isolated session count is 0, the live profile is unchanged, and teardown leaves
  no residual — and binds the tested build (`build_nonce`,
  `release_binding_digest`, `installer_sha256`). Machine-written by the
  exact-artifact stage (`scripts/e2e-exact-artifact.mjs`) from an
  `e2e-installed-isolated.mjs` run.
> **Retired category — `telegram`** (removed 2026-08-18). It attested a live
> round trip through the NATIVE Hermes gateway — the engine's own mechanism, not
> this wrapper's code. Since commit 88fb302 the wrapper owns no Telegram policy
> or transport (its only surface is the guided connect flow over the official
> `/api/messaging` endpoints, covered by unit tests), so re-proving the engine
> contradicted the wrapper principle. A leftover `telegram.json` is rejected by
> the verifier as an unknown category.

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

# thin-installer. `npm run package:thin-installer:qa > raw-thin.json` does NOT
# emit JSON: npm's banner, build:plugin's own line and the harness's
# `== Case N: ... ==` progress (Write-Host, which lands on stdout once stdout is
# redirected) all share that stream, so the file is a mixed log with the report
# at the END. capture-evidence survives it only because scripts/lib/json-input.mjs
# strips a BOM and rescans backwards for the final JSON object — a rescue that
# breaks the instant anything prints AFTER the report, and that no other tool
# (jq, ConvertFrom-Json, JSON.parse) performs. `npm run --silent` does not fix it
# either: it drops npm's banner only, not the child processes' output.
# So capture the report itself. -File below is simply what the npm script uses;
# `-Command "& .\scripts\...ps1"` now works too. It used to be a hard requirement:
# -Command runs the harness in a child scope, and the zip install action's
# GetNewClosure() scriptblock resolved commands through its own module scope ->
# GLOBAL only, so it lost the dot-sourced installer/lib helpers and died on
# `Expand-ArchiveSafely : The term ... is not recognized`. The action now carries
# that helper in as a captured command object (installer/bootstrap-companion.ps1),
# so either entry form completes.
npm run build:plugin
$thin = powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/e2e-thin-network-installer.ps1 -EmitQaArtifact
$report = $thin[[array]::LastIndexOf([object[]]$thin, '{')..($thin.Count - 1)]
# WriteAllLines, not Set-Content/Out-File -Encoding utf8: PowerShell 5.1 prepends
# a UTF-8 BOM, which strict parsers reject. The report is the tail starting at the
# only unindented `{`.
[System.IO.File]::WriteAllLines("$PWD\raw-thin.json", [string[]]$report)
node scripts/capture-evidence.mjs thin-installer raw-thin.json

# packaged-e2e + approval: BOTH are machine-written ONLY by the exact-artifact
# stage (scripts/e2e-exact-artifact.mjs) inside the package pipeline. It measures
# the immutable candidate installer (installer_sha256 + build_nonce +
# release_binding_digest) and binds those into the envelope — fields
# requirePassProof demands ("must bind the tested build"). A plain
# `e2e-installed-isolated.mjs | capture-evidence.mjs packaged-e2e -` pipe mints
# an UNBOUND passed envelope the verifier rejects — do not use it.
$env:HERMES_BUSINESS_E2E_APPROVAL = '1'
npm run package:win:qa


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
