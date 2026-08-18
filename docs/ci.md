# CI/CD — the verification mechanism and the deliberate local/remote split

Added 2026-08-18. Three workflows under `.github/workflows/`:

| Workflow | Trigger | What it proves |
|---|---|---|
| `ci.yml` | push to `master` / PR (code paths only) | The repo is **self-contained on a clean machine**: vitest unit suite + `tsc -b` + plugin SDK contract (Node 22), installer library suite under real **PowerShell 5.1** (`verify-bootstrap.ps1`), and the three Python plugin suites (policy / dashboard / community-archive) |
| `release-tag-guard.yml` | `v*` tag push | The public anchor is coherent: tag name == `package.json` version on the tagged commit (`scripts/verify-version-tag.mjs`, read-only) — the automated half of `docs/RELEASING.md` step 7 |
| `pages.yml` | `site/**` push | Deploys the public info site (pre-existing) |

## What CI adds over the local loop

Local runs prove the *dev machine* is healthy; CI proves the *repository* is.
It catches exactly the failure classes this project has already hit locally:
files missing from git, PSModulePath/module-autoload assumptions, encoding
assumptions, and "someone pushed without running the suite". The live
installed-Hermes probes in the Python suites self-skip on a machine with no
engine (`unittest.skipIf`), and `verify:plugin` falls back to the committed
`scripts/hermes-desktop-contract.json` snapshot — so a clean runner exercises
every deterministic gate and none of the machine-bound ones.

## What deliberately stays LOCAL (this is a design decision, not a gap)

The release pipeline (`npm run package:win:pilot` / `:public`) does not run in
CI. Its exact-artifact stage launches the **packaged** app under Playwright
against a real installed Hermes engine (`%LOCALAPPDATA%\hermes\hermes-agent`),
an isolated `HERMES_HOME`, and a live gateway, then machine-writes the
build-bound evidence envelopes (`build_nonce` / `release_binding_digest` /
`installer_sha256`). That contract is machine-bound **on purpose** — evidence
must be captured, never fabricated, and a GitHub-hosted runner has no engine to
capture it from. Releases follow `docs/RELEASING.md` by hand (or by the local
orchestrator); the tag push then triggers the guard workflow automatically.

If release frequency ever justifies full "tag ⇒ build" automation, the path is
a **self-hosted Windows runner** with a provisioned Hermes engine — the
contract's requirements stay identical; only the machine changes. Do not try to
port the evidence capture to a hosted runner by weakening the contract.

## Cost guards (GitHub Actions minutes)

- Windows runners bill at a 2× multiplier — the same cost-awareness as the
  Vercel guardrails applies.
- `concurrency` with `cancel-in-progress` kills superseded runs per ref.
- `paths-ignore` skips CI entirely for docs/site/promo/markdown-only pushes.
- Every job carries a `timeout-minutes` ceiling so a hung run cannot burn the
  monthly quota.
- The tag guard runs on `ubuntu-latest` (1× billing) — it needs only git+node.

## Reading a red CI

- `unit` red on CI but green locally → a clean-machine assumption leaked in
  (missing file from git, snapshot drift, env dependency). That is CI doing its
  one job — fix the assumption, don't special-case the runner.
- `installer` red → PS 5.1 behavior differs from your shell (the 5.1 engine is
  what both install doors run; local pwsh7 green does not count).
- `release-tag-guard` red → the tag was cut on the wrong commit or the version
  was not bumped first; delete the tag, fix, re-tag (`docs/RELEASING.md`).
