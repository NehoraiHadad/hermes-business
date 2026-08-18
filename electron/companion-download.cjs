const nodeFs = require('node:fs')
const path = require('node:path')
const { createHash: nodeCreateHash } = require('node:crypto')
const { hermesHome } = require('./paths.cjs')
const { createSerialGuard } = require('./ipc-guards.cjs')
const { rememberLog } = require('./logs.cjs')
const { isPassiveUpdateCheckDisabled } = require('./companion-update.cjs')
const { UPDATE_TRUST_KEYS, verifyManifestSignature } = require('./update-trust.cjs')
const { verifyUpdateManifest } = require('./update-manifest-verify.cjs')
const core = require('./companion-download-core.cjs')

// IMPURE half of the managed תכל'ס (companion) update: fetch the signed
// manifest, authenticate it, stream the installer to disk while hashing it, and
// hand the apply stage a file whose bytes are PROVEN to be the ones the release
// key signed. Every decision (asset selection, URL allow-list, size sanity,
// digest comparison, Hebrew copy) lives in the pure companion-download-core.cjs;
// this module owns only I/O, the serial guard, the journal and the ordering.
//
// ── The security property is the ORDER ───────────────────────────────────────
// There is no code-signing certificate (docs/RELEASING.md, versioning.md §13),
// so Windows vouches for nothing about the .exe we are about to hand it. Two
// checks, in this exact order, are what replace that:
//
//   (a) the MANIFEST is authenticated first — a detached Ed25519 signature by a
//       key compiled into this build (update-trust.cjs), bound to the version
//       the CHECK decided on (anti-replay). This authenticates the STATEMENT.
//   (b) ONLY THEN is the installer fetched, and its streamed SHA-256 compared to
//       `installer.sha256` out of that authenticated document. This binds the
//       statement to the FILE.
//
// Neither step alone is sufficient: (a) without (b) proves a true sentence about
// bytes we never checked; (b) without (a) compares our download against a number
// an attacker supplied. And doing (b) first would mean downloading and writing
// 104 MB of attacker-chosen bytes before asking whether anyone trustworthy ever
// vouched for this release — so a failed (a) must abort BEFORE the installer
// request is made at all.
//
// ── Fail-closed contract ─────────────────────────────────────────────────────
// Like checkCompanionUpdate, this function NEVER rejects: every failure resolves
// to `{ ok:false, code, message }` with Hebrew copy. And on ANY failure the
// downloaded bytes are DELETED — an unverified installer must never survive on
// disk where the apply stage, or a curious user, could later find and run it.
// The file only ever reaches its final path AFTER the digest verifies; until
// then it lives at a `.part` sibling, so a partially written file can never
// occupy the path the journal names.

const BUSY_MESSAGE = 'הורדת עדכון כבר מתבצעת'
const SUCCESS_MESSAGE = 'העדכון הורד ואומת'
const UPDATES_DIR_NAME = 'updates'
const STATE_DIR_NAME = 'business-state'
// A signed manifest is a few hundred bytes. A cap keeps a hostile/looping
// response from being buffered into memory before it is even parsed.
const MANIFEST_MAX_BYTES = 64 * 1024
const MANIFEST_TIMEOUT_MS = 10_000
// No overall timeout on the installer: 104 MB on a slow line legitimately takes
// minutes, and a wall-clock cap would cancel honest downloads. What IS bounded
// is silence — if no chunk arrives for this long the transfer is dead, not slow.
const STALL_TIMEOUT_MS = 120_000
// Progress is emitted at most once per this many bytes (plus always at the end),
// so a 104 MB download produces ~200 events instead of ~1600 IPC messages.
const PROGRESS_THRESHOLD_BYTES = 512 * 1024
const USER_AGENT = 'tachles-companion'

// electron is required LAZILY (inside the default-dep function, never at module
// load) so this module stays importable from vitest without a live Electron
// runtime — same idiom as companion-update.cjs.
function defaultGetVersion() {
  return require('electron').app.getVersion()
}

/**
 * Where a downloaded installer lives: `<hermesHome>/business-state/updates/`.
 * hermesHome() honours the QA runtime override, so an isolated harness can never
 * write into the live profile — and this is the same durable, product-owned
 * state dir the companion update JOURNAL uses, so the journal's `installerPath`
 * and the file it names always sit in the same tree (and never inside the app
 * install dir, which the installer itself replaces).
 */
function defaultUpdatesDir() {
  return path.join(hermesHome(), STATE_DIR_NAME, UPDATES_DIR_NAME)
}

