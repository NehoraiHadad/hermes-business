# Windows release contract (fail-closed, hardened)

The release pipeline is a **state verifier**, not a packager that hopes for the
best. Every artifact we would ship must *prove* it corresponds to the source that
is checked out, that its manifest/report/checksums/attestation/acceptance agree,
that the installer is bound to the manifest actually inside its own payload, that
the required acceptance evidence is fresh, passed and captured against **this**
build, that it carries no leaked tests/caches or path-traversal entries, that the
version was not already published as different bytes, and — for a public **or
pilot** build — that every distributable EXE is signed by an approved publisher
and verifies under `signtool verify /pa /tw` — **except** pilot, which is the one
deliberate, disclosed exception to that last clause (see "Channels" below).
Anything short of that **fails closed**: the pipeline stops and nothing official
is over-written.

This document describes the contract. It does **not** assert any currently-blocked
evidence has passed; the current stale artifact is an honest failure.

## Channels

Three `--channel` values, orthogonal to the app's own SemVer
(`docs/specs/versioning.md` D1). Grouping lives in ONE place —
`scripts/lib/release/channel-policy.mjs` — never re-derived ad hoc:

| Channel | Renderer build | Distributable? | Signing | Ledger / lock-attest / binding-chain rigor | Thin-installer + telegram |
|---|---|---|---|---|---|
| `public` | `npm run build` (real, demo stripped) | Yes | REQUIRED (approved publisher, RFC3161 timestamp) | REQUIRED | REQUIRED `passed` |
| `pilot` | `npm run build` (real, demo stripped) — **never** `build:qa` | **Yes** (Alpha prerelease, disclosed) | Tolerated unsigned (no cert yet); SmartScreen + SHA256SUMS advisory | REQUIRED — same as public | May stay honest blockers (like qa) |
| `qa` | `npm run build:qa` (`--mode qa`, demo transport baked in) | No (`…DO-NOT-DISTRIBUTE`) | Tolerated unsigned | Tolerated absent (`UNVERIFIED`) | May stay honest blockers |

`pilot` (docs/specs/versioning.md §13 stage 5) exists for one reason: hand outside
testers a REAL build — not the qa build with fabricated demo data — while there is
still no code-signing certificate. It is full-rigor everywhere EXCEPT signing, and
the preflight gate independently proves the renderer really was a production
build: `gen-build-attestation.mjs` scans the compiled `dist/` bundle for the
demo-fixture-strip stub text (`scripts/strip-demo-fixtures.mjs`) and records
`build_mode: 'production'|'qa'|'unknown'` in `build/build-attestation.json` — a
fact detected from bytes on disk, never trusted from the `--channel` argument a
caller happened to pass. `preflightRelease` fails a pilot release closed
(`pilot-qa-mode-build`) unless that fact reads `'production'`. The **public**
channel's gates are untouched by all of this — every `channel === 'public'` check
in the codebase evaluates identically to before pilot existed.

## Binding chain (no circular digest)

An installer cannot contain its own hash, so the binding is split in two:

1. **Embedded manifest** — `gen-release-manifest.mjs`, invoked from
   `after-pack.cjs` *during* packing (after `app.asar` is built, **before** NSIS
   compression) writes `win-unpacked/resources/release-manifest.json` so it is
   genuinely inside the installer, not a loose win-unpacked side file. It binds the
   `app.asar` hash, the embedded attestation facts (incl. `build_nonce`), the
   per-category evidence digests and version/commit/subject. Its digest is over the
   manifest **body only**.
2. **Release report** — `gen-release-report.mjs` (post-package) binds the manifest
   digest to the measured installer bytes:
   `release_binding_digest = sha256(manifest_digest ∥ installers)`. The installer
   contains the manifest and the report binds the installer bytes, so tampering
   either side breaks the report. `verifyReleaseReport` recomputes both digests and
   re-checks the bytes on disk (TOCTOU).
3. **Payload containment** — `nsis-payload.mjs` extracts the manifest from the
   installer with a 7-Zip-family tool and compares byte-for-byte.

### What can and cannot be proven

- Provable here: manifest ↔ app.asar/attestation/evidence, report tamper-evidence,
  installer-bytes ↔ report, embedded-vs-report equality, and on-disk drift/TOCTOU.
- **Not** provable without an NSIS extractor on the build machine: that the
  compressed payload *contains* the manifest. Absent an extractor,
  `payload_binding = { proven:false, reason:'no-nsis-extractor' }` and the
  **public** gate fails closed (`payload-binding-unproven`); qa labels it a
  residual. This proof is never faked.

## Deterministic pipeline order

`npm run package:win` (public) / `npm run package:win:pilot` (pilot Alpha) /
`npm run package:win:qa` (dev) — one orchestrator, `scripts/package-win.mjs`:

1. **verify source** — `verify:release`.
2. **build** — `build` (public, pilot) / `build:qa` (qa only).
3. **attest** — `gen-build-attestation.mjs` → `build/build-attestation.json`
   (independently records `build_mode` from the compiled `dist/` bundle).
4. **package** — `electron-builder --win nsis`; `after-pack.cjs` embeds the release
   manifest into the payload.
