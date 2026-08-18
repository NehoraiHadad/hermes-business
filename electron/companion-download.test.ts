import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createHash, generateKeyPairSync, sign as cryptoSign, verify as cryptoVerify } from 'node:crypto'

// require(), not import: this file and companion-download.cjs's own internal
// require('./qa-runtime.cjs') must resolve to the SAME Node module singleton for
// __resetQaRuntimeOverrideCache to reset the instance the code under test reads.
const { downloadCompanionUpdate, SUCCESS_MESSAGE } = require('./companion-download.cjs')
const { manifestSigningBody } = require('./update-manifest-verify.cjs')
const { messageForDownloadCode } = require('./companion-download-core.cjs')
const { __resetQaRuntimeOverrideCache } = require('./qa-runtime.cjs')

// ── fixtures ─────────────────────────────────────────────────────────────────
//
// A REAL Ed25519 key pair and a REAL detached-signature verifier (the same
// `crypto.verify(null, ...)` primitive update-trust.cjs ships), injected through
// `keys`/`verifySignature`. A toy string-compare verifier would make the
// "forged signature" case pass for the wrong reason — here a tampered byte
// genuinely fails a cryptographic check.
const { publicKey, privateKey } = generateKeyPairSync('ed25519')
const KEY_ID = 'tachles-update-ed25519-testkey00'
const KEYS = { [KEY_ID]: publicKey.export({ type: 'spki', format: 'pem' }) as string }

function realVerify(body: string, signatureB64: string, keyId: string): boolean {
  const pem = Object.prototype.hasOwnProperty.call(KEYS, keyId) ? KEYS[keyId] : null
  if (!pem || typeof body !== 'string' || !signatureB64) return false
  try {
    return cryptoVerify(null, Buffer.from(body, 'utf8'), pem, Buffer.from(String(signatureB64), 'base64')) === true
  } catch {
    return false
  }
}
function realSign(body: string): string {
  return cryptoSign(null, Buffer.from(body, 'utf8'), privateKey).toString('base64')
}

const CURRENT = '0.4.0-alpha.7'
const NEXT = '0.4.0-alpha.8'
const INSTALLER_NAME = `Tachles-Setup-${NEXT}.exe`
const BASE = `https://github.com/NehoraiHadad/hermes-business/releases/download/v${NEXT}`
const INSTALLER_URL = `${BASE}/${INSTALLER_NAME}`
const MANIFEST_URL = `${BASE}/update-manifest.json`

const PAYLOAD = Buffer.from('THE-REAL-INSTALLER-BYTES-'.repeat(40))
const PAYLOAD_SHA = createHash('sha256').update(PAYLOAD).digest('hex')
// Same LENGTH, different content — so a digest failure cannot be mistaken for a
// size failure (and vice versa).
const EVIL_PAYLOAD = Buffer.from('THE-EVIL-INSTALLER-BYTES-'.repeat(40))

function signedManifest(overrides: Record<string, unknown> = {}) {
  const doc = {
    schema: 1,
    version: NEXT,
    channel: 'pilot',
    installer: { name: INSTALLER_NAME, sha256: PAYLOAD_SHA, bytes: PAYLOAD.length },
    released_at: '2026-08-18',
    signed_by: KEY_ID,
    ...overrides
  }
  return { ...doc, signature: realSign(manifestSigningBody(doc)) }
}

// ── HTTP doubles ─────────────────────────────────────────────────────────────

function textResponse(status: number, body: string) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => null },
    text: async () => body
  }
}

async function* chunksOf(buffer: Buffer, size = 16) {
  for (let offset = 0; offset < buffer.length; offset += size) {
    yield buffer.subarray(offset, Math.min(offset + size, buffer.length))
  }
}

function binaryResponse(
  status: number,
  buffer: Buffer,
  options: { contentLength?: string | null; contentEncoding?: string | null; body?: AsyncIterable<Buffer> | null } = {}
) {
  const contentLength = options.contentLength === undefined ? String(buffer.length) : options.contentLength
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: {
      get: (name: string) => {
        const key = String(name).toLowerCase()
        if (key === 'content-length') return contentLength
        if (key === 'content-encoding') return options.contentEncoding ?? null
        return null
      }
    },
    body: options.body === undefined ? chunksOf(buffer) : options.body
  }
}