// Free space on the volume that holds `dir`. Returns null when it cannot be
// measured — the pure layer treats "unknown" as "not a proof of insufficiency"
// (see checkFreeSpace) rather than blocking the update.
function defaultFreeSpaceBytes(dir, fsImpl) {
  try {
    const stats = fsImpl.statfsSync(dir)
    const free = Number(stats.bavail) * Number(stats.bsize)
    return Number.isFinite(free) ? free : null
  } catch {
    return null
  }
}

// The journal module is required lazily inside the default so this file can be
// unit-tested (and loaded) even while companion-update-journal.cjs is owned by a
// concurrent change: every caller in the tests injects `journal` directly.
function defaultJournal() {
  return require('./companion-update-journal.cjs')
}

/** A failure with a stable code — the ONLY way this module signals a problem
 * internally, so the single catch below can turn any of them into the
 * structured `{ok:false}` result without string-matching prose. */
class DownloadFailure extends Error {
  constructor(code, detail) {
    super(detail || code)
    this.name = 'DownloadFailure'
    this.code = code
    this.detail = detail || ''
  }
}

function failure(code, detail) {
  return { ok: false, code, message: core.messageForDownloadCode(code), detail: detail || '' }
}

function readHeader(response, name) {
  const headers = response ? response.headers : null
  if (!headers || typeof headers.get !== 'function') return null
  try {
    return headers.get(name)
  } catch {
    return null
  }
}

/**
 * Iterate a fetch response body WITHOUT buffering it. Both shapes are supported
 * because "which one you get" depends on the fetch implementation (undici's web
 * ReadableStream in Electron/Node, a Node Readable behind some proxies, a plain
 * async generator in tests). A body that is neither is a hard failure, never a
 * silently empty download.
 */
async function* iterateBody(body) {
  if (!body) throw new DownloadFailure('installer-body-absent', 'response carried no body')
  if (typeof body[Symbol.asyncIterator] === 'function') {
    yield* body
    return
  }
  if (typeof body.getReader === 'function') {
    const reader = body.getReader()
    try {
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        if (value) yield value
      }
    } finally {
      try {
        reader.releaseLock()
      } catch {
        /* best effort */
      }
    }
    return
  }
  throw new DownloadFailure('installer-body-absent', 'response body is neither async-iterable nor a reader')
}

function writeChunk(stream, chunk) {
  return new Promise((resolve, reject) => {
    // The callback fires once the chunk is FLUSHED, so awaiting it gives natural
    // backpressure: we never queue more of a 104 MB body in memory than the
    // filesystem has accepted.
    stream.write(chunk, error => (error ? reject(error) : resolve()))
  })
}

// Waits for 'close', not merely 'finish'. On Windows the OS file handle is still
// open at 'finish', and both the fsync (which opens the same path 'r+') and the
// rename that follows can fail with EBUSY/EPERM against a live handle. 'close' is
// the event that guarantees the descriptor is released. Streams that have no
// event emitter at all (test doubles) settle from the end() callback instead.
function endStream(stream) {
  return new Promise((resolve, reject) => {
    let settled = false
    const done = error => {
      if (settled) return
      settled = true
      if (error) reject(error)
      else resolve()
    }
    const emitter = typeof stream.once === 'function'
    if (emitter) {
      stream.once('close', () => done(null))
      stream.once('error', error => done(error))
    }
    stream.end(error => {
      if (error) return done(error)
      if (!emitter || stream.closed === true) done(null)
    })
  })
}

// Force the bytes to the platter before the rename. Atomicity (rename) is not
// durability: a crash right after the rename could otherwise leave the journal
// pointing at a file whose contents are still in the page cache.
//
// Opened 'r+' (read/WRITE) deliberately: Windows implements fsync as
// FlushFileBuffers, which requires write access and fails EPERM on a read-only
// handle — the same trap companion-update-update-journal.cjs documents.
function fsyncFile(fsImpl, file) {
  const fd = fsImpl.openSync(file, 'r+')
  try {
    fsImpl.fsyncSync(fd)
  } finally {
    fsImpl.closeSync(fd)
  }
}

const runExclusive = createSerialGuard(BUSY_MESSAGE)

