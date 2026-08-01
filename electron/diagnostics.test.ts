import { describe, expect, it } from 'vitest'
// @ts-expect-error - plain CJS module without type declarations
import { buildManifest, serializeDiagnostics } from './diagnostics-core.cjs'
import {
  BUSINESS_MARKER,
  FAKE_EMAIL,
  FAKE_SECRETS,
  FAKE_SECRET_VALUES,
  PERSONAL_PATHS,
  PERSONAL_USERNAME
} from './redaction-fixtures'

// Raw Hermes responses, deliberately poisoned three ways:
//  - secrets/paths/emails placed in ALLOW-LISTED string fields (must be redacted
//    by the serialize chokepoint);
//  - secrets + chat/business content placed on NON-allow-listed keys (must be
//    dropped by the allow-list projection so they never reach the serializer).
function poisonedInputs() {
  return {
    versions: { app: '0.3.3', electron: '31.0.0', node: '20.11.1', hermes: '0.19.1' },
    health: {
      ok: true,
      version: '0.19.1',
      auth_required: false,
      // non-allow-listed — must be dropped
      error: `open '${PERSONAL_PATHS.windows}'`,
      access_token: FAKE_SECRETS.accessJson,
      transcript: BUSINESS_MARKER
    },
    status: {
      version: '0.19.1',
      overall: `degraded: ${FAKE_SECRETS.openai}`, // allow-listed string — redacted
      gateway_state: PERSONAL_PATHS.posixHome, // allow-listed string — path redacted
      nous_session_valid: FAKE_EMAIL, // allow-listed string — email redacted
      gateway_running: true,
      active_agents: 2,
      // non-allow-listed — must be dropped whole
      sessions: [{ from: FAKE_EMAIL, message: `${BUSINESS_MARKER} customer chat` }],
      memory: { note: BUSINESS_MARKER },
      api_key: FAKE_SECRETS.google,
      bot: FAKE_SECRETS.telegram,
      components: {
        telegram: {
          status: 'connected',
          state: PERSONAL_PATHS.macUsers, // allow-listed string — path redacted
          configured: 1,
          connected: 1,
          // non-allow-listed — dropped
          secret: FAKE_SECRETS.bearer,
          messages: [`${BUSINESS_MARKER} inbound`]
        }
      }
    },
    runtimeState: { installed: true, running: true, starting: false, mode: 'business', error: PERSONAL_PATHS.windows },
    createdAt: '2026-08-01T00:00:00.000Z',
    platform: { type: 'Windows_NT', release: '10.0.26100', arch: 'x64' }
  }
}

describe('diagnostics allow-list + redaction (end-to-end payload)', () => {
  const manifest = buildManifest(poisonedInputs())
  const payload = serializeDiagnostics(manifest)

  it('produces valid JSON after redaction', () => {
    expect(() => JSON.parse(payload)).not.toThrow()
  })

  it('lets no secret value survive', () => {
    for (const value of FAKE_SECRET_VALUES) expect(payload).not.toContain(value)
  })

  it('lets no personal path account name or raw email survive', () => {
    expect(payload).not.toContain(PERSONAL_USERNAME)
    expect(payload).not.toContain(FAKE_EMAIL)
  })

  it('lets no chat/message/business content survive', () => {
    expect(payload).not.toContain(BUSINESS_MARKER)
    const parsed = JSON.parse(payload)
    expect('sessions' in parsed.status).toBe(false)
    expect('memory' in parsed.status).toBe(false)
    expect('api_key' in parsed.status).toBe(false)
    expect('bot' in parsed.status).toBe(false)
    expect(Object.keys(parsed.health).sort()).toEqual(['auth_required', 'ok', 'version'])
    expect(Object.keys(parsed.status.components.telegram).sort()).toEqual(
      ['configured', 'connected', 'state', 'status'].sort()
    )
  })

  it('preserves useful non-sensitive structure', () => {
    const parsed = JSON.parse(payload)
    expect(parsed.status.version).toBe('0.19.1')
    expect(parsed.status.active_agents).toBe(2)
    expect(parsed.status.overall).toBe('degraded: <redacted>')
    expect(parsed.status.gateway_state).toBe('/home/<redacted>/.hermes/config.json')
    expect(parsed.status.components.telegram.state).toBe('/Users/<redacted>/Library/Application Support/Hermes')
    expect(parsed.status.nous_session_valid).toBe('<redacted>@shop.example')
    expect(parsed.runtime.error_present).toBe(true)
    expect(parsed.platform.release).toBe('10.0.26100')
  })
})
