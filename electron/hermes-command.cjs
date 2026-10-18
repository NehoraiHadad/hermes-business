const fs = require('node:fs')
const { spawn, spawnSync } = require('node:child_process')

// Hermes' official Windows fallback embeds its native bootstrap as base64.
// Execute that unchanged bootstrap with an argv array: no cmd.exe parsing of
// profile names, paths or user input. Unknown future formats fail closed.
function invocation(command, args = []) {
  if (!/[/\\]hermes\.cmd$/i.test(command)) return [command, args]
  const text = fs.readFileSync(command, 'utf8').replace(/\r/g, '').trim()
  const match = text.match(/^@echo off\n"([^"\n]+)" -I -c "import base64; exec\(base64\.b64decode\('([A-Za-z0-9+/=]+)'\)\)" %\*$/)
  if (!match) throw new Error('Unsupported official Hermes launcher format; repair the Hermes installation.')
  return [match[1], ['-I', '-c', Buffer.from(match[2], 'base64').toString('utf8'), ...args]]
}

function spawnCommand(command, args, options) {
  const [file, argv] = invocation(command, args)
  return spawn(file, argv, options)
}

function spawnCommandSync(command, args, options) {
  const [file, argv] = invocation(command, args)
  return spawnSync(file, argv, options)
}

module.exports = { invocation, spawnCommand, spawnCommandSync }