/**
 * Download + verify the installer for a version the update CHECK already
 * decided on.
 *
 *   request.version      : the target version (verdict.latest) — the anti-replay
 *                          anchor the manifest is bound to. NOT read from the
 *                          manifest, on purpose.
 *   request.installerUrl : verdict.installerUrl (allow-listed again here)
 *   request.manifestUrl  : verdict.manifestUrl  (allow-listed again here)
 *   request.signal       : optional AbortSignal — cancelling deletes the partial
 *                          file and leaves no journal behind.
 *
 * Resolves `{ ok:true, installerPath, sha256, bytes, version, currentVersion,
 * signedBy, message }` on success (journal left in phase `ready` for the apply
 * stage), or `{ ok:false, code, message, detail }` for every failure. Never
 * rejects.
 */
async function downloadCompanionUpdate(request = {}, deps = {}) {
  const {
    version = null,
    installerUrl = null,
    manifestUrl = null,
    signal = null
  } = request || {}

  const {
    fetch: fetchImpl = fetch,
    fs: fsImpl = nodeFs,
    createHash = nodeCreateHash,
    getVersion = defaultGetVersion,
    updatesDir = defaultUpdatesDir,
    journal = null,
    keys = UPDATE_TRUST_KEYS,
    verifySignature = verifyManifestSignature,
    verifyManifest = verifyUpdateManifest,
    onProgress = null,
    log = rememberLog,
    env = process.env,
    freeSpaceBytes = defaultFreeSpaceBytes,
    setTimer = setTimeout,
    clearTimer = clearTimeout,
    progressThresholdBytes = PROGRESS_THRESHOLD_BYTES,
    manifestTimeoutMs = MANIFEST_TIMEOUT_MS,
    stallTimeoutMs = STALL_TIMEOUT_MS,
    isDisabled = isPassiveUpdateCheckDisabled
  } = deps

  // Hermeticity gate, BEFORE the serial guard and before any I/O. A managed
  // download is a network call plus a write, so the isolated/packaged E2E must
  // never be able to trigger one — the same switch the passive check honours
  // (QA runtime sentinel or TACHLES_DISABLE_UPDATE_CHECK=1). Unlike the explicit
  // CHECK button, this one IS gated even when user-initiated: the check only
  // reads, this writes an executable to disk.
  let disabled
  try {
    disabled = isDisabled(env)
  } catch {
    disabled = true // a misconfigured override fails closed, exactly as it does for the check
  }
  if (disabled) {
    return failure('download-disabled', 'managed update download is disabled in this runtime')
  }

  try {
    return await runExclusive(() =>
      runDownload({
        version,
        installerUrl,
        manifestUrl,
        signal,
        fetchImpl,
        fsImpl,
        createHash,
        getVersion,
        updatesDir,
        journal: journal || defaultJournal(),
        keys,
        verifySignature,
        verifyManifest,
        onProgress,
        log,
        freeSpaceBytes,
        setTimer,
        clearTimer,
        progressThresholdBytes,
        manifestTimeoutMs,
        stallTimeoutMs
      })
    )
  } catch (error) {
    // The serial guard's busy rejection and any unforeseen throw both land here
    // — resolved, never rethrown, per the fail-closed contract above.
    if (error && error.message === BUSY_MESSAGE) return failure('busy', 'a managed download is already in flight')
    log(`Companion update download failed unexpectedly: ${error?.message || error}`)
    return failure('unexpected', String(error?.message || error))
  }
}

