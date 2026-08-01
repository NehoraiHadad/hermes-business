# Acceptance evidence (tracked, redacted)

Small, machine-readable evidence envelopes for the acceptance surfaces, reduced
from real E2E runs. These are **tracked** and deliberately tiny: only scalar
booleans / counts / enums survive the reduction. No raw logs, prompts, chat
content, usernames, tokens, absolute user paths, emails or binaries are stored —
`scripts/lib/evidence.mjs` runs every string through `sanitize` (secrets +
emails) and `redactPaths` (home/temp/drive paths) as a backstop.

## Files

- `schema.json` — JSON Schema for every envelope.
- `shared-state.json` — installed-Hermes shared-state E2E against a **throwaway**
  `HERMES_HOME` (`e2e-hermes-shared-state.mjs`, provider-free), including the
  business-shell desktop plugin install → discover → enable → shared-state →
  provider-free route render → uninstall-clean lifecycle.
- `thin-installer.json` — hermetic thin network installer
  (`e2e-thin-network-installer.ps1`): download → SHA-256 → safe-extract, with the
  full fail-closed case matrix, all in an isolated temp root over loopback.
- `approval.json` — **passed.** Approval wiring proven (the companion wrapper
  delegates to the official `approval.respond`; no competing engine) **and** the
  live denial probe now runs safely against the isolated packaged runtime: a real
  `approval.request` event is denied via `approval.respond {choice:'deny'}` with no
  side effect. Produced by `e2e-installed-isolated.mjs`.
- `packaged-e2e.json` — **passed.** The packaged companion boots against an
  isolated, harness-owned temp `HERMES_HOME` on an isolated high loopback port via
  the main-process-only QA runtime override (`electron/qa-runtime.cjs`): the
  runtime reports `mode=qa-isolated`, the isolated session count is 0, the temp
  home is populated, the live profile's defining state is unchanged, and teardown
  leaves no residual process / dir / port. Produced by `e2e-installed-isolated.mjs`.

## Regenerate

```powershell
# safe, isolated suites
$env:HERMES_E2E_NO_LLM = '1'; node scripts/e2e-hermes-shared-state.mjs > raw-shared.json
node scripts/capture-evidence.mjs shared-state raw-shared.json

npm run package:thin-installer:qa > raw-thin.json   # emits JSON on stdout
node scripts/capture-evidence.mjs thin-installer raw-thin.json

# packaged companion, isolated runtime + REAL approval deny (needs the built
# win-unpacked exe; point HERMES_BUSINESS_EXE at it). Emits the raw JSON report.
$env:HERMES_BUSINESS_EXE = '...\release\win-unpacked\העוזר לעסק.exe'
$env:HERMES_BUSINESS_E2E_APPROVAL = '1'
node scripts/e2e-installed-isolated.mjs > raw-iso.json
node scripts/capture-evidence.mjs packaged-e2e raw-iso.json
node scripts/capture-evidence.mjs approval --isolated raw-iso.json

# verify schema + redaction + version/commit correspondence + pass-proof gate
npm run verify:evidence
```

`git_state` is `working-tree` when captured before committing the changes under
review; it flips to `committed` (and `git_head` must equal `HEAD`) once the
evidence is captured from a clean tree.
