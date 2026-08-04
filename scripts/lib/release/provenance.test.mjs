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

describe('authenticateProvenance — GitHub asset digest (HIGH 6, per-entry)', () => {
  it('a ledger whose every entry matches the committed known-good digests authenticates', () => {
    const artifact = { source: 'github-asset', entries: { '0.3.3': { sha256: 'g'.repeat(64) } } }
    expect(authenticateProvenance({ artifact, trustRoots }).authenticated).toBe(true)
  })
  it('BOOTSTRAP: an EMPTY ledger with EMPTY committed roots authenticates (first release — docs/RELEASING.md step 0)', () => {
    const artifact = { source: 'github-asset', entries: {} }
    expect(authenticateProvenance({ artifact, trustRoots: { github_asset_sha256: {} } }).authenticated).toBe(true)
  })
  it('ADVERSARIAL: a mismatched entry digest rejects the whole ledger', () => {
    const artifact = { source: 'github-asset', entries: { '0.3.3': { sha256: 'b'.repeat(64) } } }
    expect(authenticateProvenance({ artifact, trustRoots }).authenticated).toBe(false)
  })
  it('ADVERSARIAL: an entry with NO committed trust root is rejected (not silently skipped)', () => {
    const artifact = { source: 'github-asset', entries: { '0.3.3': { sha256: 'g'.repeat(64) }, '9.9.9': { sha256: 'x'.repeat(64) } } }
    expect(authenticateProvenance({ artifact, trustRoots }).authenticated).toBe(false)
  })
  it('ADVERSARIAL: DROPPING a ledger entry the committed roots still record is rejected (never-shrinking)', () => {
    const artifact = { source: 'github-asset', entries: {} }
    const r = authenticateProvenance({ artifact, trustRoots })
    expect(r.authenticated).toBe(false)
    expect(r.reason).toMatch(/never-shrinking/)
  })
  it('ADVERSARIAL: no committed github_asset_sha256 object at all → unauthenticated (no trust root)', () => {
    const artifact = { source: 'github-asset', entries: { '0.3.3': { sha256: 'g'.repeat(64) } } }
    expect(authenticateProvenance({ artifact, trustRoots: {} }).authenticated).toBe(false)
  })
  it('ADVERSARIAL: a github-asset ledger with no entries object is rejected', () => {
    expect(authenticateProvenance({ artifact: { source: 'github-asset' }, trustRoots }).authenticated).toBe(false)
    expect(authenticateProvenance({ artifact: { source: 'github-asset', entries: null }, trustRoots }).authenticated).toBe(false)
  })
})

describe('authenticatedLedgerOrNull', () => {
  it('returns the ledger only when authenticated, else null (fed as "absent")', () => {
    const artifact = { source: 'signed-ledger', signed_by: 'key-A', signature: 'SIG-key-A' }
    expect(authenticatedLedgerOrNull({ artifact, trustRoots, verifySignature, body: BODY })).toBe(artifact)
    expect(authenticatedLedgerOrNull({ artifact: { source: 'signed-ledger' }, trustRoots, verifySignature, body: BODY })).toBeNull()
  })
})
