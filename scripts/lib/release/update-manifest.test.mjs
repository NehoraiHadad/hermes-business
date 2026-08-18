import { generateKeyPairSync, sign as cryptoSign, verify as cryptoVerify } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import {
  UPDATE_MANIFEST_CODES,
  attachSignature,
  buildUpdateManifest,
  crossCheckInstallerDigest,
  keyIdFromPublicKeyDer,
  manifestSigningBody,
  signUpdateManifest,
  verifyUpdateManifest
} from './update-manifest.mjs'
import { canonicalJson } from './binding.mjs'
import { expectedInstallerName } from './artifact-set.mjs'
// The SHIPPED (runtime) modules, imported directly so the test can assert that
// the build-time exports above are literally the same objects — see the
// "ONE canonicalJson and ONE verifier" case below.
import runtimeVerify from '../../../electron/update-manifest-verify.cjs'
import runtimeCanonicalJson from '../../../electron/canonical-json.cjs'
import runtimeArtifactName from '../../../electron/update-artifact-name.cjs'

const KEY_ID = 'tachles-update-ed25519-test'
const SHA = 'a'.repeat(64)
const NEXT = '0.4.0-alpha.8'
const CURRENT = '0.4.0-alpha.7'

// Toy verifier for the pure branches: `SIG:<keyId>:<body>` verifies, nothing else.
const toyVerify = (body, sig, keyId) => sig === `SIG:${keyId}:${body}`
const toySign = keyId => body => `SIG:${keyId}:${body}`

function doc(overrides = {}) {
  return {
    ...buildUpdateManifest({
      version: NEXT,
      channel: 'pilot',
      installer: { sha256: SHA, bytes: 104_279_412 },
      releasedAt: '2026-08-18',
      signedBy: KEY_ID
    }),
    ...overrides
  }
}

function signedDoc(overrides = {}) {
  const d = doc(overrides)
  return attachSignature(d, toySign(d.signed_by)(manifestSigningBody(d)))
}

function verifyIt(manifest, opts = {}) {
  return verifyUpdateManifest({
    manifest,
    currentVersion: CURRENT,
    expectedVersion: NEXT,
    keys: { [KEY_ID]: 'PEM' },
    verifySignature: toyVerify,
    ...opts
  })
}

describe('buildUpdateManifest / manifestSigningBody', () => {
  it('builds the documented shape and pins the installer name from artifact-set', () => {
    const d = doc()
    expect(d).toEqual({
      schema: 1,
      version: NEXT,
      channel: 'pilot',
      installer: { name: expectedInstallerName(null, NEXT), sha256: SHA, bytes: 104_279_412 },
      released_at: '2026-08-18',
      signed_by: KEY_ID
    })
    expect(d.installer.name).toBe(`Tachles-Setup-${NEXT}.exe`)
  })

  it('never lets an extra installer attribute into the signed body', () => {
    const d = buildUpdateManifest({
      version: NEXT,
      channel: 'pilot',
      installer: { sha256: SHA, bytes: 1, url: 'https://evil.example/x.exe' },
      releasedAt: '2026-08-18',
      signedBy: KEY_ID
    })
    expect(Object.keys(d.installer).sort()).toEqual(['bytes', 'name', 'sha256'])
  })

  it('the signing body is EXACTLY gather.mjs’s ledger convention (canonicalJson with signature blanked)', () => {
    const d = doc()
    expect(manifestSigningBody(d)).toBe(canonicalJson({ ...d, signature: undefined }))
    // and a signed document signs the same bytes as its unsigned self
    expect(manifestSigningBody(attachSignature(d, 'zzzz'))).toBe(manifestSigningBody(d))
  })

  it('build-time and RUNTIME share ONE canonicalJson and ONE verifier — not two copies that agree today', () => {
    // The runtime-needed half of this module lives in electron/ (build.files
    // packages `electron/**` and never `scripts/**`, so a verifier under
    // scripts/ is simply absent from app.asar). What must be true is stronger
    // than "the two spellings currently produce the same bytes": they must be
    // the SAME function, so a future edit to one cannot silently fork the exact
    // string an Ed25519 signature covers.
    expect(manifestSigningBody).toBe(runtimeVerify.manifestSigningBody)
    expect(verifyUpdateManifest).toBe(runtimeVerify.verifyUpdateManifest)
    expect(canonicalJson).toBe(runtimeCanonicalJson.canonicalJson)
    expect(expectedInstallerName).toBe(runtimeArtifactName.expectedInstallerName)
    // …and, belt-and-braces, the bytes themselves still match the ledger convention.
    const d = doc()
    expect(runtimeVerify.manifestSigningBody(d)).toBe(runtimeCanonicalJson.canonicalJson({ ...d, signature: undefined }))
  })

  it('refuses to build without the fields the signature must cover', () => {
    expect(() => buildUpdateManifest({ channel: 'pilot', installer: {}, releasedAt: 'x', signedBy: KEY_ID })).toThrow(/version/)
    expect(() => buildUpdateManifest({ version: NEXT, installer: {}, releasedAt: 'x', signedBy: KEY_ID })).toThrow(/channel/)
    expect(() => buildUpdateManifest({ version: NEXT, channel: 'pilot', installer: {}, releasedAt: 'x' })).toThrow(/signedBy/)
    expect(() => buildUpdateManifest({ version: NEXT, channel: 'pilot', installer: {}, signedBy: KEY_ID })).toThrow(/releasedAt/)
    expect(() => buildUpdateManifest({ version: NEXT, channel: 'pilot', releasedAt: 'x', signedBy: KEY_ID })).toThrow(/installer/)
  })
})

