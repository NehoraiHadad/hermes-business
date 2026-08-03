import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

// Loaded via require() (not `import`) so this test file and companion-update.cjs's
// own internal `require('./qa-runtime.cjs')` resolve to the EXACT SAME Node
// module singleton — required for __resetQaRuntimeOverrideCache to actually
// reset the instance companion-update.cjs consults (a static/dynamic ESM
// import here would create a SEPARATE module graph and reset the wrong copy).
const {
  checkCompanionUpdate,
  isPassiveUpdateCheckDisabled,
  getLastCheckedAt,
  STATE_FILE_NAME,
  __resetCompanionUpdateCacheForTests
} = require('./companion-update.cjs')
const {
  SENTINEL_ENV,
  SENTINEL_VALUE,
  HOME_ENV,
  HOST_ENV,
  PORT_ENV,
  __resetQaRuntimeOverrideCache
} = require('./qa-runtime.cjs')

const tmpDirs: string[] = []
function freshStateDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'companion-update-state-'))
  tmpDirs.push(dir)
  return dir
}

beforeEach(() => {
  __resetCompanionUpdateCacheForTests()
  __resetQaRuntimeOverrideCache()
})

afterEach(() => {
  while (tmpDirs.length) {
    try {
      fs.rmSync(tmpDirs.pop()!, { recursive: true, force: true })
    } catch {
      /* best effort */
    }
  }
})

function jsonResponse(status: number, body: unknown) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body
  }
}

function release(overrides: Record<string, unknown> = {}) {
  return {
    tag_name: 'v1.1.0',
    draft: false,
    prerelease: false,
    name: "תכל'ס 1.1.0",
    body: 'Fixed a bug.',
    html_url: 'https://github.com/NehoraiHadad/hermes-business/releases/tag/v1.1.0',
    published_at: '2026-01-01T00:00:00Z',
    ...overrides
  }
}

describe('checkCompanionUpdate — positive proof required for each verdict', () => {
  it('update-available: eligible release newer than current, full verdict shape', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(200, [release()]))
    const dir = freshStateDir()
    const v = await checkCompanionUpdate(
      { force: true },
      { fetch: fetchImpl, getVersion: () => '1.0.0', stateDir: () => dir, now: () => 1000 }
    )
    expect(v).toEqual({
      status: 'update-available',
      current: '1.0.0',
      latest: '1.1.0',
      releaseName: "תכל'ס 1.1.0",
      notes: 'Fixed a bug.',
      downloadUrl: 'https://github.com/NehoraiHadad/hermes-business/releases/tag/v1.1.0',
      publishedAt: '2026-01-01T00:00:00Z',
      checkedAt: 1000
    })
    expect(fetchImpl).toHaveBeenCalledTimes(1)
    const [calledUrl, calledInit] = fetchImpl.mock.calls[0]
    expect(calledUrl).toBe('https://api.github.com/repos/NehoraiHadad/hermes-business/releases?per_page=20')
    expect(calledInit.headers).toEqual({ Accept: 'application/vnd.github+json', 'User-Agent': 'tachles-companion' })
    expect(calledInit.signal).toBeInstanceOf(AbortSignal)
  })

  it('up-to-date: current equals the highest eligible release exactly', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(200, [release({ tag_name: 'v1.0.0' })]))
    const v = await checkCompanionUpdate(
      { force: true },
      { fetch: fetchImpl, getVersion: () => '1.0.0', stateDir: () => freshStateDir(), now: () => 2000 }
    )
    expect(v).toEqual({ status: 'up-to-date', current: '1.0.0', checkedAt: 2000 })
  })

  it('dev-ahead: current is newer than anything published', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(200, [release({ tag_name: 'v1.0.0' })]))
    const v = await checkCompanionUpdate(
      { force: true },
      { fetch: fetchImpl, getVersion: () => '2.0.0', stateDir: () => freshStateDir(), now: () => 3000 }
    )
    expect(v).toEqual({ status: 'dev-ahead', current: '2.0.0', checkedAt: 3000 })
  })

  it('update-available with an html_url that fails prefix validation: downloadUrl omitted, status unaffected', async () => {
    const evil = release({ html_url: 'https://github.com.evil.tld/NehoraiHadad/hermes-business/releases/tag/v1.1.0' })
    const fetchImpl = vi.fn(async () => jsonResponse(200, [evil]))
    const v = await checkCompanionUpdate(
      { force: true },
      { fetch: fetchImpl, getVersion: () => '1.0.0', stateDir: () => freshStateDir(), now: () => 4000 }
    )
    expect(v.status).toBe('update-available')
    expect(v.downloadUrl).toBeUndefined()
  })
})

