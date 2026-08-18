import { describe, expect, it } from 'vitest'

// require() so this file and the production modules resolve to the SAME Node
// module singletons — the idiom the rest of electron/*.test.ts uses.
const {
  ROLLBACK_ANCHOR_OUTCOMES,
  messageForRollbackCode,
  decideRollbackTarget,
  selectRollbackRelease
} = require('./companion-rollback-core.cjs')

const PREV = '0.4.0-alpha.8'
const RUNNING = '0.4.0-alpha.9'
const NEXT = '0.4.0-alpha.10'

/** An archived journal entry, as clearCompanionJournal writes it. */
function entry(overrides: Record<string, unknown> = {}) {
  return { currentVersion: PREV, targetVersion: RUNNING, outcome: 'applied', clearedAt: '2026-08-18T00:00:00Z', ...overrides }
}

/** An ACTIVE journal record mid-apply. */
function applying(overrides: Record<string, unknown> = {}) {
  return { phase: 'applying', currentVersion: PREV, targetVersion: RUNNING, ...overrides }
}

describe('decideRollbackTarget — where a rollback may go', () => {
  it('offers the version the newest APPLIED history entry says we came from', () => {
    const r = decideRollbackTarget({ runningVersion: RUNNING, history: [entry()] })
    expect(r).toMatchObject({ available: true, target: PREV, from: RUNNING, source: 'history' })
  })

  it('prefers an ACTIVE applying record over history — that is the broken-update case', () => {
    // The `applied-unhealthy` state leaves the journal ACTIVE on purpose, and it
    // is the case where someone most needs to go back. It must win over an older
    // history entry that happens to describe the same running version.
    const r = decideRollbackTarget({
      runningVersion: RUNNING,
      journal: applying({ currentVersion: '0.4.0-alpha.7' }),
      history: [entry()]
    })
    expect(r).toMatchObject({ available: true, target: '0.4.0-alpha.7', source: 'journal' })
  })

  it('ignores an active record that is not about the RUNNING version', () => {
    // A journal describing an install we are not actually running proves nothing
    // about this machine, so it must not become a destination.
    const r = decideRollbackTarget({ runningVersion: RUNNING, journal: applying({ targetVersion: NEXT }) })
    expect(r).toMatchObject({ available: false, code: 'no-recorded-update' })
  })

  it('ignores an active record that has not reached the applying phase', () => {
    for (const phase of ['downloading', 'verifying', 'ready']) {
      const r = decideRollbackTarget({ runningVersion: RUNNING, journal: applying({ phase }) })
      expect(r.available).toBe(false)
    }
  })

  it('takes the NEWEST qualifying history entry, not the first', () => {
    const history = [
      entry({ currentVersion: '0.4.0-alpha.2', targetVersion: '0.4.0-alpha.3' }),
      entry({ currentVersion: '0.4.0-alpha.7', targetVersion: RUNNING }),
      entry({ currentVersion: PREV, targetVersion: RUNNING })
    ]
    expect(decideRollbackTarget({ runningVersion: RUNNING, history }).target).toBe(PREV)
  })

  it.each(['apply-failed', 'cancelled', 'failed', 'unexpected-version', 'discarded-partial', 'malformed'])(
    'refuses %s as an anchor — none of them proves the previous version ever ran here',
    outcome => {
      const r = decideRollbackTarget({ runningVersion: RUNNING, history: [entry({ outcome })] })
      expect(r).toMatchObject({ available: false, code: 'no-recorded-update' })
    }
  )

  it('accepts exactly the two anchor outcomes and no others', () => {
    expect([...ROLLBACK_ANCHOR_OUTCOMES]).toEqual(['applied', 'applied-unhealthy'])
    for (const outcome of ROLLBACK_ANCHOR_OUTCOMES) {
      expect(decideRollbackTarget({ runningVersion: RUNNING, history: [entry({ outcome })] }).available).toBe(true)
    }
  })

  it('refuses a target that is not strictly OLDER — the offer self-retires after a rollback', () => {
    // After rolling v9 -> v8, history's newest entry is {from: v9, to: v8}. Asked
    // again while running v8 it points FORWARD, and must not be dressed up as a
    // rollback.
    const afterRollback = [entry({ currentVersion: RUNNING, targetVersion: PREV })]
    const r = decideRollbackTarget({ runningVersion: PREV, history: afterRollback })
    expect(r).toMatchObject({ available: false, code: 'target-not-older' })
  })

  it('compares versions by SemVer, not lexically', () => {
    // '0.4.0-alpha.9' sorts ABOVE '0.4.0-alpha.10' as a string. A lexical
    // comparison here would call the alpha.9 -> alpha.10 update a rollback and
    // offer to "go back" to something newer. This is the same class of bug that
    // was found in installer/lib/SemVer.ps1.
    const r = decideRollbackTarget({ runningVersion: NEXT, history: [entry({ currentVersion: RUNNING, targetVersion: NEXT })] })
    expect(r).toMatchObject({ available: true, target: RUNNING })
  })

  it('refuses when the running version cannot be parsed', () => {
    for (const running of ['', 'nightly', null, undefined, 42]) {
      const r = decideRollbackTarget({ runningVersion: running as never, history: [entry()] })
      expect(r).toMatchObject({ available: false, code: 'running-version-unparseable' })
    }
  })

  it('refuses a malformed recorded previous version instead of guessing', () => {
    const r = decideRollbackTarget({ runningVersion: RUNNING, history: [entry({ currentVersion: 'latest' })] })
    expect(r).toMatchObject({ available: false, code: 'target-version-unparseable' })
  })

  it('survives junk history without throwing', () => {
    for (const history of [null, undefined, 'nope', [null, 7, {}, { outcome: 'applied' }]]) {
      const r = decideRollbackTarget({ runningVersion: RUNNING, history: history as never })
      expect(r.available).toBe(false)
    }
  })

  it('always carries a Hebrew message when unavailable', () => {
    const r = decideRollbackTarget({ runningVersion: RUNNING })
    expect(r.message).toBeTruthy()
    expect(messageForRollbackCode('no-recorded-update')).toContain('גרסה קודמת')
    // Unknown codes still get user-safe copy rather than leaking a bare code.
    expect(messageForRollbackCode('something-new')).toBeTruthy()
  })
})

