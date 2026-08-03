import { afterEach, describe, expect, it } from 'vitest'
import { createRequire } from 'node:module'
import { FAKE_SECRETS, FAKE_SECRET_VALUES, PERSONAL_PATHS, PERSONAL_USERNAME } from './redaction-fixtures'

// Native require so this suite shares the exact CJS instance runtime-state.cjs
// records into (an ESM interop import can get a separate module copy, making
// cross-module wiring assertions read an empty journal).
const cjsRequire = createRequire(import.meta.url)
const { recordAppError, recentAppErrors, __resetAppErrorJournal } = cjsRequire('./error-journal.cjs')

afterEach(() => __resetAppErrorJournal())

describe('app error journal (diagnostics timeline)', () => {
  it('records Error objects and plain messages with timestamp and source', () => {
    const now = () => '2026-08-03T12:00:00.000Z'
    recordAppError('runtime', new Error('spawn failed'), { now })
    recordAppError('startup', 'gateway did not become healthy', { now })
    expect(recentAppErrors()).toEqual([
      { at: '2026-08-03T12:00:00.000Z', source: 'runtime', message: 'spawn failed' },
      { at: '2026-08-03T12:00:00.000Z', source: 'startup', message: 'gateway did not become healthy' }
    ])
  })

  it('redacts secrets, personal paths and emails at ingestion', () => {
    recordAppError('runtime', `auth failed with key ${FAKE_SECRETS.openai} at ${PERSONAL_PATHS.windows}`)
    const [entry] = recentAppErrors()
    for (const secret of FAKE_SECRET_VALUES) expect(entry.message).not.toContain(secret)
    expect(entry.message).not.toContain(PERSONAL_USERNAME)
    expect(entry.message).toContain('<redacted>')
  })

  it('drops empty messages and caps message/source length', () => {
    recordAppError('runtime', '')
    recordAppError('runtime', null)
    expect(recentAppErrors()).toEqual([])
    recordAppError('s'.repeat(200), 'x'.repeat(1000))
    const [entry] = recentAppErrors()
    expect(entry.source.length).toBe(40)
    expect(entry.message.length).toBe(300)
  })

  it('keeps a bounded ring and returns the most recent entries', () => {
    for (let index = 0; index < 150; index += 1) recordAppError('runtime', `failure ${index}`)
    const all = recentAppErrors(1000)
    expect(all.length).toBe(100)
    expect(all[all.length - 1].message).toBe('failure 149')
    expect(recentAppErrors(5).length).toBe(5)
  })
})

describe('runtime-state wiring', () => {
  it('patchRuntimeState records error transitions into the journal', () => {
    const { patchRuntimeState } = cjsRequire('./runtime-state.cjs')
    patchRuntimeState({ error: 'Hermes is not running' })
    const entries = recentAppErrors()
    expect(entries.some(e => e.source === 'runtime' && e.message === 'Hermes is not running')).toBe(true)
    // Clearing the error must not record anything new.
    const before = recentAppErrors().length
    patchRuntimeState({ error: null })
    expect(recentAppErrors().length).toBe(before)
  })
})
