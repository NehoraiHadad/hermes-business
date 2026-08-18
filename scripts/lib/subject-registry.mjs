// THE single declarative registry of what release integrity attests.
//
// Consumers share this one source of truth so a subject can never be attested by
// one gate and ignored by another. Sets are split BY PURPOSE, not by directory:
//   * APP_RUNTIME_INPUTS   — the sources that actually ship inside the artifact
//     (main-process runtime, renderer sources vite compiles, the hermes-plugin
//     tree, the extraResources bootstrap scripts, the community runtime payload,
//     packaged assets, package.json).
//   * BUILD_PIPELINE_INPUTS — the scripts/config that DETERMINISTICALLY transform,
//     sign or attest that runtime (plugin bundler, icon/version rcedit pass,
//     build-attestation generator + its lib). A change here can alter the shipped
//     bytes or the attestation itself, so it must invalidate a prepared artifact.
//   * THIN_INSTALLER_INPUTS — every implementation + contract/probe source that
//     makes the thin-installer evidence MEANINGFUL: the NSIS script, the bootstrap
//     scripts, the shared installer library, the build/verify scripts and the
//     hermetic thin-installer + NSIS-contract harnesses with their helpers.
//
//   PACKAGED_INPUTS = APP_RUNTIME_INPUTS + BUILD_PIPELINE_INPUTS. The build
//   attestation fingerprints it, so ANY runtime OR build-transform drift
//   invalidates a prepared artifact — never the generated dist//release/ outputs,
//   node_modules or tests.
//
//   EVIDENCE_SUBJECTS — for each acceptance-evidence category, the exact
//   repository files that category attests. docs/evidence/* is in NO set, so an
//   evidence-only edit can never self-invalidate a `passed` envelope.
//
// Bump SUBJECT_SCHEME whenever the hashing scheme or a set's MEANING changes; it is
// folded into every fingerprint, so old fingerprints stop matching and force an
// honest recapture rather than silently comparing across schemes.

export const SUBJECT_SCHEME = 3

// Tests, caches and compiled Python never run in the shipped app, so a change to
// them must not invalidate an artifact — excluded from every SHIPPED directory walk.
const NON_SHIPPED = /(^|\/)(__pycache__|\.pytest_cache|node_modules)(\/|$)|(^|\/)tests?\/|(^|\/)test_[^/]*\.py$|\.test\.(cjs|mjs|js|jsx|ts|tsx|py)$/

// ---- APP_RUNTIME_INPUTS — sources that ship inside the artifact --------------

// Main-process runtime copied verbatim into app.asar (build.files `electron/**`).
const ELECTRON_RUNTIME = [{ dir: 'electron', exclude: NON_SHIPPED }]

// Renderer SOURCE inputs that `vite build` compiles into the packaged `dist/`.
// We fingerprint the sources, never the generated dist output.
const RENDERER_SOURCES = [
  { dir: 'src', exclude: NON_SHIPPED },
  { file: 'index.html' },
  { file: 'vite.config.ts' },
  { file: 'tsconfig.json' },
  { file: 'tsconfig.app.json' },
  { file: 'tsconfig.node.json' }
]

// The Hermes plugin tree packaged whole (build.files `hermes-plugin/**` plus the
// extraResources bootstrap/dashboard/skill/policy files, all subsets of it).
const HERMES_PLUGIN = [{ dir: 'hermes-plugin', exclude: NON_SHIPPED }]

// Bootstrap scripts shipped verbatim via extraResources / the NSIS payload.
const SHIPPED_INSTALLER = [
  { file: 'installer/bootstrap.ps1' },
  { file: 'installer/bootstrap-companion.ps1' }
]

// The self-contained community runtime payload, shipped verbatim by BOTH
// build.extraResources (`business-bootstrap/community/**`) and the NSIS
// `$INSTDIR\community` payload: the generator/provisioner CLIs, the pure
// community library and the two product skill bodies. The selectors mirror what
// those two shippers actually filter — `*.mjs` minus `*.test.mjs` (NON_SHIPPED
// covers the tests), and `**/SKILL.md` only. The community-archive plugin tree
// also shipped under that payload is already covered by HERMES_PLUGIN.
//
// The vendored js-yaml/argparse bytes that ship alongside are deliberately NOT
// fingerprinted here — node_modules is out of every set by design. Their
// integrity is carried by package-lock.json (RELEASE_DIRTY_INPUTS via
// BUILD_CONFIG_INPUTS) plus the `npm ci` lock-attest, not by this registry.
const COMMUNITY_RUNTIME = [
  { file: 'scripts/community-generate.mjs' },
  { file: 'scripts/community-provision.mjs' },
  { dir: 'scripts/lib/community', exclude: NON_SHIPPED, exts: ['.mjs'] },
  // Only SKILL.md bodies ship, so a sibling note must never churn the
  // fingerprint. `exclude` is tested against directories as well as files, so it
  // is anchored on `.md` (never matching a skill FOLDER) and drops any markdown
  // whose basename is not exactly SKILL.md; `exts` drops everything non-markdown.
  { dir: 'assets/community-skills', exclude: /(^|\/)(?!SKILL\.md$)[^/]*\.md$/, exts: ['.md'] }
]