5. **inspect** — `verify-no-update-metadata.mjs`.
6. **sign** — `sign-release.mjs` signs every distributable EXE and verifies each
   with `signtool verify /pa /tw` against the publisher allowlist (public). qa
   AND pilot leave them unsigned (pilot logs an honest "Alpha prerelease, no
   certificate yet" line, not a "non-distributable" one). No certificate is
   assumed; public fails closed without one.
7. **report** — `gen-release-report.mjs` measures installers, proves payload
   containment, writes `release/release-report.json`.
8. **finalize** — `finalize-release.mjs` stages `checksums.json` / `SHA256SUMS.txt`
   / `ACCEPTANCE.md` into a symlink-verified staging dir, runs the gate over the
   **staged** checksums, and promotes all-or-nothing only after it passes and no
   installer mutated mid-run. A failed gate leaves prior official sidecars untouched.
9. **gate** — `verify-release-contract.mjs` re-verifies the promoted state.

## Read-only verifier / dry run

```
node scripts/verify-release-contract.mjs [--channel public|qa|pilot] [--no-probe]
```

Mutates nothing. Prints every honest reason a release is not ready and exits
non-zero unless the workspace is fully contract-clean for the channel.

## What the preflight rejects (all fail-closed)

| Failure code | Meaning |
|---|---|
| `dirty-inputs` | Uncommitted release input (registry-derived, incl. `package-lock.json`; `-z` parser handles renames/non-ASCII). |
| `attestation-*` | Missing/malformed/stale embedded attestation. |
| `artifact-set` | Not exactly the one expected versioned installer (extra/unparseable/wrong name). |
| `checksums-invalid` | `checksums.json` byte/hash disagrees with the binary on disk. |
| `asar-invalid` | `app.asar` missing/corrupt/incomplete (strict header + read validation). |
| `packaged-forbidden` | Shipped `app.asar` carries our tests/caches. Only the archive **root** `node_modules/` is exempt. |
| `asar-unsafe-path` | A packaged path uses a backslash, is absolute, or contains `.`/`..` (traversal). |
| `version-ledger-unavailable` / `version-reuse` | No durable prior-release ledger, or this version was already published as different bytes. |
| `evidence-unverified` / `evidence-not-passed` | `verify-evidence` failed, or a channel-required gate is not `passed`. |
| `evidence-category-absent` / `evidence-category-duplicate` | Not exactly one envelope per declared category. |
| `evidence-wrong-build` | `packaged-e2e` evidence lacks or mismatches this build's `build_nonce`/`release_binding_digest`/`installer_sha256`. |
| `release-report` | Report missing, tampered, or drifted from disk. |
| `payload-binding-unproven` | Installer↔payload containment not proven (public, pilot). |
| `lock-integrity-unattested` | No clean-install / lockfile-integrity attestation (public, pilot). |
| `unsigned-public` / `untrusted-timestamp-public` / `publisher-not-approved` | Public EXE unsigned, untimestamped, or signed by a non-allowlisted publisher. Never fires for qa/pilot — their per-item signing loop does not run. |
| `pilot-qa-mode-build` | Pilot only: the build attestation's `build_mode` fact is not `"production"` — a `build:qa` artifact can never pass `--channel pilot`. |

Public/pilot-required evidence gates: `packaged-e2e`, `approval`, `shared-state`,
`thin-installer`, `telegram` (public); pilot requires the first three, exactly
like qa, and may leave the last two as honest external blockers. `version-ledger-
unavailable` / `version-reuse` and `lock-integrity-unattested` fail closed for
BOTH public and pilot — see `scripts/lib/release/channel-policy.mjs`
(`requiresFullRigor`).

## Inputs supplied out-of-band (absent ⇒ public/pilot fails closed)

- `release-ledger.json` — durable signed / GitHub-asset prior-release ledger
  `{ source, entries: { <version>: { sha256 } } }` (version immutability),
  authenticated per-entry against `build/trust-roots.json`'s
  `github_asset_sha256` map (bidirectional lockstep — see
  `docs/RELEASING.md` steps 0 and 9, including the committed empty pair that
  bootstraps the first release).
- `build/sign-allowlist.json` — approved `{ subjects, thumbprints }`.
- `release/lock-attest.json` — `{ verified, lockfile_sha256 }` from an `npm ci`
  clean-install / lockfile-integrity attestation (not performed by the verifier).

## Modules

Small, pure, independently tested (`scripts/lib/release/*.test.mjs`):

- `preflight.mjs` — the one pure verdict over gathered facts.
- `channel-policy.mjs` — the single source of the public/pilot/qa rigor and
  signing-tolerance groupings; every module that branches on channel imports
  `requiresFullRigor`/`isSigningTolerant` from here instead of re-deriving it.
- `manifest.mjs` — canonical manifest + report builders and tamper-evident verifier.
- `binding.mjs` — the legacy artifact↔acceptance binding + canonical JSON.
- `nsis-payload.mjs` — payload-containment prover (honest not-proven fallback).
- `checksums.mjs` / `artifact-set.mjs` — checksum + expected-artifact-set verifiers.
- `asar-index.mjs` — strict asar reader + forbidden-content + path-traversal contract.
- `prior-ledger.mjs` — durable version-immutability decision.
- `porcelain.mjs` — `git status -z` parser + registry-driven dirty membership.
- `signing.mjs` / `signtool.mjs` — signing policy + `signtool verify /pa /tw` probe.
- `evidence-binding.mjs` — cardinality, channel gates, packaged-e2e build binding.
- `staging.mjs` — symlink-safe atomic sidecar promotion + TOCTOU re-verification.
- `gather.mjs` — the only impure module; reads the workspace into the state object.
