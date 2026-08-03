import { describe, expect, it } from 'vitest'
import { formatErrorDetails } from './ErrorBoundary'

describe('formatErrorDetails', () => {
  it('includes the message and stack for a real Error', () => {
    const error = new Error('boom')
    const details = formatErrorDetails(error)
    expect(details).toContain('boom')
    expect(details).toContain(error.stack!.split('\n')[0])
  })

  it('falls back to a Hebrew placeholder for an Error with no message', () => {
    const error = new Error('')
    error.stack = undefined
    expect(formatErrorDetails(error)).toBe('שגיאה ללא הודעה')
  })

  it('passes a non-empty thrown string through unchanged', () => {
    expect(formatErrorDetails('כשל בטעינה')).toBe('כשל בטעינה')
  })

  it('treats a blank thrown string as unknown', () => {
    expect(formatErrorDetails('   ')).toBe('שגיאה לא ידועה')
  })

  it('describes null/undefined as unknown', () => {
    expect(formatErrorDetails(null)).toBe('שגיאה לא ידועה')
    expect(formatErrorDetails(undefined)).toBe('שגיאה לא ידועה')
  })

  it('serializes a thrown plain object as JSON', () => {
    expect(formatErrorDetails({ code: 'EFAIL' })).toBe('{"code":"EFAIL"}')
  })

  it('stringifies a value that cannot be JSON-serialized', () => {
    const circular: Record<string, unknown> = {}
    circular.self = circular
    expect(formatErrorDetails(circular)).toBe(String(circular))
  })

  it('formats a thrown number', () => {
    expect(formatErrorDetails(42)).toBe('42')
  })
})
