# Open items — known, not fixed

Everything here was **found and verified**, then deliberately left alone. Nothing
in this file is a guess or a "might be nice"; each entry names the file, what is
wrong, and what closing it would take.

The point of the file is that a finding is worthless if it only exists in the
conversation that produced it. Anything that gets fixed should be **deleted from
here**, not ticked — a list of crossed-out items rots into noise.

Last reviewed: 2026-08-18, after closing every item that was a code task. What
remains cannot be closed by editing this repository: a residual whose safety
rests on reasoning rather than on code, a certificate that has to be bought, a
key-revocation mechanism that only becomes meaningful past pilot scale (plus one
action that is yours, not the code's), a measurement that needs a clean machine,
and one decision recorded so it is not re-proposed without its argument.

---

## 1. Residual: a gateway could respawn between the probe and the restart

**Where:** `electron/hermes-update-flow.cjs`, post-rollback path.

The post-rollback stop is now verified with the authoritative `officialGatewayState()`
(anything other than `stopped`, including `unknown`, fails closed). But that reader is
a point-in-time probe: a gateway respawning *between* the probe and
`ensureGatewayBackground` would still be missed.

Judged not a live gap — nothing in this flow can spawn one there, since the scheduled
task / login item only fires at logon. Recorded because the reasoning, not the code,
is what makes it safe, and that reasoning could stop holding.

## 2. No code-signing certificate (F3)

The installer is unsigned and Windows vouches for nothing about it; SmartScreen warns
on first install. The whole certless trust design
(`docs/specs/versioning.md` §7.3–§7.5) exists because of this.

A certificate would remove the first-install warning and unblock the electron-updater
path (§10.2). It is a **purchase**, not a code task: money plus business-identity
verification with a certificate authority.

## 3. No revocation for the update signing keys

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

## 4. SmartScreen App Reputation is unmeasured

Installing on this machine never triggered a SmartScreen block, but the installer was
launched from a local path / our own download, so the absence of a Mark-of-the-Web is
consistent with that and proves nothing about a browser download on a machine that has
never seen Tachles. Settling it needs a freshly-imaged machine and a browser download.

## 5. Channel toggle (F6) — deliberately NOT built

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