async function runDownload(ctx) {
  const {
    version,
    installerUrl,
    manifestUrl,
    signal,
    fetchImpl,
    fsImpl,
    createHash,
    getVersion,
    updatesDir,
    journal,
    keys,
    verifySignature,
    verifyManifest,
    onProgress,
    log,
    freeSpaceBytes,
    setTimer,
    clearTimer,
    progressThresholdBytes,
    manifestTimeoutMs,
    stallTimeoutMs
  } = ctx

  const currentVersion = getVersion()

  // One AbortController drives BOTH fetches, so a caller cancel, a manifest
  // timeout and a mid-stream stall all tear the transfer down through the same
  // path. The flags below are what tell the three apart afterwards — an
  // AbortError alone cannot say WHY it aborted.
  const controller = new AbortController()
  let cancelled = false
  let manifestTimedOut = false
  let stalled = false
  const onExternalAbort = () => {
    cancelled = true
    controller.abort()
  }
  if (signal) {
    if (signal.aborted) return failure('cancelled', 'download cancelled before it started')
    signal.addEventListener('abort', onExternalAbort, { once: true })
  }

  let tempPath = null
  let finalPath = null
  let journalOpened = false
  let stallTimer = null

  const emit = (phase, receivedBytes, totalBytes) => {
    if (typeof onProgress !== 'function') return
    try {
      onProgress({ receivedBytes, totalBytes, phase })
    } catch (error) {
      // A throwing renderer callback must never fail a good download.
      log(`Companion update progress listener threw (non-fatal): ${error?.message || error}`)
    }
  }
  const assertLive = () => {
    if (cancelled) throw new DownloadFailure('cancelled', 'download cancelled by the user')
  }
  const disarmStall = () => {
    if (stallTimer !== null) {
      clearTimer(stallTimer)
      stallTimer = null
    }
  }

  try {
    // ---- 0. inputs -----------------------------------------------------------
    if (typeof version !== 'string' || !version) {
      throw new DownloadFailure('target-version-invalid', 'no target version supplied')
    }
    // Re-validate the URLs HERE even though the CHECK already did. This function
    // is reachable over IPC, so its arguments are untrusted input in their own
    // right — a verdict is not a capability.
    const safeInstallerUrl = core.sanitizeAssetUrl(installerUrl)
    if (!safeInstallerUrl) throw new DownloadFailure('installer-url-rejected', `installer URL rejected: ${JSON.stringify(installerUrl)}`)
    const safeManifestUrl = core.sanitizeAssetUrl(manifestUrl)
    if (!safeManifestUrl) throw new DownloadFailure('manifest-url-rejected', `manifest URL rejected: ${JSON.stringify(manifestUrl)}`)
    assertLive()

    // ---- 1. the STATEMENT: fetch + authenticate the manifest ------------------
    emit('manifest', 0, null)
    const manifest = await fetchManifest({
      url: safeManifestUrl,
      fetchImpl,
      controller,
      setTimer,
      clearTimer,
      manifestTimeoutMs,
      isCancelled: () => cancelled,
      markTimeout: () => {
        manifestTimedOut = true
      },
      timedOut: () => manifestTimedOut
    })
    assertLive()

    const verdict = verifyManifest({
      manifest,
      currentVersion,
      // The version the CHECK decided on — never `manifest.version`. This is the
      // anti-replay anchor: a genuinely signed but OLD manifest is authentic and
      // off-topic, and off-topic is rejected.
      expectedVersion: version,
      keys,
      verifySignature
    })
    if (!verdict.ok) {
      // NOTE: the installer has NOT been requested at this point, and must not
      // be. An unauthenticated statement buys no bytes.
      throw new DownloadFailure('manifest-unverified', `[${verdict.code}] ${verdict.detail}`)
    }
    log(`Companion update manifest authenticated for v${version} (${verdict.detail})`)

    const expectedSha256 = manifest.installer.sha256
    const expectedBytes = manifest.installer.bytes
    const installerName = manifest.installer.name

    // ---- 2. destination ------------------------------------------------------
    const dir = updatesDir()
    if (!dir) throw new DownloadFailure('state-dir-unavailable', 'no updates directory available')
    // Defence in depth: the verifier already pinned installer.name to the
    // template, so this can only fire if that check is ever loosened. A name with
    // a path separator would otherwise let an authenticated-but-hostile manifest
    // choose where we write an executable.
    if (path.basename(installerName) !== installerName) {
      throw new DownloadFailure('manifest-unverified', `installer.name is not a bare filename: ${JSON.stringify(installerName)}`)
    }
    try {
      fsImpl.mkdirSync(dir, { recursive: true })
    } catch (error) {
      throw new DownloadFailure('state-dir-unavailable', `cannot create ${dir}: ${error?.message || error}`)
    }
    finalPath = path.join(dir, installerName)
    // pid-scoped so two processes (an accidental second instance) cannot fight
    // over one temp file. The final path stays untouched until the digest passes.
    tempPath = `${finalPath}.${process.pid}.part`
    removeQuietly(fsImpl, tempPath, log)

    // ---- 3. disk space (fail fast, before 104 MB of I/O) ---------------------
    const space = core.checkFreeSpace({ freeBytes: freeSpaceBytes(dir, fsImpl), requiredBytes: expectedBytes })
    if (!space.ok) throw new DownloadFailure(space.code, space.detail)
    assertLive()

    // ---- 4. durable journal --------------------------------------------------
    // Opened BEFORE the first byte lands, with all four trusted fields already
    // known (they come out of the AUTHENTICATED manifest), so an interrupted
    // download is always reconcilable at the next launch.
    journal.beginCompanionUpdate({
      currentVersion,
      targetVersion: version,
      installerPath: finalPath,
      installerSha256: expectedSha256
    })
    journalOpened = true

    // ---- 5. the FILE: stream + hash ------------------------------------------
    const response = await fetchInstaller({ url: safeInstallerUrl, fetchImpl, controller, isCancelled: () => cancelled })

    const declared = core.checkDeclaredSize({
      contentLength: readHeader(response, 'content-length'),
      contentEncoding: readHeader(response, 'content-encoding'),
      expectedBytes
    })
    if (!declared.ok) throw new DownloadFailure(declared.code, declared.detail)
    // The authenticated size is the fallback total, so the progress bar has a
    // denominator even when the server declares none.
    const totalBytes = declared.declaredBytes === null ? expectedBytes : declared.declaredBytes

    const hash = createHash('sha256')
    let receivedBytes = 0
    let lastEmitted = 0
    let stream
    try {
      stream = fsImpl.createWriteStream(tempPath)
    } catch (error) {
      throw new DownloadFailure('write-failed', `cannot open ${tempPath}: ${error?.message || error}`)
    }
    if (typeof stream.once === 'function') {
      // Without a listener a stream 'error' is an unhandled exception; the write
      // callbacks below surface the same error, so this one is only a sink.
      stream.once('error', error => log(`Companion update write stream error: ${error?.message || error}`))
    }

    const armStall = () => {
      disarmStall()
      stallTimer = setTimer(() => {
        stalled = true
        controller.abort()
      }, stallTimeoutMs)
    }

    emit('downloading', 0, totalBytes)
    try {
      armStall()
      for await (const chunk of iterateBody(response.body)) {
        assertLive()
        armStall()
        const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
        // Hash and write the SAME buffer, in the same pass: the digest we verify
        // is therefore literally the bytes that reached the disk, not a second
        // read of a file that could have been swapped underneath us.
        hash.update(buffer)
        await writeChunk(stream, buffer)
        receivedBytes += buffer.length
        if (receivedBytes - lastEmitted >= progressThresholdBytes) {
          lastEmitted = receivedBytes
          emit('downloading', receivedBytes, totalBytes)
        }
      }
      disarmStall()
      await endStream(stream)
    } catch (error) {
      disarmStall()
      try {
        stream.destroy?.()
      } catch {
        /* best effort */
      }
      if (error instanceof DownloadFailure) throw error
      if (cancelled) throw new DownloadFailure('cancelled', 'download cancelled mid-stream')
      if (stalled) throw new DownloadFailure('installer-fetch-failed', `no data received for ${stallTimeoutMs}ms — connection stalled`)
      throw new DownloadFailure('write-failed', `while streaming to ${tempPath}: ${error?.message || error}`)
    }
    emit('downloading', receivedBytes, totalBytes)

    try {
      fsyncFile(fsImpl, tempPath)
    } catch (error) {
      throw new DownloadFailure('write-failed', `fsync failed for ${tempPath}: ${error?.message || error}`)
    }

    // ---- 6. bind the statement to the file -----------------------------------
    journal.updateCompanionPhase('verifying', {})
    emit('verifying', receivedBytes, totalBytes)
    const acceptance = core.decideInstallerAcceptance({
      expectedSha256,
      expectedBytes,
      receivedSha256: hash.digest('hex'),
      receivedBytes
    })
    if (!acceptance.ok) throw new DownloadFailure(acceptance.code, acceptance.detail)

    // ---- 7. publish atomically ----------------------------------------------
    // Only NOW does a file appear at the path the journal names, so anything
    // found there is by construction verified.
    try {
      fsImpl.renameSync(tempPath, finalPath)
    } catch (error) {
      throw new DownloadFailure('write-failed', `cannot move the verified installer into place: ${error?.message || error}`)
    }
    tempPath = null // renamed away; the failure path must not chase it

    journal.updateCompanionPhase('ready', { installerPath: finalPath })
    emit('ready', receivedBytes, totalBytes)
    log(`Companion update v${version} downloaded and verified at ${finalPath}`)
    return {
      ok: true,
      code: null,
      message: SUCCESS_MESSAGE,
      installerPath: finalPath,
      sha256: core.normalizeSha256(expectedSha256),
      bytes: expectedBytes,
      version,
      currentVersion,
      signedBy: manifest.signed_by,
      detail: acceptance.detail
    }
  } catch (error) {
    disarmStall()
    const code = error instanceof DownloadFailure ? error.code : 'unexpected'
    const detail = error instanceof DownloadFailure ? error.detail : String(error?.message || error)
    // ROLLBACK. Two obligations, both unconditional:
    //  * the partial/unverified bytes are DELETED — never leave an installer the
    //    apply stage could later pick up without knowing it failed verification;
    //  * the journal is archived-and-cleared, so launch-time recovery does not
    //    later "recover" a transaction that already rolled itself back cleanly
    //    (this is also what "cancellation leaves no journal residue" means).
    if (tempPath) removeQuietly(fsImpl, tempPath, log)
    if (journalOpened) {
      try {
        journal.recordCompanionFailure(new Error(`[${code}] ${detail}`))
        journal.clearCompanionJournal({ outcome: code === 'cancelled' ? 'cancelled' : 'failed' })
      } catch (journalError) {
        log(`Companion update journal rollback failed (non-fatal): ${journalError?.message || journalError}`)
      }
    }
    log(`Companion update download failed [${code}]: ${detail}`)
    return failure(code, detail)
  } finally {
    disarmStall()
    if (signal) {
      try {
        signal.removeEventListener('abort', onExternalAbort)
      } catch {
        /* best effort */
      }
    }
  }
}

