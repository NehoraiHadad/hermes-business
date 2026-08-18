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

// A GitHub-shaped response. By DEFAULT its headers are READABLE and carry no
// `Link` — which is exactly what api.github.com returns when the whole release
// set fits in one `per_page=20` page, i.e. positive proof that the scan saw
// everything. Pass `link` to simulate a paginated (⇒ truncated) listing.
function jsonResponse(status: number, body: unknown, options: { link?: string } = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: {
      get: (name: string) => (String(name).toLowerCase() === 'link' ? (options.link ?? null) : null)
    },
    json: async () => body
  }
}

// A response whose headers cannot be read at all (a non-conforming fetch impl /
// proxy). Completeness is then unprovable — the check must fail CLOSED.
function headerlessResponse(status: number, body: unknown) {
  return { ok: status >= 200 && status < 300, status, json: async () => body }
}

const NEXT_PAGE_LINK =
  '<https://api.github.com/repositories/1/releases?per_page=20&page=2>; rel="next", ' +
  '<https://api.github.com/repositories/1/releases?per_page=20&page=3>; rel="last"'

// The live shape that exposed the defect: every published release is a
// prerelease, so a STABLE install has no eligible candidate at all.
function allPrereleases() {
  return [
    release({ tag_name: 'v0.4.0-alpha.8', prerelease: true }),
    release({ tag_name: 'v0.4.0-alpha.7', prerelease: true }),
    release({ tag_name: 'v0.4.0-alpha.6', prerelease: true })
  ]
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
      checkedAt: 1000,
      // This fixture publishes no assets, so the managed one-click path is
      // honestly reported as unavailable — the manual downloadUrl above is what
      // the UI offers. Silence here would be indistinguishable from a bug.
      managedUpdate: false,
      managedUpdateReason: 'assets-absent'
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

describe('checkCompanionUpdate — managed-update asset resolution (one-click download targets)', () => {
  const ASSET_BASE = 'https://github.com/NehoraiHadad/hermes-business/releases/download/v1.1.0'

  function withAssets(assets: unknown[]) {
    return [release({ assets })]
  }

  function installerAsset(url = `${ASSET_BASE}/Tachles-Setup-1.1.0.exe`) {
    return { name: 'Tachles-Setup-1.1.0.exe', browser_download_url: url }
  }

  function manifestAsset(url = `${ASSET_BASE}/update-manifest.json`) {
    return { name: 'update-manifest.json', browser_download_url: url }
  }

  async function check(assets: unknown[], version = '1.0.0') {
    const fetchImpl = vi.fn(async () => jsonResponse(200, withAssets(assets)))
    return checkCompanionUpdate(
      { force: true },
      { fetch: fetchImpl, getVersion: () => version, stateDir: () => freshStateDir(), now: () => 1000 }
    )
  }

  it('resolves BOTH asset URLs from the pinned names and marks the managed path available', async () => {
    const v = await check([installerAsset(), manifestAsset(), { name: 'SHA256SUMS.txt', browser_download_url: `${ASSET_BASE}/SHA256SUMS.txt` }])
    expect(v.status).toBe('update-available')
    expect(v.managedUpdate).toBe(true)
    expect(v.installerUrl).toBe(`${ASSET_BASE}/Tachles-Setup-1.1.0.exe`)
    expect(v.manifestUrl).toBe(`${ASSET_BASE}/update-manifest.json`)
    expect(v.managedUpdateReason).toBeUndefined()
    // The manual fallback is NEVER removed by the managed path existing.
    expect(v.downloadUrl).toBe('https://github.com/NehoraiHadad/hermes-business/releases/tag/v1.1.0')
  })

  it('a release with the installer but NO manifest is an honest "manual fallback", not a crash', async () => {
    const v = await check([installerAsset()])
    expect(v.status).toBe('update-available')
    expect(v.managedUpdate).toBe(false)
    expect(v.managedUpdateReason).toBe('manifest-asset-absent')
    expect(v.installerUrl).toBeUndefined()
    expect(v.downloadUrl).toBeTruthy()
  })

  it('a release whose installer asset is named for a DIFFERENT version does not match', async () => {
    const v = await check([{ name: 'Tachles-Setup-9.9.9.exe', browser_download_url: `${ASSET_BASE}/Tachles-Setup-9.9.9.exe` }, manifestAsset()])
    expect(v.managedUpdate).toBe(false)
    expect(v.managedUpdateReason).toBe('installer-asset-absent')
  })

  it('a look-alike host on the installer asset is rejected, and the verdict says so', async () => {
    const v = await check([
      installerAsset('https://github.com.evil.tld/NehoraiHadad/hermes-business/releases/download/v1.1.0/Tachles-Setup-1.1.0.exe'),
      manifestAsset()
    ])
    expect(v.status).toBe('update-available')
    expect(v.managedUpdate).toBe(false)
    expect(v.managedUpdateReason).toBe('installer-url-rejected')
    expect(v.installerUrl).toBeUndefined()
  })

  it('an http:// downgrade on the manifest asset is rejected', async () => {
    const v = await check([installerAsset(), manifestAsset('http://github.com/NehoraiHadad/hermes-business/releases/download/v1.1.0/update-manifest.json')])
    expect(v.managedUpdate).toBe(false)
    expect(v.managedUpdateReason).toBe('manifest-url-rejected')
  })

  it('assets are not reported on non-update-available verdicts at all', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(200, [release({ tag_name: 'v1.0.0', assets: [installerAsset(), manifestAsset()] })]))
    const v = await checkCompanionUpdate(
      { force: true },
      { fetch: fetchImpl, getVersion: () => '1.0.0', stateDir: () => freshStateDir(), now: () => 1000 }
    )
    expect(v).toEqual({ status: 'up-to-date', current: '1.0.0', checkedAt: 1000 })
  })
})

