// Real loader-contribution UI assertions for the real-loader E2E, split into two
// honestly-distinct claims:
//   1. CONTRACT proof   — the installed renderer runtime-loader discovered
//      <isoHome>/desktop-plugins/business-shell/plugin.js and rendered its
//      contributions. Proven by the rendered `לעסק` nav item (the loaded-plugin
//      inventory is not exposed on window, so the rendered contribution IS it).
//   2. CLICK-PATH acceptance — a NORMAL, hit-tested user-input path actually
//      navigates/opens the page. Two OFFICIAL Hermes affordances are tried, in
//      priority order, with real Playwright pointer/keyboard input:
//        a. the sidebar nav row — a direct pointer click (the primary affordance);
//        b. the command palette — the first-class ⌘/Ctrl+K navigation surface,
//           driven by real keyboard (open) + real pointer (select the plugin's
//           own PALETTE_AREA command `business.open`, which runs
//           host.navigate('/business')).
//      On installed Hermes Desktop 0.19.1 the sidebar row's pointer click is
//      intercepted by an overlay `div[data-sidebar="group"]` (a product
//      hit-test bug — see docs/hermes-integration.md), so acceptance normally
//      lands on the command palette. Because the palette navigates through the
//      official router, the workspace pane is fronted and the page (and its
//      Automations tab) become hit-testable by a real pointer.
//
//      A hash-router path may DIAGNOSE that the route contribution still works,
//      but it must NEVER stand in for a real user-input path: if BOTH official
//      affordances fail, the run reports a product/hit-test bug (BLOCKED), it
//      does not silently pass.

const NAV_LABEL = 'לעסק'
const SHELL_MARKER = 'פתח את Hermes המלא'
const TASKS_TAB = 'משימות'
const AUTOMATIONS_TITLE = 'משימות קבועות'
const AUTOMATIONS_LOADING = 'טוען משימות…'
const PAUSED_BADGE = 'מושהית'
// Shown ONLY when the paused-inclusive door was unavailable and Automations fell
// back to the active-only cron.manage RPC. Its ABSENCE after a settled load, plus
// a rendered PAUSED row, proves the companion backend was reached.
const FALLBACK_NOTICE = 'התצוגה הפשוטה מציגה משימות פעילות מתוך Hermes'

// The plugin's PALETTE_AREA contribution (business-shell plugin.js): a genuine,
// user-selectable ⌘K command whose `run` calls host.navigate('/business').
const BUSINESS_COMMAND_LABEL = /פתח את Hermes לעסק/
// A distinctive term from that command's label/keywords, typed to filter the
// palette down to it (the palette ranks the exact-substring match to the top).
const BUSINESS_COMMAND_QUERY = 'לעסק'
// Default binding for `nav.commandPalette` (lib/keybinds/actions.ts: mod+k). The
// real-loader run is win32-only (see e2e-real-loader.mjs), so mod === Control.
const PALETTE_OPEN_KEY = 'Control+KeyK'

/** Wait until the gateway-connecting overlay (z-(--z-connecting)) has faded /
 *  detached — i.e. the ISOLATED backend actually connected. Until then it
 *  intercepts every click. A cold boot against a fresh home is slow; allow time. */
export async function waitForGatewayConnected(page, { timeoutMs = 180_000 } = {}) {
  await page.waitForFunction(
    () => {
      const overlays = [...document.querySelectorAll('div.fixed.inset-0')].filter(el =>
        String(el.className || '').includes('z-(--z-connecting)')
      )
      if (overlays.length === 0) return true
      return overlays.every(el => {
        const s = getComputedStyle(el)
        return s.opacity === '0' || s.pointerEvents === 'none' || s.display === 'none'
      })
    },
    undefined,
    { timeout: timeoutMs, polling: 500 }
  )
}

function navItem(page) {
  return page
    .locator('a, button, [role="link"], [role="button"], [role="menuitem"]')
    .filter({ hasText: new RegExp(`^\\s*${NAV_LABEL}\\s*$`) })
    .first()
}

/** CONTRACT proof: the plugin's SIDEBAR_NAV_AREA contribution rendered (loader
 *  ran) and the isolated backend connected. Throws if the contribution never
 *  appears. Does NOT navigate — that is the click-path's job. */
export async function assertLoaderContribution(page, { timeoutMs = 120_000 } = {}) {
  const nav = navItem(page)
  await nav.waitFor({ state: 'visible', timeout: timeoutMs })
  const navText = (await nav.innerText()).trim()
  await waitForGatewayConnected(page)
  return { navRendered: true, navText }
}