// Packaged icons/assets and the manifest that carries version + build config.
const ASSETS = [{ file: 'build/icon.png' }, { file: 'build/icon.ico' }]
const PACKAGING_CONFIG = [{ file: 'package.json' }]

/** Sources that actually ship inside the artifact. */
export const APP_RUNTIME_INPUTS = [
  ...ELECTRON_RUNTIME,
  ...RENDERER_SOURCES,
  ...HERMES_PLUGIN,
  ...SHIPPED_INSTALLER,
  ...COMMUNITY_RUNTIME,
  ...ASSETS,
  ...PACKAGING_CONFIG
]

// ---- BUILD_PIPELINE_INPUTS — deterministic transform/sign/attest sources -----
// Changing any of these can alter the shipped bytes (plugin bundle, exe icon/
// version) or the attestation content, so a stale artifact must re-fingerprint.
// The pure hashing engine and this registry are versioned by SUBJECT_SCHEME
// instead of self-fingerprinting, to avoid churny self-reference.
export const BUILD_PIPELINE_INPUTS = [
  { file: 'scripts/after-pack.cjs' },
  { file: 'scripts/build-plugin.mjs' },
  { file: 'scripts/gen-build-attestation.mjs' },
  { file: 'scripts/lib/build-attestation.mjs' },
  ...RELEASE_SECURITY_PIPELINE()
]

// HIGH 4 — the COMPLETE transitive release-security/build pipeline. Every module
// that decides containment, signing, provenance, the build-identity chain, lock
// integrity, staging/promotion or the final verdict can change what a "clean"
// release means, so a change to ANY of them must invalidate a prepared artifact
// (folded into the attestation fingerprint) AND block a release when uncommitted.
// The whole scripts/lib/release tree is captured declaratively (tests excluded),
// plus the top-level orchestration scripts that run the release. The pure hashing
// ENGINE + this registry are deliberately NOT here (they are versioned by
// SUBJECT_SCHEME to avoid self-referential churn) but ARE in RELEASE_DIRTY_INPUTS.
function RELEASE_SECURITY_PIPELINE() {
  return [
    { dir: 'scripts/lib/release', exclude: NON_SHIPPED },
    { file: 'scripts/gen-release-manifest.mjs' },
    { file: 'scripts/gen-release-report.mjs' },
    { file: 'scripts/finalize-release.mjs' },
    { file: 'scripts/sign-release.mjs' },
    { file: 'scripts/gen-installer-checksums.mjs' },
    { file: 'scripts/verify-no-update-metadata.mjs' },
    { file: 'scripts/verify-release-contract.mjs' }
  ]
}

// Release-security inputs that must be CLEAN at release time but are kept OUT of the
// artifact fingerprint to avoid self-referential churn (the hashing engine + this
// registry hash themselves) or because they are trust material, not shipped bytes.
const RELEASE_SECURITY_DIRTY_ONLY = [
  { file: 'scripts/lib/subject-registry.mjs' },
  { file: 'scripts/lib/source-fingerprint.mjs' },
  { file: 'scripts/lib/subject-hash.mjs' },
  { file: 'scripts/lib/evidence-subject.mjs' },
  { file: 'scripts/lib/evidence.mjs' },
  { file: 'scripts/lib/evidence-reducers.mjs' },
  { file: 'scripts/lib/evidence-gates.mjs' },
  { file: 'scripts/lib/git-provenance.mjs' },
  { file: 'scripts/capture-evidence.mjs' },
  { file: 'scripts/verify-evidence.mjs' },
  { file: 'scripts/gen-lock-attest.mjs' },
  { file: 'build/sign-allowlist.json' },
  { file: 'build/trust-roots.json' }
]

// ---- THIN_INSTALLER_INPUTS — implementation + contract/probe sources ---------
// Directory selectors (fail-closed if empty) capture whole dependency trees
// declaratively rather than a fragile manually enumerated leaf list:
//   * installer/lib/**   — the shared installer library dot-sourced by every
//     bootstrap/NSIS path (NON_SHIPPED drops its Python tests + __pycache__).
//   * scripts/lib/**.ps1 — the thin-installer + NSIS-contract harness helpers and
//     the dot-sourced focused test suites (their test code IS the proof).
// hermes-compat.json is included because verify-bootstrap + installer/lib decide
// release compatibility against it; package.json carries the productName/version
// the bootstrap + NSIS embed. COMMUNITY_RUNTIME is here too because the NSIS
// script writes that payload — the thin-installer evidence attests those bytes.
export const THIN_INSTALLER_INPUTS = [
  ...SHIPPED_INSTALLER,
  ...COMMUNITY_RUNTIME,
  { file: 'installer/business-bootstrap.nsi' },
  { dir: 'installer/lib', exclude: NON_SHIPPED },
  { file: 'scripts/build-bootstrap.ps1' },
  { file: 'scripts/verify-bootstrap.ps1' },
  { file: 'scripts/test-bootstrap-lib.ps1' },
  { file: 'scripts/mock-http-server.ps1' },
  { file: 'scripts/e2e-thin-network-installer.ps1' },
  { file: 'scripts/e2e-companion-nsis-contract.ps1' },
  { dir: 'scripts/lib', exts: ['.ps1'] },
  { file: 'hermes-compat.json' },
  ...PACKAGING_CONFIG
]

