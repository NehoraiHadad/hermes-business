import { describe, expect, it } from 'vitest'
import {
  captureOwned,
  buildRestorePatch,
  backupTerminalBackend,
  restoreOwned,
  getAt
} from './partner-config.cjs'

// A realistic pre-partner config: some owned fields present, some absent.
const PRE_PARTNER = {
  display: { personality: 'friendly' },
  approvals: { mode: 'off', cron_mode: 'approve', timeout: 42 },
  terminal: { backend: 'daytona' }
  // delegation.subagent_auto_approve and terminal.docker_* are ABSENT.
}

describe('captureOwned', () => {
  it('records presence AND value, distinguishing absent from present-null', () => {
    const backup = captureOwned(PRE_PARTNER)
    const personality = backup.fields.find(f => f.path.join('.') === 'display.personality')
    expect(personality).toMatchObject({ present: true, value: 'friendly' })
    const delegation = backup.fields.find(f => f.path.join('.') === 'delegation.subagent_auto_approve')
    expect(delegation).toMatchObject({ present: false })
    const cron = backup.fields.find(f => f.path.join('.') === 'approvals.cron_mode')
    expect(cron).toMatchObject({ present: true, value: 'approve' })
  })

  it('treats a present null as present, not absent', () => {
    const backup = captureOwned({ display: { personality: null } })
    const personality = backup.fields.find(f => f.path.join('.') === 'display.personality')
    expect(personality).toMatchObject({ present: true, value: null })
  })
})

describe('buildRestorePatch', () => {
  it('restores present fields exactly and absent fields to the documented stock default', () => {
    const patch = buildRestorePatch(captureOwned(PRE_PARTNER))
    // Present -> exact captured value.
    expect(getAt(patch, ['display', 'personality'])).toEqual({ present: true, value: 'friendly' })
    expect(getAt(patch, ['approvals', 'mode'])).toEqual({ present: true, value: 'off' })
    expect(getAt(patch, ['approvals', 'cron_mode'])).toEqual({ present: true, value: 'approve' })
    expect(getAt(patch, ['terminal', 'backend'])).toEqual({ present: true, value: 'daytona' })
    // Absent -> stock default (config_defaults): delegation false, docker fields.
    expect(getAt(patch, ['delegation', 'subagent_auto_approve'])).toEqual({ present: true, value: false })
    expect(getAt(patch, ['terminal', 'docker_volumes'])).toEqual({ present: true, value: [] })
    expect(getAt(patch, ['terminal', 'docker_network'])).toEqual({ present: true, value: true })
    // Never touches an unrelated key the feature does not own.
    expect(getAt(patch, ['approvals', 'timeout'])).toEqual({ present: false, value: undefined })
  })

  it('restores everything to stock defaults for a null/malformed backup', () => {
    const patch = buildRestorePatch(null)
    expect(getAt(patch, ['display', 'personality'])).toEqual({ present: true, value: null })
    expect(getAt(patch, ['approvals', 'mode'])).toEqual({ present: true, value: 'smart' })
    expect(getAt(patch, ['approvals', 'cron_mode'])).toEqual({ present: true, value: 'deny' })
    expect(backupTerminalBackend(null)).toBe('local')
  })
})

describe('restoreOwned', () => {
  it('drives one config PUT plus the terminal-backend endpoint', async () => {
    const calls: Array<{ endpoint: string; body?: any; method?: string }> = []
    const api = async (endpoint: string, init?: { method?: string; body?: any }) => {
      calls.push({ endpoint, method: init?.method, body: init?.body })
      return {}
    }
    await restoreOwned(captureOwned(PRE_PARTNER), api)
    const put = calls.find(c => c.endpoint === '/api/config')
    expect(put?.body.config.display).toEqual({ personality: 'friendly' })
    const backend = calls.find(c => c.endpoint === '/api/tools/terminal/backend')
    expect(backend?.body).toEqual({ backend: 'daytona' })
  })
})
