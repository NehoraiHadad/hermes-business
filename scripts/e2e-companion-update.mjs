// End-to-end rehearsal of the in-app one-click update, up to (but not including)
// the NSIS launch — driven against REAL bytes, REAL Ed25519 material and the REAL
// runtime modules. Nothing about the logic under test is mocked.
//
// What is real here:
//   * the actual ~104 MB release installer, streamed and hashed chunk by chunk;
//   * the actual private signing key, producing a real signature;
//   * electron/update-manifest-verify.cjs, companion-download{,-core}.cjs and the
//     durable journal, exactly as they run in the packaged app;
//   * the GitHub URL allowlist — the URLs passed in are genuine github.com asset
//     URLs, so sanitizeAssetUrl is exercised rather than bypassed.
//
// What is substituted, and why that is honest: only `fetch` and `hermesHome`.
// The injected fetch serves the local bytes for those genuine URLs, so the network
// is replaced but every validation the real path performs still runs. Substituting
// the URL allowlist instead (e.g. pointing at localhost) would have disabled one of
// the controls under test, which is exactly what a rehearsal must not do.
//
// Run: node scripts/e2e-companion-update.mjs
import { createHash, sign as cryptoSign, createPrivateKey } from 'node:crypto'
import { readFileSync, statSync, mkdtempSync, rmSync, existsSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { buildUpdateManifest, signUpdateManifest } from './lib/release/update-manifest.mjs'
import trust from '../electron/update-trust.cjs'
import downloadModule from '../electron/companion-download.cjs'
import journalModule from '../electron/companion-update-journal.cjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const KEY = path.join(process.env.USERPROFILE || process.env.HOME, '.tachles-release', 'update-signing-key.pem')
const CURRENT = '0.4.0-alpha.7'
const TARGET = '0.4.0-alpha.8'
const BASE = 'https://github.com/NehoraiHadad/hermes-business/releases/download'
const INSTALLER_URL = `${BASE}/v${TARGET}/Tachles-Setup-${TARGET}.exe`
const MANIFEST_URL = `${BASE}/v${TARGET}/update-manifest.json`

let pass = 0
let fail = 0
function check(name, ok, detail = '') {
  if (ok) { pass++; console.log(`  PASS  ${name}`) }
  else { fail++; console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ''}`) }
}

const realInstaller = path.join(root, 'release', `Tachles-Setup-${CURRENT}.exe`)
if (!existsSync(realInstaller)) {
  console.error(`No installer at ${realInstaller}; run package:win first.`)
  process.exit(2)
}
// The real bytes of a real installer. We describe them as the NEXT version so the
// updater sees a genuine upgrade; the mechanism under test is indifferent to what
// the bytes actually contain, and using real ones keeps the 104 MB streaming path
// honest rather than testing a toy file.
const bytes = readFileSync(realInstaller)
const sha256 = createHash('sha256').update(bytes).digest('hex')
console.log(`Installer under test: ${(bytes.length / 1e6).toFixed(1)} MB, sha256 ${sha256.slice(0, 16)}…\n`)

const privateKey = createPrivateKey(readFileSync(KEY))
const KEY_ID = Object.keys(trust.UPDATE_TRUST_KEYS)[0]

// Signs with the REAL private key, through the same DI entry point the release
// pipeline uses (produceSignedManifest), so the body canonicalization and the
// self-verification against the SHIPPED public key are the real ones.
function makeManifest({ version = TARGET, digest = sha256, bytesLen = bytes.length } = {}) {
  const doc = buildUpdateManifest({
    version,
    channel: 'pilot',
    installer: { name: `Tachles-Setup-${version}.exe`, sha256: digest, bytes: bytesLen },
    releasedAt: '2026-08-18',
    signedBy: KEY_ID
  })
  const signed = signUpdateManifest({
    doc,
    sign: body => cryptoSign(null, Buffer.from(body, 'utf8'), privateKey).toString('base64'),
    verifySignature: trust.verifyManifestSignature,
    keys: trust.UPDATE_TRUST_KEYS,
    // The replay scenario deliberately signs an OLDER version than the running
    // app, which signUpdateManifest's own self-check would reject. Anchor the
    // self-check below the oldest version we ever mint here so the harness can
    // still PRODUCE that artifact; the runtime verifier is what must reject it,
    // and scenario 4 asserts exactly that.
    currentVersion: '0.0.0'
  })
  if (!signed.ok) throw new Error(`harness could not sign: [${signed.code}] ${signed.detail}`)
  return JSON.stringify(signed.manifest)
}

function makeFetch(manifestJson, { installerBody = bytes, contentLength = null } = {}) {
  return async url => {
    if (url === MANIFEST_URL) {
      return { ok: true, status: 200, headers: new Headers(), json: async () => JSON.parse(manifestJson), text: async () => manifestJson }
    }
    if (url === INSTALLER_URL) {
      const total = contentLength === null ? String(installerBody.length) : contentLength
      const headers = new Headers(total === false ? {} : { 'content-length': String(total) })
      return {
        ok: true,
        status: 200,
        headers,
        body: (async function* () {
          for (let i = 0; i < installerBody.length; i += 1 << 20) yield installerBody.subarray(i, i + (1 << 20))
        })()
      }
    }
    return { ok: false, status: 404, headers: new Headers() }
  }
}

async function scenario(name, { manifest, fetchOpts = {}, expectOk, expectCode }) {
  const home = mkdtempSync(path.join(tmpdir(), 'tachles-e2e-'))
  const updatesDir = path.join(home, 'business-state', 'updates')
  const journalFile = path.join(home, 'business-state', 'companion-update-journal.json')
  const progress = []
  try {
    const result = await downloadModule.downloadCompanionUpdate(
      { version: TARGET, installerUrl: INSTALLER_URL, manifestUrl: MANIFEST_URL },
      {
        fetch: makeFetch(manifest, fetchOpts),
        getVersion: () => CURRENT,
        updatesDir: () => updatesDir,
        // The REAL journal module, with only its file path redirected into the
        // temp home — the atomic write, the phase machine and the verifiable
        // clear are all the shipping implementations.
        journal: {
          beginCompanionUpdate: r => journalModule.beginCompanionUpdate(r, { file: journalFile }),
          updateCompanionPhase: (ph, patch) => journalModule.updateCompanionPhase(ph, patch, { file: journalFile }),
          recordCompanionFailure: e => journalModule.recordCompanionFailure(e, { file: journalFile }),
          clearCompanionJournal: o => journalModule.clearCompanionJournal(o, { file: journalFile }),
          readCompanionJournal: () => journalModule.readCompanionJournal({ file: journalFile })
        },
        onProgress: p => progress.push(p),
        log: m => console.log(`      [log] ${m}`)
      }
    )
    const okMatch = result.ok === expectOk
    const codeMatch = expectCode ? result.code === expectCode : true
    check(name, okMatch && codeMatch, `got ok=${result.ok} code=${result.code || '-'} msg=${result.message || ''} detail=${result.detail || '-'}`)

    const leftovers = existsSync(updatesDir) ? readdirSync(updatesDir) : []
    if (expectOk) {
      check(`${name} · installer landed and matches digest`,
        !!result.installerPath && existsSync(result.installerPath) &&
        createHash('sha256').update(readFileSync(result.installerPath)).digest('hex') === sha256)
      const rec = journalModule.readCompanionJournal({ file: journalFile })
      check(`${name} · journal handed off at phase=ready`, rec && rec.phase === 'ready', `phase=${rec && rec.phase}`)
      check(`${name} · progress was reported`, progress.length > 0 && progress.some(p => p.receivedBytes > 0))
    } else {
      check(`${name} · nothing executable left behind`, leftovers.length === 0, `leftovers=${JSON.stringify(leftovers)}`)
    }
    return result
  } finally {
    rmSync(home, { recursive: true, force: true })
  }
}

console.log('=== 1. HAPPY PATH — real signature, real bytes, real digest ===')
await scenario('happy path', { manifest: makeManifest(), expectOk: true })

console.log('\n=== 2. FORGED SIGNATURE — one byte of the signature flipped ===')
{
  const m = JSON.parse(makeManifest())
  const sig = Buffer.from(m.signature, 'base64'); sig[0] ^= 0xff
  m.signature = sig.toString('base64')
  await scenario('forged signature rejected', { manifest: JSON.stringify(m), expectOk: false, expectCode: 'manifest-unverified' })
}

console.log('\n=== 3. TAMPERED DIGEST — manifest re-signed for different bytes ===')
{
  const wrong = createHash('sha256').update(Buffer.concat([bytes, Buffer.from('x')])).digest('hex')
  await scenario('digest mismatch rejected', { manifest: makeManifest({ digest: wrong }), expectOk: false, expectCode: 'installer-digest-mismatch' })
}

console.log('\n=== 4. DOWNGRADE / REPLAY — a genuinely signed OLDER manifest ===')
{
  const old = makeManifest({ version: '0.4.0-alpha.6' })
  await scenario('replayed old manifest rejected', { manifest: old, expectOk: false, expectCode: 'manifest-unverified' })
}

console.log('\n=== 5. TRUNCATED DOWNLOAD — body shorter than the signed length ===')
await scenario('truncated download rejected', {
  manifest: makeManifest(),
  fetchOpts: { installerBody: bytes.subarray(0, bytes.length - 4096), contentLength: bytes.length },
  expectOk: false
})

console.log(`\n${'='.repeat(60)}\n${fail === 0 ? 'ALL SCENARIOS PASSED' : 'FAILURES PRESENT'} — ${pass} passed, ${fail} failed`)
process.exit(fail === 0 ? 0 : 1)