describe('selectRollbackRelease — finding the published older release', () => {
  const release = (tag: string, extra: Record<string, unknown> = {}) => ({ tag_name: tag, assets: [], ...extra })

  it('matches by parsed SemVer, so the v-prefix convention is not hardcoded', () => {
    expect(selectRollbackRelease({ releases: [release(`v${PREV}`)], target: PREV }).ok).toBe(true)
    expect(selectRollbackRelease({ releases: [release(PREV)], target: PREV }).ok).toBe(true)
  })

  it('skips drafts — a draft was never published, so nobody ever ran it', () => {
    const r = selectRollbackRelease({ releases: [release(`v${PREV}`, { draft: true })], target: PREV })
    expect(r).toMatchObject({ ok: false, code: 'release-absent' })
  })

  it('reports release-absent when the target is simply not there', () => {
    const r = selectRollbackRelease({ releases: [release(`v${RUNNING}`)], target: PREV })
    expect(r).toMatchObject({ ok: false, code: 'release-absent' })
  })

  it('distinguishes "gone" from "unreadable tags" — only the first is user-actionable', () => {
    const r = selectRollbackRelease({ releases: [release('nightly-build')], target: PREV })
    expect(r).toMatchObject({ ok: false, code: 'release-tag-unparseable' })
  })

  it('refuses an unparseable target outright', () => {
    expect(selectRollbackRelease({ releases: [release(`v${PREV}`)], target: 'newest' })).toMatchObject({
      ok: false,
      code: 'target-version-unparseable'
    })
  })

  it('survives a junk release list', () => {
    for (const releases of [null, undefined, 'nope', [null, 3, {}]]) {
      expect(selectRollbackRelease({ releases: releases as never, target: PREV }).ok).toBe(false)
    }
  })
})
