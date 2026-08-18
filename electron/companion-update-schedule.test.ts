import { describe, expect, it } from 'vitest'
// @ts-expect-error - plain CJS module without type declarations
import {
  decidePassiveCheck,
  PASSIVE_CHECK_REASONS,
  PASSIVE_UPDATE_INITIAL_DELAY_MS,
  PASSIVE_UPDATE_INTERVAL_MS,
  PASSIVE_UPDATE_MIN_WAKE_MS
} from './companion-update-schedule.cjs'

// A fixed, readable epoch base so every case reads as "T + n" rather than as a
// wall-clock literal. Same fixture style as companion-update.test.ts's injected
// `now`.
const T0 = 1_800_000_000_000
const READY = T0
// Anything at or after this instant is past the 60s post-ready quiet period.
const WARM = READY + PASSIVE_UPDATE_INITIAL_DELAY_MS

type Decision = { check: boolean; reason: string; nextWakeInMs: number | null }

function decide(overrides: Record<string, unknown> = {}): Decision {
  return decidePassiveCheck({ now: WARM, readyAt: READY, lastCheckedAt: null, disabled: false, ...overrides })
}

describe('decidePassiveCheck — disabled short-circuits and leaves NO timer (R7)', () => {
  it('disabled wins over a stale timestamp and returns nextWakeInMs null', () => {
    // A null wake is the load-bearing part: an isolated/packaged E2E must not be
    // left with a passive timer that keeps waking up to decide "no".
    expect(decide({ disabled: true, lastCheckedAt: T0 - 10 * PASSIVE_UPDATE_INTERVAL_MS })).toEqual({
      check: false,
      reason: PASSIVE_CHECK_REASONS.DISABLED,
      nextWakeInMs: null
    })
  })

  it('disabled wins even with no durable state at all (the "never checked" branch)', () => {
    expect(decide({ disabled: true, lastCheckedAt: null }).check).toBe(false)
  })

  it('only a literal true disables — a truthy non-boolean does not silently disable the feature', () => {
    // Fail-open is correct in THIS direction: the flag comes from
    // isPassiveUpdateCheckDisabled(), which already returns a strict boolean and
    // already fails closed itself. A stray truthy value here must not become a
    // second, undocumented kill switch.
    expect(decide({ disabled: 'yes' as unknown as boolean }).check).toBe(true)
  })
})

describe('decidePassiveCheck — the scheduler must be started before anything runs', () => {
  it('readyAt null (module loaded, app not ready yet) is inert and arms nothing', () => {
    expect(decide({ readyAt: null })).toEqual({
      check: false,
      reason: PASSIVE_CHECK_REASONS.NOT_STARTED,
      nextWakeInMs: null
    })
  })

  it.each([undefined, NaN, Infinity, '0', {}, []])('readyAt %o is treated as not started', value => {
    expect(decide({ readyAt: value as unknown as number }).reason).toBe(PASSIVE_CHECK_REASONS.NOT_STARTED)
  })

  it('a non-finite clock fails closed: no check and no timer (never a busy re-arm)', () => {
    for (const now of [NaN, Infinity, -Infinity, undefined, 'now']) {
      expect(decide({ now: now as unknown as number })).toEqual({
        check: false,
        reason: PASSIVE_CHECK_REASONS.INVALID_CLOCK,
        nextWakeInMs: null
      })
    }
  })
})