describe('verifyUpdateManifest — happy path', () => {
  it('a well-formed, correctly signed, strictly-newer manifest verifies', () => {
    const r = verifyIt(signedDoc())
    expect(r.ok).toBe(true)
    expect(r.detail).toMatch(KEY_ID)
  })

  it('accepts a plain ARRAY of trusted key ids as well as a { id: PEM } map', () => {
    expect(verifyIt(signedDoc(), { keys: [KEY_ID] }).ok).toBe(true)
  })
})

describe('verifyUpdateManifest — every fail-closed branch', () => {
  it('manifest-absent: no manifest at all', () => {
    expect(verifyIt(null).code).toBe('manifest-absent')
    expect(verifyIt('not-an-object').code).toBe('manifest-absent')
  })

  it('schema-unsupported: schema !== 1 is refused, never best-effort parsed', () => {
    const d = doc({ schema: 2 })
    const m = attachSignature(d, toySign(KEY_ID)(manifestSigningBody(d)))
    expect(verifyIt(m).code).toBe('schema-unsupported')
    expect(verifyIt(doc({ schema: undefined })).code).toBe('schema-unsupported')
  })

  it('expected-version-absent: no expectedVersion means no anti-replay control, so refuse', () => {
    expect(verifyIt(signedDoc(), { expectedVersion: undefined }).code).toBe('expected-version-absent')
  })

  it('signer-unknown: an ABSENT signed_by is rejected', () => {
    expect(verifyIt(signedDoc({ signed_by: undefined })).code).toBe('signer-unknown')
  })

  it('signer-unknown: a key id that is not in the shipped trust map is rejected', () => {
    const d = doc({ signed_by: 'attacker-key' })
    const m = attachSignature(d, toySign('attacker-key')(manifestSigningBody(d)))
    // the signature is internally consistent — it is the KEY that is untrusted
    expect(toyVerify(manifestSigningBody(m), m.signature, 'attacker-key')).toBe(true)
    expect(verifyIt(m).code).toBe('signer-unknown')
  })

  it('signature-absent: an unsigned manifest is treated as absent, never as trusted', () => {
    expect(verifyIt(doc()).code).toBe('signature-absent')
    expect(verifyIt(attachSignature(doc(), 123)).code).toBe('signature-absent')
  })

  it('signature-invalid: a forged signature is rejected', () => {
    expect(verifyIt(attachSignature(doc(), 'SIG:forged')).code).toBe('signature-invalid')
  })

  it('signature-invalid: TAMPERING with a signed field breaks the signature', () => {
    const m = signedDoc()
    const tampered = { ...m, installer: { ...m.installer, sha256: 'b'.repeat(64) } }
    expect(verifyIt(tampered).code).toBe('signature-invalid')
  })

  it('signature-invalid: no verifier injected is a refusal, not a pass', () => {
    expect(verifyIt(signedDoc(), { verifySignature: undefined }).code).toBe('signature-invalid')
  })

  it('version-mismatch: a GENUINELY SIGNED OLD manifest replayed for a newer check is rejected (anti-replay)', () => {
    const old = doc({ version: '0.4.0-alpha.5', installer: { name: 'Tachles-Setup-0.4.0-alpha.5.exe', sha256: SHA, bytes: 10 } })
    const m = attachSignature(old, toySign(KEY_ID)(manifestSigningBody(old)))
    // The signature itself is perfectly valid — that is the point of the test.
    expect(toyVerify(manifestSigningBody(m), m.signature, KEY_ID)).toBe(true)
    const r = verifyIt(m, { currentVersion: '0.4.0-alpha.4' })
    expect(r.ok).toBe(false)
    expect(r.code).toBe('version-mismatch')
  })

  it('version-unparseable: an unorderable installed version is refused, never treated as equal', () => {
    expect(verifyIt(signedDoc(), { currentVersion: 'not-a-version' }).code).toBe('version-unparseable')
    expect(verifyIt(signedDoc(), { currentVersion: undefined }).code).toBe('version-unparseable')
  })

  it('version-not-newer: a manifest for the INSTALLED version (or older) is a rollback', () => {
    const same = doc({ version: CURRENT, installer: { name: `Tachles-Setup-${CURRENT}.exe`, sha256: SHA, bytes: 10 } })
    const m = attachSignature(same, toySign(KEY_ID)(manifestSigningBody(same)))
    const r = verifyIt(m, { expectedVersion: CURRENT, currentVersion: CURRENT })
    expect(r.code).toBe('version-not-newer')
    const older = doc({ version: '0.4.0-alpha.6', installer: { name: 'Tachles-Setup-0.4.0-alpha.6.exe', sha256: SHA, bytes: 10 } })
    const m2 = attachSignature(older, toySign(KEY_ID)(manifestSigningBody(older)))
    expect(verifyIt(m2, { expectedVersion: '0.4.0-alpha.6' }).code).toBe('version-not-newer')
  })

  it('direction-unknown: an unrecognised direction is refused, never defaulted into a branch', () => {
    // A typo must not fall through to whichever side an if/else leaves open.
    expect(verifyIt(signedDoc(), { direction: 'backward' }).code).toBe('direction-unknown')
    expect(verifyIt(signedDoc(), { direction: 'rollBack' }).code).toBe('direction-unknown')
    expect(verifyIt(signedDoc(), { direction: null }).code).toBe('direction-unknown')
  })

  it("direction:'rollback' inverts ONLY the ordering rule — an older manifest passes, a newer one does not", () => {
    const older = doc({ version: '0.4.0-alpha.6', installer: { name: 'Tachles-Setup-0.4.0-alpha.6.exe', sha256: SHA, bytes: 10 } })
    const m = attachSignature(older, toySign(KEY_ID)(manifestSigningBody(older)))
    // Same document that is 'version-not-newer' going forward is ACCEPTED going back.
    expect(verifyIt(m, { expectedVersion: '0.4.0-alpha.6' }).code).toBe('version-not-newer')
    expect(verifyIt(m, { expectedVersion: '0.4.0-alpha.6', direction: 'rollback' }).ok).toBe(true)
    // ...and the forward manifest is refused in the rollback direction.
    expect(verifyIt(signedDoc(), { direction: 'rollback' }).code).toBe('version-not-older')
  })

  it("direction:'rollback' does NOT weaken the signature or the anti-replay equality", () => {
    // The whole safety argument for allowing a downgrade rests on these two
    // controls being untouched. If either could be skipped by asking for a
    // rollback, the direction flag would BE the downgrade attack.
    const older = doc({ version: '0.4.0-alpha.6', installer: { name: 'Tachles-Setup-0.4.0-alpha.6.exe', sha256: SHA, bytes: 10 } })
    const signed = attachSignature(older, toySign(KEY_ID)(manifestSigningBody(older)))
    expect(verifyIt({ ...signed, signature: 'AAAA' }, { expectedVersion: '0.4.0-alpha.6', direction: 'rollback' }).code).toBe('signature-invalid')
    expect(verifyIt(signed, { expectedVersion: '0.4.0-alpha.5', direction: 'rollback' }).code).toBe('version-mismatch')
    expect(verifyIt(signed, { expectedVersion: undefined, direction: 'rollback' }).code).toBe('expected-version-absent')
  })

  it('reinstalling the RUNNING version is refused in BOTH directions', () => {
    const same = doc({ version: CURRENT, installer: { name: `Tachles-Setup-${CURRENT}.exe`, sha256: SHA, bytes: 10 } })
    const m = attachSignature(same, toySign(KEY_ID)(manifestSigningBody(same)))
    expect(verifyIt(m, { expectedVersion: CURRENT, currentVersion: CURRENT }).code).toBe('version-not-newer')
    expect(verifyIt(m, { expectedVersion: CURRENT, currentVersion: CURRENT, direction: 'rollback' }).code).toBe('version-not-older')
  })

  it('installer-absent: no installer record', () => {
    expect(verifyIt(signedDoc({ installer: undefined })).code).toBe('installer-absent')
  })

  it('installer-digest-malformed: wrong length, uppercase, non-hex or non-string', () => {
    for (const bad of ['a'.repeat(63), 'a'.repeat(65), 'A'.repeat(64), `${'a'.repeat(63)}g`, undefined, 12345]) {
      const m = signedDoc({ installer: { name: expectedInstallerName(null, NEXT), sha256: bad, bytes: 10 } })
      expect(verifyIt(m).code, `sha256=${String(bad)}`).toBe('installer-digest-malformed')
    }
  })

  it('installer-bytes-invalid: zero, negative, fractional or absent byte counts', () => {
    for (const bad of [0, -1, 1.5, undefined, '104279412']) {
      const m = signedDoc({ installer: { name: expectedInstallerName(null, NEXT), sha256: SHA, bytes: bad } })
      expect(verifyIt(m).code, `bytes=${String(bad)}`).toBe('installer-bytes-invalid')
    }
  })

  it('installer-name-mismatch: any name other than the pinned Tachles-Setup-<version>.exe', () => {
    for (const bad of ['Tachles Setup 0.4.0-alpha.8.exe', 'Tachles-Setup-0.4.0-alpha.7.exe', 'payload.exe', undefined]) {
      const m = signedDoc({ installer: { name: bad, sha256: SHA, bytes: 10 } })
      expect(verifyIt(m).code, `name=${String(bad)}`).toBe('installer-name-mismatch')
    }
  })

  it('every documented failure code is reachable and declared', () => {
    const observed = new Set([
      verifyIt(null).code,
      verifyIt(doc({ schema: 9 })).code,
      verifyIt(signedDoc(), { expectedVersion: null }).code,
      verifyIt(signedDoc({ signed_by: 'nope' })).code,
      verifyIt(doc()).code,
      verifyIt(attachSignature(doc(), 'bogus')).code,
      verifyIt(signedDoc(), { currentVersion: 'zzz' }).code,
      verifyIt(signedDoc({ installer: undefined })).code
    ])
    for (const code of observed) expect(UPDATE_MANIFEST_CODES).toContain(code)
  })
})

