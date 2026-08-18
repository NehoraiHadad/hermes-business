// Pure scheduling decision for the תכל'ס (companion) PASSIVE self-update check —
// "may I check right now, and when should I wake up next". No Electron, no
// timers, no filesystem, no clock of its own: the current time, the durable
// last-check timestamp and the disabled flag are all injected, so the entire
// re-arming schedule is unit-testable without a running app. The impure half
// (real setTimeout, real BrowserWindow, real IPC push) stays in main.cjs — the
// same split companion-update-core.cjs / companion-update.cjs already uses.
//
// WHY this module exists (the bug it was extracted to fix): תכל'ס is
// TRAY-RESIDENT — `window-all-closed` deliberately does not quit, the assistant
// stays reachable from the tray — so a session routinely stays alive for weeks.
// The original wiring armed a single one-shot setTimeout 60s after `ready` and
// nothing else, which meant a machine left on for a fortnight performed exactly
// ONE update check, at launch. The 24h constant was only ever a staleness gate,
// never a scheduler.
//
// WHY a re-arming setTimeout rather than one setInterval: Windows suspends
// timers across sleep/hibernate, so a long-period interval can fire once
// immediately on resume and then drift indefinitely. A timeout that re-arms
// itself after each run is self-healing when combined with the DURABLE
// lastCheckedAt gate below — waking early or late only changes when the question
// gets asked, never the answer. The durable timestamp, not the timer, decides
// whether a network call actually happens (docs/specs/versioning.md §6.5, §9:
// "פסיבית — לכל היותר אחת ל־24 שעות (throttle עמיד)").

// 60s after `ready` before the first decision is even allowed, so the passive
// check never competes with the Hermes startup sequence (§6.5).
const PASSIVE_UPDATE_INITIAL_DELAY_MS = 60_000
// The durable throttle: at most one passive check per 24h (§9).
const PASSIVE_UPDATE_INTERVAL_MS = 24 * 60 * 60 * 1000
// Floor for any scheduled wake. Only guards against a rounded-to-zero (or
// negative) delay turning the re-arming loop into a busy spin; it is not a
// policy knob — the real spacing is always the durable throttle.
const PASSIVE_UPDATE_MIN_WAKE_MS = 1_000

// Every reason a decision can carry. Exported so callers/tests name the branch
// instead of matching a string literal, and so a log line stays greppable.
const PASSIVE_CHECK_REASONS = Object.freeze({
  DISABLED: 'disabled',
  INVALID_CLOCK: 'invalid-clock',
  NOT_STARTED: 'not-started',
  STARTUP_DELAY: 'startup-delay',
  NEVER_CHECKED: 'never-checked',
  CLOCK_SKEW: 'clock-skew',
  STALE: 'stale',
  FRESH: 'fresh'
})

// A finite, strictly positive option value, or the module default. Anything else
// (undefined, NaN, Infinity, 0, a negative, a string) is a caller mistake that
// must not be able to collapse the schedule into a busy loop.
function positiveOption(value, fallback) {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : fallback
}

// Clamp a computed wake delay into [min, max]. The upper bound matters for more
// than tidiness: setTimeout stores its delay in a signed 32-bit int, and a delay
// above 2^31-1 ms (~24.8 days) silently fires IMMEDIATELY. A corrupt durable
// timestamp far in the past/future must therefore never be able to produce an
// unbounded delay. A non-finite computation degrades to the upper bound (check
// later) rather than to zero (check now).
function clampWake(value, min, max) {
  if (!Number.isFinite(value)) return max
  if (value < min) return min
  return value > max ? max : value
}

/**
 * Decide whether the passive companion self-update check may run right now, and
 * when the caller should next wake up to ask again.
 *
 * Inputs (all injected — this module reads no ambient state):
 *   - `now`           — the current epoch ms (`Date.now()` at the call site).
 *   - `readyAt`       — epoch ms at which the passive scheduler was started
 *                       (app `ready`). `null`/absent means "not started yet".
 *   - `lastCheckedAt` — the DURABLE last-check timestamp read from
 *                       companion-update-state.json, or `null` when there is no
 *                       state file / it is unreadable (see
 *                       companion-update.getLastCheckedAt: a missing file is not
 *                       proof a check ran, so it correctly reads as "due").
 *   - `disabled`      — the result of `isPassiveUpdateCheckDisabled(env)` (QA
 *                       runtime override / TACHLES_DISABLE_UPDATE_CHECK, R7).
 *   - `initialDelayMs` / `intervalMs` / `minWakeMs` — overridable only for tests.
 *
 * Returns `{ check, reason, nextWakeInMs }`:
 *   - `check`        — may a real check run now.
 *   - `reason`       — which branch decided it (PASSIVE_CHECK_REASONS).
 *   - `nextWakeInMs` — how long until the caller should ask again, or `null` for
 *                      "do not arm a timer at all". `null` is deliberate for the
 *                      disabled branch: an isolated/packaged E2E run must leave
 *                      NO passive timer behind (hermetic, R7), not merely a timer
 *                      that keeps deciding "no".
 *
 * Total function: never throws, whatever it is handed (a missing argument
 * object, a NaN clock, a string timestamp).
 */
