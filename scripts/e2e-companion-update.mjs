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
const BASE = 'https://github.com/NehoraiHadad/hermes-business/releases/download'

// Versions are DISCOVERED from whatever installer release/ actually holds, never
// hardcoded. They were hardcoded originally, and went stale the moment the repo
// moved past alpha.8 — the harness then refused to run at all, which is the worst
// failure mode for a rehearsal: it stops being evidence without anyone deciding
// that it should. What the harness genuinely needs is only "a real ~100 MB
// installer whose bytes we can stream and hash", plus three orderable versions
// around it; which release it happens to be is irrelevant to every assertion.
function discoverInstaller() {
  const dir = path.join(root, 'release')
  const names = existsSync(dir) ? readdirSync(dir).filter(n => /^Tachles-Setup-.+\.exe$/.test(n)) : []
  if (!names.length) return null
  // Highest prerelease number wins, so a directory holding several builds picks
  // the newest rather than whatever the filesystem lists first.
  const parsed = names
    .map(name => ({ name, version: name.replace(/^Tachles-Setup-/, '').replace(/\.exe$/, '') }))
    .map(e => ({ ...e, tail: Number((e.version.match(/(\d+)$/) || [])[1] ?? -1) }))
    .sort((a, b) => a.tail - b.tail)
  return parsed[parsed.length - 1]
}

/** Step the trailing numeric prerelease identifier by `delta`. */
function stepVersion(version, delta) {
  const m = version.match(/^(.*?)(\d+)$/)
  if (!m) throw new Error(`cannot step version ${version}`)
  const next = Number(m[2]) + delta
  if (next < 0) throw new Error(`stepping ${version} by ${delta} goes below zero`)
  return `${m[1]}${next}`
}

const found = discoverInstaller()
if (!found) {
  console.error(`No Tachles-Setup-*.exe under ${path.join(root, 'release')}; run package:win first.`)
  process.exit(2)
}
// The discovered build plays the CURRENTLY INSTALLED version; TARGET is one step
// forward (the update under test) and OLD one step back (the rollback target).
const CURRENT = found.version
const TARGET = stepVersion(CURRENT, 1)
const OLD = stepVersion(CURRENT, -1)

