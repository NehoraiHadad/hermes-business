import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawn, spawnSync } from 'node:child_process'
import { cleanProcessEnv } from './lib/environment-path.mjs'

const root = path.resolve(import.meta.dirname, '..')
const localData = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local')
const devRoot = path.join(localData, 'hermes-business-dev')
const devHome = path.join(devRoot, 'hermes-home')
const explicitBinary = process.env.HERMES_BUSINESS_HERMES_EXE
const hermesBinary = explicitBinary || path.join(localData, 'hermes', 'hermes-agent', 'venv', 'Scripts', 'hermes.exe')
const electronBinary = process.platform === 'win32'
  ? path.join(root, 'node_modules', 'electron', 'dist', 'electron.exe')
  : path.join(root, 'node_modules', '.bin', 'electron')

if (!path.isAbsolute(hermesBinary) || !fs.existsSync(hermesBinary)) {
  console.error(`Hermes binary not found: ${hermesBinary}`)
  console.error('Set HERMES_BUSINESS_HERMES_EXE to the absolute live Hermes executable path.')
  process.exit(1)
}
if (!fs.existsSync(electronBinary)) {
  console.error('Electron is not installed. Run npm install first.')
  process.exit(1)
}

fs.mkdirSync(devHome, { recursive: true })
const env = {
  ...cleanProcessEnv(process.env),
  HERMES_BUSINESS_DEV_RUNTIME: 'isolated-dev-home',
  HERMES_BUSINESS_DEV_HERMES_HOME: devHome,
  HERMES_BUSINESS_HERMES_EXE: path.resolve(hermesBinary),
  HERMES_BUSINESS_DEV_PORT: process.env.HERMES_BUSINESS_DEV_PORT || '19119'
}

const children = new Set()
let closing = false
function stopChild(child) {
  if (!child?.pid) return
  if (process.platform === 'win32') spawnSync('taskkill.exe', ['/pid', String(child.pid), '/t', '/f'], { stdio: 'ignore', windowsHide: true })
  else child.kill('SIGTERM')
}
function shutdown(code = 0) {
  if (closing) return
  closing = true
  for (const child of children) stopChild(child)
  process.exit(code)
}

async function waitForVite(timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      const response = await fetch('http://127.0.0.1:5173')
      if (response.ok) return
    } catch { /* keep polling */ }
    await new Promise(resolve => setTimeout(resolve, 250))
  }
  throw new Error('Vite did not become ready on http://127.0.0.1:5173')
}

console.log(`Development mode: isolated (${devHome})`)
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm'
const vite = spawn(npm, ['run', 'dev:web'], { cwd: root, env, stdio: 'inherit', windowsHide: true })
children.add(vite)
vite.once('exit', code => shutdown(code || 0))
process.on('SIGINT', () => shutdown(130))
process.on('SIGTERM', () => shutdown(143))

try {
  await waitForVite()
  const desktop = spawn(electronBinary, ['.'], { cwd: root, env, stdio: 'inherit', windowsHide: true })
  children.add(desktop)
  desktop.once('exit', code => shutdown(code || 0))
} catch (error) {
  console.error(error.message || error)
  shutdown(1)
}
