# Releasing תכל'ס — the pilot (Alpha) checklist

This is the full release checklist from `docs/specs/versioning.md` §5.4, adapted
to the **pilot** channel (docs/specs/versioning.md §13 stage 5,
`docs/release-contract.md` "Channels"). It produces a distributable Alpha
installer — `Tachles-Setup-<version>.exe` — for outside testers: a REAL
production renderer build, full attestation/binding-chain/ledger/lock-integrity
rigor, but **unsigned** (no code-signing certificate yet) and honest about it.

Read first if you haven't: `docs/release-contract.md` (the contract itself),
`docs/ACCEPTANCE.md` §3 "Build artifacts" (what pilot/public/qa each mean),
`docs/specs/versioning.md` §5 (the identity chain) and §13 stage 5.

For a **public** (signed) release, follow the same steps with `public` in place
of `pilot` everywhere below, plus a code-signing certificate
(`HERMES_SIGN_THUMBPRINT`, `build/sign-allowlist.json`) and a `passed`
`thin-installer` envelope (pilot may leave it an honest blocker, like qa).

## Before you start

- Working tree clean (`git status` — nothing the release-dirty-input registry
  cares about; `node scripts/verify-release-contract.mjs --channel pilot` will
  tell you exactly what's uncommitted).
- You are NOT going to run the packaging pipeline for the user, and neither is
  this document going to run it for you — every `npm run package:win:pilot`
  below is something a human (or the release orchestrator) runs deliberately.
- **A version bump invalidates every version-bound evidence envelope**
  (`docs/specs/versioning.md` §1.5 — `package.json` is in `PACKAGED_INPUTS`,
  and a version-bump commit is not evidence-only, so it invalidates ALL
  envelopes). This is expected and priced into step 3/4 below — do not "fix"
  it by holding off the bump.
- **First pilot release ever? Bootstrap the ledger pair (step 0).** The pilot
  preflight requires an AUTHENTICATED version-immutability ledger even when no
  release exists yet — an ABSENT ledger fails closed (`version-ledger-
  unavailable`), it is never treated as "nothing to check". Before the first
  `package:win:pilot` run, commit the explicit empty pair (the committed
  statement "no releases exist yet"):

  `release-ledger.json` (repo root):

  ```json
  { "source": "github-asset", "entries": {} }
  ```

  `build/trust-roots.json` (already committed in this repo with an empty map —
  verify it still has one):

  ```json
  { "github_asset_sha256": {} }
  ```

  Authentication is per-entry and bidirectional (`scripts/lib/release/
  provenance.mjs`): every ledger entry must match its committed trust-root
  digest AND every trust-root version must still be present in the ledger, so
  these two files move in lockstep from here on (step 9). Both are release
  dirty-inputs — they must be COMMITTED, not just written, before the pipeline
  will accept them.

## Checklist

1. **Consolidate the changes.** Update `CHANGELOG.md`: a new `## [<version>] -
   <date>` section with both a Hebrew `### מה חדש (למשתמש)` block (user-facing
   phrasing — this is what gets copied into the GitHub Release body) and an
   English `### Technical` block. Keep releases infrequent/batched — every bump
   is expensive (see above), so don't bump for a one-line fix in isolation.

2. **Bump the version.** Edit `"version"` in `package.json` (and keep
   `package-lock.json`'s two `version` fields in lockstep — the packaging
   config test enforces this: `scripts/packaging-config.test.ts` "keeps
   package.json and the lockfile version in lockstep"). From this commit
   forward, every existing evidence envelope is stale.

3. **Cheap recaptures.** These two are fast, hermetic, and required for BOTH
   pilot and public:

   ```powershell
   $env:HERMES_E2E_NO_LLM = '1'; node scripts/e2e-hermes-shared-state.mjs > raw-shared.json
   node scripts/capture-evidence.mjs shared-state raw-shared.json

   npm run package:thin-installer:qa > raw-thin.json   # emits JSON on stdout
   node scripts/capture-evidence.mjs thin-installer raw-thin.json
   ```

   (`docs/evidence/README.md` "Regenerate" has the full, current commands —
   treat that file as the source of truth if it and this checklist ever
   disagree.)

4. **Thin-installer — pilot may skip; public must pass.** Pilot inherits qa's
   tolerance here (`docs/release-contract.md` "Channels" table): the
   `thin-installer` evidence category may stay an honest external blocker.
   (The former `telegram` category was retired 2026-08-18 — it attested the
   native engine's round-trip, not wrapper code; see
   `docs/evidence/README.md`.)

5. **Package.** This is the expensive step — the exact-artifact stage re-runs
   the packaged E2E + a REAL denied-approval probe against the isolated runtime,
   machine-binding `packaged-e2e` + `approval` to this exact build:

   ```powershell
   $env:HERMES_BUSINESS_E2E_APPROVAL = '1'
   npm run package:win:pilot
   ```

   All 12 stages must pass (`node scripts/package-win.mjs --channel pilot
   --dry-run` prints the plan without running anything, if you want to see it
   first). If ANY stage fails, nothing is promoted — fix and re-run from
   scratch; do not hand-patch `release/`. Confirm at the end:
   `release/Tachles-Setup-<version>.exe` exists, and it is the ONLY installer
   under `release/`.

6. **Commit the evidence.** The freshly captured/machine-written envelopes
   under `docs/evidence/*.json` (and `build/lock-attest.json` →
   `release/lock-attest.json` if not already tracked as expected) are
   evidence-only changes and do not themselves invalidate anything further —
   commit them:

   ```powershell
   git add docs/evidence/ CHANGELOG.md package.json package-lock.json
   git commit -m "chore(release): v<version> pilot evidence + changelog"
   ```

7. **Tag the release commit.**

   ```powershell
   git tag -a v<version> -m "Tachles <version> (pilot)"
   git push --tags
   ```

   The tag name (`v<version>`) must equal `package.json`'s `"version"` on this
   exact commit — verify it read-only, no git mutation:

   ```powershell
   node scripts/verify-version-tag.mjs v<version>
   ```

8. **Create the GitHub Release — as a PRERELEASE.** Never publish before the
   pipeline in step 5 succeeded (draft first if you're not 100% sure, then
   publish once you've re-checked the assets):

   ```powershell
   gh release create v<version> `
     "release/Tachles-Setup-<version>.exe" `
     "release/SHA256SUMS.txt" `
     --title "Tachles <version> (Alpha — Pilot)" `
     --prerelease `
     --notes-file <path-to-a-temp-file-containing>
   ```

   The release page is BILINGUAL, split by audience: the title is Latin-script
   and the body opens in English (the releases page is public, international
   infrastructure — GitHub visitors, tooling), then carries the full Hebrew
   user section (the actual pilot testers, and the in-app update panel that
   renders this body). The body MUST contain, in this order:
   - a short English opening: what Tachles is, one-line install instruction,
     the unsigned/SmartScreen disclosure, a link to the (Hebrew) info site,
     and a note that the product/notes below are in Hebrew;
   - the Hebrew `### מה חדש (למשתמש)` section copied from `CHANGELOG.md` for
     this version, and
   - a fixed installation advisory (copy verbatim, do not paraphrase away the
     honesty):

     > קובץ ההתקנה **אינו חתום דיגיטלית** (גרסת Pilot/Alpha — עדיין אין תעודת
     > חתימה). Windows SmartScreen עשוי להציג אזהרה — זה צפוי. לפני ההתקנה,
     > מומלץ לאמת את ה־SHA-256 של הקובץ מול `SHA256SUMS.txt` המצורף לאותה
     > הוצאה.

9. **Populate the version-immutability ledger — BOTH files.** After the
   Release is published (asset bytes are now public and immutable), record its
   SHA-256 — already computed for you in `release/SHA256SUMS.txt` /
   `release/checksums.json` — in BOTH halves of the ledger pair (the
   authentication in `scripts/lib/release/provenance.mjs` is per-entry and
   bidirectional; a ledger entry without its matching committed trust root, or
   vice versa, fails the WHOLE ledger closed):

   `release-ledger.json` (repo root) — add the entry, never drop prior ones
   (the ledger is never-shrinking):

   ```json
   {
     "source": "github-asset",
     "entries": {
       "<version>": { "sha256": "<sha256 from SHA256SUMS.txt>", "released_at": "<ISO date>" }
     }
   }
   ```

   `build/trust-roots.json` — the committed known-good digest for the same
   version:

   ```json
   {
     "github_asset_sha256": {
       "<version>": "<same sha256>"
     }
   }
   ```

   Commit them together:

   ```powershell
   git add release-ledger.json build/trust-roots.json
   git commit -m "chore(release): record v<version> pilot asset in the release ledger"
   ```

10. **Verify closure.**

    ```powershell
    node scripts/verify-release-contract.mjs --channel pilot
    ```

    Must print `DISTRIBUTABLE` / `contract clean` with **zero** failures (the
    only acceptable `externalBlocker` is `thin-installer` if you chose not to
    recapture it in step 4 — that's honest, not a defect).
    Sanity-check that a previous companion install's update check
    (`SupportUpdatePanel` → "בדוק עדכון") now surfaces `<version>` as
    available, once its release channel eligibility (D1 — a prerelease
    install checks against everything, including future stable releases) is
    satisfied.

## What this checklist deliberately does NOT do

- It does not touch the `public` channel's gates, and it does not require a
  code-signing certificate — pilot is designed to exist WITHOUT one
  (`docs/specs/versioning.md` §13 stage 5; the eventual signed path is §10.2,
  "mandatory when a certificate exists", separately tracked).
- It does not wire `electron-updater` or flip `build.publish` — that stays
  `null` on purpose (`scripts/verify-no-update-metadata.mjs`); pilot testers
  install manually, exactly like public testers do today.
- It never re-runs the packaging pipeline "just to check" — every
  `package:win:pilot` invocation is a REAL, expensive, evidence-invalidating
  build. Use `--dry-run` (`node scripts/package-win.mjs --channel pilot
  --dry-run`) or `verify:release-contract:pilot` to inspect state without
  mutating anything.
