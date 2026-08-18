// Pure verifier for the EXACT expected release artifact set.
//
// electron-builder's NSIS target is configured with an explicit ASCII
// `build.win.artifactName` override (`Tachles-Setup-${version}.exe`) — NOT the
// default `${productName} Setup ${version}.exe` template, which would render the
// Hebrew `productName` and produce a name GitHub Releases silently normalizes
// (docs/specs/versioning.md D3). A release must ship EXACTLY that one installer
// for the current version — no extra .exe (a stale same-name-different-version
// binary, a leftover from another target, an unrelated tool), and no file whose
// name we cannot parse a version out of. An unexpected or unparseable artifact
// means the release tree is not the one we think we cut, so the contract fails
// closed rather than measuring whatever happens to be present.

import { versionFromInstallerName } from './checksums.mjs'
import artifactName from '../../../electron/update-artifact-name.cjs'

/**
 * The single installer basename electron-builder is expected to emit. Fixed
 * ASCII template — does NOT depend on productName (see D3).
 *
 * RE-EXPORTED from electron/update-artifact-name.cjs, not implemented here: the
 * in-app updater must pick the release ASSET by this exact name at RUNTIME, and
 * `scripts/**` is not packaged into app.asar (build.files ships `electron/**`).
 * One template, one place — the release gate and the updater can never drift
 * apart about which file is "the installer".
 */
export const { expectedInstallerName } = artifactName

/**
 * Verify the measured installer set against the expected one.
 *   productName : build.productName (unused by the expected-name template; kept
 *                 for call-site compatibility, see expectedInstallerName)
 *   version     : package.json version
 *   installers  : [{ name, version? }]  (measured from release/)
 * Returns { ok, errors[], expected }. Fails closed on: no installer, more than
 * one, a name that is not the expected versioned name, or a name we cannot parse a
 * semver out of (unparseable → rejected, never silently accepted).
 */
export function verifyArtifactSet({ productName, version, installers = [] } = {}) {
  const errors = []
  const expected = expectedInstallerName(productName, version)
  if (!version) {
    errors.push('cannot derive expected artifact name: missing version')
    return { ok: false, errors, expected }
  }
  if (installers.length === 0) {
    errors.push('no installer .exe present under release/')
    return { ok: false, errors, expected }
  }
  const names = installers.map(i => i.name)
  for (const name of names) {
    const parsed = versionFromInstallerName(name)
    if (!parsed) {
      errors.push(`unparseable installer name "${name}" (no version token)`)
      continue
    }
    if (parsed !== version) {
      errors.push(`installer "${name}" is v${parsed} but current version is v${version}`)
    }
    if (name !== expected) {
      errors.push(`unexpected installer name "${name}"; expected exactly "${expected}"`)
    }
  }
  const extras = names.filter(n => n !== expected)
  if (extras.length && names.includes(expected)) {
    errors.push(`extra artifact(s) alongside the expected installer: ${extras.join(', ')}`)
  }
  if (names.length > 1) {
    errors.push(`expected exactly 1 installer, found ${names.length}: ${names.join(', ')}`)
  }
  return { ok: errors.length === 0, errors, expected }
}