async function fetchManifest({ url, fetchImpl, controller, setTimer, clearTimer, manifestTimeoutMs, isCancelled, markTimeout, timedOut }) {
  let timer = setTimer(() => {
    markTimeout()
    controller.abort()
  }, manifestTimeoutMs)
  let response
  try {
    response = await fetchImpl(url, {
      headers: { Accept: 'application/json', 'User-Agent': USER_AGENT },
      signal: controller.signal
    })
  } catch (error) {
    if (isCancelled()) throw new DownloadFailure('cancelled', 'download cancelled while fetching the manifest')
    if (timedOut()) throw new DownloadFailure('manifest-fetch-failed', `manifest request timed out after ${manifestTimeoutMs}ms`)
    throw new DownloadFailure('manifest-fetch-failed', `manifest request failed: ${error?.message || error}`)
  } finally {
    clearTimer(timer)
    timer = null
  }
  if (!response || response.ok !== true) {
    throw new DownloadFailure('manifest-fetch-failed', `manifest request failed: HTTP ${response ? response.status : 'no-response'}`)
  }
  let text
  try {
    text = await response.text()
  } catch (error) {
    if (isCancelled()) throw new DownloadFailure('cancelled', 'download cancelled while reading the manifest')
    throw new DownloadFailure('manifest-fetch-failed', `manifest body unreadable: ${error?.message || error}`)
  }
  if (typeof text !== 'string' || text.length > MANIFEST_MAX_BYTES) {
    throw new DownloadFailure('manifest-parse-failed', `manifest body is absent or larger than ${MANIFEST_MAX_BYTES} bytes`)
  }
  try {
    return JSON.parse(text)
  } catch (error) {
    throw new DownloadFailure('manifest-parse-failed', `manifest is not valid JSON: ${error?.message || error}`)
  }
}