describe('checkCompanionUpdate — §8 failure-semantics table: every row resolves to unknown, never rejects', () => {
  it('no network / timeout', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new DOMException('The operation was aborted', 'TimeoutError')
    })
    const v = await checkCompanionUpdate(
      { force: true },
      { fetch: fetchImpl, getVersion: () => '1.0.0', stateDir: () => freshStateDir(), now: () => 1 }
    )
    expect(v).toEqual({ status: 'unknown', current: '1.0.0', checkedAt: 1, message: 'לא ניתן לבדוק עדכונים כרגע' })
  })

  it('HTTP 403 (rate limit)', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(403, { message: 'rate limited' }))
    const v = await checkCompanionUpdate(
      { force: true },
      { fetch: fetchImpl, getVersion: () => '1.0.0', stateDir: () => freshStateDir(), now: () => 1 }
    )
    expect(v.status).toBe('unknown')
  })

  it('HTTP 429 (rate limit)', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(429, { message: 'too many requests' }))
    const v = await checkCompanionUpdate(
      { force: true },
      { fetch: fetchImpl, getVersion: () => '1.0.0', stateDir: () => freshStateDir(), now: () => 1 }
    )
    expect(v.status).toBe('unknown')
  })

  it('HTTP 200 with malformed JSON (not an array)', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(200, { not: 'an array' }))
    const v = await checkCompanionUpdate(
      { force: true },
      { fetch: fetchImpl, getVersion: () => '1.0.0', stateDir: () => freshStateDir(), now: () => 1 }
    )
    expect(v.status).toBe('unknown')
  })

  it('HTTP 200 but json() throws (corrupt body)', async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => {
        throw new SyntaxError('Unexpected token')
      }
    }))
    const v = await checkCompanionUpdate(
      { force: true },
      { fetch: fetchImpl, getVersion: () => '1.0.0', stateDir: () => freshStateDir(), now: () => 1 }
    )
    expect(v.status).toBe('unknown')
  })

  it('all tags unparseable — still carries the honest "can\'t check" message, not a bare status', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(200, [release({ tag_name: 'garbage' }), release({ tag_name: 'also-garbage' })]))
    const v = await checkCompanionUpdate(
      { force: true },
      { fetch: fetchImpl, getVersion: () => '1.0.0', stateDir: () => freshStateDir(), now: () => 1 }
    )
    expect(v).toEqual({ status: 'unknown', current: '1.0.0', checkedAt: 1, message: 'לא ניתן לבדוק עדכונים כרגע' })
  })

  it('empty release list — empty is NOT proof of up-to-date', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(200, []))
    const v = await checkCompanionUpdate(
      { force: true },
      { fetch: fetchImpl, getVersion: () => '1.0.0', stateDir: () => freshStateDir(), now: () => 1 }
    )
    expect(v).toEqual({ status: 'unknown', current: '1.0.0', checkedAt: 1, message: 'לא ניתן לבדוק עדכונים כרגע' })
  })

  it('concurrent check → serial-guard rejection surfaces its own message, never a rejected promise', async () => {
    let resolveFetch: (value: unknown) => void = () => {}
    const gate = new Promise(resolve => {
      resolveFetch = resolve
    })
    const fetchImpl = vi.fn(async () => {
      await gate
      return jsonResponse(200, [release()])
    })
    const deps = { fetch: fetchImpl, getVersion: () => '1.0.0', stateDir: () => freshStateDir(), now: () => 1 }

    const first = checkCompanionUpdate({ force: true }, deps)
    // Give the first call a tick to enter the serial-guard-protected section.
    await Promise.resolve()
    const second = await checkCompanionUpdate({ force: true }, deps)
    expect(second).toEqual({ status: 'unknown', current: '1.0.0', checkedAt: null, message: 'בדיקת עדכון כבר מתבצעת' })

    resolveFetch(undefined)
    const firstResult = await first
    expect(firstResult.status).toBe('update-available')
  })

  it('cache in effect, no force → returns the stored verdict WITHOUT re-fetching', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(200, [release({ tag_name: 'v1.0.0' })]))
    const deps = { fetch: fetchImpl, getVersion: () => '1.0.0', stateDir: () => freshStateDir(), now: () => 5000 }

    const first = await checkCompanionUpdate({}, deps)
    const second = await checkCompanionUpdate({}, deps)
    expect(fetchImpl).toHaveBeenCalledTimes(1)
    expect(second).toEqual(first)
  })

  it('force bypasses the cache and re-fetches', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(200, [release({ tag_name: 'v1.0.0' })]))
    const dir = freshStateDir()
    await checkCompanionUpdate({}, { fetch: fetchImpl, getVersion: () => '1.0.0', stateDir: () => dir, now: () => 5000 })
    await checkCompanionUpdate({ force: true }, { fetch: fetchImpl, getVersion: () => '1.0.0', stateDir: () => dir, now: () => 5001 })
    expect(fetchImpl).toHaveBeenCalledTimes(2)
  })
})

