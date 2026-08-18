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
  these two files move in lockstep from here on (step 10). Both are release
  dirty-inputs — they must be COMMITTED, not just written, before the pipeline
  will accept them.

## Checklist

1. **Consolidate the changes.** Update `CHANGELOG.md`: a new `## [<version>] -
   <date>` section with both a Hebrew `### מה חדש (למשתמש)` block (user-facing
   phrasing — this is what gets copied into the GitHub Release body) and an
   English `### Technical` block. Keep releases infrequent/batched — every bump
   is expensive (see above), so don't bump for a one-line fix in isolation.

2. **Bump the version — and COMMIT the bump before anything is packaged.** Edit
   `"version"` in `package.json` (and keep `package-lock.json`'s two `version`
   fields in lockstep — the packaging config test enforces this:
   `scripts/packaging-config.test.ts` "keeps package.json and the lockfile
   version in lockstep"). From this commit forward, every existing evidence
   envelope is stale.

   ```powershell
   git add package.json package-lock.json
   git commit -m "chore(release): bump to <version>"
   ```

   The bump lands in its OWN commit, here — not folded into the evidence commit
   of step 6. Two independent mechanisms make "package first, commit the bump
   after" fail, and both of them fail at the END of the expensive run:

   - **The dirty-inputs gate.** `package.json` is a release input
     (`PACKAGING_CONFIG` → `PACKAGED_INPUTS` → `RELEASE_DIRTY_INPUTS` in
     `scripts/lib/subject-registry.mjs`), and `package-lock.json` is one too
     (via `BUILD_CONFIG_INPUTS`). Stage 12,
     `scripts/finalize-release.mjs`, runs `preflightRelease`, whose first rule
     reports every uncommitted input — and a failed gate promotes NOTHING:

     ```
     Refusing to promote official sidecars (reason: gate-failed).
     Blocking failures:
      - [dirty-inputs] 2 input(s) uncommitted: package-lock.json, package.json
     ```

     You no longer have to reach stage 12 to learn this: `package-win.mjs` reads
     the same registry once before stage 1 and, on `public` or `pilot`, refuses
     immediately with the same file list and `nothing was built`. `qa` only
     warns — recapturing evidence over working-tree changes is what that channel
     is for. The early read is a courtesy, not the gate: inputs can change while
     the pipeline runs, so stage 12 stays the authority.
   - **The build identity chain binds the commit.** Stage 3
     (`scripts/gen-build-attestation.mjs`) records `source_head` — the HEAD it
     built from — and `computeReleaseBinding`
     (`scripts/lib/release/binding.mjs`) folds that HEAD *and* its subject line
     into the release binding digest through `commitFingerprint`. Packaging
     first and committing after would promote an acceptance bound to a commit
     that is not the released one. The gate says so independently: a bump commit
     is not evidence-only, so the head relation turns `code-descendant` and the
     preflight adds `attestation-head-stale` on top of the dirty inputs.

   This does not contradict step 6. Evidence envelopes are **not** release
   inputs — `docs/evidence/*` is in no subject set and in no dirty-input
   selector, and `docs/evidence/*.json` is explicitly durable in the head-relation
   walk (`isDurableReleaseArtifact`, `scripts/lib/git-provenance.mjs`). So
   committing the envelopes AFTER packaging keeps the relation
   `evidence-descendant`, which the gate accepts; committing `package.json`
   afterwards would not.

3. **Cheap recaptures.** These two are fast, hermetic, and required for BOTH
   pilot and public:

   ```powershell
   $env:HERMES_E2E_NO_LLM = '1'; node scripts/e2e-hermes-shared-state.mjs > raw-shared.json
   node scripts/capture-evidence.mjs shared-state raw-shared.json

   npm run build:plugin
   $thin = powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/e2e-thin-network-installer.ps1 -EmitQaArtifact
   [System.IO.File]::WriteAllLines("$PWD\raw-thin.json", [string[]]$thin[[array]::LastIndexOf([object[]]$thin, '{')..($thin.Count - 1)])
   node scripts/capture-evidence.mjs thin-installer raw-thin.json
   ```

   The thin-installer capture is deliberately NOT `npm run
   package:thin-installer:qa > raw-thin.json`. That redirect does not produce
   JSON — npm's banner, `build:plugin`'s output and the harness's own `== Case
   N: ... ==` progress lines share the same stdout, so the file is a mixed log
   whose LAST object is the report. `capture-evidence.mjs` currently rescues it
   (`scripts/lib/json-input.mjs` rescans for the final JSON object), but nothing
   else can read the file and the rescue dies the moment anything prints after
   the report. The capture above takes the harness's output apart in PowerShell
   and keeps only the report (`WriteAllLines`, because PowerShell 5.1's
   `Set-Content -Encoding utf8` prepends a BOM strict parsers reject), so
   `raw-thin.json` is genuinely parseable. Keep `-File`: entering the harness as
   `-Command "& .\scripts\…"` fails part-way through, in the extraction closure.

   (`docs/evidence/README.md` "Regenerate" has the full, current commands —
   treat that file as the source of truth if it and this checklist ever
   disagree.)

4. **Thin-installer — pilot may skip; public must pass.** Pilot inherits qa's
   tolerance here (`docs/release-contract.md` "Channels" table): the
   `thin-installer` evidence category may stay an honest external blocker.
   (The former `telegram` category was retired 2026-08-18 — it attested the
   native engine's round-trip, not wrapper code; see
   `docs/evidence/README.md`.)

5. **Package.** First, clear the PREVIOUS version's installer out of `release/`.
   Nothing cleans that directory — `scripts/package-win.mjs` runs the 12 stages
   and no more, and electron-builder writes the new installer alongside whatever
   is already sitting there. Check:

   ```powershell
   Get-ChildItem release\*.exe | Select-Object Name, Length, LastWriteTime
   ```

   Move or delete every `Tachles-Setup-<older-version>.exe` (and its `.blockmap`
   sibling — no stage reads blockmaps; electron-builder rewrites the current
   one). This is not tidiness. The installer is located by a SUBSTRING match on
   the version that must hit exactly one file (`selectVersionedInstaller`,
   `scripts/lib/release/exact-artifact.mjs`), so a leftover collides whenever
   the new version string is contained in the older name — cutting `0.4.0` with
   a leftover `0.4.0-alpha.9`, or `0.4.0-alpha.1` with a leftover
   `0.4.0-alpha.10`. On a collision `measureInstallers` returns NOTHING, and the
   run dies with `No installer .exe under release/` (gen-release-report,
   finalize-release) or `[artifact-set] no installer .exe present under
   release/` — which reads like a build failure rather than a stale file.

   Delete installers and blockmaps only. Everything else under `release/` is
   either regenerated by this run or is the record of the last one:
   - `checksums.json`, `SHA256SUMS.txt`, `ACCEPTANCE.md`, `release-report.json`
     and `update-manifest.json` are the official sidecars stage 12 promotes in
     ONE atomic transaction, and a failed gate deliberately leaves the previous
     ones standing (`Prior sidecars left untouched`). That is the last GOOD
     release's record — do not hand-delete it.
   - `.release-promote-journal.json`, if you ever see it, means a promotion was
     interrupted; `finalize-release.mjs` heals it (`recoverRelease`) at the start
     of the next run. Deleting it by hand destroys that recovery and strands the
     `*.bak-<n>` pre-images next to it.
   - `win-unpacked/` is the phase-1 payload that stages 5–11 sign, measure and
     re-extract, and `lock-attest.json` is written by stage 8 and read by the
     gate. Both are rewritten by a run; never touch either during one.

   Second, MOVE `docs/evidence/packaged-e2e.json` and
   `docs/evidence/approval.json` out of the tree before you start. This is a
   genuine circular dependency in the pipeline, not a quirk, and it costs a full
   run every time it is rediscovered:

   - stage 1 is `npm run verify:release`, which runs `test:evidence`, which
     REFUSES to pass while any `passed` envelope is stale — and a version bump
     stales these two on both counts at once (`app_version 0.4.0-alpha.N !=
     current 0.4.0-alpha.N+1`, plus subject drift);
   - but stage 11 (`scripts/e2e-exact-artifact.mjs`) is the ONLY thing that can
     regenerate them, because they must be machine-bound to the candidate
     installer (`installer_sha256` + `build_nonce` + `release_binding_digest`,
     which `requirePassProof` demands).

   So the gate that blocks the run is waiting on a later stage of the same run.
   Moving the two files aside makes the tree honestly "pre-capture" — the
   evidence test treats an absent envelope as not-yet-captured rather than as a
   failed one — and stage 11 then writes fresh, bound envelopes:

   ```powershell
   New-Item -ItemType Directory -Force $env:TEMP\ev-hold | Out-Null
   Move-Item docs\evidence\packaged-e2e.json, docs\evidence\approval.json $env:TEMP\ev-hold
   ```

   Do NOT delete them outright: if the run fails before stage 11 you want the
   previous release's envelopes back. Discard the held copies only once stage 11
   has written new ones.

   The other two envelopes are NOT part of this — `shared-state` and
   `thin-installer` are captured by hand in step 3 and must already be fresh, or
   stage 1 fails on them for the ordinary reason.

   Then package. This is the expensive step — the exact-artifact stage re-runs
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
   under `docs/evidence/*.json` are evidence-only changes and do not themselves
   invalidate anything further — commit them:

   ```powershell
   git add docs/evidence/ CHANGELOG.md
   git commit -m "chore(release): v<version> pilot evidence + changelog"
   ```

   `package.json` / `package-lock.json` are deliberately absent here: they were
   committed in step 2, before the build, and this commit must stay durable —
   envelopes (and non-subject files like `CHANGELOG.md`) only.

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

8. **Sign the update manifest (עוגן האמון של העדכון מתוך האפליקציה).** The
   installer is UNSIGNED and always will be (no code-signing certificate), so
   the ONLY thing that lets an installed app tell "the installer we published"
   from "an .exe someone handed it" is a detached Ed25519 signature over the
   installer's SHA-256. `release/update-manifest.json` is that statement, and
   it is per-release on purpose: `build/trust-roots.json` is RETROSPECTIVE (it
   can only pin versions that already shipped), so an installed v0.4.0-alpha.7
   can never contain anything about the alpha.8 it is being offered.

   `npm run package:win:pilot` already produced and staged it in step 5 —
   atomically, in the same all-or-nothing transaction as `checksums.json` /
   `SHA256SUMS.txt` / `ACCEPTANCE.md` — IF a signing key was present on the
   build machine. Check:

   ```powershell
   Get-Content release\update-manifest.json
   ```

   If it is missing (finalize prints a loud `WARNING: no signed
   update-manifest.json`, and `release/ACCEPTANCE.md` records it as **Signed
   update manifest: ABSENT**), sign it now:

   ```powershell
   node scripts/sign-update-manifest.mjs --channel pilot
   ```

   - המפתח הפרטי יושב מחוץ למאגר, בנתיב
     `%USERPROFILE%\.tachles-release\update-signing-key.pem` (override: `--key`
     או `TACHLES_UPDATE_SIGNING_KEY`).
     It is generated once by `node scripts/gen-update-key.mjs`, it is
     **בלתי ניתן לשחזור** if lost, and it must never be committed — only its
     public half ships, inside `electron/update-trust.cjs` (a multi-key map, so
     a future rotation is not a flag day).
   - The signer verifies its OWN output against that shipped public key before
     writing anything: a manifest the app cannot verify is worse than none.
   - `installer.sha256` must equal `release/checksums.json` (and the ledger
     entry, once step 10 records it). A disagreement is a hard failure, never a
     warning — three independent records of one file that disagree mean the
     release tree is not the one we think we cut.
   - The manifest is **absent or signed — never present-and-unsigned.** An
     unsigned placeholder would teach the updater to accept unsigned
     statements, which is the entire attack.
   - Upload it as a release asset alongside `SHA256SUMS.txt` in the next step;
     an app that cannot fetch it must refuse to auto-install and fall back to
     the manual download.

9. **Create the GitHub Release — as a PRERELEASE.** Never publish before the
   pipeline in step 5 succeeded (draft first if you're not 100% sure, then
   publish once you've re-checked the assets):

   ```powershell
   gh release create v<version> `
     "release/Tachles-Setup-<version>.exe" `
     "release/SHA256SUMS.txt" `
     "release/update-manifest.json" `
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

10. **Populate the version-immutability ledger — BOTH files.** After the
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

    Update `site/index.html`'s static download href to the new version IN THE SAME
    COMMIT. It is pinned by `site/download-link.test.mjs` to the newest ledger
    entry, so adding one here turns that test red until the site follows. That is
    deliberate: the static href is what a visitor gets when GitHub is unreachable
    or rate-limited, and a fallback one version behind is how it quietly stops
    being current.

    ```powershell
    git add release-ledger.json build/trust-roots.json site/index.html
    git commit -m "chore(release): record v<version> pilot asset in the release ledger"
    ```

11. **Verify closure.**

    ```powershell
    node scripts/verify-release-contract.mjs --channel pilot
    node scripts/verify-published-release.mjs --tag v<version> --channel pilot
    ```

    The first must print `DISTRIBUTABLE` / `contract clean` with **zero** failures (the
    only acceptable `externalBlocker` is `thin-installer` if you chose not to
    recapture it in step 4 — that's honest, not a defect).

    The second is REQUIRED, not optional: it is the only machine check over
    step 9, which is otherwise pure hand-work. It re-reads the PUBLISHED release
    and holds it to the shape this checklist mandates — prerelease, not draft,
    exactly the three assets, the Latin-script title `Tachles <version> (Alpha —
    Pilot)`, a body carrying the Hebrew user section and the verbatim
    installation advisory, and a published installer digest equal to the ledger
    entry recorded in step 10. It exists because step 9 drifted within minutes
    of being read on v0.4.0-alpha.10: that release went out with a Hebrew title,
    with `checksums.json` uploaded in place of the `SHA256SUMS.txt` the mandated
    advisory tells testers to verify against, and with a Hebrew-only body
    instead of the required bilingual one. Nothing caught any of it — it was
    found by re-reading the checklist afterwards. A manual step with no verifier
    drifts.

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
