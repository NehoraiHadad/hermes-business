// Packaged-app probe for the honest "Hermes is not installed yet" state.
//
// It points the packaged companion at a throwaway Hermes home plus a deliberately
// non-existent Hermes binary and asserts the UI says so instead of silently
// reusing another installation.
//
// Isolation contract (task 4.3):
//   * the operator environment must PROVE isolation — this probe now runs the
//     same assertSafeInstalledE2E gate as every other installed-app probe, which
//     it previously skipped entirely;
//   * the throwaway home is named `hermes-e2e-home-*` so the shared test-path
//     sentinels (electron/runtime-mode.cjs `isTestPath`,
//     scripts/lib/environment-path.mjs `isHermesTestPathEntry`) actually cover
//     it. The old `hb-missing-hermes-*` prefix matched neither, so the temp home
//     and the temp binary were invisible to both guards;
//   * BECAUSE the sentinels now cover it, the probe can no longer use the
//     PRODUCTION runtime: `productionConfig` refuses a temporary E2E home/binary
//     outright (main.cjs then fails closed and quits, so no window ever opens).
//     That refusal is the desired product behaviour, so the probe arms the
//     DEVELOPMENT runtime instead — the mode purpose-built for an isolated home
//     plus an explicit, product-owned Hermes binary. `resolveHermesBinary` treats
//     an explicit-but-missing binary as authoritative and returns null, which is
//     exactly the truthful "not installed" runtime state under test;
//   * the CHILD environment is scrubbed of HERMES_HOME and every
//     HERMES_BUSINESS_QA_* variable (cleanProcessEnv) so no ambient QA override
//     can hijack the runtime selection. The safety gate is therefore asserted
//     against the OPERATOR env (process.env) via `safetyEnv` — see
//     scripts/lib/installed-launch.mjs.

import { existsSync, mkdirSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { assertSafeInstalledE2E } from './lib/e2e-safety.mjs'
import { requireElectron } from './lib/electron-require.mjs'
import { cleanProcessEnv } from './lib/environment-path.mjs'
import { removeTempHome } from './lib/isolated-runtime.mjs'
import { withProbeApp } from './lib/probe-app.mjs'

assertSafeInstalledE2E()

// Env names come from the runtime contract itself — never re-typed here.
const { DEV_SENTINEL_ENV, DEV_SENTINEL_VALUE, DEV_HOME_ENV, DEV_BINARY_ENV, DEV_PORT_ENV } =
  requireElectron('runtime-mode.cjs')

const root = path.resolve(import.meta.dirname, '..')
const executable = path.join(root, 'release', 'win-unpacked', "תכל'ס.exe")
if (!existsSync(executable)) throw new Error(`Packaged executable is missing: ${executable}`)

const suffix = `${process.pid}-${Date.now()}`
const hermesHome = path.join(os.tmpdir(), `hermes-e2e-home-missing-${suffix}`)
const missingBinary = path.join(hermesHome, 'missing-hermes.exe')
const screenshot = path.join(root, 'release', 'e2e-missing-hermes-ui.png')
mkdirSync(hermesHome, { recursive: true })

try {
  await withProbeApp(
    {
      prefix: 'hermes-e2e-home-missing-ui',
      executablePath: executable,
      completeOnboarding: false,
      boot: 'none',
      waitForShell: false,
      safetyEnv: process.env,
      env: {
        ...cleanProcessEnv(process.env),
        [DEV_SENTINEL_ENV]: DEV_SENTINEL_VALUE,
        [DEV_HOME_ENV]: hermesHome,
        [DEV_BINARY_ENV]: missingBinary,
        [DEV_PORT_ENV]: process.env.HERMES_BUSINESS_MISSING_HERMES_PORT || '19911'
      }
    },
    async ({ page }) => {
      const runtime = await page.evaluate(() => window.hermesDesktop?.getRuntime())
      if (runtime?.installed) {
        throw new Error(`The isolated dev home reused another Hermes install: ${JSON.stringify(runtime)}`)
      }

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
    }
  )
} finally {
  await removeTempHome(hermesHome)
}
