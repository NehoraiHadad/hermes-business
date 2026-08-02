const fs = require('node:fs')
const path = require('node:path')

// Stage the bootstrap's shared PowerShell modules for both packaged Electron
// resources and the source checkout. Copy every top-level module so a newly
// added loader dependency cannot be silently omitted; Python tests stay out.
function stageBootstrapLibrary(sourceRoot, stagingRoot, isPackaged) {
  const sourceDir = isPackaged
    ? path.join(sourceRoot, 'lib')
    : path.join(sourceRoot, 'installer', 'lib')
  if (!fs.existsSync(sourceDir)) {
    throw new Error('The packaged bootstrap library payload is missing')
  }

  const files = fs.readdirSync(sourceDir, { withFileTypes: true })
    .filter(entry => entry.isFile() && (entry.name.endsWith('.ps1') || entry.name === 'enable_plugin.py'))
    .map(entry => entry.name)
    .sort()
  if (files.length === 0) throw new Error('The packaged bootstrap library payload is empty')

  const targetDir = path.join(stagingRoot, 'lib')
  fs.mkdirSync(targetDir, { recursive: true })
  for (const name of files) {
    fs.copyFileSync(path.join(sourceDir, name), path.join(targetDir, name))
  }
  return files
}

module.exports = { stageBootstrapLibrary }