function decidePassiveCheck(input = {}) {
  const {
    now,
    readyAt = null,
    lastCheckedAt = null,
    disabled = false
  } = input || {}
  const initialDelayMs = positiveOption(input && input.initialDelayMs, PASSIVE_UPDATE_INITIAL_DELAY_MS)
  const intervalMs = positiveOption(input && input.intervalMs, PASSIVE_UPDATE_INTERVAL_MS)
  const minWakeMs = positiveOption(input && input.minWakeMs, PASSIVE_UPDATE_MIN_WAKE_MS)

  // Disabled wins over everything and leaves no timer behind.
  if (disabled === true) return { check: false, reason: PASSIVE_CHECK_REASONS.DISABLED, nextWakeInMs: null }

  // Without a trustworthy clock nothing below can be reasoned about. Fail closed:
  // no check, and no timer either (a re-arm computed from a broken clock is how
  // a busy loop starts).
  if (typeof now !== 'number' || !Number.isFinite(now)) {
    return { check: false, reason: PASSIVE_CHECK_REASONS.INVALID_CLOCK, nextWakeInMs: null }
  }

  // The scheduler has not been started yet (pre-`ready`). Event-driven callers —
  // the window show/focus trigger — are registered at module load, i.e. possibly
  // before `ready`; they must be inert until the schedule actually starts, and
  // must not arm anything themselves.
  if (typeof readyAt !== 'number' || !Number.isFinite(readyAt)) {
    return { check: false, reason: PASSIVE_CHECK_REASONS.NOT_STARTED, nextWakeInMs: null }
  }

  // The 60s post-ready quiet period (§6.5). Also absorbs the window `show`/
  // `focus` that the very first window emits while it is coming up — those are
  // the boot, not a user returning from the tray. A backwards clock jump makes
  // `sinceReady` negative; the clamp keeps the resulting wait at most one full
  // initial delay.
  const sinceReady = now - readyAt
  if (sinceReady < initialDelayMs) {
    return {
      check: false,
      reason: PASSIVE_CHECK_REASONS.STARTUP_DELAY,
      nextWakeInMs: clampWake(initialDelayMs - sinceReady, minWakeMs, initialDelayMs)
    }
  }

  // No durable timestamp (first run ever, or an unreadable/corrupt state file):
  // absence is not proof a check happened recently, so this is due.
  if (typeof lastCheckedAt !== 'number' || !Number.isFinite(lastCheckedAt)) {
    return { check: true, reason: PASSIVE_CHECK_REASONS.NEVER_CHECKED, nextWakeInMs: intervalMs }
  }

  const elapsed = now - lastCheckedAt
  // A durable timestamp in the FUTURE cannot be trusted (the user moved the
  // system clock back, or the state file was written under a skewed clock).
  // Treating it as "fresh" would stall the passive check for as long as the skew
  // lasts — potentially forever, which is exactly the class of silent death this
  // module exists to remove. Checking once is the cheap, safe answer; the check
  // itself rewrites lastCheckedAt with a sane value.
  if (elapsed < 0) return { check: true, reason: PASSIVE_CHECK_REASONS.CLOCK_SKEW, nextWakeInMs: intervalMs }
  if (elapsed >= intervalMs) return { check: true, reason: PASSIVE_CHECK_REASONS.STALE, nextWakeInMs: intervalMs }

  // Still inside the durable throttle: sleep exactly until it expires. This is
  // what makes an early wake (a spurious timer fire, a tray click, a
  // sleep/resume artefact) free — it costs one local JSON read and re-arms.
  return {
    check: false,
    reason: PASSIVE_CHECK_REASONS.FRESH,
    nextWakeInMs: clampWake(intervalMs - elapsed, minWakeMs, intervalMs)
  }
}

module.exports = {
  PASSIVE_UPDATE_INITIAL_DELAY_MS,
  PASSIVE_UPDATE_INTERVAL_MS,
  PASSIVE_UPDATE_MIN_WAKE_MS,
  PASSIVE_CHECK_REASONS,
  decidePassiveCheck
}
