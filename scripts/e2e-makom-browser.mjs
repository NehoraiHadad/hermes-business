import { createServer } from 'vite'
import { chromium } from 'playwright-core'
import { spawn } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import net from 'node:net'
import assert from 'node:assert/strict'
import { reapProcessTree } from '../electron/process-util.cjs'
import { removeOwnedDir } from './lib/probes/hermes/real-loader-fs.mjs'
import { verifyMakomUi } from './lib/probes/hermes/makom-ui.mjs'
const metadata = JSON.parse(readFileSync('.artifacts/makom/pinned-runtime.json', 'utf8'))
const home = mkdtempSync(path.join(tmpdir(), 'tachles-makom-ui-'))
const token = randomBytes(32).toString('hex')
const port = await new Promise(resolve => { const probe = net.createServer().listen(0, '127.0.0.1', () => { const value = probe.address().port; probe.close(() => resolve(value)) }) })
const origin = 'http://127.0.0.1:' + port
const python = process.env.MAKOM_HERMES_PYTHON || path.join(process.env.LOCALAPPDATA, 'hermes/hermes-agent/venv/Scripts/python.exe')
const server = spawn(python, ['scripts/makom-http-test-server.py', home, String(port)], { windowsHide: true,
  env: { ...process.env, PYTHONUTF8: '1', PYTHONPATH: metadata.engine, HERMES_HOME: home, HERMES_DASHBOARD_SESSION_TOKEN: token,
    WHATSAPP_ENABLED: '0', TELEGRAM_ENABLED: '0', HERMES_DISABLE_UPDATE_CHECK: '1' }, stdio: ['ignore', 'pipe', 'pipe'] })
let logs = '', vite, browser
server.stdout.on('data', data => { logs += data }); server.stderr.on('data', data => { logs += data })
try {
  console.log('Waiting for the isolated Hermes backend.')
  let ready = false
  for (let i = 0; i < 160; i++) {
    const probe = await fetch(origin + '/api/plugins/business-shell/makom', { headers: { 'X-Hermes-Session-Token': token, Authorization: 'Bearer ' + token }, signal: AbortSignal.timeout(3000) }).catch(() => null)
    ready = probe?.ok || false
    if (ready) break
    if (probe) throw Error('Hermes Makom route returned ' + probe.status + ': ' + (await probe.text()).slice(0,500))
    if (server.exitCode !== null) throw Error('Hermes backend exited')
    await new Promise(resolve => setTimeout(resolve, 500))
  }
  assert.ok(ready, 'The actual Hermes backend must mount the Makom API')
  for (const suffix of ['', '/connect', '/disconnect']) {
    const response = await fetch(origin + '/api/plugins/business-shell/makom' + suffix, suffix ? {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ profiles: ['default'] })
    } : {})
    assert.ok([401, 403].includes(response.status), 'Local connection routes require Hermes authentication')
  }
  console.log('Hermes API ready; opening the shared production form.')
  vite = await createServer({ configFile: false, root: process.cwd(), cacheDir: path.join(home, 'vite-cache'), optimizeDeps: { noDiscovery: true, include: ['react', 'react-dom/client'] }, plugins: [{ name: 'makom-test-page', configureServer(server) {
    server.middlewares.use('/__makom-test', (_req, res) => { res.setHeader('Content-Type', 'text/html'); res.end('<!doctype html><html lang="he" dir="rtl"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>בדיקת חיבור מקום</title><body style="font:16px Arial;padding:24px;background:#f7f5ef"><div id="root"></div><script type="module" src="/scripts/lib/makom-browser-entry.js"></script>') })
  } }], server: { host: '127.0.0.1', port: 0, watch: null, proxy: {
    '/api/plugins/business-shell/makom': { target: origin, changeOrigin: true, headers: { 'X-Hermes-Session-Token': token, Authorization: 'Bearer ' + token },
      configure: proxy => proxy.on('proxyReq', request => request.removeHeader('origin')) }
  } } })
  await vite.listen()
  console.log('Vite ready.')
  browser = await chromium.launch({ channel: 'msedge', headless: true })
  console.log('Browser launched.')
  const page = await browser.newPage({ viewport: { width: 1280, height: 1000 } })
  page.setDefaultNavigationTimeout(120000)
  const errors = []; page.on('pageerror', error => errors.push(error.message))
  await page.goto(vite.resolvedUrls.local[0] + '__makom-test')
  console.log('Browser form opened.')
  await page.getByLabel('העוזר הראשי').waitFor()
  const result = await verifyMakomUi(page, { link: 'http://127.0.0.1:8000/public/shadmot', directory: '.artifacts/makom/browser', connectedCheck: async () => {
    const response = await fetch(origin + '/api/skills?profile=default', { headers: { 'X-Hermes-Session-Token': token, Authorization: 'Bearer ' + token }, signal: AbortSignal.timeout(10000) })
    assert.equal(response.status, 200)
    assert.ok((await response.text()).includes('makom-community'), 'Native Hermes skill discovery must find the installed skill')
  } })
  await page.setViewportSize({ width: 390, height: 844 })
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false)
  await page.screenshot({ path: '.artifacts/makom/browser/mobile.png', fullPage: true })
  assert.deepEqual(errors, [])
  writeFileSync('.artifacts/makom/browser.json', JSON.stringify({ ...result, actualHermesBackend: true, mobile: true, errors }, null, 2))
  console.log('Browser -> authenticated Hermes API -> profile-bound MCP -> live Makom passed.')
} catch (error) {
  console.error(error)
  throw error
} finally {
  if (browser) await browser.close()
  if (vite) await vite.close()
  reapProcessTree(server)
  writeFileSync('.artifacts/makom/http-server.log', logs.replaceAll(token, '[test-session]'))
  removeOwnedDir(home)
}
