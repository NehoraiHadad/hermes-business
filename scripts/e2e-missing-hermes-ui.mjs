import { existsSync, mkdirSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { _electron as electron } from 'playwright-core'

const root = path.resolve(import.meta.dirname, '..')
const executable = path.join(root, 'release', 'win-unpacked', "תכל'ס.exe")
if (!existsSync(executable)) throw new Error(`Packaged executable is missing: ${executable}`)

const suffix = `${process.pid}-${Date.now()}`
const hermesHome = path.join(os.tmpdir(), `hb-missing-hermes-${suffix}`)
const missingBinary = path.join(hermesHome, 'missing-hermes.exe')
const userData = path.join(os.tmpdir(), `hb-missing-ui-${suffix}`)
const screenshot = path.join(root, 'release', 'e2e-missing-hermes-ui.png')
mkdirSync(hermesHome, { recursive: true })

const app = await electron.launch({
  executablePath: executable,
  args: [`--user-data-dir=${userData}`],
  env: {
    ...process.env,
    HERMES_HOME: '',
    HERMES_BUSINESS_HOME: hermesHome,
    HERMES_BUSINESS_HERMES_EXE: missingBinary
  },
  timeout: 120_000
})

try {
  const page = await app.firstWindow({ timeout: 60_000 })
  await page.waitForLoadState('domcontentloaded')
  const runtime = await page.evaluate(() => window.hermesDesktop?.getRuntime())
  if (runtime?.installed) throw new Error(`Explicit empty HERMES_HOME reused another install: ${JSON.stringify(runtime)}`)

  await page.getByText('Hermes עדיין אינו מותקן', { exact: true }).waitFor({ state: 'visible' })
  const installButton = page.getByRole('button', { name: 'התקן את Hermes והמשך' })
  await installButton.waitFor({ state: 'visible' })
  if (await installButton.isDisabled()) throw new Error('The no-Hermes install action is unexpectedly disabled')
  await page.screenshot({ path: screenshot })

  console.log(
    JSON.stringify(
      {
        ok: true,
        runtime: { installed: runtime.installed, running: runtime.running, version: runtime.version },
        installActionVisible: true,
        screenshot
      },
      null,
      2
    )
  )
} finally {
  await app.close()
  for (const target of [hermesHome, userData]) {
    if (target.startsWith(os.tmpdir()) && existsSync(target)) rmSync(target, { recursive: true, force: true })
  }
}
