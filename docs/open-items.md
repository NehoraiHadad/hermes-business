# Open items — known, not fixed

Everything here was **found and verified**, then deliberately left alone. Nothing
in this file is a guess or a "might be nice"; each entry names the file, what is
wrong, and what closing it would take.

The point of the file is that a finding is worthless if it only exists in the
conversation that produced it. Anything that gets fixed should be **deleted from
here**, not ticked — a list of crossed-out items rots into noise.

Last reviewed: 2026-08-18 (after v0.4.0-alpha.11).

---

## 1. The installer sends no `Authorization` to GitHub — the real cause of CI flakes

**Where:** `installer/lib/ReleaseSelection.ps1` → `Get-GitHubApiHeaders` (~line 96),
`.github/workflows/ci.yml` (the `installer` job).

`Get-GitHubApiHeaders` sends only `User-Agent` + `Accept`. No token support exists
anywhere in `installer/`, and CI passes none. Unauthenticated api.github.com allows
**60 requests/hour PER IP**, shared across everyone on that IP — and
`Resolve-LatestCompatibleRelease` makes **1 + N** requests: one release list, then
one `contents/hermes_cli/__init__.py` read *per candidate release*, up to 100 with
`per_page=100`. On a shared `windows-latest` runner that is the structural reason
the external probe flakes.

This is now an **optimisation, not a correctness bug**: as of v0.4.0-alpha.11 a rate
limit is correctly identified, reported with its reset time, and swallowed by the CI
external gate. It reddened CI once (run 32149075429) before those two fixes.

**To close:** opt-in `Authorization: Bearer` from `$env:GITHUB_TOKEN`/`$env:GH_TOKEN`
in `Get-GitHubApiHeaders`, plus `env: GITHUB_TOKEN: ${{ github.token }}` on the CI
step — 60 → 1000 req/hr, no behaviour change for end users who have no token.
Cheaper secondary option, no secret required: have the resolver stop at the first
in-range release instead of resolving every tag, which cuts N sharply.

## 2. `e2e-thin-network-installer.ps1` cannot be invoked with `-Command`

**Where:** `installer/bootstrap-companion.ps1` (~line 77).

The zip install action is a `.GetNewClosure()` scriptblock. Invoked in a child scope
it loses the dot-sourced `installer/lib` helpers and the run dies with
`Expand-ArchiveSafely : The term ... is not recognized`. Only `-File` works, which is
what the npm script happens to use — so the trap is latent rather than active.

`docs/evidence/README.md` now documents that `-File` is required and why, so nobody
is currently blocked. But the closure genuinely does not carry its dependencies, and
the next caller that reaches for `-Command` will hit it.

**To close:** make the scriptblock capture what it needs, or dot-source the helpers
inside it.

## 3. `verify-release-contract.mjs`'s header comment is false

**Where:** top of `scripts/verify-release-contract.mjs`.

It claims *"This is the gate `package:win` runs BEFORE electron-builder."* It does
not. Stage 1 is `npm run verify:release` = `npm test && test:evidence &&
test:plugin:policy && test:plugin:community && verify:plugin:release &&
verify:bootstrap`. The contract preflight never runs there — it runs inside stage 12
(`finalize-release.mjs`).

That stale sentence is precisely why dirty inputs surface only after a full build:
a reader believes they were already checked.

**To close:** correct the comment. Optionally reconsider whether a cheap
`dirty-inputs` check belongs in stage 1, where it would cost seconds instead of a
whole build.

## 4. `RELEASING.md` step 6 references a file nothing writes

Step 6 still says "(and `build/lock-attest.json` → `release/lock-attest.json` if not
already tracked as expected)". No code writes `build/lock-attest.json`;
`gen-lock-attest.mjs` writes `release/lock-attest.json` only, and `/release/` is
gitignored, so it can never be tracked. The parenthetical is unactionable.

## 5. The recapture hint steers back to the broken command

**Where:** `RECAPTURE['thin-installer']` in `scripts/lib/subject-registry.mjs`.

