import { generateKeyPairSync, sign as cryptoSign } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { keyIdFromPublicKeyDer } from '../scripts/lib/release/update-manifest.mjs'

// Loaded via require() so this file and the production modules resolve to the
// EXACT SAME Node module singletons — the idiom the rest of electron/*.test.ts uses.
const { UPDATE_TRUST_KEYS, verifyManifestSignature } = require('./update-trust.cjs')

const BODY = 'canonical-signing-body-under-test'

/**
 * These tests guard the SHIPPED trust map itself, not the verification algorithm
 * (companion-download.test.ts covers that). The map is hand-edited — a key is
 * pasted in by a human running gen-update-key.mjs — and it is the one file where
 * a copy/paste slip silently disarms the only defence an unsigned installer has.
 */
describe('shipped update trust map', () => {
  const ids = Object.keys(UPDATE_TRUST_KEYS)

  it('is frozen, so nothing at runtime can add a key it likes', () => {
    expect(Object.isFrozen(UPDATE_TRUST_KEYS)).toBe(true)
  })

  it('carries a RESERVE key alongside the primary', () => {
    // Not "length >= 1". Rotation only ever reaches FUTURE installs: an app on a
    // user's disk trusts exactly the ids compiled into it and we cannot reach it
    // to add one. If the primary key is lost or stolen and no second key already
    // shipped, every existing install loses its update path permanently. This
    // assertion exists so nobody "tidies up" the spare entry.
    expect(ids.length).toBeGreaterThanOrEqual(2)
  })

  it.each(Object.entries(UPDATE_TRUST_KEYS))('%s is a valid Ed25519 key whose id matches its own bytes', (id, pem) => {
    // The id is CONTENT-ADDRESSED. Recomputing it from the pasted PEM is what
    // catches the realistic mistake: pasting key B's material under key A's id
    // (e.g. after a second gen-update-key run), which would otherwise surface far
    // away as a baffling 'signer-unknown' at release time.
    const { createPublicKey } = require('node:crypto')
    const key = createPublicKey(pem as string)
    expect(key.asymmetricKeyType).toBe('ed25519')
    expect(keyIdFromPublicKeyDer(key.export({ type: 'spki', format: 'der' }))).toBe(id)
  })

  it('rejects a signature from a key that is not in the map, whichever id it claims', () => {
    // The security property in one line: an attacker holding SOME Ed25519 key
    // cannot get a manifest accepted by naming a trusted id, because the id
    // selects the public key we check against rather than describing the signer.
    const { privateKey } = generateKeyPairSync('ed25519')
    const forged = cryptoSign(null, Buffer.from(BODY, 'utf8'), privateKey).toString('base64')
    for (const id of ids) expect(verifyManifestSignature(BODY, forged, id)).toBe(false)
    expect(verifyManifestSignature(BODY, forged, 'tachles-update-ed25519-deadbeefdeadbeef')).toBe(false)
  })

  it('never throws its way to a pass on malformed input', () => {
    const id = ids[0]
    expect(verifyManifestSignature(BODY, 'not-base64-!!!', id)).toBe(false)
    expect(verifyManifestSignature(BODY, '', id)).toBe(false)
    expect(verifyManifestSignature(BODY, null as unknown as string, id)).toBe(false)
    expect(verifyManifestSignature(null as unknown as string, 'AAAA', id)).toBe(false)
    // Prototype keys must not resolve as trusted ids (hasOwnProperty guard).
    expect(verifyManifestSignature(BODY, 'AAAA', 'constructor')).toBe(false)
    expect(verifyManifestSignature(BODY, 'AAAA', '__proto__')).toBe(false)
  })
})