describe('checkCompanionUpdate — durable throttle state (atomic-write under userData)', () => {
  it('writes companion-update-state.json with the last check time and status', async () => {
    const dir = freshStateDir()
    const fetchImpl = vi.fn(async () => jsonResponse(200, [release({ tag_name: 'v1.0.0' })]))
    await checkCompanionUpdate(
      { force: true },
      { fetch: fetchImpl, getVersion: () => '1.0.0', stateDir: () => dir, now: () => 9000 }
    )
    const written = JSON.parse(fs.readFileSync(path.join(dir, STATE_FILE_NAME), 'utf8'))
    expect(written).toMatchObject({ lastCheckedAt: 9000, lastStatus: 'up-to-date' })
  })

  it('a falsy stateDir (no userData available) never breaks the check itself', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(200, [release({ tag_name: 'v1.0.0' })]))
    const v = await checkCompanionUpdate(
      { force: true },
      { fetch: fetchImpl, getVersion: () => '1.0.0', stateDir: () => null, now: () => 9500 }
    )
    expect(v.status).toBe('up-to-date')
  })
})

describe('isPassiveUpdateCheckDisabled — passive-check hermeticity (§6.5, R7)', () => {
  it('is NOT disabled under a normal (non-QA, non-flagged) environment', () => {
    expect(isPassiveUpdateCheckDisabled({})).toBe(false)
  })

  it('is disabled when TACHLES_DISABLE_UPDATE_CHECK=1', () => {
    expect(isPassiveUpdateCheckDisabled({ TACHLES_DISABLE_UPDATE_CHECK: '1' })).toBe(true)
  })

  it('is NOT disabled when the env flag has a non-"1" value', () => {
    expect(isPassiveUpdateCheckDisabled({ TACHLES_DISABLE_UPDATE_CHECK: 'true' })).toBe(false)
  })

  it('is disabled when the QA runtime override sentinel is active and valid', () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'qa-home-'))
    tmpDirs.push(home)
    const env = {
      [SENTINEL_ENV]: SENTINEL_VALUE,
      [HOME_ENV]: home,
      [HOST_ENV]: '127.0.0.1',
      [PORT_ENV]: '45678'
    }
    expect(isPassiveUpdateCheckDisabled(env)).toBe(true)
  })

  it('fails CLOSED (disabled) when the QA sentinel is set but malformed', () => {
    const env = { [SENTINEL_ENV]: SENTINEL_VALUE } // sentinel on, home missing → QaOverrideError
    expect(isPassiveUpdateCheckDisabled(env)).toBe(true)
  })
})

describe('getLastCheckedAt — durable read with no network I/O (passive-timer precondition, §6.5)', () => {
  it('is null when no state file has ever been written', () => {
    const dir = freshStateDir()
    expect(getLastCheckedAt({ stateDir: () => dir })).toBeNull()
  })

  it('reads back lastCheckedAt after a real check wrote it', async () => {
    const dir = freshStateDir()
    const fetchImpl = vi.fn(async () => jsonResponse(200, [release({ tag_name: 'v1.0.0' })]))
    await checkCompanionUpdate(
      { force: true },
      { fetch: fetchImpl, getVersion: () => '1.0.0', stateDir: () => dir, now: () => 12_000 }
    )
    expect(getLastCheckedAt({ stateDir: () => dir })).toBe(12_000)
    // Never touches the network itself.
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })

  it('is null when stateDir resolves to a falsy value', () => {
    expect(getLastCheckedAt({ stateDir: () => null })).toBeNull()
  })

  it('is null when the state file is corrupt JSON', () => {
    const dir = freshStateDir()
    fs.writeFileSync(path.join(dir, STATE_FILE_NAME), '{not json')
    expect(getLastCheckedAt({ stateDir: () => dir })).toBeNull()
  })

  it('falls back to defaultStateDir (electron app.getPath) when no deps are given', () => {
    // No live Electron app in this suite — defaultStateDir() throws when it tries
    // require('electron').app.getPath(...), which getLastCheckedAt must not let
    // escape as a network-check-shaped failure. It is acceptable for this to
    // throw here (no fail-closed contract is claimed for a missing Electron
    // runtime, unlike checkCompanionUpdate) — the point is it does not silently
    // fabricate "never checked" behind a swallowed error.
    expect(() => getLastCheckedAt()).toThrow()
  })
})