let pass = 0
let fail = 0
function check(name, ok, detail = '') {
  if (ok) { pass++; console.log(`  PASS  ${name}`) }
  else { fail++; console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ''}`) }
}

const realInstaller = path.join(root, 'release', found.name)
// The real bytes of a real installer. We describe them as the NEXT version so the
// updater sees a genuine upgrade; the mechanism under test is indifferent to what
// the bytes actually contain, and using real ones keeps the 104 MB streaming path
// honest rather than testing a toy file.
const bytes = readFileSync(realInstaller)
const sha256 = createHash('sha256').update(bytes).digest('hex')
console.log(`Installer under test: ${found.name} — ${(bytes.length / 1e6).toFixed(1)} MB, sha256 ${sha256.slice(0, 16)}…`)
console.log(`Simulating: installed v${CURRENT}, update to v${TARGET}, rollback to v${OLD}\n`)

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

function urlsFor(version) {
  return {
    installerUrl: `${BASE}/v${version}/Tachles-Setup-${version}.exe`,
    manifestUrl: `${BASE}/v${version}/update-manifest.json`
  }
}

function makeFetch(manifestJson, { installerBody = bytes, contentLength = null, version = TARGET } = {}) {
  const { installerUrl: INSTALLER_URL, manifestUrl: MANIFEST_URL } = urlsFor(version)
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

async function scenario(name, { manifest, fetchOpts = {}, expectOk, expectCode, version = TARGET, direction = 'forward' }) {
  const home = mkdtempSync(path.join(tmpdir(), 'tachles-e2e-'))
  const updatesDir = path.join(home, 'business-state', 'updates')
  const journalFile = path.join(home, 'business-state', 'companion-update-journal.json')
  // The HISTORY path must be redirected too, not just the active journal.
  // `clearCompanionJournal` takes `file` and `history` as SEPARATE options and
  // defaults `history` to historyPath() — i.e. the operator's LIVE
  // %LOCALAPPDATA%\hermes profile. Overriding only `file` (as this harness did
  // originally) let every rehearsal append its synthetic outcomes to the real
  // user's update history; the leaked entries are still identifiable by their
  // `tachles-e2e-*` installerPath. A rehearsal that writes into the live profile
  // is not a rehearsal.
  const historyFile = path.join(home, 'business-state', 'companion-update-journal-history.json')
  const progress = []
  try {
    const { installerUrl, manifestUrl } = urlsFor(version)
    const result = await downloadModule.downloadCompanionUpdate(
      { version, installerUrl, manifestUrl, direction },
      {
        fetch: makeFetch(manifest, { ...fetchOpts, version }),
        getVersion: () => CURRENT,
        updatesDir: () => updatesDir,
        // The REAL journal module, with only its file path redirected into the
        // temp home — the atomic write, the phase machine and the verifiable
        // clear are all the shipping implementations.
        journal: {
          beginCompanionUpdate: r => journalModule.beginCompanionUpdate(r, { file: journalFile }),
          updateCompanionPhase: (ph, patch) => journalModule.updateCompanionPhase(ph, patch, { file: journalFile }),
          recordCompanionFailure: e => journalModule.recordCompanionFailure(e, { file: journalFile }),
          clearCompanionJournal: o => journalModule.clearCompanionJournal(o, { file: journalFile, history: historyFile }),
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
  const old = makeManifest({ version: OLD })
  await scenario('replayed old manifest rejected', { manifest: old, expectOk: false, expectCode: 'manifest-unverified' })
}

console.log('\n=== 5. TRUNCATED DOWNLOAD — body shorter than the signed length ===')
await scenario('truncated download rejected', {
  manifest: makeManifest(),
  fetchOpts: { installerBody: bytes.subarray(0, bytes.length - 4096), contentLength: bytes.length },
  expectOk: false
})

console.log('\n=== 6. ROLLBACK — a genuinely signed OLDER manifest, requested DELIBERATELY ===')
{
  // Scenario 4 proved this exact document is REFUSED going forward. Here the same
  // bytes and the same signature are ACCEPTED, because the caller declared
  // `direction: 'rollback'` — i.e. main asked, by name, for the version its own
  // durable journal says this install came from. Running both against ONE artifact
  // is the point: it shows the direction flag is the only difference, and that
  // nothing about the signature or the digest was relaxed to allow it.
  await scenario('rollback to a signed older version is accepted', {
    manifest: makeManifest({ version: OLD }),
    version: OLD,
    direction: 'rollback',
    expectOk: true
  })

  console.log('\n=== 7. ROLLBACK cannot be turned into a forced UPGRADE ===')
  // The mirror image, and the reason a rollback is not merely "skip the version
  // check": anyone who could make the app ask for a rollback must not get a forced
  // upgrade out of it either. Only a strictly older target is allowed.
  await scenario('a NEWER manifest is refused in the rollback direction', {
    manifest: makeManifest(),
    direction: 'rollback',
    expectOk: false,
    expectCode: 'manifest-unverified'
  })

  console.log('\n=== 8. An unknown direction is refused outright ===')
  // A typo must not fall through to whichever branch an if/else leaves open.
  await scenario('an unrecognised direction never defaults into a branch', {
    manifest: makeManifest(),
    direction: 'sideways',
    expectOk: false,
    expectCode: 'manifest-unverified'
  })
}

console.log(`\n${'='.repeat(60)}\n${fail === 0 ? 'ALL SCENARIOS PASSED' : 'FAILURES PRESENT'} — ${pass} passed, ${fail} failed`)
process.exit(fail === 0 ? 0 : 1)