describe('checkCompanionUpdate — a COMPLETE, NON-EMPTY scan with no candidate is an ANSWER, not a failure', () => {
  it('stable install + a repo publishing only prereleases ⇒ up-to-date (the defect this suite pins)', async () => {
    // The exact live shape: 0.4.0 stable installed, every published release is
    // an alpha. The fetch fully succeeded and PROVED there is nothing to
    // install; reporting "לא ניתן לבדוק עדכונים כרגע" here would claim the
    // check failed when it did not.
    const fetchImpl = vi.fn(async () => jsonResponse(200, allPrereleases()))
    const v = await checkCompanionUpdate(
      { force: true },
      { fetch: fetchImpl, getVersion: () => '0.4.0', stateDir: () => freshStateDir(), now: () => 7000 }
    )
    expect(v).toEqual({ status: 'up-to-date', current: '0.4.0', checkedAt: 7000 })
    expect(v.message).toBeUndefined()
  })

  it('the SAME listing for a prerelease install still reports the newest alpha (alpha channel untouched)', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(200, allPrereleases()))
    const v = await checkCompanionUpdate(
      { force: true },
      { fetch: fetchImpl, getVersion: () => '0.4.0-alpha.6', stateDir: () => freshStateDir(), now: () => 7100 }
    )
    expect(v.status).toBe('update-available')
    expect(v.latest).toBe('0.4.0-alpha.8')
  })

  it('a found candidate stays decisive even on a TRUNCATED listing (omitted entries were created earlier)', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(200, [release()], { link: NEXT_PAGE_LINK }))
    const v = await checkCompanionUpdate(
      { force: true },
      { fetch: fetchImpl, getVersion: () => '1.0.0', stateDir: () => freshStateDir(), now: () => 7300 }
    )
    expect(v.status).toBe('update-available')
    expect(v.latest).toBe('1.1.0')
  })

  it('the durable state records the proven up-to-date, not a fake unknown', async () => {
    const dir = freshStateDir()
    const fetchImpl = vi.fn(async () => jsonResponse(200, allPrereleases()))
    await checkCompanionUpdate(
      { force: true },
      { fetch: fetchImpl, getVersion: () => '0.4.0', stateDir: () => dir, now: () => 7400 }
    )
    const written = JSON.parse(fs.readFileSync(path.join(dir, STATE_FILE_NAME), 'utf8'))
    expect(written).toMatchObject({ lastCheckedAt: 7400, lastStatus: 'up-to-date' })
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

  it('all tags unparseable — an unreadable tag is not proof of being older, so the scan is incomplete', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse(200, [release({ tag_name: 'garbage' }), release({ tag_name: 'also-garbage' })])
    )
    const v = await checkCompanionUpdate(
      { force: true },
      { fetch: fetchImpl, getVersion: () => '1.0.0', stateDir: () => freshStateDir(), now: () => 1 }
    )
    expect(v).toEqual({ status: 'unknown', current: '1.0.0', checkedAt: 1, message: 'לא ניתן לבדוק עדכונים כרגע' })
  })

  it('an unparseable RUNNING version — nothing to compare against, even on a complete listing', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(200, [release({ tag_name: 'v1.0.0' })]))
    const v = await checkCompanionUpdate(
      { force: true },
      { fetch: fetchImpl, getVersion: () => 'not-a-version', stateDir: () => freshStateDir(), now: () => 1 }
    )
    expect(v).toEqual({
      status: 'unknown',
      current: 'not-a-version',
      checkedAt: 1,
      message: 'לא ניתן לבדוק עדכונים כרגע'
    })
  })

  it('empty release list — [] is content-free, and content-free is NOT proof of up-to-date', async () => {
    // The scan is COMPLETE here (readable headers, no next page, nothing
    // unorderable) and it still must not report מעודכן: this repo publishes
    // releases and keeps a never-shrinking ledger, so an empty listing is an
    // upstream anomaly, and up-to-date would durably (cache + lastStatus)
    // swallow a pending update. 'unknown' degrades to a recoverable
    // "couldn't check" instead.
    const fetchImpl = vi.fn(async () => jsonResponse(200, []))
    const v = await checkCompanionUpdate(
      { force: true },
      { fetch: fetchImpl, getVersion: () => '1.0.0', stateDir: () => freshStateDir(), now: () => 1 }
    )
    expect(v).toEqual({ status: 'unknown', current: '1.0.0', checkedAt: 1, message: 'לא ניתן לבדוק עדכונים כרגע' })
  })

  it('TRUNCATED listing (Link rel="next") with no eligible candidate — the unseen page may hold the update', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(200, allPrereleases(), { link: NEXT_PAGE_LINK }))
    const v = await checkCompanionUpdate(
      { force: true },
      { fetch: fetchImpl, getVersion: () => '0.4.0', stateDir: () => freshStateDir(), now: () => 1 }
    )
    expect(v).toEqual({ status: 'unknown', current: '0.4.0', checkedAt: 1, message: 'לא ניתן לבדוק עדכונים כרגע' })
  })

  it('truncated EMPTY listing — unknown twice over (empty census AND an unseen page)', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(200, [], { link: NEXT_PAGE_LINK }))
    const v = await checkCompanionUpdate(
      { force: true },
      { fetch: fetchImpl, getVersion: () => '1.0.0', stateDir: () => freshStateDir(), now: () => 1 }
    )
    expect(v.status).toBe('unknown')
  })

  it('UNREADABLE response headers with no eligible candidate — completeness unprovable ⇒ fails closed', async () => {
    const fetchImpl = vi.fn(async () => headerlessResponse(200, allPrereleases()))
    const v = await checkCompanionUpdate(
      { force: true },
      { fetch: fetchImpl, getVersion: () => '0.4.0', stateDir: () => freshStateDir(), now: () => 1 }
    )
    expect(v.status).toBe('unknown')
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
