// @vitest-environment jsdom
import '../../test/setup-dom'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mainClient = vi.hoisted(() => ({ listOAuthProviders: vi.fn() }))
vi.mock('../../lib/hermes-client', () => ({ hermesClient: mainClient }))
vi.mock('../ui/Modal', () => ({ Modal: ({ children }: { children: ReactNode }) => <div>{children}</div> }))
vi.mock('./providers/CodexOAuth', () => ({ CodexOAuth: () => <div>codex</div> }))
vi.mock('./providers/DeviceFlowOAuth', () => ({ DeviceFlowOAuth: () => <div>device</div> }))
vi.mock('./providers/ExternalProviderCard', () => ({ ExternalProviderCard: () => <div>external</div> }))

import { ProviderModal } from './ProviderModal'

describe('ProviderModal runtime selection', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    window.hermesDesktop = undefined
  })

  it('reads the catalog from the separately provisioned community home', async () => {
    const communityApi = vi.fn(async (endpoint: string) => {
      if (endpoint === '/api/providers/oauth?profile=default') {
        return { providers: [{ id: 'openai-codex', name: 'ChatGPT', flow: 'device_code', status: { logged_in: false } }] }
      }
      throw new Error(`unexpected ${endpoint}`)
    })
    window.hermesDesktop = {
      getCommunityRuntime: vi.fn(async () => ({ provisioned: true, active: true, target: 'community' })),
      startCommunityRuntime: vi.fn(async () => ({ provisioned: true, active: true, target: 'community', running: true, gatewayStarted: true, error: null })),
      communityApi
    } as unknown as HermesDesktopBridge

    render(<ProviderModal onClose={() => {}} onConnect={async () => {}} onOAuthConnected={() => {}} />)

    await waitFor(() => expect(communityApi).toHaveBeenCalledWith('/api/providers/oauth?profile=default', undefined))
    expect(mainClient.listOAuthProviders).not.toHaveBeenCalled()
    expect(screen.getByTestId('provider-runtime-target')).toHaveTextContent('הקהילתי')
  })

  it('does not expose an API-key form until the runtime target probe resolves', async () => {
    let resolveProbe!: (value: CommunityRuntimeState) => void
    const probe = new Promise<CommunityRuntimeState>(resolve => { resolveProbe = resolve })
    window.hermesDesktop = {
      getCommunityRuntime: vi.fn(() => probe)
    } as unknown as HermesDesktopBridge
    mainClient.listOAuthProviders.mockResolvedValue([])

    render(<ProviderModal onClose={() => {}} onConnect={async () => {}} onOAuthConnected={() => {}} />)

    expect(screen.getByText(/בודק לאיזה Hermes/)).toBeInTheDocument()
    expect(screen.queryByLabelText(/API key/)).not.toBeInTheDocument()
    expect(mainClient.listOAuthProviders).not.toHaveBeenCalled()

    await act(async () => resolveProbe({
      provisioned: true,
      active: false,
      target: 'business',
      running: false,
      starting: false,
      gatewayStarted: false,
      error: null
    }))
    await waitFor(() => expect(mainClient.listOAuthProviders).toHaveBeenCalledOnce())
    expect(screen.getByTestId('provider-runtime-target')).toHaveTextContent('העסקי')
  })

  it('reports honestly when the community catalog offers no completable flow', async () => {
    const communityApi = vi.fn(async () => ({
      providers: [{ id: 'copilot-acp', name: 'Copilot', flow: 'external', status: { logged_in: false } }]
    }))
    window.hermesDesktop = {
      getCommunityRuntime: vi.fn(async () => ({ provisioned: true, active: true, target: 'community' })),
      startCommunityRuntime: vi.fn(async () => ({ provisioned: true, active: true, target: 'community', running: true, gatewayStarted: true, error: null })),
      communityApi
    } as unknown as HermesDesktopBridge

    render(<ProviderModal onClose={() => {}} onConnect={async () => {}} onOAuthConnected={() => {}} />)

    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('שום דרך חיבור נתמכת'))
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument()
  })

  it('keeps the business API-key fallback when the live catalog fails', async () => {
    window.hermesDesktop = {
      getCommunityRuntime: vi.fn(async () => ({ active: false, target: 'business' }))
    } as unknown as HermesDesktopBridge
    mainClient.listOAuthProviders.mockRejectedValue(new Error('catalog offline'))
    const onConnect = vi.fn(async () => {})

    render(<ProviderModal onClose={() => {}} onConnect={onConnect} onOAuthConnected={() => {}} />)

    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('אפשרויות החיבור הבסיסיות'))
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'openrouter' } })
    fireEvent.change(screen.getByPlaceholderText('הדבק כאן את המפתח'), { target: { value: 'sk-test' } })
    fireEvent.submit(screen.getByPlaceholderText('הדבק כאן את המפתח').closest('form')!)
    await waitFor(() => expect(onConnect).toHaveBeenCalledWith('openrouter', 'sk-test'))
  })
})
