// Real development Companion, native IPC/preload + Hermes + Makom public reads.
// All application/profile/cache state is isolated; no inference or messages.
import assert from 'node:assert/strict'
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import path from 'node:path'
import { resolveHermesBinary } from '../electron/runtime-mode.cjs'
import { tmpdir } from 'node:os'
import { seedCompanionContext, serveCompanionBuild } from './lib/makom-companion-fixture.mjs'
import { electronDriverArgs } from './lib/electron-driver.mjs'
import { _electron as electron } from 'playwright-core'
import { createSandbox, removeOwnedDir } from './lib/probes/hermes/real-loader-fs.mjs'
import { buildChildEnv } from './lib/probes/hermes/real-loader-env.mjs'
import { verifyMakomUi } from './lib/probes/hermes/makom-ui.mjs'
import { reapProcessTree } from '../electron/process-util.cjs'
import { snapshotLoginItem, verifyAndRestoreLoginItem } from './lib/isolated-e2e/login-item-guard.mjs'
const root = process.cwd()
const runtime = JSON.parse(readFileSync('.artifacts/makom/runtime.json', 'utf8'))
assert.ok(existsSync(runtime.launcher), 'Prepare the test runtime with scripts/makom-test-runtime.py first')
const sandbox = createSandbox('hermes-business-e2e-makom-')
const installedHome = path.resolve(runtime.root)
assert.ok(installedHome.startsWith(path.resolve(tmpdir()) + path.sep) &&
  path.basename(installedHome).startsWith('tachles-makom-runtime-'), 'Use only the disposable official test installation')
// Match a real installation: PM dependency selection belongs to its data home.
// An unrelated empty home causes native plugin admission to build a minimal
// dependency set. User data/Electron caches remain in this run's own sandbox.
sandbox.hermesHome = installedHome
const publishedCli = resolveHermesBinary({ hermesHome: installedHome, hermesBinary: null })
assert.ok(publishedCli && publishedCli.startsWith(installedHome + path.sep), 'Discover the real published native CLI')
const loginItemBefore = snapshotLoginItem()
const env = buildChildEnv({ base: process.env, sandbox, cliBin: publishedCli })
Object.assign(env, {
  HERMES_BUSINESS_DEV_RUNTIME: 'isolated-dev-home',
  HERMES_BUSINESS_DEV_HERMES_HOME: sandbox.hermesHome,
  HERMES_BUSINESS_HERMES_EXE: publishedCli,
  HERMES_BUSINESS_DEV_PORT: '19179',
  HERMES_NO_UPDATE_CHECK: '1', HERMES_DISABLE_UPDATE_CHECK: '1', DO_NOT_TRACK: '1'
})
let app, vite, page
const errors = []
try {
  // Dev Companion has one canonical dev URL. Refuse to collide with a server
  // owned by another task; never stop or replace an existing listener.
  try { await fetch('http://127.0.0.1:5173', { signal: AbortSignal.timeout(2000) }); throw Error('Port 5173 is already in use') }
  catch (error) { if (error.message === 'Port 5173 is already in use') throw error }
  await seedCompanionContext(root, sandbox)
  vite = await serveCompanionBuild(root)
  console.log('Launching the isolated Companion with the runtime Hermes CLI.')
  app = await electron.launch({
    executablePath: path.join(root, 'node_modules/electron/dist/electron.exe'),
    args: electronDriverArgs([root]), cwd: root, env, timeout: 120000
  })
  console.log('Companion launched through the native Electron driver.')
  page = await app.firstWindow()
  page.setDefaultTimeout(60000)
  page.on('pageerror', error => errors.push(error.message))
  let running = false
  for (let i = 0; i < 1200; i++) {
    running = await page.evaluate(async () => Boolean(window.hermesDesktop && (await window.hermesDesktop.getRuntime()).running))
    if (running) break
    await new Promise(resolve => setTimeout(resolve, 500))
  }
  assert.ok(running, 'The isolated native Hermes runtime must become ready')
  assert.equal(await page.evaluate(async () => (await window.hermesDesktop.getRuntime()).mode), 'development')
  await page.evaluate(() => window.hermesDesktop.setWindowMode('full'))
  await page.getByRole('button', { name: /^הגדרות ועזרה/ }).click()
  await page.getByRole('button', { name: /^חיבורים/ }).click()
  await page.getByRole('button', { name: 'חבר את מקום — מידע מהקהילה', exact: true }).click()
  const result = await verifyMakomUi(page, { link: 'http://127.0.0.1:8000/public/shadmot', directory: '.artifacts/makom/companion' })
  assert.deepEqual(errors, [])
  writeFileSync('.artifacts/makom/companion.json', JSON.stringify({ ...result, nativeIpc: true, isolated: true, pageErrors: errors }, null, 2))
  console.log('Companion Makom connect, live verification and disconnect passed through native IPC.')
} catch (error) {
  console.error(error)
  if (app) {
    const mainLogs = await app.evaluate(async ({ app }) => {
      const { createRequire } = process.getBuiltinModule('node:module')
      const load = createRequire(app.getAppPath() + '/package.json')
      return { logs: load('./electron/logs.cjs').recentLogs(), errors: load('./electron/error-journal.cjs').recentAppErrors() }
    }).catch(failure => ({ error: failure.message }))
    writeFileSync('.artifacts/makom/companion-main-diagnostics.json', JSON.stringify(mainLogs, null, 2))
  }
  if (page) {
    const logs = await page.evaluate(() => window.hermesDesktop.getRecentLogs()).catch(() => null)
    writeFileSync('.artifacts/makom/companion-runtime-log.json', JSON.stringify(logs, null, 2))
  }
  if (page) await page.screenshot({ path: '.artifacts/makom/companion-failure.png', fullPage: true }).catch(() => {})
  throw error
} finally {
  if (app) {
    const child = app.process()
    await app.close().catch(() => {})
    reapProcessTree(child)
  }
  if (vite) await new Promise(resolve => vite.close(resolve))
  removeOwnedDir(sandbox.root)
  const loginItem = verifyAndRestoreLoginItem(loginItemBefore)
  assert.ok(!loginItem.applicable || loginItem.unchanged, 'The isolated Companion must not modify user login recovery')
}
