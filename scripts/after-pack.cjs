const path = require('node:path')

// CRITICAL 2 — afterPack does ONLY the final resource edit (icon + version strings).
//
// afterPack runs while electron-builder is still assembling the app dir — BEFORE the
// payload is signed and compressed. Signing here would seal bytes that later steps
// re-write, and per-file coverage of every shipped PE is not guaranteed. So this hook
// deliberately does NOT sign and does NOT embed the release manifest. Both move to
// the explicit phase-2 script (scripts/finalize-payload.mjs), which runs AFTER the
// `--win dir` build completes (this rcedit is the LAST PE mutation) and BEFORE NSIS
// compresses the payload: it signs every shipped PE, verifies each, then embeds the
// manifest so the recorded hashes describe the SIGNED bytes. See sign-phase.mjs.
exports.default = async function afterPack(context) {
  if (context.electronPlatformName !== 'win32') return
  const { rcedit } = await import('rcedit')
  const executable = path.join(
    context.appOutDir,
    `${context.packager.appInfo.productFilename}.exe`
  )
  const icon = path.join(context.packager.projectDir, 'build', 'icon.ico')
  const version = context.packager.appInfo.version
  await rcedit(executable, {
    icon,
    'file-version': version,
    'product-version': version,
    'version-string': {
      ProductName: 'העוזר לעסק',
      FileDescription: 'עוזר עסקי ידידותי המבוסס על Hermes Agent',
      CompanyName: 'העוזר לעסק (Alpha)'
    }
  })
}
