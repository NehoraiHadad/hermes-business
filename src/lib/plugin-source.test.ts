import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { createStorage, loadShippedPlugin, pluginSource } from './plugin-test-harness'

describe('shipped Hermes Desktop Plugin', () => {
  it('loads as plain JavaScript and exposes the expected plugin identity and friendly copy', () => {
    const runtime = loadShippedPlugin({})
    expect(runtime.__plugin.id).toBe('business-shell')
    expect(runtime.__helpers.friendlyToolName('google_calendar.list_events')).toBe('בודק את היומן…')
    expect(runtime.__helpers.friendlyToolName('google_workspace.gmail_search')).toBe('עובד עם המייל…')
    expect(runtime.__helpers.humanSchedule('0 8 * * 0-4')).toContain('08:00')
    expect(runtime.__helpers.humanSchedule({ display: '0 8 * * 0-4' })).toContain('08:00')
  })

  it('creates one real guided session and resumes it idempotently', async () => {
    const request = vi.fn(async (method: string, _params?: Record<string, unknown>) => {
      if (method === 'skills.manage') return { skills: [{ name: 'tachles-welcome' }] }
      if (method === 'cron.manage') return { jobs: [] }
      if (method === 'session.create') {
        return { session_id: 'runtime-1', stored_session_id: 'stored-1' }
      }
      if (method === 'command.dispatch') {
        return { type: 'skill', name: 'tachles-welcome', message: 'expanded-bootstrap-message' }
      }
      return { status: 'streaming' }
    })
    const navigate = vi.fn()
    const runtime = loadShippedPlugin({
      request,
      navigate,
      notify: vi.fn(),
      state: {
        gateway: { get: () => 'open' },
        model: { get: () => 'gpt-test' },
        profile: { get: () => 'default' }
      }
    })
    const storage = createStorage()

    await runtime.__helpers.startGuidedSetup(storage)
    await runtime.__helpers.startGuidedSetup(storage)

    expect(request.mock.calls.map(call => call[0])).toEqual([
      'skills.manage',
      'cron.manage',
      'session.create',
      'command.dispatch',
      'prompt.submit'
    ])
    // The guided first run opens the role-sensing welcome, not the business
    // onboarding: at this point nothing is known about what the user wants.
    expect(request.mock.calls[3][1]).toMatchObject({
      session_id: 'runtime-1',
      name: 'tachles-welcome'
    })
    expect(request.mock.calls[4][1]).toEqual({
      session_id: 'runtime-1',
      text: 'expanded-bootstrap-message'
    })
    expect(navigate).toHaveBeenLastCalledWith('/stored-1')
    const prompt = runtime.__helpers.guidedSetupPrompt()
    expect(prompt).not.toContain('/tachles-welcome')
    expect(prompt).not.toContain('/business-bootstrap')
    expect(prompt).toContain('WRAPPER_VERIFIED_SNAPSHOT')
    expect(prompt).toContain('Never run hermes doctor')
  })

  it('does not submit when Hermes does not resolve the bootstrap Skill', async () => {
    const request = vi.fn(async (method: string, _params?: Record<string, unknown>) => {
      if (method === 'skills.manage') return { skills: [{ name: 'tachles-welcome' }] }
      if (method === 'cron.manage') return { jobs: [] }
      if (method === 'session.create') return { session_id: 'runtime-1', stored_session_id: 'stored-1' }
      if (method === 'command.dispatch') return { type: 'send', message: 'wrong route' }
      return { status: 'streaming' }
    })
    const runtime = loadShippedPlugin({
      request,
      state: {
        gateway: { get: () => 'open' },
        model: { get: () => 'gpt-test' },
        profile: { get: () => 'default' }
      }
    })

    await expect(runtime.__helpers.startGuidedSetup(createStorage())).rejects.toThrow('requested Skill')
    expect(request.mock.calls.map(call => call[0])).not.toContain('prompt.submit')
  })

  it('imports only symbols present in the installed Hermes Plugin SDK when Hermes is available', () => {
    const sdkPath = path.join(
      process.env.LOCALAPPDATA || '',
      'hermes',
      'hermes-agent',
      'apps',
      'desktop',
      'src',
      'sdk',
      'index.ts'
    )
    if (!existsSync(sdkPath)) return
    const sdk = readFileSync(sdkPath, 'utf8')
    const importBlock = pluginSource.match(/import\s*\{([\s\S]*?)\}\s*from '@hermes\/plugin-sdk'/)?.[1] || ''
    const imported = importBlock
      .split(',')
      .map(value => value.trim())
      .filter(Boolean)
    expect(imported.length).toBeGreaterThan(0)
    for (const symbol of imported) {
      expect(sdk, `Hermes Plugin SDK is missing ${symbol}`).toMatch(new RegExp(`\\b${symbol}\\b`))
    }
  })
})