describe('decidePassiveCheck — 60s post-ready quiet period (§6.5)', () => {
  it('at ready itself: no check, wake in exactly the initial delay', () => {
    expect(decide({ now: READY })).toEqual({
      check: false,
      reason: PASSIVE_CHECK_REASONS.STARTUP_DELAY,
      nextWakeInMs: PASSIVE_UPDATE_INITIAL_DELAY_MS
    })
  })

  it('mid-way through: wake for the REMAINING quiet time, not a fresh full delay', () => {
    expect(decide({ now: READY + 20_000 })).toMatchObject({
      check: false,
      reason: PASSIVE_CHECK_REASONS.STARTUP_DELAY,
      nextWakeInMs: 40_000
    })
  })

  it('one millisecond before the boundary is still the quiet period, clamped to the wake floor', () => {
    expect(decide({ now: WARM - 1 })).toMatchObject({
      reason: PASSIVE_CHECK_REASONS.STARTUP_DELAY,
      nextWakeInMs: PASSIVE_UPDATE_MIN_WAKE_MS
    })
  })

  it('exactly at the boundary the quiet period is over', () => {
    expect(decide({ now: WARM }).reason).not.toBe(PASSIVE_CHECK_REASONS.STARTUP_DELAY)
  })

  it('a backwards clock jump after ready never produces a wait longer than one full delay', () => {
    // now < readyAt ⇒ sinceReady negative ⇒ an unclamped remaining would grow
    // without bound (here: 60s + a whole day).
    const d = decide({ now: READY - PASSIVE_UPDATE_INTERVAL_MS })
    expect(d.reason).toBe(PASSIVE_CHECK_REASONS.STARTUP_DELAY)
    expect(d.nextWakeInMs).toBe(PASSIVE_UPDATE_INITIAL_DELAY_MS)
  })

  it('the boot window`s own show/focus is absorbed: the trigger path cannot check during the quiet period', () => {
    // The window emits show+focus while it is coming up. Decided at that instant
    // (well inside 60s), the answer is "no" even with a wildly stale timestamp.
    expect(decide({ now: READY + 200, lastCheckedAt: T0 - 30 * PASSIVE_UPDATE_INTERVAL_MS }).check).toBe(false)
  })
})

describe('decidePassiveCheck — the durable throttle decides, not the timer', () => {
  it('no durable timestamp at all (first run / unreadable state) is due', () => {
    expect(decide({ lastCheckedAt: null })).toEqual({
      check: true,
      reason: PASSIVE_CHECK_REASONS.NEVER_CHECKED,
      nextWakeInMs: PASSIVE_UPDATE_INTERVAL_MS
    })
  })

  it.each([undefined, NaN, Infinity, -Infinity, '1800000000000', {}, []])(
    'a corrupt durable timestamp (%o) reads as "never checked", never as "fresh"',
    value => {
      // Absence/corruption is not proof a check ran recently — the same
      // fail-closed reading getLastCheckedAt() already documents.
      expect(decide({ lastCheckedAt: value as unknown as number }).check).toBe(true)
    }
  )

  it('a check just performed is fresh: no check, wake when the throttle expires', () => {
    expect(decide({ now: WARM, lastCheckedAt: WARM })).toEqual({
      check: false,
      reason: PASSIVE_CHECK_REASONS.FRESH,
      nextWakeInMs: PASSIVE_UPDATE_INTERVAL_MS
    })
  })

  it('one millisecond short of 24h is still fresh (boundary is >=, matching the original gate)', () => {
    const d = decide({ now: WARM, lastCheckedAt: WARM - PASSIVE_UPDATE_INTERVAL_MS + 1 })
    expect(d.check).toBe(false)
    expect(d.reason).toBe(PASSIVE_CHECK_REASONS.FRESH)
    // The true remainder is 1ms; the wake floor lifts it to 1s so the re-arming
    // loop cannot spin. One extra second of throttle is invisible next to 24h.
    expect(d.nextWakeInMs).toBe(PASSIVE_UPDATE_MIN_WAKE_MS)
  })

  it('an hour short of 24h wakes for exactly the remainder, not a fresh full throttle', () => {
    const hour = 60 * 60 * 1000
    expect(decide({ now: WARM, lastCheckedAt: WARM - PASSIVE_UPDATE_INTERVAL_MS + hour }).nextWakeInMs).toBe(hour)
  })

  it('exactly 24h old is stale and checks', () => {
    expect(decide({ now: WARM, lastCheckedAt: WARM - PASSIVE_UPDATE_INTERVAL_MS })).toEqual({
      check: true,
      reason: PASSIVE_CHECK_REASONS.STALE,
      nextWakeInMs: PASSIVE_UPDATE_INTERVAL_MS
    })
  })

  it('a durable timestamp in the FUTURE checks instead of stalling forever', () => {
    // The user moved the system clock back (or the file was written under a
    // skewed clock). "Fresh" would silently suspend the whole feature until the
    // skew unwound — exactly the class of silent death this module removes.
    expect(decide({ now: WARM, lastCheckedAt: WARM + 5 * PASSIVE_UPDATE_INTERVAL_MS })).toEqual({
      check: true,
      reason: PASSIVE_CHECK_REASONS.CLOCK_SKEW,
      nextWakeInMs: PASSIVE_UPDATE_INTERVAL_MS
    })
  })
})

