// The ONE template for the shipped installer's basename.
//
// Moved here (out of scripts/lib/release/artifact-set.mjs, which re-exports it)
// because it is now needed at RUNTIME, not only at build time: the in-app
// updater must pick the right GitHub release ASSET by exact name, and the update
// manifest verifier must pin `installer.name` against the same template.
// `build.files` ships `electron/**` and not `scripts/**`, so a build-time-only
// home made this literal unreachable from inside app.asar — and a second copy of
// the literal in the runtime is precisely how the release gate and the updater
// would drift about "which file is the installer".
//
// electron-builder's NSIS target is configured with an explicit ASCII
// `build.win.artifactName` override (`Tachles-Setup-${version}.exe`) — NOT the
// default `${productName} Setup ${version}.exe` template, which would render the
// Hebrew `productName` and produce a name GitHub Releases silently normalizes
// (docs/specs/versioning.md D3).

/**
 * The single installer basename electron-builder is expected to emit. Fixed
 * ASCII template — does NOT depend on productName (see D3). The parameter is
 * kept for call-site compatibility / signature stability but is intentionally
 * unused.
 */
function expectedInstallerName(_productName, version) {
  return `Tachles-Setup-${version}.exe`
}

module.exports = { expectedInstallerName }
