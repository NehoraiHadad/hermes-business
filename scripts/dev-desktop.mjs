// `npm run dev:desktop` — Vite dev server + Electron against an ISOLATED dev
// Hermes home.
//
// Every runtime constant here is IMPORTED from the product contract
// (electron/runtime-mode.cjs): the dev sentinel name/value, the dev home/binary/
// port variable names, the default dev root, the default port, and the Hermes
// binary discovery policy. Restating any of them in the launcher is how a dev
// runtime silently stops matching the runtime it is supposed to start. The env
// this script builds is then re-validated through `resolveRuntimeMode` itself
// before anything is spawned, so an invalid dev env fails here rather than as a
// mysterious quit inside Electron.
//
// The Vite port is likewise not hard-coded: it is read from vite.config.ts (the
// single place that declares it) or from VITE_PORT, and the responder on that
// port is IDENTIFIED as this project's dev server before Electron is pointed at
// it — otherwise an unrelated service already holding the port would happily
// serve the desktop shell. NOTE: the main process pins the dev renderer URL
// itself (electron/window-create.cjs + electron/url-policy.cjs), so overriding
// VITE_PORT only moves the dev server, not the window — that mismatch is called
// out loudly rather than producing a blank window.

import fs from 'node:fs'
import path from 'node:path'
import { spawn, spawnSync } from 'node:child_process'
import { cleanProcessEnv } from './lib/environment-path.mjs'
import { requireElectron } from './lib/electron-require.mjs'
import { resolveVitePort, viteUrl, waitForThisProjectsVite } from './lib/vite-port.mjs'

const {
  DEV_SENTINEL_ENV,
  DEV_SENTINEL_VALUE,
  DEV_HOME_ENV,
  DEV_BINARY_ENV,
  DEV_PORT_ENV,
  DEV_PORT,
  defaultDevRoot,
  resolveHermesBinary,
  resolveRuntimeMode
} = requireElectron('runtime-mode.cjs')

const root = path.resolve(import.meta.dirname, '..')

// ── Isolated dev runtime ─────────────────────────────────────────────────────
const baseEnv = cleanProcessEnv(process.env)
// `hermes-home` is the leaf runtime-mode's devConfig defaults to under the dev
// root; the root itself and the whole binary-discovery policy come from there.
const devHome = baseEnv[DEV_HOME_ENV]
  ? path.resolve(baseEnv[DEV_HOME_ENV])
  : path.join(defaultDevRoot(baseEnv), 'hermes-home')
const explicitBinary = baseEnv[DEV_BINARY_ENV] ? path.resolve(baseEnv[DEV_BINARY_ENV]) : null
const hermesBinary = resolveHermesBinary({ hermesBinary: explicitBinary, hermesHome: devHome }, baseEnv)

if (!hermesBinary || !path.isAbsolute(hermesBinary) || !fs.existsSync(hermesBinary)) {
  console.error(`Hermes binary not found${explicitBinary ? `: ${explicitBinary}` : ''}`)
  console.error(`Set ${DEV_BINARY_ENV} to the absolute live Hermes executable path.`)
  process.exit(1)
}

const electronBinary = process.platform === 'win32'
  ? path.join(root, 'node_modules', 'electron', 'dist', 'electron.exe')
  : path.join(root, 'node_modules', '.bin', 'electron')
if (!fs.existsSync(electronBinary)) {
  console.error('Electron is not installed. Run npm install first.')
  process.exit(1)
}

const env = {
  ...baseEnv,
  [DEV_SENTINEL_ENV]: DEV_SENTINEL_VALUE,
  [DEV_HOME_ENV]: devHome,
  [DEV_BINARY_ENV]: hermesBinary,
  [DEV_PORT_ENV]: String(baseEnv[DEV_PORT_ENV] || DEV_PORT)
}

// Fail here, with the runtime's own message, rather than inside a quitting app.
let runtimeConfig
try {
  runtimeConfig = resolveRuntimeMode(env)
} catch (error) {
  console.error(`Development runtime env is invalid: ${error?.message || error}`)
  process.exit(1)
}
fs.mkdirSync(runtimeConfig.hermesHome, { recursive: true })

// ── Process supervision ──────────────────────────────────────────────────────
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

const declaredPort = resolveVitePort({ env: {} })
const vitePort = resolveVitePort()
const rendererUrl = viteUrl(vitePort)
if (vitePort !== declaredPort) {
  console.warn(
    `WARNING: VITE_PORT=${vitePort} but the main process loads the dev renderer from port ${declaredPort} ` +
      '(pinned in electron/window-create.cjs and electron/url-policy.cjs). The desktop window will be blank ' +
      'until those are changed too.'
  )
}

console.log(`Development mode: ${runtimeConfig.mode} (${runtimeConfig.hermesHome}) on port ${runtimeConfig.preferredPort}`)
console.log(`Renderer: ${rendererUrl}`)
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm'
const vite = spawn(npm, ['run', 'dev:web'], { cwd: root, env, stdio: 'inherit', windowsHide: true })
children.add(vite)
vite.once('exit', code => shutdown(code || 0))
process.on('SIGINT', () => shutdown(130))
process.on('SIGTERM', () => shutdown(143))

try {
  await waitForThisProjectsVite(rendererUrl)
  const desktop = spawn(electronBinary, ['.'], { cwd: root, env, stdio: 'inherit', windowsHide: true })
  children.add(desktop)
  desktop.once('exit', code => shutdown(code || 0))
} catch (error) {
  console.error(error.message || error)
  shutdown(1)
}
