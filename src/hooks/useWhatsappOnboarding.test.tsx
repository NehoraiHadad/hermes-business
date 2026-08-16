// @vitest-environment jsdom
import '../test/setup-dom'
import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mainApi = vi.hoisted(() => ({
  ensureWhatsappPolicy: vi.fn(),
  getWhatsappPolicy: vi.fn(),
  startWhatsappOnboarding: vi.fn(),
  pollWhatsappOnboarding: vi.fn(),
  applyWhatsappOnboarding: vi.fn(),
  cancelWhatsappOnboarding: vi.fn()
}))

vi.mock('../lib/hermes-client', () => ({ hermesClient: mainApi }))

import { useWhatsappOnboarding } from './useWhatsappOnboarding'

const connected = {
  pairing_id: 'pair-1',
  status: 'connected' as const,
  expires_at: '2026-08-16T12:00:00Z',
  mode: 'bot' as const
}

describe('WhatsApp onboarding runtime selection', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mainApi.ensureWhatsappPolicy.mockResolvedValue({ ok: true, enabled: true })
    mainApi.getWhatsappPolicy.mockResolvedValue({ mode: 'selected_chats', reply_chats: [], reply_groups: [] })
    mainApi.startWhatsappOnboarding.mockResolvedValue(connected)
    mainApi.cancelWhatsappOnboarding.mockResolvedValue({ ok: true })
  })

  it('uses the separate community runtime after it has been provisioned', async () => {
    const communityApi = vi.fn(async () => connected)
    window.hermesDesktop = {
      getCommunityRuntime: vi.fn(async () => ({ provisioned: true, active: true, target: 'community' })),
      startCommunityRuntime: vi.fn(async () => ({ provisioned: true, active: true, target: 'community', running: true, gatewayStarted: true, error: null })),
      communityApi
    } as unknown as HermesDesktopBridge
    const { result } = renderHook(() => useWhatsappOnboarding('bot'))

    await act(async () => result.current.start())

    expect(communityApi).toHaveBeenCalledWith('/api/messaging/whatsapp/onboarding/start', {
      method: 'POST',
      body: { mode: 'bot', allowed_users: '*', profile: 'default' }
    })
    expect(mainApi.ensureWhatsappPolicy).not.toHaveBeenCalled()
    expect(result.current.onboarding).toEqual(connected)
  })

  it('keeps the official main flow when no community deployment exists', async () => {
    window.hermesDesktop = {
      getCommunityRuntime: vi.fn(async () => ({ provisioned: false }))
    } as unknown as HermesDesktopBridge
    const { result } = renderHook(() => useWhatsappOnboarding('bot'))

    await act(async () => result.current.start())

    expect(mainApi.ensureWhatsappPolicy).toHaveBeenCalledOnce()
    expect(mainApi.startWhatsappOnboarding).toHaveBeenCalledOnce()
    expect(result.current.onboarding).toEqual(connected)
  })

  it('does not let stale community directories hijack the business flow without an active marker', async () => {
    window.hermesDesktop = {
      getCommunityRuntime: vi.fn(async () => ({ provisioned: true, active: false, target: 'business' })),
      startCommunityRuntime: vi.fn()
    } as unknown as HermesDesktopBridge
    const { result } = renderHook(() => useWhatsappOnboarding('bot'))

    await act(async () => result.current.start())

    expect(window.hermesDesktop.startCommunityRuntime).not.toHaveBeenCalled()
    expect(mainApi.ensureWhatsappPolicy).toHaveBeenCalledOnce()
    expect(mainApi.startWhatsappOnboarding).toHaveBeenCalledOnce()
  })
})
