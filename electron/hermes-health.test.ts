import { describe, expect, it, vi } from 'vitest'
import {
  GATEWAY_SETTLE_DEADLINE_MS,
  GATEWAY_SETTLE_POLL_MS,
  interpretGatewayDeep,
  assertGatewayDeepHealthy,
  assertFullHealth,
  waitForGatewayDeepHealth
} from './hermes-health.cjs'

const CMD = 'C:\\Users\\me\\AppData\\Local\\hermes\\hermes-agent\\venv\\Scripts\\hermes.exe'

// Realistic `gateway status --deep` output from hermes_cli/gateway_windows.py.
// Structural tokens ([1]..[6], PASS/FAIL, "Deep probes:", the ASCII high-level
// text) are hard-coded English; only schtasks status VALUES and paths localize.
const PROBE_DESC: Record<number, string> = {
  1: 'PID file present: C:\\Users\\me\\AppData\\Local\\hermes\\gateway.pid (pid=12345)',
  2: 'Lock file held by a live process: C:\\Users\\me\\AppData\\Local\\hermes\\gateway.lock',
  3: 'get_running_pid() => 12345',
  4: '_pid_exists(12345) => True',
  5: "gateway_state.json state='running' (updated 3s ago)",
  6: 'Last lifecycle event: tag=gateway.start pid=12345 ts=2026-08-01T09:00:00Z'
}

function winDeep(
  verdicts: Partial<Record<number, string>> = {},
  opts: {
    installLine?: string
    processLine?: string
    header?: string | null
    omit?: number[]
    extra?: string[]
  } = {}
): string {
  const {
    installLine = '✓ Scheduled Task registered: Hermes_Gateway',
    processLine = '✓ Gateway process running (PID: 12345)',
    header = 'Deep probes:',
    omit = [],
    extra = []
  } = opts
  const probeLines = [1, 2, 3, 4, 5, 6]
    .filter(id => !omit.includes(id))
    .map(id => `  [${id}] ${verdicts[id] ?? 'PASS'}  ${PROBE_DESC[id]}`)
  return [
    installLine,
    '  Status: Ready',
    '  Last Run Time: 8/1/2026 9:00:00 AM',
    '  Last Run Result: 0x0',
    processLine,
    '',
    '  Task name:        Hermes_Gateway',
    '  Task script:      C:\\Users\\me\\AppData\\Local\\hermes\\gateway-service\\Hermes_Gateway.cmd',
    '',
    ...(header === null ? [] : [header]),
    ...probeLines,
    ...extra
  ].join('\n')
}

describe('interpretGatewayDeep — structural Windows deep-probe parsing', () => {
  const win = (output: string) => interpretGatewayDeep({ ok: true, output }, { platform: 'win32' })

  it('is healthy when all six probes are present and the safe set is PASS', () => {
    const v = win(winDeep())
    expect(v.healthy).toBe(true)
    expect(v.reason).toMatch(/process\/lifecycle liveness/)
  })

  it('stays healthy when only the ADVISORY probes ([1] PID file, [6] exit-diag) FAIL', () => {
    // A running gateway can legitimately show a stale/absent pid.json and a
    // last-event tag that isn't "gateway.start" — gating on those would
    // false-FAIL a healthy install, so they are not gated.
    const v = win(winDeep({ 1: 'FAIL', 6: 'FAIL' }))
    expect(v.healthy).toBe(true)
    expect(v.reason).toMatch(/advisory \[1\], \[6\] FAIL — not gated/)
  })

  it('is UNHEALTHY on exit 0 when a required liveness probe reads FAIL', () => {
    // The core bug: status() exits 0 even when probes FAIL. We must not pass.
    expect(win(winDeep({ 3: 'FAIL' })).healthy).toBe(false)
    expect(win(winDeep({ 5: 'FAIL' })).healthy).toBe(false)
    expect(win(winDeep({ 2: 'FAIL' })).reason).toMatch(/\[2\].*FAIL/)
  })

  it('fails closed when the Deep probes block is missing entirely', () => {
    const v = win(winDeep({}, { header: null, omit: [1, 2, 3, 4, 5, 6] }))
    expect(v.healthy).toBe(false)
    expect(v.reason).toMatch(/deep-probe block missing/)
  })

  it('fails closed when a required probe is missing (shape changed)', () => {
    const v = win(winDeep({}, { omit: [4] }))
    expect(v.healthy).toBe(false)
    expect(v.reason).toMatch(/\[4\] missing/)
  })

  it('fails closed on a DUPLICATE probe id (ambiguous)', () => {
    const v = win(winDeep({}, { extra: ['  [3] FAIL  get_running_pid() => None'] }))
    expect(v.healthy).toBe(false)
    expect(v.reason).toMatch(/\[3\] appeared 2 times/)
  })

  it('fails closed on an UNKNOWN probe id (newer gateway)', () => {
    const v = win(winDeep({}, { extra: ['  [7] PASS  some brand new probe'] }))
    expect(v.healthy).toBe(false)
    expect(v.reason).toMatch(/unexpected deep probe \[7\]/)
  })

  it('fails closed on an unrecognized verdict token', () => {
    const out = winDeep().replace('[3] PASS', '[3] WARN')
    const v = win(out)
    expect(v.healthy).toBe(false)
    expect(v.reason).toMatch(/unrecognized verdict "WARN"/)
  })

  it('is UNHEALTHY when the high-level line says the service is not installed', () => {
    // Even with all probes PASS, "not installed" is a hard no.
    const v = win(winDeep({}, { installLine: '✗ Gateway service not installed' }))
    expect(v.healthy).toBe(false)
    expect(v.reason).toMatch(/not installed/)
  })

  it('is UNHEALTHY when the high-level line says no process is detected', () => {
    const v = win(winDeep({}, { processLine: '✗ No gateway process detected' }))
    expect(v.healthy).toBe(false)
    expect(v.reason).toMatch(/no gateway process detected/)
  })

  it('parses a localized/Unicode console (ASCII structural tokens still win)', () => {
    // schtasks Status localized to Japanese + a Unicode profile path; [6]
    // advisory FAIL. Structural tokens remain ASCII, so we still read healthy.
    const localized = [
      '✓ Scheduled Task registered: Hermes_Gateway',
      '  Status: 準備完了',
      '  Last Run Time: 2026/08/01 9:00:00',
      '✓ Gateway process running (PID: 12345)',
      '',
      'Deep probes:',
      '  [1] PASS  PID file present: C:\\Users\\ヘルメス\\AppData\\Local\\hermes\\gateway.pid (pid=12345)',
      '  [2] PASS  Lock file held by a live process: C:\\Users\\ヘルメス\\AppData\\Local\\hermes\\gateway.lock',
      '  [3] PASS  get_running_pid() => 12345',
      '  [4] PASS  _pid_exists(12345) => True',
      "  [5] PASS  gateway_state.json state='running' (updated 3s ago)",
      '  [6] FAIL  exit-diag log missing: C:\\Users\\ヘルメス\\logs\\gateway-exit-diag.log'
    ].join('\n')
    expect(interpretGatewayDeep({ ok: true, output: localized }, { platform: 'win32' }).healthy).toBe(true)
  })

  it('is unhealthy when the probe exited non-zero regardless of text', () => {
    expect(interpretGatewayDeep({ ok: false, output: winDeep() }, { platform: 'win32' }).healthy).toBe(false)
    expect(interpretGatewayDeep({ ok: false, output: '' }, { platform: 'win32' }).healthy).toBe(false)
  })
})