describe('decidePassiveCheck — every scheduled wake is a safe setTimeout delay', () => {
  it('never returns a wake above the throttle (setTimeout overflows past 2^31-1 ms and fires immediately)', () => {
    const cases = [
      { lastCheckedAt: WARM + Number.MAX_SAFE_INTEGER },
      { lastCheckedAt: WARM - 1 },
      { lastCheckedAt: null },
      { now: READY, lastCheckedAt: null }
    ]
    for (const c of cases) {
      const wake = decide(c).nextWakeInMs
      expect(wake).not.toBeNull()
      expect(wake!).toBeLessThanOrEqual(PASSIVE_UPDATE_INTERVAL_MS)
      expect(wake!).toBeLessThan(2 ** 31 - 1)
    }
  })

  it('never returns a zero/negative wake (a re-arming loop must not busy-spin)', () => {
    for (const offset of [0, 1, 2, 999]) {
      const wake = decide({ now: WARM, lastCheckedAt: WARM - PASSIVE_UPDATE_INTERVAL_MS + offset }).nextWakeInMs
      if (wake === null) continue
      expect(wake).toBeGreaterThanOrEqual(offset === 0 ? PASSIVE_UPDATE_INTERVAL_MS : PASSIVE_UPDATE_MIN_WAKE_MS)
    }
  })
})