/** Open the official ⌘/Ctrl+K command palette with a real keyboard press and
 *  return its (visible) search input. Idempotent: only presses the toggle key
 *  when the palette isn't already open, so a slow first open is never toggled
 *  back shut by a retry. */
async function openCommandPalette(page, { attempts = 4, perAttemptMs = 4000 } = {}) {
  const input = page.locator('[cmdk-input]').first()
  for (let i = 0; i < attempts; i += 1) {
    if (await input.isVisible().catch(() => false)) return input
    await page.keyboard.press(PALETTE_OPEN_KEY)
    try {
      await input.waitFor({ state: 'visible', timeout: perAttemptMs })
      return input
    } catch {
      /* try again — the first keydown may have been swallowed mid-boot */
    }
  }
  // Final attempt: surface the real failure to the caller.
  await input.waitFor({ state: 'visible', timeout: perAttemptMs })
  return input
}

/** Attempt the PRIMARY affordance: a real, hit-tested pointer click on the
 *  sidebar nav row. Short-budgeted because the installed Hermes intercepts it —
 *  we don't want to burn the whole timeout before the palette fallback. */
async function trySidebarPointer(page, shellMarker, { clickTimeoutMs, renderTimeoutMs }) {
  const nav = navItem(page)
  try {
    await nav.click({ timeout: clickTimeoutMs }) // real pointer click; NOT force
    await shellMarker.waitFor({ state: 'visible', timeout: renderTimeoutMs })
    return { ok: true }
  } catch (error) {
    return { ok: false, diagnostic: String(error?.message || error) }
  }
}

/** Attempt the OFFICIAL command palette: open it with a real keyboard press,
 *  type to filter down to the plugin's contributed `business.open` command, and
 *  select it with the ENTER key. Its `run` calls host.navigate('/business')
 *  through the official router, which fronts the workspace pane.
 *
 *  Selection is KEYBOARD, not a pointer click, on purpose: this installed Hermes
 *  runs with a non-unity webContents zoom / HiDPI devicePixelRatio, and
 *  Playwright's synthetic *pointer* coordinates are offset by that factor — so
 *  elementFromPoint resolves to a full-size ancestor (cmdk-root / the sidebar
 *  group) and the click is refused. Enter is the canonical ⌘K UX (type → Enter)
 *  and needs no coordinate hit-test, so it drives the real command reliably. */
async function tryCommandPalette(page, shellMarker, { renderTimeoutMs }) {
  const devicePixelRatio = await page.evaluate(() => window.devicePixelRatio).catch(() => null)
  try {
    const input = await openCommandPalette(page)
    // Real keystrokes into the auto-focused palette input; cmdk re-ranks and
    // auto-highlights the best match (our business.open command) on each change.
    await input.pressSequentially(BUSINESS_COMMAND_QUERY, { delay: 20 })
    // Confirm the contributed command actually surfaced before committing Enter.
    const row = page.getByRole('option').filter({ hasText: BUSINESS_COMMAND_LABEL }).first()
    await row.waitFor({ state: 'visible', timeout: 10_000 })
    await input.press('Enter') // keyboard select — coordinate-free
    await shellMarker.waitFor({ state: 'visible', timeout: renderTimeoutMs })
    return { ok: true, label: 'business.open', selectedBy: 'keyboard-enter', devicePixelRatio }
  } catch (error) {
    // Never leave the palette open — it's a modal portal that would cover the
    // Automations assertions that follow.
    await page.keyboard.press('Escape').catch(() => undefined)
    return { ok: false, diagnostic: String(error?.message || error), devicePixelRatio }
  }
}

/**
 * CLICK-PATH acceptance: navigate to `/business` through a NORMAL Hermes
 * user-input affordance. Tries the sidebar pointer click first (auto-upgrades
 * the mechanism the day the upstream hit-test bug is fixed), then the command
 * palette (the reliable official path today). On total failure, DIAGNOSE via the
 * hash router to distinguish a hit-test/input bug (route contribution fine) from
 * a genuine route-contract failure — but return clickPathOk:false either way so
 * the orchestrator fails the user-path acceptance instead of hiding the bug.
 */