// The desktop-plugin loading CONTRACT: the verifier, the real-source contract
// helpers, and the checked-in snapshot generated from installed Hermes source.
// Not shipped, but any change re-anchors what "the plugin loads in real Hermes"
// was proven against, so the approval + shared-state evidence must be recaptured.
const PLUGIN_CONTRACT = [
  { file: 'scripts/verify-plugin.mjs' },
  { file: 'scripts/plugin-sdk-contract.mjs' },
  { file: 'scripts/gen-hermes-contract.mjs' },
  { file: 'scripts/lib/hermes-desktop-contract.mjs' },
  { file: 'scripts/hermes-desktop-contract.json' }
]

/** The complete packaged-source input set a release artifact attests. */
export const PACKAGED_INPUTS = [...APP_RUNTIME_INPUTS, ...BUILD_PIPELINE_INPUTS]

// Build-config inputs that are NOT fingerprinted into the artifact (they don't
// change the shipped bytes deterministically) but MUST still be clean at release:
// the dependency lockfile (supply-chain integrity) and any electron-builder config
// side file. Kept out of PACKAGED_INPUTS so they don't churn the source
// fingerprint, but folded into RELEASE_DIRTY_INPUTS so an uncommitted lockfile
// blocks a release.
export const BUILD_CONFIG_INPUTS = [
  { file: 'package-lock.json' },
  { file: 'electron-builder.yml' },
  { file: 'electron-builder.json' }
]

/** Every selector whose uncommitted modification must BLOCK a release. Derived
 * from the same declarative registry the fingerprint uses (never an ad-hoc regex):
 * the packaged inputs, the build-transform pipeline, the thin-installer inputs and
 * the build-config/lockfile. `dirtyRelease()` matches a git path against these. */
export const RELEASE_DIRTY_INPUTS = [
  ...PACKAGED_INPUTS,
  ...THIN_INSTALLER_INPUTS,
  ...BUILD_CONFIG_INPUTS,
  ...RELEASE_SECURITY_DIRTY_ONLY
]

/** Per-category evidence subjects: the repository files each category attests.
 * docs/evidence/* is deliberately in NO set, so evidence edits never self-
 * invalidate. `packaged-e2e` attests the whole packaged artifact. */
export const EVIDENCE_SUBJECTS = {
  'packaged-e2e': PACKAGED_INPUTS,
  approval: [...ELECTRON_RUNTIME, ...HERMES_PLUGIN, ...PLUGIN_CONTRACT],
  'shared-state': [...ELECTRON_RUNTIME, ...HERMES_PLUGIN, ...PLUGIN_CONTRACT],
  'thin-installer': [...THIN_INSTALLER_INPUTS, ...HERMES_PLUGIN]
}

/** One-line recapture hint per category, surfaced by the verifier when a passed
 * envelope is stale or unmigratable (no fabrication — it tells the operator how
 * to honestly re-attest). See docs/evidence/README.md for the full commands. */
export const RECAPTURE = {
  'packaged-e2e': 'recapture via the package pipeline (HERMES_BUSINESS_E2E_APPROVAL=1 npm run package:win:qa) — its exact-artifact stage (scripts/e2e-exact-artifact.mjs) machine-writes the bound envelope; a plain e2e-installed-isolated pipe lacks build_nonce/release_binding_digest/installer_sha256 and requirePassProof rejects it',
  approval: 'recapture via the same package pipeline run (HERMES_BUSINESS_E2E_APPROVAL=1 npm run package:win:qa) — the exact-artifact stage machine-writes approval alongside packaged-e2e from the isolated denial probe',
  'shared-state': 'node scripts/e2e-hermes-shared-state.mjs then node scripts/capture-evidence.mjs shared-state <raw>',
  'thin-installer': 'recapture per docs/evidence/README.md "Regenerate" — run the harness (-File, as the npm script does) and write only its report TAIL to <raw> before node scripts/capture-evidence.mjs thin-installer <raw>; a plain `npm run package:thin-installer:qa > <raw>` redirect writes a mixed log, not JSON'
}

export const CATEGORIES = Object.keys(EVIDENCE_SUBJECTS)