async function fetchInstaller({ url, fetchImpl, controller, isCancelled }) {
  let response
  try {
    response = await fetchImpl(url, {
      headers: { Accept: 'application/octet-stream', 'User-Agent': USER_AGENT },
      signal: controller.signal
    })
  } catch (error) {
    if (isCancelled()) throw new DownloadFailure('cancelled', 'download cancelled while requesting the installer')
    throw new DownloadFailure('installer-fetch-failed', `installer request failed: ${error?.message || error}`)
  }
  if (!response || response.ok !== true) {
    throw new DownloadFailure('installer-fetch-failed', `installer request failed: HTTP ${response ? response.status : 'no-response'}`)
  }
  return response
}

// Removal is best-effort-LOUD: it must not mask the original failure by throwing
// a second one, but a file we could not delete is exactly the residue this
// module promises not to leave, so it is always logged.
function removeQuietly(fsImpl, file, log) {
  try {
    fsImpl.rmSync(file, { force: true })
  } catch (error) {
    log(`Companion update could not remove ${file}: ${error?.message || error}`)
  }
}

module.exports = {
  BUSY_MESSAGE,
  SUCCESS_MESSAGE,
  UPDATES_DIR_NAME,
  MANIFEST_MAX_BYTES,
  MANIFEST_TIMEOUT_MS,
  STALL_TIMEOUT_MS,
  PROGRESS_THRESHOLD_BYTES,
  defaultUpdatesDir,
  downloadCompanionUpdate
}