describe('REAL Ed25519 round-trip (crypto.verify(null, ...) — the gather.mjs convention)', () => {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519')
  const keyId = keyIdFromPublicKeyDer(publicKey.export({ type: 'spki', format: 'der' }))
  const pem = publicKey.export({ type: 'spki', format: 'pem' })
  const keys = { [keyId]: pem }
  const realSign = body => cryptoSign(null, Buffer.from(body, 'utf8'), privateKey).toString('base64')
  const realVerify = (body, sigB64, id) => {
    const key = keys[id]
    if (!key || !sigB64) return false
    try { return cryptoVerify(null, Buffer.from(body, 'utf8'), key, Buffer.from(String(sigB64), 'base64')) } catch { return false }
  }

  it('derives a stable, content-addressed key id', () => {
    expect(keyId).toMatch(/^tachles-update-ed25519-[0-9a-f]{16}$/)
    expect(keyIdFromPublicKeyDer(publicKey.export({ type: 'spki', format: 'der' }))).toBe(keyId)
  })

  it('sign → verify OK with the real primitive', () => {
    const unsigned = buildUpdateManifest({ version: NEXT, channel: 'pilot', installer: { sha256: SHA, bytes: 104_279_412 }, releasedAt: '2026-08-18', signedBy: keyId })
    const manifest = attachSignature(unsigned, realSign(manifestSigningBody(unsigned)))
    const r = verifyUpdateManifest({ manifest, currentVersion: CURRENT, expectedVersion: NEXT, keys, verifySignature: realVerify })
    expect(r.ok).toBe(true)
  })

  it('ADVERSARIAL: mutating ONE byte of the signed body breaks verification', () => {
    const unsigned = buildUpdateManifest({ version: NEXT, channel: 'pilot', installer: { sha256: SHA, bytes: 104_279_412 }, releasedAt: '2026-08-18', signedBy: keyId })
    const manifest = attachSignature(unsigned, realSign(manifestSigningBody(unsigned)))
    // one byte of the digest: ...aaaa -> ...aaab (still 64 lowercase hex, so it
    // passes every shape check and can ONLY be caught by the signature)
    const flipped = { ...manifest, installer: { ...manifest.installer, sha256: `${SHA.slice(0, 63)}b` } }
    expect(realVerify(manifestSigningBody(flipped), flipped.signature, keyId)).toBe(false)
    const r = verifyUpdateManifest({ manifest: flipped, currentVersion: CURRENT, expectedVersion: NEXT, keys, verifySignature: realVerify })
    expect(r.ok).toBe(false)
    expect(r.code).toBe('signature-invalid')
  })

  it('ADVERSARIAL: a signature made by a DIFFERENT real key does not verify', () => {
    const other = generateKeyPairSync('ed25519')
    const unsigned = buildUpdateManifest({ version: NEXT, channel: 'pilot', installer: { sha256: SHA, bytes: 10 }, releasedAt: '2026-08-18', signedBy: keyId })
    const manifest = attachSignature(unsigned, cryptoSign(null, Buffer.from(manifestSigningBody(unsigned), 'utf8'), other.privateKey).toString('base64'))
    expect(verifyUpdateManifest({ manifest, currentVersion: CURRENT, expectedVersion: NEXT, keys, verifySignature: realVerify }).code).toBe('signature-invalid')
  })

  it('signUpdateManifest self-verifies and REFUSES to emit a manifest the shipped keys cannot check', () => {
    const unsigned = buildUpdateManifest({ version: NEXT, channel: 'pilot', installer: { sha256: SHA, bytes: 10 }, releasedAt: '2026-08-18', signedBy: keyId })
    const good = signUpdateManifest({ doc: unsigned, sign: realSign, verifySignature: realVerify, keys })
    expect(good.ok).toBe(true)
    expect(good.manifest.signature).toEqual(expect.any(String))

    // a signer whose public half is NOT in the trust map: valid signature, useless artifact
    const stranger = generateKeyPairSync('ed25519')
    const bad = signUpdateManifest({
      doc: unsigned,
      sign: body => cryptoSign(null, Buffer.from(body, 'utf8'), stranger.privateKey).toString('base64'),
      verifySignature: realVerify,
      keys
    })
    expect(bad.ok).toBe(false)
    expect(bad.manifest).toBe(null)
    expect(bad.code).toBe('signature-invalid')
    expect(bad.detail).toMatch(/refusing to emit an unverifiable manifest/)
  })
})