export async function openBusinessViaPointer(page, { clickTimeoutMs = 20_000, renderTimeoutMs = 20_000 } = {}) {
  const shellMarker = page.getByText(SHELL_MARKER, { exact: false }).first()

  // (a) Primary affordance — the sidebar nav row. Short budget: on installed
  //     Hermes 0.19.1 this is intercepted by an overlay div[data-sidebar="group"].
  const sidebar = await trySidebarPointer(page, shellMarker, {
    clickTimeoutMs: Math.min(6_000, clickTimeoutMs),
    renderTimeoutMs
  })
  if (sidebar.ok) {
    return { clickPathOk: true, businessPageRendered: true, mechanism: 'sidebar-pointer', sidebar }
  }

  // (b) Official command palette — first-class ⌘/Ctrl+K + the plugin's own
  //     contributed command. Real keyboard throughout: press to open, type to
  //     filter, Enter to select (coordinate-free, so the zoom/DPR pointer offset
  //     that breaks synthetic clicks can't block it).
  const palette = await tryCommandPalette(page, shellMarker, { renderTimeoutMs })
  if (palette.ok) {
    return {
      clickPathOk: true,
      businessPageRendered: true,
      mechanism: 'command-palette',
      sidebar,
      palette
    }
  }

  // Neither official user-input path worked. Hash router = DIAGNOSTIC only.
  let contractOpens = false
  try {
    await page.evaluate(() => {
      window.location.hash = '#/business'
    })
    await shellMarker.waitFor({ state: 'visible', timeout: renderTimeoutMs })
    contractOpens = true
  } catch {
    /* the route contribution itself is broken */
  }
  return {
    clickPathOk: false,
    businessPageRendered: contractOpens,
    contractOpens,
    mechanism: 'user-input-failed',
    sidebar,
    palette
  }
}

/**
 * From the open /business page: open Automations via a REAL pointer click on the
 * tab, then prove the paused-inclusive companion door was used by asserting the
 * SEEDED paused job renders with its paused badge AND the active-only fallback
 * notice is absent. Empty / loading / error cannot pass. Returns the observed
 * facts including tabClickOk (true when a REAL input path — pointer OR keyboard —
 * opened the tab) and tabMechanism. The dispatchEvent path is a DIAGNOSTIC-only
 * fallback so the backend-door proof can still run and pinpoint the failure; it
 * never sets tabClickOk true.
 */
export async function assertAutomationsBackend(page, { seededJobName, timeoutMs = 30_000 } = {}) {
  const tab = page.getByRole('button', { name: TASKS_TAB, exact: true }).first()
  const title = page.getByText(AUTOMATIONS_TITLE, { exact: false }).first()
  let tabClickOk = false
  let tabMechanism = null
  try {
    await tab.click({ timeout: 6_000 }) // real pointer click (works when zoom/DPR == 1)
    await title.waitFor({ state: 'visible', timeout: timeoutMs })
    tabClickOk = true
    tabMechanism = 'pointer'
  } catch {
    try {
      // Real KEYBOARD activation: press() focuses the tab and sends a genuine
      // Enter keydown, which a native <button> turns into a click — no
      // coordinate hit-test, so it survives the zoom/DPR pointer offset.
      await tab.press('Enter', { timeout: 6_000 })
      await title.waitFor({ state: 'visible', timeout: timeoutMs })
      tabClickOk = true
      tabMechanism = 'keyboard-enter'
    } catch {
      // Diagnose only: fire the React onClick directly so the rest of the proof
      // can still run and pinpoint whether the backend door works despite the
      // input path failing. Never sets tabClickOk true.
      await tab.dispatchEvent('click').catch(() => undefined)
      await title.waitFor({ state: 'visible', timeout: timeoutMs })
      tabMechanism = 'dispatch-diagnostic'
    }
  }

  // Wait for the async list to settle (loading placeholder gone).
  await page
    .getByText(AUTOMATIONS_LOADING, { exact: false })
    .first()
    .waitFor({ state: 'hidden', timeout: timeoutMs })
    .catch(() => undefined)

  // POSITIVE proof: the seeded PAUSED job row is visible. A paused row can only
  // come from list_jobs(include_disabled=True) — the fallback door filters it out.
  const seededRow = page.getByText(seededJobName, { exact: false }).first()
  await seededRow.waitFor({ state: 'visible', timeout: timeoutMs })
  const pausedBadgeVisible = (await page.getByText(PAUSED_BADGE, { exact: true }).count()) > 0
  const fallbackNoticePresent = (await page.getByText(FALLBACK_NOTICE, { exact: false }).count()) > 0

  if (fallbackNoticePresent) {
    throw new Error('Automations fell back to the active-only cron.manage RPC — companion backend door NOT reached')
  }
  if (!pausedBadgeVisible) {
    throw new Error('seeded PAUSED job rendered without its paused badge — paused-inclusive door not proven')
  }
  return {
    automationsOpened: true,
    tabClickOk,
    tabMechanism,
    fallbackNoticePresent,
    backendDoorUsed: true,
    seededPausedRendered: true
  }
}
