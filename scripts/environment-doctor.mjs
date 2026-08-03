import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { cleanHermesTestPath, isHermesTestPathEntry } from './lib/environment-path.mjs'

const APPLY = process.argv.includes('--apply')

function powershell(script, env = process.env) {
  return spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], {
    encoding: 'utf8',
    windowsHide: true,
    env
  })
}

function userPath() {
  if (process.platform !== 'win32') return process.env.PATH || ''
  const result = powershell("[Console]::OutputEncoding=[Text.Encoding]::UTF8; [Environment]::GetEnvironmentVariable('Path','User')")
  if (result.status !== 0) throw new Error(result.stderr.trim() || 'Could not read User PATH')
  return result.stdout.trim()
}

function writeUserPath(value) {
  const env = { ...process.env, HERMES_BUSINESS_CLEAN_USER_PATH: value }
  const result = powershell("[Environment]::SetEnvironmentVariable('Path',$env:HERMES_BUSINESS_CLEAN_USER_PATH,'User')", env)
  if (result.status !== 0) throw new Error(result.stderr.trim() || 'Could not update User PATH')
}

const current = userPath()
const verdict = cleanHermesTestPath(current)
const ambientHome = process.env.HERMES_HOME || null
const inheritedPath = cleanHermesTestPath(process.env.PATH || '')
const staleAmbientHome = ambientHome && isHermesTestPathEntry(ambientHome)

console.log(`Hermes User PATH: ${verdict.removed.length ? 'needs repair' : 'clean'}`)
console.log(`Ambient HERMES_HOME: ${ambientHome || 'not set in this process'}`)
for (const entry of verdict.removed) console.log(`- stale E2E PATH: ${entry}`)
if (!verdict.removed.length && (staleAmbientHome || inheritedPath.removed.length)) {
  console.log('This already-running terminal/app still has inherited E2E variables; restart it to refresh the environment.')
}

if (!APPLY) {
  if (verdict.removed.length) console.log('Run npm run repair:environment to back up and remove these User PATH entries.')
  process.exitCode = verdict.removed.length ? 1 : 0
} else if (verdict.removed.length) {
  const backupDir = path.join(process.env.LOCALAPPDATA || os.tmpdir(), 'HermesBusinessBootstrap')
  fs.mkdirSync(backupDir, { recursive: true })
  const backup = path.join(backupDir, `user-path-backup-${new Date().toISOString().replace(/[:.]/g, '-')}.txt`)
  fs.writeFileSync(backup, current, 'utf8')
  writeUserPath(verdict.cleaned)
  console.log(`Removed ${verdict.removed.length} stale entries. Backup: ${backup}`)
} else {
  console.log('No User PATH changes were necessary.')
}
