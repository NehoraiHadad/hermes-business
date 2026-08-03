import { describe, expect, it, vi } from 'vitest'
import { createDemoDesktop } from './demo-desktop'
import { BRIDGE_UNAVAILABLE, createHermesDesktop } from './desktop'

// The desktop group is the second chokepoint (next to rpc/api) where demo,
// bridge and no-bridge get ONE meaning, so product code never branches on mode.
// These tests pin that contract for all three.

function fakeBridge(overrides: Record<string, unknown> = {}) {
  return {
    startGoogleSetup: vi.fn(async () => ({ ok: true, authUrl: 'https://accounts.google.com/x' })),
    ensureWhatsappPolicy: vi.fn(async () => ({ ok: true, enabled: true })),
    chooseFile: vi.fn(async () => 'C:\\secrets\\client_secret.json'),
    openFull: vi.fn(async () => ({ ok: true })),
    probeCodexGrant: vi.fn(async () => ({ ok: true, reachable: true })),
    getPartnerFeed: vi.fn(async () => ({
      generatedAt: new Date().toISOString(),
      available: true,
      cron: { ok: true, jobs: [] },
      sessions: { ok: true, rows: [] },
      curator: { ok: true, insights: null }
    })),
    ...overrides
  } as unknown as HermesDesktopBridge
}

describe('desktop facade — bridge mode', () => {
  it('delegates to the bridge with the caller arguments unchanged', async () => {
    const bridge = fakeBridge()
    const desktop = createHermesDesktop(() => bridge)
    await expect(desktop.startGoogleSetup('C:\\secret.json')).resolves.toMatchObject({ ok: true })
    expect(bridge.startGoogleSetup).toHaveBeenCalledWith('C:\\secret.json')
    await expect(desktop.openFullSurface('logs')).resolves.toEqual({ ok: true })
    expect(bridge.openFull).toHaveBeenCalledWith('logs')
  })

  it('delegates the partner feed to the bridge', async () => {
    const bridge = fakeBridge()
    const desktop = createHermesDesktop(() => bridge)
    await expect(desktop.getPartnerFeed()).resolves.toMatchObject({ available: true })
    expect(bridge.getPartnerFeed).toHaveBeenCalledWith()
  })

  it('reports a native file dialog only when the bridge can actually open one', () => {
    expect(createHermesDesktop(() => fakeBridge()).hasNativeFileDialog).toBe(true)
    expect(createHermesDesktop(() => fakeBridge({ chooseFile: undefined })).hasNativeFileDialog).toBe(false)
    expect(createHermesDesktop(() => undefined).hasNativeFileDialog).toBe(false)
  })
})

describe('desktop facade — missing bridge', () => {
  it('throws honestly instead of fabricating a result', async () => {
    const desktop = createHermesDesktop(() => undefined)
    await expect(desktop.ensureWhatsappPolicy()).rejects.toThrow(BRIDGE_UNAVAILABLE)
    await expect(desktop.getWhatsappGuard()).rejects.toThrow(BRIDGE_UNAVAILABLE)
    await expect(desktop.restartRuntime()).rejects.toThrow(BRIDGE_UNAVAILABLE)
  })

  it('treats an OLDER bridge missing a method the same way — never a silent pass', async () => {
    const desktop = createHermesDesktop(() => fakeBridge({ ensureWhatsappPolicy: undefined }))
    await expect(desktop.ensureWhatsappPolicy()).rejects.toThrow(BRIDGE_UNAVAILABLE)
  })

  // Call sites degrade with `.catch(...)`. A SYNCHRONOUS throw would sail past that
  // catch and take the caller down, so the failure must arrive as a rejection.
  it('rejects rather than throwing synchronously, so a caller .catch() still works', async () => {
    const desktop = createHermesDesktop(() => undefined)
    expect(() => desktop.getCuratorInsights().catch(() => 'handled')).not.toThrow()
    await expect(desktop.getWhatsappDirectory().catch(() => [])).resolves.toEqual([])
  })

  it('rejects the partner feed with BRIDGE_UNAVAILABLE, never a fabricated empty snapshot', async () => {
    const desktop = createHermesDesktop(() => undefined)
    await expect(desktop.getPartnerFeed()).rejects.toThrow(BRIDGE_UNAVAILABLE)
    await expect(
      createHermesDesktop(() => fakeBridge({ getPartnerFeed: undefined })).getPartnerFeed()
    ).rejects.toThrow(BRIDGE_UNAVAILABLE)
  })

  it('reports an absent Codex probe as null so the grant gate fails closed, not loudly', async () => {
    await expect(createHermesDesktop(() => undefined).probeCodexGrant()).resolves.toBeNull()
    await expect(
      createHermesDesktop(() => fakeBridge({ probeCodexGrant: undefined })).probeCodexGrant()
    ).resolves.toBeNull()
  })
})

