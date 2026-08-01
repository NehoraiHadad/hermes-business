import type { OnboardingData } from '../../types'
import { normalizeOnboarding } from '../../../shared/onboarding-contract.js'
import { BUSINESS_CONTEXT_IDENTITY, BUSINESS_CONTEXT_OWNER, BUSINESS_CONTEXT_SKILL, BUSINESS_CONTEXT_VERSION } from './identity'

// The structured business-context payload — the FULL user+business context plus the
// authoritative provider/connection facts, carried as data (not a receipt-only blob).
export type ContextProvider = { ready: boolean; configured: boolean; usable: boolean; state: string; label: string }
export type ContextConnection = { id: string; connected: boolean }

export type BusinessContext = {
  owner: string
  identity: string
  schema: number
  skill: string
  completedAt: string
  provider: ContextProvider
  connections: ContextConnection[]
  business: OnboardingData
}

// A corruption CHECKSUM (not authentication — it is unkeyed/unsigned). SHA-256 via
// WebCrypto when available, else a deterministic FNV-1a fallback so the artifact is
// always self-describing about which algorithm produced its hash.
export type Checksum = { algo: 'sha-256' | 'fnv1a-64'; hash: string }

type SnapshotConnection = { id?: unknown; state?: unknown }

// Deterministic canonical JSON (sorted keys) so the checksum and the encoded payload
// are stable regardless of property order — we encode/verify STRUCTURE, not chance bytes.
export function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`
  if (value && typeof value === 'object') {
    return `{${Object.keys(value as Record<string, unknown>)
      .sort()
      .map(key => `${JSON.stringify(key)}:${stableStringify((value as Record<string, unknown>)[key])}`)
      .join(',')}}`
  }
  return JSON.stringify(value)
}

function fnv1a64(input: string): string {
  const mask = 0xffffffffffffffffn
  let hash = 0xcbf29ce484222325n
  for (let i = 0; i < input.length; i += 1) {
    hash ^= BigInt(input.charCodeAt(i))
    hash = (hash * 0x100000001b3n) & mask
  }
  return hash.toString(16).padStart(16, '0')
}

async function sha256Hex(text: string): Promise<string | null> {
  const subtle = globalThis.crypto?.subtle
  if (!subtle) return null
  try {
    const buf = await subtle.digest('SHA-256', new TextEncoder().encode(text))
    return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('')
  } catch {
    return null
  }
}

// Prefer SHA-256; fall back to FNV-1a. Honestly a CHECKSUM for corruption/staleness —
// never presented as authentication.
export async function contentChecksum(text: string): Promise<Checksum> {
  const sha = await sha256Hex(text)
  if (sha) return { algo: 'sha-256', hash: sha }
  return { algo: 'fnv1a-64', hash: fnv1a64(text) }
}

// UTF-8 safe base64 so Hebrew content round-trips exactly (no Markdown-fence parsing
// is ever needed to recover the payload — it is a single self-delimited token).
export function encodeBase64(text: string): string {
  const bytes = new TextEncoder().encode(text)
  let bin = ''
  for (const b of bytes) bin += String.fromCharCode(b)
  return btoa(bin)
}

export function decodeBase64(b64: string): string {
  const bin = atob(b64)
  return new TextDecoder().decode(Uint8Array.from(bin, c => c.charCodeAt(0)))
}

// Build the structured context from the wrapper-verified snapshot. ALL onboarding
// fields are captured (normalized); provider facts come ONLY from the authoritative
// snapshot; a connection is `connected` only when observed state is exactly 'connected'.
export function buildBusinessContext(input: {
  data: OnboardingData
  snapshot: Record<string, unknown>
  completedAt: string
}): BusinessContext {
  const rawConnections = Array.isArray(input.snapshot.connections)
    ? (input.snapshot.connections as SnapshotConnection[])
    : []
  return {
    owner: BUSINESS_CONTEXT_OWNER,
    identity: BUSINESS_CONTEXT_IDENTITY,
    schema: BUSINESS_CONTEXT_VERSION,
    skill: BUSINESS_CONTEXT_SKILL,
    completedAt: input.completedAt,
    provider: {
      ready: input.snapshot.provider_ready === true,
      configured: input.snapshot.provider_configured === true,
      usable: input.snapshot.provider_usable === true,
      state: typeof input.snapshot.provider_state === 'string' ? input.snapshot.provider_state : 'unknown',
      label: typeof input.snapshot.provider_label === 'string' ? input.snapshot.provider_label : ''
    },
    connections: rawConnections.map(connection => ({
      id: String(connection.id ?? ''),
      connected: connection.state === 'connected'
    })),
    business: normalizeOnboarding(input.data)
  }
}

// The canonical bytes we checksum + encode. completedAt is EXCLUDED so an otherwise
// identical context is not rewritten just because a new timestamp was minted.
export function canonicalPayload(context: BusinessContext): string {
  const { completedAt: _omit, ...core } = context
  return stableStringify(core)
}
