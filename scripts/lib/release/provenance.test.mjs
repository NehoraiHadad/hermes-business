import { describe, expect, it } from 'vitest'
import { authenticateProvenance, authenticatedLedgerOrNull } from './provenance.mjs'

const BODY = 'canonical-ledger-body'
const trustRoots = { ledger_pubkeys: ['key-A'], github_asset_sha256: { '0.3.3': 'g'.repeat(64) } }
// A toy verifier: signature "SIG-<key>" over BODY by that key verifies.
const verifySignature = (body, sig, keyId) => body === BODY && sig === `SIG-${keyId}`

describe('authenticateProvenance — signed ledger (HIGH 6)', () => {
  it('a ledger signed by a committed trust-root key authenticates', () => {
    const artifact = { source: 'signed-ledger', signed_by: 'key-A', signature: 'SIG-key-A' }
    expect(authenticateProvenance({ artifact, trustRoots, verifySignature, body: BODY }).authenticated).toBe(true)
  })
  it('ADVERSARIAL: a bare {source:signed-ledger} with no signature is NOT trusted', () => {
    const r = authenticateProvenance({ artifact: { source: 'signed-ledger' }, trustRoots, verifySignature, body: BODY })
    expect(r.authenticated).toBe(false)
    expect(r.reason).toMatch(/no-signature/)
  })
  it('ADVERSARIAL: a forged signature by an UNKNOWN key is rejected', () => {
    const artifact = { source: 'signed-ledger', signed_by: 'key-EVIL', signature: 'SIG-key-EVIL' }
    expect(authenticateProvenance({ artifact, trustRoots, verifySignature, body: BODY }).authenticated).toBe(false)
  })
  it('ADVERSARIAL: a tampered body breaks the signature', () => {
    const artifact = { source: 'signed-ledger', signed_by: 'key-A', signature: 'SIG-key-A' }
    expect(authenticateProvenance({ artifact, trustRoots, verifySignature, body: 'TAMPERED' }).authenticated).toBe(false)
  })
  it('with NO trust root configured, public fails closed (unauthenticated)', () => {
    const artifact = { source: 'signed-ledger', signed_by: 'key-A', signature: 'SIG-key-A' }
    expect(authenticateProvenance({ artifact, trustRoots: {}, verifySignature, body: BODY }).authenticated).toBe(false)
  })
})

describe('authenticateProvenance — GitHub asset digest (HIGH 6)', () => {
  it('a matching committed known-good asset digest authenticates', () => {
    const artifact = { source: 'github-asset', version: '0.3.3', asset_sha256: 'g'.repeat(64) }
    expect(authenticateProvenance({ artifact, trustRoots }).authenticated).toBe(true)
  })
  it('ADVERSARIAL: a mismatched asset digest is rejected', () => {
    const artifact = { source: 'github-asset', version: '0.3.3', asset_sha256: 'b'.repeat(64) }
    expect(authenticateProvenance({ artifact, trustRoots }).authenticated).toBe(false)
  })
})

describe('authenticatedLedgerOrNull', () => {
  it('returns the ledger only when authenticated, else null (fed as "absent")', () => {
    const artifact = { source: 'signed-ledger', signed_by: 'key-A', signature: 'SIG-key-A' }
    expect(authenticatedLedgerOrNull({ artifact, trustRoots, verifySignature, body: BODY })).toBe(artifact)
    expect(authenticatedLedgerOrNull({ artifact: { source: 'signed-ledger' }, trustRoots, verifySignature, body: BODY })).toBeNull()
  })
})