describe('desktop facade — demo mode', () => {
  it('serves fixtures and never touches the bridge', async () => {
    const bridge = fakeBridge()
    const desktop = createHermesDesktop(() => bridge, createDemoDesktop())
    await expect(desktop.getVersions()).resolves.toMatchObject({ hermes: expect.any(String) })
    expect(bridge.startGoogleSetup).not.toHaveBeenCalled()
    expect(bridge.ensureWhatsappPolicy).not.toHaveBeenCalled()
  })

  // The regression this whole task closes: WhatsappCloudConnect used to SKIP the guard
  // precondition in demo. The check now always runs; the fixture backend satisfies it.
  it('satisfies the WhatsApp safety precondition instead of letting callers skip it', async () => {
    const desktop = createHermesDesktop(() => undefined, createDemoDesktop())
    await expect(desktop.ensureWhatsappPolicy()).resolves.toEqual({ ok: true, enabled: true })
  })

  it('keeps the guard proof consistent with the policy the user just saved', async () => {
    const desktop = createHermesDesktop(() => undefined, createDemoDesktop())
    await expect(desktop.getWhatsappGuard()).resolves.toMatchObject({ mode: 'read_only', reply_chats: 0 })
    await desktop.setWhatsappPolicy({
      version: 2,
      mode: 'selected_chats',
      behavior: 'assist',
      instructions: '',
      reply_chats: ['972500000001', '972500000002'],
      reply_groups: [],
      sources: []
    })
    await expect(desktop.getWhatsappPolicy()).resolves.toMatchObject({ mode: 'selected_chats' })
    await expect(desktop.getWhatsappGuard()).resolves.toMatchObject({
      plugin_loaded: true,
      enforcing: true,
      mode: 'selected_chats',
      reply_chats: 2
    })
  })

  it('serves a faithful partner-feed fixture: one check-in run, one Telegram session, curator', async () => {
    const desktop = createHermesDesktop(() => undefined, createDemoDesktop())
    const snapshot = await desktop.getPartnerFeed()
    expect(snapshot.available).toBe(true)
    expect(snapshot.cron.ok).toBe(true)
    expect(snapshot.cron.jobs).toHaveLength(1)
    expect(snapshot.cron.jobs[0].isPartnerCheckin).toBe(true)
    expect(snapshot.cron.jobs[0].runs).toHaveLength(1)
    expect(snapshot.sessions.ok).toBe(true)
    expect(snapshot.sessions.rows).toEqual([expect.objectContaining({ source: 'telegram' })])
    expect(snapshot.curator).toMatchObject({ ok: true })
    expect(snapshot.curator.insights?.available).toBe(true)
  })

  it('says a full-Hermes surface did not open here rather than claiming success', async () => {
    const desktop = createHermesDesktop(() => undefined, createDemoDesktop())
    const result = await desktop.openFullSurface('dashboard')
    expect(result.ok).toBe(false)
    expect(result.message).toContain('dashboard')
  })
})
