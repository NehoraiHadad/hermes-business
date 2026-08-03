import { describe, expect, it } from 'vitest'
import { nextFocusIndex } from './focus-trap'

describe('nextFocusIndex', () => {
  it('returns -1 when the dialog has no focusable elements', () => {
    expect(nextFocusIndex(0, -1, false)).toBe(-1)
    expect(nextFocusIndex(0, 0, true)).toBe(-1)
  })

  it('moves forward through the list on Tab', () => {
    expect(nextFocusIndex(3, 0, false)).toBe(1)
    expect(nextFocusIndex(3, 1, false)).toBe(2)
  })

  it('wraps from the last element back to the first on Tab', () => {
    expect(nextFocusIndex(3, 2, false)).toBe(0)
  })

  it('treats focus outside the tracked set (-1) as before the first element on Tab', () => {
    expect(nextFocusIndex(3, -1, false)).toBe(0)
  })

  it('moves backward through the list on Shift+Tab', () => {
    expect(nextFocusIndex(3, 2, true)).toBe(1)
    expect(nextFocusIndex(3, 1, true)).toBe(0)
  })

  it('wraps from the first element back to the last on Shift+Tab', () => {
    expect(nextFocusIndex(3, 0, true)).toBe(2)
  })

  it('treats focus outside the tracked set (-1) as before the first element on Shift+Tab too', () => {
    expect(nextFocusIndex(3, -1, true)).toBe(2)
  })

  it('is stable for a single-focusable dialog (always lands back on it)', () => {
    expect(nextFocusIndex(1, 0, false)).toBe(0)
    expect(nextFocusIndex(1, 0, true)).toBe(0)
  })
})