describe('interpretGatewayDeep — non-Windows fails closed (honest, not universal)', () => {
  it('does NOT apply the Windows parser to systemd-style output; fails closed', () => {
    // systemd `gateway status --deep` has no [1]..[6] PASS/FAIL block; pretending
    // the Windows parser understands it would be a false PASS. Fail closed.
    const systemdish = [
      '✓ User gateway service is running',
      '',
      'Recent logs:',
      '-- journal begins --',
      'gateway started ok'
    ].join('\n')
    const v = interpretGatewayDeep({ ok: true, output: systemdish }, { platform: 'linux' })
    expect(v.healthy).toBe(false)
    expect(v.reason).toMatch(/only for Windows|Windows only/i)
    expect(v.reason).toContain('linux')
  })
})

describe('assertGatewayDeepHealthy', () => {
  it('resolves when a well-formed Windows deep report is healthy', async () => {
    const run = vi.fn().mockResolvedValue({ stdout: winDeep(), stderr: '' })
    await expect(
      assertGatewayDeepHealthy(CMD, { run, log: vi.fn(), platform: 'win32' })
    ).resolves.toMatchObject({ healthy: true })
    expect(run).toHaveBeenCalledWith(CMD, ['gateway', 'status', '--deep'], expect.any(Number))
  })

  it('throws (honest, scoped copy) when the deep probe rejects', async () => {
    const run = vi.fn().mockRejectedValue(new Error('gateway not running'))
    await expect(
      assertGatewayDeepHealthy(CMD, { run, log: vi.fn(), platform: 'win32' })
    ).rejects.toThrow(/חיוּת עומק של תהליך/)
  })

  it('throws when a required probe reports FAIL on exit 0', async () => {
    const run = vi.fn().mockResolvedValue({ stdout: winDeep({ 3: 'FAIL' }), stderr: '' })
    const log = vi.fn()
    await expect(assertGatewayDeepHealthy(CMD, { run, log, platform: 'win32' })).rejects.toThrow(
      /חיוּת עומק/
    )
    expect(log).toHaveBeenCalledWith(expect.stringMatching(/process-liveness check failed/))
  })
})

