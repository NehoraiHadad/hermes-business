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
    runtimeState: {
      installed: true,
      running: true,
      starting: false,
      mode: 'business',
      version: '0.19.1',
      compatible: true,
      compatRange: '>=0.19.0 <0.21.0',
      error: PERSONAL_PATHS.windows
    },
    createdAt: '2026-08-01T00:00:00.000Z',
    platform: { type: 'Windows_NT', release: '10.0.26100', arch: 'x64' },
    // Poisoned optional facts: unknown keys must be dropped, strings coerced.
    guard: {
      pluginLoaded: true,
      enforcing: true,
      mode: 'read_only',
      activationPhase: 'active',
      raw_policy_file: PERSONAL_PATHS.posixHome, // non-allow-listed — dropped
      chats: [BUSINESS_MARKER] // non-allow-listed — dropped
    },
    updateJournal: {
      phase: 'verify',
      failures: [{ error: FAKE_SECRETS.bearer }, { error: BUSINESS_MARKER }], // only the COUNT survives
      backupPath: PERSONAL_PATHS.windows // non-allow-listed — dropped
    },
    partner: { mode: 'partner', sandbox: 'guard', token: FAKE_SECRETS.telegram }, // token dropped
    recentErrors: [
      { at: '2026-08-01T00:00:00.000Z', source: 'runtime', message: `key ${FAKE_SECRETS.openai} rejected` },
      { at: '2026-08-01T00:01:00.000Z', source: 'uncaught', message: 'boom', extra: BUSINESS_MARKER } // extra dropped
    ],
    uptimeSeconds: 1234.9
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

  it('carries the runtime error TEXT, redacted — not just a boolean', () => {
    const parsed = JSON.parse(payload)
    expect(parsed.runtime.error).toContain('<redacted>')
    expect(parsed.runtime.error).not.toContain(PERSONAL_USERNAME)
    expect(parsed.runtime.version).toBe('0.19.1')
    expect(parsed.runtime.compat_range).toBe('>=0.19.0 <0.21.0')
    expect(parsed.uptime_seconds).toBe(1235)
  })

  it('projects guard/update-journal/partner to enums and counters only', () => {
    const parsed = JSON.parse(payload)
    expect(parsed.whatsapp_guard).toEqual({
      plugin_loaded: true,
      enforcing: true,
      mode: 'read_only',
      activation_phase: 'active'
    })
    expect(parsed.update_journal).toEqual({ present: true, phase: 'verify', failures: 2 })
    expect(parsed.partner).toEqual({ mode: 'partner', sandbox: 'guard' })
    // Poisoned extras (paths, chats, tokens, failure details) never survive.
    expect(payload).not.toContain('raw_policy_file')
    expect(payload).not.toContain('backupPath')
    expect('token' in parsed.partner).toBe(false)
  })

  it('projects the app-error timeline with redaction and no extra keys', () => {
    const parsed = JSON.parse(payload)
    expect(parsed.recent_errors.length).toBe(2)
    expect(parsed.recent_errors[0]).toEqual({
      at: '2026-08-01T00:00:00.000Z',
      source: 'runtime',
      message: 'key <redacted> rejected'
    })
    expect(Object.keys(parsed.recent_errors[1]).sort()).toEqual(['at', 'message', 'source'])
  })

  it('reports absent optional facts as honest nulls/empties, never fabricated', () => {
    const minimal = buildManifest({
      versions: {},
      health: null,
      status: null,
      runtimeState: { installed: false, running: false, starting: false, mode: 'live', error: null },
      createdAt: 'now',
      platform: {}
    })
    expect(minimal.whatsapp_guard).toBeNull()
    expect(minimal.update_journal).toEqual({ present: false, phase: null, failures: 0 })
    expect(minimal.partner).toBeNull()
    expect(minimal.recent_errors).toEqual([])
    expect(minimal.runtime.error).toBeNull()
    expect(minimal.uptime_seconds).toBeNull()
  })
})
