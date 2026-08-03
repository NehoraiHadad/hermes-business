import { describe, expect, it } from 'vitest'
import { createToast, resetToastSequence, toastReducer } from './toast'

describe('toast queue', () => {
  it('assigns increasing ids so every toast is distinguishable', () => {
    resetToastSequence()
    const a = createToast('first')
    const b = createToast('second')
    expect(b.id).toBeGreaterThan(a.id)
  })

  it('defaults to info severity', () => {
    expect(createToast('hello').severity).toBe('info')
  })

  it('show always replaces the current toast (replace-with-latest, not a stack)', () => {
    const a = createToast('first')
    const b = createToast('second')
    const afterA = toastReducer(null, { type: 'show', toast: a })
    const afterB = toastReducer(afterA, { type: 'show', toast: b })
    expect(afterB).toEqual(b)
  })

  it('dismiss clears the toast when the id matches the one on screen', () => {
    const a = createToast('first')
    const shown = toastReducer(null, { type: 'show', toast: a })
    expect(toastReducer(shown, { type: 'dismiss', id: a.id })).toBeNull()
  })

  it('dismiss is a no-op when a newer toast already replaced the one the timer was for', () => {
    // This is the exact race the old setTimeout-per-hook design allowed: toast A's
    // stale 2500ms timer must never blank toast B just because B arrived after A.
    const a = createToast('first')
    const b = createToast('second')
    const afterA = toastReducer(null, { type: 'show', toast: a })
    const afterB = toastReducer(afterA, { type: 'show', toast: b })
    // A's timer fires late and tries to dismiss by A's id.
    expect(toastReducer(afterB, { type: 'dismiss', id: a.id })).toEqual(b)
  })

  it('dismiss on an already-empty state stays empty', () => {
    expect(toastReducer(null, { type: 'dismiss', id: 1 })).toBeNull()
  })
})