describe('assertFullHealth', () => {
  const base = {
    ensureGateway: vi.fn().mockResolvedValue(undefined),
    start: vi.fn().mockResolvedValue({ running: true }),
    api: vi.fn().mockResolvedValue({ ok: true }),
    assertGatewayDeep: vi.fn().mockResolvedValue(undefined)
  }

  it('requires runtime up, /api/health ok, AND gateway deep liveness', async () => {
    const deps = { ...base }
    await expect(assertFullHealth(CMD, deps)).resolves.toMatchObject({ health: { ok: true } })
    expect(deps.assertGatewayDeep).toHaveBeenCalledWith(CMD)
  })

  it('throws when the runtime never comes up', async () => {
    await expect(
      assertFullHealth(CMD, { ...base, start: vi.fn().mockResolvedValue({ running: false, error: 'x' }) })
    ).rejects.toThrow('x')
  })

  it('throws when foreground /api/health is not ok', async () => {
    await expect(
      assertFullHealth(CMD, { ...base, api: vi.fn().mockResolvedValue({ ok: false }) })
    ).rejects.toThrow(/foreground health/)
  })

  it('propagates a gateway deep-liveness failure', async () => {
    await expect(
      assertFullHealth(CMD, { ...base, assertGatewayDeep: vi.fn().mockRejectedValue(new Error('deep failed')) })
    ).rejects.toThrow('deep failed')
  })
})


// A FAKE CLOCK, not a real one: `sleep` never sleeps, it only advances `now`, so
// the bounded wait's tests measure the exact simulated time and probe count the
// real code would burn without any test ever waiting.
function makeClock() {
  let t = 1_000_000
  const slept: number[] = []
  return {
    now: () => t,
    slept,
    sleep: vi.fn(async (ms: number) => {
      slept.push(ms)
      t += ms
    }),
    elapsed: () => t - 1_000_000
  }
}

describe('waitForGatewayDeepHealth — the bounded settle wait', () => {
  it('returns on the FIRST pass without sleeping', async () => {
    const clock = makeClock()
    const result = await waitForGatewayDeepHealth(CMD, {
      assertGatewayDeep: vi.fn(async () => ({ healthy: true })),
      sleep: clock.sleep,
      now: clock.now,
      log: vi.fn()
    })
    expect(result).toMatchObject({ healthy: true, attempts: 1, waitedMs: 0, lastReason: null })
    expect(clock.slept).toEqual([])
  })

  it('honours an injected deadline/interval and reports the last failure reason', async () => {
    const clock = makeClock()
    const result = await waitForGatewayDeepHealth(CMD, {
      assertGatewayDeep: vi.fn(async () => {
        throw new Error('probe [5] FAIL')
      }),
      sleep: clock.sleep,
      now: clock.now,
      deadlineMs: 20_000,
      pollMs: 4_000,
      log: vi.fn()
    })
    expect(result).toMatchObject({ healthy: false, attempts: 6, waitedMs: 20_000, lastReason: 'probe [5] FAIL' })
    expect(clock.slept).toEqual([4000, 4000, 4000, 4000, 4000])
  })

  it('terminates even against a FROZEN clock (the attempt cap does not depend on time)', async () => {
    // The elapsed-deadline bound alone would spin forever here. The derived
    // attempt cap is the second, clock-independent bound that must hold.
    const probe = vi.fn(async () => {
      throw new Error('probe [5] FAIL')
    })
    const result = await waitForGatewayDeepHealth(CMD, {
      assertGatewayDeep: probe,
      sleep: vi.fn(async () => {}),
      now: () => 5_000,
      deadlineMs: 30_000,
      pollMs: 3_000,
      log: vi.fn()
    })
    expect(result).toMatchObject({ healthy: false, attempts: 11, waitedMs: 0 })
    expect(probe).toHaveBeenCalledTimes(11)
  })

  it('never throws, whatever the probe does', async () => {
    const result = await waitForGatewayDeepHealth(CMD, {
      assertGatewayDeep: vi.fn(() => {
        throw 'not an Error'
      }),
      sleep: vi.fn(async () => {}),
      now: () => 0,
      deadlineMs: 0,
      pollMs: 1_000,
      log: vi.fn()
    })
    expect(result).toMatchObject({ healthy: false, attempts: 1, lastReason: 'not an Error' })
  })

  it('the shipped defaults are the measured ones (120 s / 5 s)', () => {
    // 120 s ≈ 7.5x the 15-16 s settle measured live; 5 s is a real poll against
    // a probe that itself costs ~5.7 s. Call sites may raise the DEADLINE for
    // their own cost matrix (the agent-update recovery does, because it gates a
    // destructive rollback) but they all poll at this cadence.
    expect(GATEWAY_SETTLE_DEADLINE_MS).toBe(120_000)
    expect(GATEWAY_SETTLE_POLL_MS).toBe(5_000)
  })

  it('uses those defaults when a call site names no budget of its own', async () => {
    const clock = makeClock()
    const result = await waitForGatewayDeepHealth(CMD, {
      assertGatewayDeep: vi.fn(async () => {
        throw new Error('probe [5] FAIL')
      }),
      sleep: clock.sleep,
      now: clock.now,
      log: vi.fn()
    })
    expect(result.attempts).toBe(GATEWAY_SETTLE_DEADLINE_MS / GATEWAY_SETTLE_POLL_MS + 1)
    expect(result.waitedMs).toBe(GATEWAY_SETTLE_DEADLINE_MS)
  })
})