It is what the verifier prints at an operator when the envelope is stale, and it
still says `npm run package:thin-installer:qa then ... capture-evidence ... <raw>`.
Not false — it makes no claim about stdout — but it points at the path
`docs/evidence/README.md` now warns about (that redirect produces a mixed log, not
JSON; see item 2's neighbour in that file).

**To close:** point the hint at the documented command.

## 6. `release/` holds orphan blockmaps

`.blockmap` files for alpha.1 … alpha.10 plus a pre-D3 Hebrew-named
`תכל'ס Setup 0.4.0-alpha.1.exe.blockmap`. Harmless — nothing reads blockmaps, and
only `.exe` files are measured — but it makes the directory misleading to read, and
`release/` is exactly where a release operator looks to confirm what is about to
ship.

## 7. Residual: a gateway could respawn between the probe and the restart

**Where:** `electron/hermes-update-flow.cjs`, post-rollback path.

The post-rollback stop is now verified with the authoritative `officialGatewayState()`
(anything other than `stopped`, including `unknown`, fails closed). But that reader is
a point-in-time probe: a gateway respawning *between* the probe and
`ensureGatewayBackground` would still be missed.

Judged not a live gap — nothing in this flow can spawn one there, since the scheduled
task / login item only fires at logon. Recorded because the reasoning, not the code,
is what makes it safe, and that reasoning could stop holding.

## 8. No code-signing certificate (F3)

The installer is unsigned and Windows vouches for nothing about it; SmartScreen warns
on first install. The whole certless trust design
(`docs/specs/versioning.md` §7.3–§7.5) exists because of this.

A certificate would remove the first-install warning and unblock the electron-updater
path (§10.2). It is a **purchase**, not a code task: money plus business-identity
verification with a certificate authority.

## 9. No revocation for the update signing keys

`electron/update-trust.cjs` ships a primary and a reserve key. Adding the reserve lets
us sign again if the primary is lost or stolen — it **cannot** make already-installed
apps stop trusting a stolen primary. Stated in `docs/specs/versioning.md` §7.4 rather
than implied away.

Acceptable at pilot scale. With a real user base this needs a separate mechanism (a
signed minimum-version floor, or a revoked-id list) — and neither it nor its
distribution path exists today.

**User action, still outstanding:** the reserve private key
(`%USERPROFILE%\.tachles-release\update-signing-key-backup.pem`) is meant to live
OFFLINE and away from the build machine. While it sits next to the primary, one
machine compromise takes both and the reserve has bought nothing. It protects against
LOSS either way.

## 10. SmartScreen App Reputation is unmeasured

Installing on this machine never triggered a SmartScreen block, but the installer was
launched from a local path / our own download, so the absence of a Mark-of-the-Web is
consistent with that and proves nothing about a browser download on a machine that has
never seen Tachles. Settling it needs a freshly-imaged machine and a browser download.

## 11. Channel toggle (F6) — deliberately NOT built

Recommended against, recorded so it is not re-proposed without the argument.

An alpha install already sees BOTH prereleases and stable releases; a stable install
never sees prereleases (`scanReleases` in `electron/companion-update-core.cjs`). After
a 1.0.0 ships, the next alpha would be 1.1.0-alpha.1 — higher by SemVer — so testers
keep receiving alphas with no toggle at all. The only want it serves is a tester
moving to stable-only, which one manual install already achieves.

So it solves nothing today and cannot be meaningfully tested today. Building it and
calling it working would violate the rule the rest of this repo runs on.

---

## Process note: the site must move with each release

`site/index.html`'s static download href is pinned by
`site/download-link.test.mjs` to the newest entry in `release-ledger.json`. So
updating the ledger in RELEASING step 10 turns that test red until the site follows,
and both belong in the same commit. That is intended — the static href is what a
visitor gets when GitHub is unreachable or rate-limited, and letting it lag is how the
fallback quietly stops being current. Noted here because it is a real step someone
will otherwise meet as a surprise CI failure.
