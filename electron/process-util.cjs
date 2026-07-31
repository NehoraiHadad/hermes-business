const { spawn, spawnSync } = require('node:child_process')
const { redact } = require('./security.cjs')
const { rememberLog } = require('./logs.cjs')
const { hermesHome } = require('./paths.cjs')

// Run a child process to completion, streaming its output into the redacted log
// buffer and returning the captured stdout/stderr. Rejects on timeout or a
// non-zero exit (with a redacted message). Used by the Google setup and
// gateway/install flows.
function runCaptured(command, args, timeout = 120_000, extraEnv = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      windowsHide: true,
      env: { ...process.env, HERMES_HOME: hermesHome(), ...extraEnv },
      // These setup commands are launched from a GUI and must never wait for
      // invisible terminal input. Hermes treats EOF as "use the safe default".
      stdio: ['ignore', 'pipe', 'pipe']
    })
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

// Force-terminate a spawned process AND its child tree so a runtime that never
// became healthy can never linger as an orphan holding its loopback port. On
// Windows only `taskkill /t /f` reaps the whole tree — Node's `proc.kill()` can
// leave grandchildren (the venv launcher spawns python). `platform`/`run` are
// injectable so the reap ordering is unit-testable without spawning a process.
// Returns true when a kill was actually attempted.
function reapProcessTree(proc, { platform = process.platform, run = spawnSync } = {}) {
  if (!proc || proc.pid == null) return false
  try {
    if (platform === 'win32') {
      run('taskkill.exe', ['/pid', String(proc.pid), '/t', '/f'], { windowsHide: true })
      return true
    }
    try {
      proc.kill('SIGTERM')
    } catch {
      // already gone
    }
    try {
      proc.kill('SIGKILL')
    } catch {
      // already gone
    }
    return true
  } catch {
    // Best-effort reap; the caller clears its handle regardless.
    return false
  }
}

module.exports = { runCaptured, parseJsonOutput, reapProcessTree }