describe('decidePassiveCheck — injected timings and hostile input', () => {
  it('honours injected initialDelayMs / intervalMs / minWakeMs', () => {
    const d = decidePassiveCheck({
      now: 5_000,
      readyAt: 0,
      lastCheckedAt: 4_000,
      disabled: false,
      initialDelayMs: 1_000,
      intervalMs: 10_000,
      minWakeMs: 10
    })
    expect(d).toEqual({ check: false, reason: PASSIVE_CHECK_REASONS.FRESH, nextWakeInMs: 9_000 })
  })

  it.each([0, -1, NaN, Infinity, '24h', null])(
    'an invalid intervalMs (%o) falls back to the 24h default rather than collapsing the schedule',
    value => {
      const d = decidePassiveCheck({
        now: WARM,
        readyAt: READY,
        lastCheckedAt: WARM,
        disabled: false,
        intervalMs: value as unknown as number
      })
      expect(d.nextWakeInMs).toBe(PASSIVE_UPDATE_INTERVAL_MS)
    }
  )

  it('never throws, whatever it is handed', () => {
    expect(() => decidePassiveCheck()).not.toThrow()
    expect(() => decidePassiveCheck(undefined as unknown as Record<string, never>)).not.toThrow()
    expect(() => decidePassiveCheck(null as unknown as Record<string, never>)).not.toThrow()
    expect(() => decidePassiveCheck(42 as unknown as Record<string, never>)).not.toThrow()
    expect(() => decidePassiveCheck('nope' as unknown as Record<string, never>)).not.toThrow()
    expect(decidePassiveCheck().check).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// The regression the module exists for: drive the decision the way main.cjs
// drives it — arm, wake, act, re-arm from FRESH durable state — and assert the
// long-session behaviour that the previous one-shot setTimeout could not deliver.
// ---------------------------------------------------------------------------
function simulateSession(options: {
  days: number
  /** Extra wake instants (tray return, sleep/resume artefact) as ms-since-ready. */
  extraWakes?: number[]
  /** Sleep/hibernate: the OS delivers the wake this late. */
  wakeSkewMs?: (scheduledAt: number) => number
}): { checks: number[]; wakes: number } {
  const horizon = READY + options.days * 24 * 60 * 60 * 1000
  const extras = [...(options.extraWakes ?? [])].map(offset => READY + offset).sort((a, b) => a - b)
  const checks: number[] = []
  let lastCheckedAt: number | null = null
  let wakes = 0
  // The armed wake, exactly as armPassiveCompanionUpdateTimer holds it.
  let armedAt: number | null = READY + (decidePassiveCheck({ now: READY, readyAt: READY, lastCheckedAt }).nextWakeInMs as number)

  while (true) {
    const nextExtra = extras.length ? extras[0] : Infinity
    const nextTimer = armedAt === null ? Infinity : options.wakeSkewMs ? options.wakeSkewMs(armedAt) : armedAt
    const now = Math.min(nextExtra, nextTimer)
    if (!Number.isFinite(now) || now > horizon) break
    const fromTimer = nextTimer <= nextExtra
    if (fromTimer) armedAt = null
    else extras.shift()
    wakes++

    const decision = decidePassiveCheck({ now, readyAt: READY, lastCheckedAt })
    if (decision.check) {
      // A real check always rewrites the durable timestamp — companion-update.cjs
      // persists lastCheckedAt for EVERY verdict, including `unknown`.
      lastCheckedAt = now
      checks.push(now - READY)
    }
    // Re-arm from fresh state, which is what main.cjs does in the tick's .then().
    if (fromTimer) {
      const next = decidePassiveCheck({ now, readyAt: READY, lastCheckedAt }).nextWakeInMs
      armedAt = next === null ? null : now + next
    }
  }
  return { checks, wakes }
}

describe('a long-lived tray-resident session (the bug)', () => {
  it('checks once per day for a fortnight instead of exactly once at launch', () => {
    const { checks } = simulateSession({ days: 14 })
    // Was 1 (the one-shot). Now: the 60s post-ready check plus one per elapsed day.
    expect(checks.length).toBe(14)
    expect(checks[0]).toBe(PASSIVE_UPDATE_INITIAL_DELAY_MS)
    for (let i = 1; i < checks.length; i++) {
      expect(checks[i] - checks[i - 1]).toBe(PASSIVE_UPDATE_INTERVAL_MS)
    }
  })

  it('survives sleep/hibernate: a wake delivered three days late still yields ONE check, then resumes daily', () => {
    // Windows suspends timers; on resume the delayed fire lands long after its
    // scheduled instant. The durable gate — not the timer — decides, so a
    // three-day-late wake performs a single check and re-arms 24h out.
    const threeDays = 3 * PASSIVE_UPDATE_INTERVAL_MS
    const { checks } = simulateSession({
      days: 10,
      wakeSkewMs: scheduledAt => (scheduledAt === READY + PASSIVE_UPDATE_INITIAL_DELAY_MS ? scheduledAt : scheduledAt + threeDays)
    })
    // No burst of catch-up checks, and each pair is at least one throttle apart.
    for (let i = 1; i < checks.length; i++) {
      expect(checks[i] - checks[i - 1]).toBeGreaterThanOrEqual(PASSIVE_UPDATE_INTERVAL_MS)
    }
    expect(checks.length).toBeGreaterThan(1)
  })

  it('a user returning from the tray checks when the throttle has expired, and is free when it has not', () => {
    const hour = 60 * 60 * 1000
    // The machine hibernates right after the post-ready check, so the daily timer
    // is delivered days late (or never, within this horizon). The tray returns are
    // then the ONLY thing that can notice a new release — which is precisely the
    // "user came back after days" case the timer alone cannot cover. Two returns
    // land inside the throttle (must be free) and one after it (must check).
    const { checks } = simulateSession({
      days: 3,
      extraWakes: [2 * hour, 5 * hour, 25 * hour],
      wakeSkewMs: scheduledAt =>
        scheduledAt === READY + PASSIVE_UPDATE_INITIAL_DELAY_MS
          ? scheduledAt
          : scheduledAt + 5 * PASSIVE_UPDATE_INTERVAL_MS
    })
    expect(checks).toContain(25 * hour)
    expect(checks).not.toContain(2 * hour)
    expect(checks).not.toContain(5 * hour)
  })

  it('a burst of tray returns inside the throttle performs no check at all', () => {
    const minute = 60 * 1000
    const { checks, wakes } = simulateSession({
      days: 1,
      extraWakes: [2 * minute, 3 * minute, 4 * minute, 5 * minute, 6 * minute]
    })
    expect(wakes).toBeGreaterThanOrEqual(6)
    // Only the 60s post-ready check; every tray return after it was absorbed.
    expect(checks).toEqual([PASSIVE_UPDATE_INITIAL_DELAY_MS])
  })
})
