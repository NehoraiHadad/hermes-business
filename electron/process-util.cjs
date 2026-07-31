const { spawn } = require('node:child_process')
const { redact } = require('./security.cjs')
const { rememberLog } = require('./logs.cjs')
const { hermesHome } = require('./paths.cjs')

// Run a child process to completion, streaming its output into the redacted log
// buffer and returning the captured stdout/stderr. Rejects on timeout or a
// non-zero exit (with a redacted message). Used by the Google setup and
// gateway/install flows.
function runCaptured(command, args, timeout = 120_000) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { windowsHide: true, env: { ...process.env, HERMES_HOME: hermesHome() } })
    let stdout = ''
    let stderr = ''
    const timer = setTimeout(() => {
      child.kill()
      reject(new Error('The setup step timed out'))
    }, timeout)
    child.stdout.on('data', chunk => {
      stdout += chunk
      rememberLog(chunk)
    })
    child.stderr.on('data', chunk => {
      stderr += chunk
      rememberLog(chunk)
    })
    child.on('error', error => {
      clearTimeout(timer)
      reject(error)
    })
    child.on('exit', code => {
      clearTimeout(timer)
      if (code === 0) resolve({ stdout, stderr })
      else reject(new Error(redact(stderr || stdout || `Setup exited with code ${code}`)))
    })
  })
}

// Recover the last JSON object printed by a setup script that may also emit
// status lines before it.
function parseJsonOutput(output) {
  const lines = output.trim().split(/\r?\n/).reverse()
  for (const line of lines) {
    try {
      return JSON.parse(line)
    } catch {
      // Keep scanning; setup scripts may print status lines before JSON.
    }
  }
  const start = output.lastIndexOf('{')
  if (start >= 0) {
    try {
      return JSON.parse(output.slice(start))
    } catch {
      return null
    }
  }
  return null
}

module.exports = { runCaptured, parseJsonOutput }
