const fs = require('node:fs')
const path = require('node:path')
const { spawnCommandSync } = require('./hermes-command.cjs')

function launcherCandidates(home, platform = process.platform, engine = path.join(home, 'hermes-agent')) {
  const names = platform === 'win32' ? ['hermes.exe', 'hermes.cmd'] : ['hermes']
  return [
    ...(path.resolve(engine) === path.resolve(home, 'hermes-agent')
      ? names.map(name => path.join(home, 'bin', name)) : []),
    ...names.map(name => path.join(engine, '.hermes', 'bin', name)),
    // Active pre-PM installations remain supported until their official update.
    path.join(engine, 'venv', platform === 'win32' ? 'Scripts' : 'bin', names[0])
  ]
}

function installRepoRoot(command) {
  const bin = path.dirname(command)
  if (path.basename(bin) === 'bin' && path.basename(path.dirname(bin)) === '.hermes') {
    return path.resolve(bin, '..', '..')
  }
  if (path.basename(bin) === 'bin' && path.basename(path.dirname(bin)) !== 'venv') {
    return path.resolve(bin, '..', 'hermes-agent')
  }
  return path.resolve(command, '..', '..', '..')
}

function installPython(command, home) {
  if (!command) return null
  const root = installRepoRoot(command)
  if (fs.existsSync(path.join(root, 'pm', 'environments.py'))) {
    const options = { encoding: 'utf8', windowsHide: true, timeout: 30_000,
      env: { ...process.env, HERMES_HOME: home } }
    const published = spawnCommandSync(command, ['--print-runtime-command'], options)
    if (published.status !== 0) throw new Error('Hermes could not resolve its native runtime command')
    const [python] = JSON.parse(published.stdout)
    const probe = spawnCommandSync(python, ['-I', '-c',
      'import sys; from pathlib import Path; sys.path.insert(0,sys.argv[1]); from pm.environments import project_python; print(project_python(Path(sys.argv[1])))', root], options)
    const selected = String(probe.stdout || '').trim()
    if (probe.status !== 0 || !path.isAbsolute(selected) || !fs.existsSync(selected)) {
      throw new Error('The native Hermes dependency environment is incomplete; repair Hermes first')
    }
    return selected
  }
  const legacy = path.join(path.dirname(command), process.platform === 'win32' ? 'python.exe' : 'python')
  return fs.existsSync(legacy) ? legacy : null
}

module.exports = { launcherCandidates, installRepoRoot, installPython }
