const path = require('node:path')

// CRITICAL 2 — afterPack embeds ONLY the app icon, and never signs.
//
// Root cause of the earlier missing-icon/branding bug: `win.signAndEditExecutable:false`
// disabled electron-builder's native resedit pass entirely. The fix is `win.signExecutable:false`,
// which keeps native resedit (icon + version strings + Windows-form file/product version, derived
// from package.json productName/author/version) while still skipping code signing. That native
// pass runs in `signApp` AFTER this hook, so it is the authoritative last resource edit and it
// correctly renders the `0.4.0-alpha.1` prerelease as a numeric Windows version.
//
// This hook stays as an early, defense-in-depth icon embed (and a stable subject-registry file).
// It deliberately embeds ONLY the icon — no version strings — so it cannot diverge from the
// authoritative native pass, and no non-numeric prerelease string is ever handed to rcedit.
// It does NOT sign and does NOT embed the release manifest: signing + manifest move to the
// explicit phase-2 script (scripts/finalize-payload.mjs), which runs AFTER the `--win dir` build
// completes (so it signs the fully edited bytes) and BEFORE NSIS compresses the payload. See
// scripts/lib/release/sign-phase.mjs.
exports.default = async function afterPack(context) {
  if (context.electronPlatformName !== 'win32') return
  const { rcedit } = await import('rcedit')
  const executable = path.join(
    context.appOutDir,
    `${context.packager.appInfo.productFilename}.exe`
  )
  const icon = path.join(context.packager.projectDir, 'build', 'icon.ico')
  await rcedit(executable, { icon })
}
