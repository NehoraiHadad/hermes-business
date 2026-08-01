# Release contract — third hardening pass

Fail-closed Windows release contract. Pure decision modules live in
`scripts/lib/release/`; `scripts/lib/release/gather.mjs` collects the real workspace
state and `preflight.mjs` renders one verdict over it. `node scripts/verify-release-contract.mjs`
runs the whole gate read-only. Every rule below is covered by synthetic/fixture
adversarial tests (`*.test.mjs`) that never depend on the stale committed artifact.

## What this pass added (findings → mechanism)

| # | Finding | Mechanism | Key module(s) / tests |
|---|---------|-----------|-----------------------|
| C1 | `payload_binding.proven` was an editable boolean | The verifier **re-extracts** the manifest, the nonce-bearing attestation **and** the app.asar from the installer itself, hashes each, and binds them into a `containment_digest`. Promotion requires the verifier's own extraction to succeed **and** the report's recorded digest to equal the freshly-extracted one. A toggled boolean or a digest describing bytes not in this installer fails closed. | `nsis-payload.mjs` (`proveContainmentBound`), `containment.mjs` (`decideContainment`) |
| C2 | Signing covered only installer+app; `signAndEditExecutable:false` disabled signing | Enumerate **every** shipped PE (`resources/elevate.exe`, runtime DLLs, `.node`) + installer; public requires each signed by an approved, timestamped publisher **or** a justified exclusion. `signAndEditExecutable:false` removed. `afterPack` signs all PEs (helpers/DLLs first, product exe last) **before** NSIS via `sign-payload`; with no signer it signs nothing (honest). | `pe-inventory.mjs`, `sign-payload.mjs`, `after-pack.cjs` |
| H3 | packaged-e2e binding was hand-entered via `--extra` | Binding must be **machine-captured** from the exact staged artifact (nonce echoed by the running app + measured hashes), stamped `capture_method:'machine'`. The manual `--extra build_nonce=…` path and hand-minted PASSED envelopes are refused. | `evidence-capture.mjs`, `evidence-binding.mjs`, `capture-evidence.mjs` |
| H4 | Transitive release pipeline not in the registry | The whole `scripts/lib/release` tree + release orchestration scripts fold into `BUILD_PIPELINE_INPUTS` (attested + dirty); the hashing engine, trust roots and lock/config fold into `RELEASE_DIRTY_INPUTS`. `SUBJECT_SCHEME` bumped to 3. | `subject-registry.mjs` |
| H5 | Lock attestation was a self-asserted boolean | The attestation's recorded `package_lock_sha256` must equal the lockfile on disk now, record node/npm provenance, and assert a clean `npm ci`. | `lock-attest.mjs`, `gen-lock-attest.mjs` |
| H6 | Ledger/allowlist trusted by self-applied label | Provenance is **authenticated** against committed trust roots: a detached signature verified by a committed public key, or a committed known-good GitHub asset digest. Unauthenticated ⇒ treated as absent ⇒ public fails closed. | `provenance.mjs`, `build/trust-roots.json` |
| H7 | Loose build A/B could be mixed | One identity chain: `attestation.build_nonce == manifest.build_nonce == evidence nonce == build nonce`, commit/fingerprint/binding-digest all tied. Any split fails closed. | `identity-chain.mjs` |
| H8 | Promotion could half-update sidecars; report overwritten directly | Promotion is a real transaction: existing files backed up, staged files renamed in, **rollback** on any failure. `release-report.json` is staged (to `build/`) and promoted in the **same** transaction; installers are fingerprinted before report/checksum generation and re-verified before promotion. | `staging.mjs`, `finalize-release.mjs`, `gen-release-report.mjs` |
| M9 | Bundled tools not discovered | Discover electron-builder cache `7za` and the vendored `@electron/windows-sign/vendor/signtool.exe`; prefer the pinned vendor tool, validate path/hash. Missing tools are advisory (never a standalone block); a cert is still required. | `tool-discovery.mjs`, `gather.mjs` |

## Honest blockers on THIS workspace (public is NOT ready)

`node scripts/verify-release-contract.mjs` currently reports (among others):

- **`pe-unsigned`** for `resources/elevate.exe` and every runtime DLL — no code-signing
  certificate is configured, so nothing is signed and no publisher is approved.
- **`containment-*`** — no NSIS extractor (`7za`) is discoverable on this box, so the
  installer↔payload containment cannot be independently proven.
- **`version-ledger-unavailable` / would-be `ledger-unauthenticated`** — no committed
  trust root / signed prior-release ledger.
- **`lock-integrity-unattested`** — no `release/lock-attest.json` from a clean `npm ci`.
- **evidence gates blocked**, dirty inputs, stale attestation vs HEAD — expected on an
  uncommitted working tree.

These are real external prerequisites (a cert, an authenticated ledger + trust root,
a machine with `7za`), not contract defects. The gate stays fail-closed until they are
genuinely satisfied — it never fakes a pass.