describe('crossCheckInstallerDigest — three independent records of one file', () => {
  const manifest = doc()
  const checksums = { installers: [{ name: manifest.installer.name, bytes: manifest.installer.bytes, sha256: SHA }] }
  const ledger = { source: 'github-asset', entries: { [NEXT]: { sha256: SHA } } }

  it('agreement across checksums.json and the ledger passes and names both', () => {
    const r = crossCheckInstallerDigest({ manifest, checksums, ledger })
    expect(r.ok).toBe(true)
    expect(r.compared).toEqual(['checksums.json', 'release-ledger.json'])
  })

  it('a ledger with NO entry for this version yet is simply not a data point', () => {
    const r = crossCheckInstallerDigest({ manifest, checksums, ledger: { entries: {} } })
    expect(r.ok).toBe(true)
    expect(r.compared).toEqual(['checksums.json'])
  })

  it('DISAGREEMENT with checksums.json is a hard failure', () => {
    const r = crossCheckInstallerDigest({ manifest, checksums: { installers: [{ name: manifest.installer.name, bytes: manifest.installer.bytes, sha256: 'b'.repeat(64) }] } })
    expect(r.ok).toBe(false)
    expect(r.code).toBe('checksums-digest-mismatch')
  })

  it('DISAGREEMENT with the published ledger entry is a hard failure', () => {
    const r = crossCheckInstallerDigest({ manifest, checksums, ledger: { entries: { [NEXT]: { sha256: 'c'.repeat(64) } } } })
    expect(r.ok).toBe(false)
    expect(r.code).toBe('ledger-digest-mismatch')
  })

  it('a byte-count disagreement is a hard failure too', () => {
    const r = crossCheckInstallerDigest({ manifest, checksums: { installers: [{ name: manifest.installer.name, bytes: 7, sha256: SHA }] } })
    expect(r.code).toBe('checksums-bytes-mismatch')
  })

  it('no checksums entry for the pinned installer name is a hard failure', () => {
    expect(crossCheckInstallerDigest({ manifest, checksums: { installers: [] } }).code).toBe('checksums-entry-absent')
  })
})