/** A fetch double that answers the manifest URL and the installer URL separately
 * and RECORDS which URLs were requested — the "no installer request at all"
 * assertions are the whole point of several cases below. */
function fetchDouble(handlers: { manifest?: () => unknown; installer?: () => unknown } = {}) {
  const calls: string[] = []
  const impl = vi.fn(async (url: string) => {
    calls.push(url)
    if (url === MANIFEST_URL) return (handlers.manifest ?? (() => textResponse(200, JSON.stringify(signedManifest()))))()
    if (url === INSTALLER_URL) return (handlers.installer ?? (() => binaryResponse(200, PAYLOAD)))()
    throw new Error(`unexpected fetch: ${url}`)
  })
  return Object.assign(impl, { calls })
}

// ── journal double ───────────────────────────────────────────────────────────
//
// The real companion-update-journal.cjs is owned by a concurrent change; the
// engine only ever touches it through DI, so the contract is exercised here as a
// recorder: begin → verifying → ready, or begin → failure → clear.
function journalDouble() {
  const events: Array<{ call: string; args: unknown }> = []
  return {
    events,
    phases: () => events.filter(e => e.call === 'updateCompanionPhase').map(e => (e.args as string[])[0]),
    beginCompanionUpdate: vi.fn((record: unknown) => {
      events.push({ call: 'begin', args: record })
      return record
    }),
    updateCompanionPhase: vi.fn((phase: string, patch: unknown) => {
      events.push({ call: 'updateCompanionPhase', args: [phase, patch] })
      return null
    }),
    recordCompanionFailure: vi.fn((error: unknown) => {
      events.push({ call: 'recordCompanionFailure', args: String((error as Error)?.message) })
      return null
    }),
    clearCompanionJournal: vi.fn((options: unknown) => {
      events.push({ call: 'clearCompanionJournal', args: options })
      return null
    })
  }
}

const tmpDirs: string[] = []
function freshUpdatesDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'companion-download-'))
  tmpDirs.push(dir)
  return dir
}

function baseDeps(dir: string, fetchImpl: unknown, journal: unknown, extra: Record<string, unknown> = {}) {
  return {
    fetch: fetchImpl,
    // REAL fs on a real temp dir: the atomic-rename / fsync / delete-on-failure
    // properties are about the filesystem, so faking it would test nothing.
    updatesDir: () => dir,
    journal,
    getVersion: () => CURRENT,
    keys: KEYS,
    verifySignature: realVerify,
    // A generous but explicit free-space answer keeps the happy paths from
    // depending on the CI machine's actual disk.
    freeSpaceBytes: () => 8 * 1024 * 1024 * 1024,
    log: () => {},
    env: {},
    progressThresholdBytes: 0,
    ...extra
  }
}

function listDir(dir: string) {
  return fs.readdirSync(dir).sort()
}

