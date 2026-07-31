const path = require('node:path')

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
      CompanyName: 'Hermes Business POC'
    }
  })
}
