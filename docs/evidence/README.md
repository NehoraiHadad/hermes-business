# Acceptance evidence (tracked, redacted)

Small, machine-readable evidence envelopes for the acceptance surfaces, reduced
from real E2E and live-probe runs. These are **tracked** and deliberately tiny: only scalar
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
- `telegram.json` — **passed.** Redacted live Telegram diagnosis from a manual
  live probe (`hermes-send` + `getWebhookInfo`/`getMe`), hand-reduced to scalars:
  official polling is healthy, the bot token is valid, and Hermes is the **sole
  poller** with **no** webhook conflict. A historical inbound update **reached
  Hermes** and was blocked only because the sender was not authorized at that send
  time; the current allowlist authorizes the sender, with **no** config/env
  mutation. Exactly **one** benign connectivity-test reply was delivered to the
  home channel via the official Hermes send (WhatsApp/Google untouched, 0 other
  chats touched). It deliberately does **not** claim a fresh post-authorization
  user→agent→reply round trip — that remains a manual step. The `telegram`
  pass-proof rule in `scripts/lib/evidence-gates.mjs` enforces the
  sole-owner / no-webhook / no-mutation / single-send invariants.

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

# telegram.json has no scripted capture: it is hand-reduced and redacted from a
# manual live probe (never touching live config/env), then held to the same gate.

# verify schema + redaction + version/commit correspondence + pass-proof gate
npm run verify:evidence
```

`git_state` is `working-tree` when captured before committing the changes under
review; it flips to `committed` (and `git_head` must equal `HEAD`) once the
evidence is captured from a clean tree.