beforeEach(() => {
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

describe('downloadCompanionUpdate — happy path', () => {
  it('verifies the manifest, streams+hashes the installer, and publishes it atomically', async () => {
    const dir = freshUpdatesDir()
    const fetchImpl = fetchDouble()
    const journal = journalDouble()
    const progress: Array<{ receivedBytes: number; totalBytes: number | null; phase: string }> = []

    const result = await downloadCompanionUpdate(
      { version: NEXT, installerUrl: INSTALLER_URL, manifestUrl: MANIFEST_URL },
      baseDeps(dir, fetchImpl, journal, { onProgress: (event: never) => progress.push(event) })
    )

    expect(result.ok).toBe(true)
    expect(result.message).toBe(SUCCESS_MESSAGE)
    expect(result.installerPath).toBe(path.join(dir, INSTALLER_NAME))
    expect(result.sha256).toBe(PAYLOAD_SHA)
    expect(result.bytes).toBe(PAYLOAD.length)
    expect(result.version).toBe(NEXT)
    expect(result.currentVersion).toBe(CURRENT)
    expect(result.signedBy).toBe(KEY_ID)

    // The bytes on disk are the bytes that were signed for, and NOTHING else is
    // left behind — no .part sibling.
    expect(listDir(dir)).toEqual([INSTALLER_NAME])
    expect(fs.readFileSync(result.installerPath)).toEqual(PAYLOAD)

    // Manifest FIRST, installer second — the ordering is the security property.
    expect(fetchImpl.calls).toEqual([MANIFEST_URL, INSTALLER_URL])

    // Journal: opened before the first byte with all four trusted fields, then
    // advanced, and left at `ready` for the apply stage (never cleared on success).
    expect(journal.beginCompanionUpdate).toHaveBeenCalledWith({
      currentVersion: CURRENT,
      targetVersion: NEXT,
      installerPath: path.join(dir, INSTALLER_NAME),
      installerSha256: PAYLOAD_SHA
    })
    expect(journal.phases()).toEqual(['verifying', 'ready'])
    expect(journal.clearCompanionJournal).not.toHaveBeenCalled()

    // Progress is reportable end-to-end.
    expect(progress[0]).toEqual({ receivedBytes: 0, totalBytes: null, phase: 'manifest' })
    expect(progress.some(p => p.phase === 'downloading' && p.receivedBytes > 0)).toBe(true)
    expect(progress.at(-1)).toEqual({ receivedBytes: PAYLOAD.length, totalBytes: PAYLOAD.length, phase: 'ready' })
    expect(progress.every(p => p.receivedBytes <= PAYLOAD.length)).toBe(true)
  })

  it('tolerates a missing Content-Length and falls back to the AUTHENTICATED size as the denominator', async () => {
    const dir = freshUpdatesDir()
    const fetchImpl = fetchDouble({ installer: () => binaryResponse(200, PAYLOAD, { contentLength: null }) })
    const progress: Array<{ totalBytes: number | null }> = []
    const result = await downloadCompanionUpdate(
      { version: NEXT, installerUrl: INSTALLER_URL, manifestUrl: MANIFEST_URL },
      baseDeps(dir, fetchImpl, journalDouble(), { onProgress: (event: never) => progress.push(event) })
    )
    expect(result.ok).toBe(true)
    expect(progress.filter(p => p.totalBytes !== null).every(p => p.totalBytes === PAYLOAD.length)).toBe(true)
  })

  it('a body exposed as a web ReadableStream (getReader) streams identically', async () => {
    const dir = freshUpdatesDir()
    const reader = (() => {
      const iterator = chunksOf(PAYLOAD)
      return {
        getReader: () => ({
          read: async () => {
            const next = await iterator.next()
            return next.done ? { done: true, value: undefined } : { done: false, value: next.value }
          },
          releaseLock: () => {}
        })
      }
    })()
    const fetchImpl = fetchDouble({ installer: () => binaryResponse(200, PAYLOAD, { body: reader as never }) })
    const result = await downloadCompanionUpdate(
      { version: NEXT, installerUrl: INSTALLER_URL, manifestUrl: MANIFEST_URL },
      baseDeps(dir, fetchImpl, journalDouble())
    )
    expect(result.ok).toBe(true)
    expect(fs.readFileSync(path.join(dir, INSTALLER_NAME))).toEqual(PAYLOAD)
  })

  it('a throwing progress listener never fails an otherwise good download', async () => {
    const dir = freshUpdatesDir()
    const result = await downloadCompanionUpdate(
      { version: NEXT, installerUrl: INSTALLER_URL, manifestUrl: MANIFEST_URL },
      baseDeps(dir, fetchDouble(), journalDouble(), {
        onProgress: () => {
          throw new Error('renderer went away')
        }
      })
    )
    expect(result.ok).toBe(true)
  })
})

describe('downloadCompanionUpdate — the manifest must be authenticated BEFORE any installer byte is fetched', () => {
  async function run(manifestFactory: () => unknown, dir = freshUpdatesDir()) {
    const fetchImpl = fetchDouble({ manifest: () => textResponse(200, JSON.stringify(manifestFactory())) })
    const journal = journalDouble()
    const result = await downloadCompanionUpdate(
      { version: NEXT, installerUrl: INSTALLER_URL, manifestUrl: MANIFEST_URL },
      baseDeps(dir, fetchImpl, journal)
    )
    return { result, fetchImpl, journal, dir }
  }

  it('a FORGED signature aborts and the installer is never requested at all', async () => {
    const { result, fetchImpl, journal, dir } = await run(() => {
      const manifest = signedManifest()
      // Flip one byte of the payload the signature covers.
      return { ...manifest, installer: { ...manifest.installer, sha256: 'b'.repeat(64) } }
    })
    expect(result.ok).toBe(false)
    expect(result.code).toBe('manifest-unverified')
    expect(result.detail).toContain('signature-invalid')
    expect(result.message).toBe(messageForDownloadCode('manifest-unverified'))
    // THE assertion: no installer request, so no attacker-chosen bytes were ever
    // written to this machine.
    expect(fetchImpl.calls).toEqual([MANIFEST_URL])
    expect(listDir(dir)).toEqual([])
    // Nothing was started, so there is nothing to journal or roll back.
    expect(journal.beginCompanionUpdate).not.toHaveBeenCalled()
  })

  it('a signature made by an UNTRUSTED key is refused (signer-unknown), no installer fetch', async () => {
    const other = generateKeyPairSync('ed25519')
    const { result, fetchImpl } = await run(() => {
      const doc = {
        schema: 1,
        version: NEXT,
        channel: 'pilot',
        installer: { name: INSTALLER_NAME, sha256: PAYLOAD_SHA, bytes: PAYLOAD.length },
        released_at: '2026-08-18',
        signed_by: 'tachles-update-ed25519-rogue0000'
      }
      return { ...doc, signature: cryptoSign(null, Buffer.from(manifestSigningBody(doc), 'utf8'), other.privateKey).toString('base64') }
    })
    expect(result.code).toBe('manifest-unverified')
    expect(result.detail).toContain('signer-unknown')
    expect(fetchImpl.calls).toEqual([MANIFEST_URL])
  })

  it('ANTI-REPLAY: a genuinely signed manifest for the WRONG version aborts', async () => {
    // Authentic, correctly signed — and about a different release. A signature
    // proves who wrote a statement, never when it is replayed.
    const { result, fetchImpl } = await run(() =>
      signedManifest({ version: '0.4.0-alpha.6', installer: { name: 'Tachles-Setup-0.4.0-alpha.6.exe', sha256: PAYLOAD_SHA, bytes: PAYLOAD.length } })
    )
    expect(result.ok).toBe(false)
    expect(result.code).toBe('manifest-unverified')
    expect(result.detail).toContain('version-mismatch')
    expect(fetchImpl.calls).toEqual([MANIFEST_URL])
  })

  it('a manifest that is not strictly NEWER than the installed version is refused (downgrade)', async () => {
    const dir = freshUpdatesDir()
    const fetchImpl = fetchDouble({
      manifest: () =>
        textResponse(
          200,
          JSON.stringify(
            signedManifest({ version: CURRENT, installer: { name: `Tachles-Setup-${CURRENT}.exe`, sha256: PAYLOAD_SHA, bytes: PAYLOAD.length } })
          )
        )
    })
    const result = await downloadCompanionUpdate(
      // The CHECK itself is told to expect the older version here, so only the
      // defence-in-depth "not strictly newer" clause can catch it.
      { version: CURRENT, installerUrl: INSTALLER_URL, manifestUrl: MANIFEST_URL },
      baseDeps(dir, fetchImpl, journalDouble())
    )
    expect(result.code).toBe('manifest-unverified')
    expect(result.detail).toContain('version-not-newer')
    expect(fetchImpl.calls).toEqual([MANIFEST_URL])
  })

  it('an unknown schema is refused rather than best-effort parsed', async () => {
    const { result } = await run(() => signedManifest({ schema: 2 }))
    expect(result.detail).toContain('schema-unsupported')
  })

  it('HTTP 404 on the manifest is a structured failure, never a rejection', async () => {
    const dir = freshUpdatesDir()
    const fetchImpl = fetchDouble({ manifest: () => textResponse(404, 'Not Found') })
    const result = await downloadCompanionUpdate(
      { version: NEXT, installerUrl: INSTALLER_URL, manifestUrl: MANIFEST_URL },
      baseDeps(dir, fetchImpl, journalDouble())
    )
    expect(result).toMatchObject({ ok: false, code: 'manifest-fetch-failed' })
    expect(result.detail).toContain('404')
    expect(fetchImpl.calls).toEqual([MANIFEST_URL])
  })

  it('a network throw on the manifest fetch is a structured failure', async () => {
    const dir = freshUpdatesDir()
    const fetchImpl = fetchDouble({
      manifest: () => {
        throw new TypeError('fetch failed')
      }
    })
    const result = await downloadCompanionUpdate(
      { version: NEXT, installerUrl: INSTALLER_URL, manifestUrl: MANIFEST_URL },
      baseDeps(dir, fetchImpl, journalDouble())
    )
    expect(result).toMatchObject({ ok: false, code: 'manifest-fetch-failed' })
  })

  it('a manifest body that is not JSON fails as manifest-parse-failed', async () => {
    const dir = freshUpdatesDir()
    const fetchImpl = fetchDouble({ manifest: () => textResponse(200, '<html>rate limited</html>') })
    const result = await downloadCompanionUpdate(
      { version: NEXT, installerUrl: INSTALLER_URL, manifestUrl: MANIFEST_URL },
      baseDeps(dir, fetchImpl, journalDouble())
    )
    expect(result).toMatchObject({ ok: false, code: 'manifest-parse-failed' })
  })

  it('an absurdly large manifest body is refused before it is parsed', async () => {
    const dir = freshUpdatesDir()
    const fetchImpl = fetchDouble({ manifest: () => textResponse(200, 'x'.repeat(70 * 1024)) })
    const result = await downloadCompanionUpdate(
      { version: NEXT, installerUrl: INSTALLER_URL, manifestUrl: MANIFEST_URL },
      baseDeps(dir, fetchImpl, journalDouble())
    )
    expect(result).toMatchObject({ ok: false, code: 'manifest-parse-failed' })
  })
})

describe('downloadCompanionUpdate — the bytes must match the authenticated statement', () => {
  it('digest mismatch ⇒ the file is DELETED and nothing reaches the final path', async () => {
    const dir = freshUpdatesDir()
    const fetchImpl = fetchDouble({ installer: () => binaryResponse(200, EVIL_PAYLOAD, { contentLength: String(PAYLOAD.length) }) })
    const journal = journalDouble()
    const result = await downloadCompanionUpdate(
      { version: NEXT, installerUrl: INSTALLER_URL, manifestUrl: MANIFEST_URL },
      baseDeps(dir, fetchImpl, journal)
    )
    expect(result).toMatchObject({ ok: false, code: 'installer-digest-mismatch' })
    expect(result.message).toBe(messageForDownloadCode('installer-digest-mismatch'))
    // No installer, no .part — an unverified binary must never survive where the
    // apply stage could later find it.
    expect(listDir(dir)).toEqual([])
    // The transaction rolled itself back completely, so no journal residue is
    // left for launch-time recovery to puzzle over.
    expect(journal.recordCompanionFailure).toHaveBeenCalled()
    expect(journal.clearCompanionJournal).toHaveBeenCalledWith({ outcome: 'failed' })
  })

  it('TRUNCATED download (Content-Length > received) ⇒ abort + delete', async () => {
    const dir = freshUpdatesDir()
    const half = PAYLOAD.subarray(0, Math.floor(PAYLOAD.length / 2))
    const fetchImpl = fetchDouble({
      installer: () => binaryResponse(200, PAYLOAD, { contentLength: String(PAYLOAD.length), body: chunksOf(half) })
    })
    const result = await downloadCompanionUpdate(
      { version: NEXT, installerUrl: INSTALLER_URL, manifestUrl: MANIFEST_URL },
      baseDeps(dir, fetchImpl, journalDouble())
    )
    expect(result).toMatchObject({ ok: false, code: 'installer-truncated' })
    expect(listDir(dir)).toEqual([])
  })

  it('a Content-Length that disagrees with the SIGNED size aborts before a byte is streamed', async () => {
    const dir = freshUpdatesDir()
    const fetchImpl = fetchDouble({ installer: () => binaryResponse(200, PAYLOAD, { contentLength: '999999' }) })
    const result = await downloadCompanionUpdate(
      { version: NEXT, installerUrl: INSTALLER_URL, manifestUrl: MANIFEST_URL },
      baseDeps(dir, fetchImpl, journalDouble())
    )
    expect(result).toMatchObject({ ok: false, code: 'installer-size-declared-mismatch' })
    expect(listDir(dir)).toEqual([])
  })

  it('a body that overruns the signed size is refused (installer-oversize)', async () => {
    const dir = freshUpdatesDir()
    const tooMuch = Buffer.concat([PAYLOAD, Buffer.from('EXTRA')])
    const fetchImpl = fetchDouble({
      installer: () => binaryResponse(200, PAYLOAD, { contentLength: String(PAYLOAD.length), body: chunksOf(tooMuch) })
    })
    const result = await downloadCompanionUpdate(
      { version: NEXT, installerUrl: INSTALLER_URL, manifestUrl: MANIFEST_URL },
      baseDeps(dir, fetchImpl, journalDouble())
    )
    expect(result).toMatchObject({ ok: false, code: 'installer-oversize' })
    expect(listDir(dir)).toEqual([])
  })

  it('HTTP 500 on the installer is a structured failure with no residue', async () => {
    const dir = freshUpdatesDir()
    const fetchImpl = fetchDouble({ installer: () => ({ ok: false, status: 500, headers: { get: () => null }, body: null }) })
    const journal = journalDouble()
    const result = await downloadCompanionUpdate(
      { version: NEXT, installerUrl: INSTALLER_URL, manifestUrl: MANIFEST_URL },
      baseDeps(dir, fetchImpl, journal)
    )
    expect(result).toMatchObject({ ok: false, code: 'installer-fetch-failed' })
    expect(result.detail).toContain('500')
    expect(listDir(dir)).toEqual([])
    expect(journal.clearCompanionJournal).toHaveBeenCalled()
  })

  it('a 200 with no readable body is a failure, never a silently empty file', async () => {
    const dir = freshUpdatesDir()
    const fetchImpl = fetchDouble({ installer: () => binaryResponse(200, PAYLOAD, { body: null }) })
    const result = await downloadCompanionUpdate(
      { version: NEXT, installerUrl: INSTALLER_URL, manifestUrl: MANIFEST_URL },
      baseDeps(dir, fetchImpl, journalDouble())
    )
    expect(result).toMatchObject({ ok: false, code: 'installer-body-absent' })
    expect(listDir(dir)).toEqual([])
  })

  it('a mid-stream network error deletes the partial file', async () => {
    const dir = freshUpdatesDir()
    async function* explodingBody() {
      yield PAYLOAD.subarray(0, 32)
      throw new Error('ECONNRESET')
    }
    const fetchImpl = fetchDouble({ installer: () => binaryResponse(200, PAYLOAD, { body: explodingBody() }) })
    const result = await downloadCompanionUpdate(
      { version: NEXT, installerUrl: INSTALLER_URL, manifestUrl: MANIFEST_URL },
      baseDeps(dir, fetchImpl, journalDouble())
    )
    expect(result.ok).toBe(false)
    expect(listDir(dir)).toEqual([])
  })
})

describe('downloadCompanionUpdate — cancellation', () => {
  it('cancelling mid-stream removes the partial file and leaves no journal residue', async () => {
    const dir = freshUpdatesDir()
    const controller = new AbortController()
    async function* cancellingBody() {
      yield PAYLOAD.subarray(0, 32)
      controller.abort()
      yield PAYLOAD.subarray(32)
    }
    const fetchImpl = fetchDouble({ installer: () => binaryResponse(200, PAYLOAD, { body: cancellingBody() }) })
    const journal = journalDouble()

    const result = await downloadCompanionUpdate(
      { version: NEXT, installerUrl: INSTALLER_URL, manifestUrl: MANIFEST_URL, signal: controller.signal },
      baseDeps(dir, fetchImpl, journal)
    )

    expect(result).toMatchObject({ ok: false, code: 'cancelled' })
    expect(result.message).toBe(messageForDownloadCode('cancelled'))
    expect(listDir(dir)).toEqual([])
    expect(journal.clearCompanionJournal).toHaveBeenCalledWith({ outcome: 'cancelled' })
  })

  it('an already-aborted signal refuses before any fetch happens', async () => {
    const dir = freshUpdatesDir()
    const controller = new AbortController()
    controller.abort()
    const fetchImpl = fetchDouble()
    const result = await downloadCompanionUpdate(
      { version: NEXT, installerUrl: INSTALLER_URL, manifestUrl: MANIFEST_URL, signal: controller.signal },
      baseDeps(dir, fetchImpl, journalDouble())
    )
    expect(result).toMatchObject({ ok: false, code: 'cancelled' })
    expect(fetchImpl.calls).toEqual([])
  })
})

describe('downloadCompanionUpdate — untrusted arguments and preconditions', () => {
  it('a look-alike installer host is rejected without any network call', async () => {
    const dir = freshUpdatesDir()
    const fetchImpl = fetchDouble()
    const result = await downloadCompanionUpdate(
      {
        version: NEXT,
        installerUrl: `https://github.com.evil.tld/NehoraiHadad/hermes-business/releases/download/v${NEXT}/${INSTALLER_NAME}`,
        manifestUrl: MANIFEST_URL
      },
      baseDeps(dir, fetchImpl, journalDouble())
    )
    expect(result).toMatchObject({ ok: false, code: 'installer-url-rejected' })
    expect(fetchImpl.calls).toEqual([])
  })

  it('an http:// downgrade on the manifest URL is rejected without any network call', async () => {
    const dir = freshUpdatesDir()
    const fetchImpl = fetchDouble()
    const result = await downloadCompanionUpdate(
      { version: NEXT, installerUrl: INSTALLER_URL, manifestUrl: MANIFEST_URL.replace('https://', 'http://') },
      baseDeps(dir, fetchImpl, journalDouble())
    )
    expect(result).toMatchObject({ ok: false, code: 'manifest-url-rejected' })
    expect(fetchImpl.calls).toEqual([])
  })

  it('the release PAGE url is not an acceptable installer URL', async () => {
    const dir = freshUpdatesDir()
    const result = await downloadCompanionUpdate(
      { version: NEXT, installerUrl: `https://github.com/NehoraiHadad/hermes-business/releases/tag/v${NEXT}`, manifestUrl: MANIFEST_URL },
      baseDeps(dir, fetchDouble(), journalDouble())
    )
    expect(result).toMatchObject({ ok: false, code: 'installer-url-rejected' })
  })

  it('MISSING assets (a verdict with managedUpdate:false) yields an honest refusal, not a crash', async () => {
    // This is the shape the renderer would pass if it ignored `managedUpdate`
    // and called the engine anyway on a release with no managed payload.
    const dir = freshUpdatesDir()
    const fetchImpl = fetchDouble()
    const result = await downloadCompanionUpdate(
      { version: NEXT, installerUrl: undefined, manifestUrl: undefined },
      baseDeps(dir, fetchImpl, journalDouble())
    )
    expect(result).toMatchObject({ ok: false, code: 'installer-url-rejected' })
    expect(typeof result.message).toBe('string')
    expect(fetchImpl.calls).toEqual([])
  })

  it('a missing target version is refused (there would be no anti-replay anchor)', async () => {
    const dir = freshUpdatesDir()
    const result = await downloadCompanionUpdate(
      { installerUrl: INSTALLER_URL, manifestUrl: MANIFEST_URL },
      baseDeps(dir, fetchDouble(), journalDouble())
    )
    expect(result).toMatchObject({ ok: false, code: 'target-version-invalid' })
  })

  it('obviously insufficient disk space fails fast — before the installer is requested', async () => {
    const dir = freshUpdatesDir()
    const fetchImpl = fetchDouble()
    const journal = journalDouble()
    const result = await downloadCompanionUpdate(
      { version: NEXT, installerUrl: INSTALLER_URL, manifestUrl: MANIFEST_URL },
      baseDeps(dir, fetchImpl, journal, { freeSpaceBytes: () => 1024 })
    )
    expect(result).toMatchObject({ ok: false, code: 'disk-space-insufficient' })
    expect(result.message).toBe(messageForDownloadCode('disk-space-insufficient'))
    expect(fetchImpl.calls).toEqual([MANIFEST_URL])
    expect(journal.beginCompanionUpdate).not.toHaveBeenCalled()
  })

  it('UNMEASURABLE free space does not block the update', async () => {
    const dir = freshUpdatesDir()
    const result = await downloadCompanionUpdate(
      { version: NEXT, installerUrl: INSTALLER_URL, manifestUrl: MANIFEST_URL },
      baseDeps(dir, fetchDouble(), journalDouble(), { freeSpaceBytes: () => null })
    )
    expect(result.ok).toBe(true)
  })
})

describe('downloadCompanionUpdate — hermeticity and serialization', () => {
  it('TACHLES_DISABLE_UPDATE_CHECK=1 refuses before any I/O (packaged E2E stays hermetic)', async () => {
    const dir = freshUpdatesDir()
    const fetchImpl = fetchDouble()
    const journal = journalDouble()
    const result = await downloadCompanionUpdate(
      { version: NEXT, installerUrl: INSTALLER_URL, manifestUrl: MANIFEST_URL },
      baseDeps(dir, fetchImpl, journal, { env: { TACHLES_DISABLE_UPDATE_CHECK: '1' } })
    )
    expect(result).toMatchObject({ ok: false, code: 'download-disabled' })
    expect(fetchImpl.calls).toEqual([])
    expect(journal.beginCompanionUpdate).not.toHaveBeenCalled()
    expect(listDir(dir)).toEqual([])
  })

  it('a misconfigured disable-switch reader fails CLOSED', async () => {
    const dir = freshUpdatesDir()
    const fetchImpl = fetchDouble()
    const result = await downloadCompanionUpdate(
      { version: NEXT, installerUrl: INSTALLER_URL, manifestUrl: MANIFEST_URL },
      baseDeps(dir, fetchImpl, journalDouble(), {
        isDisabled: () => {
          throw new Error('QA override is invalid')
        }
      })
    )
    expect(result).toMatchObject({ ok: false, code: 'download-disabled' })
    expect(fetchImpl.calls).toEqual([])
  })

  it('a second concurrent download is refused by the serial guard, never rejected', async () => {
    const dir = freshUpdatesDir()
    let releaseManifest: () => void = () => {}
    const gate = new Promise<void>(resolve => {
      releaseManifest = resolve
    })
    const slowFetch = fetchDouble({
      manifest: async () => {
        await gate
        return textResponse(200, JSON.stringify(signedManifest()))
      }
    })

    const first = downloadCompanionUpdate(
      { version: NEXT, installerUrl: INSTALLER_URL, manifestUrl: MANIFEST_URL },
      baseDeps(dir, slowFetch, journalDouble())
    )
    await Promise.resolve()
    const second = await downloadCompanionUpdate(
      { version: NEXT, installerUrl: INSTALLER_URL, manifestUrl: MANIFEST_URL },
      baseDeps(freshUpdatesDir(), fetchDouble(), journalDouble())
    )
    expect(second).toMatchObject({ ok: false, code: 'busy' })
    expect(second.message).toBe(messageForDownloadCode('busy'))

    releaseManifest()
    await expect(first).resolves.toMatchObject({ ok: true })
  })

  it('never rejects: even a collaborator that throws resolves to a structured failure', async () => {
    const dir = freshUpdatesDir()
    const result = await downloadCompanionUpdate(
      { version: NEXT, installerUrl: INSTALLER_URL, manifestUrl: MANIFEST_URL },
      baseDeps(dir, fetchDouble(), journalDouble(), {
        getVersion: () => {
          throw new Error('electron app unavailable')
        }
      })
    )
    expect(result).toMatchObject({ ok: false, code: 'unexpected' })
    expect(result.message).toBe(messageForDownloadCode('unexpected'))
  })
})
