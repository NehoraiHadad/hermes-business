import { afterEach, describe, expect, it, vi } from 'vitest'
import { TOOL_COPY_CASES, describeTool } from '../../shared/tool-copy.js'
import { approvalCopy, humanizeTool, redactDiagnosticText, timeAgo } from './presentation'

describe('timeAgo — shared relative-time copy (curator + partner feed)', () => {
  afterEach(() => vi.useRealTimers())

  it('covers each Hebrew bucket directly at its boundaries', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-08-04T12:00:00.000Z'))
    expect(timeAgo('2026-08-04T12:00:00.000Z')).toBe('לפני רגע')
    expect(timeAgo('2026-08-04T11:59:00.000Z')).toBe('לפני רגע') // 1 minute still "just now"
    expect(timeAgo('2026-08-04T11:58:00.000Z')).toBe('לפני 2 דקות')
    expect(timeAgo('2026-08-04T09:00:00.000Z')).toBe('לפני 3 שעות')
    expect(timeAgo('2026-08-01T12:00:00.000Z')).toBe('לפני 3 ימים')
  })

  it('is fail-closed on unusable input: empty string, not never-invented copy', () => {
    expect(timeAgo(null)).toBe('')
    expect(timeAgo(undefined)).toBe('')
    expect(timeAgo('not-a-date')).toBe('')
  })

  it('clamps a future timestamp to "just now" instead of a negative age', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-08-04T12:00:00.000Z'))
    expect(timeAgo('2026-08-04T12:05:00.000Z')).toBe('לפני רגע')
  })
})

describe('business presentation mapping', () => {
  it('turns internal tool names into plain-language activity', () => {
    expect(humanizeTool('google_calendar.list_events')).toBe('בודק אירועים ביומן')
    expect(humanizeTool('gmail.send_message')).toBe('שולח אימייל')
    expect(humanizeTool('google_workspace.gmail_search')).toBe('מחפש הודעות ב־Gmail')
    expect(humanizeTool('terminal', { arguments: { command: 'npm test' } })).toBe('מריץ בדיקות')
    expect(humanizeTool('terminal', { arguments: { command: 'rg -n TODO src' } })).toBe('מחפש בקבצי המחשב')
    expect(humanizeTool('terminal', { arguments: '{"command":"git status"}' })).toBe('בודק את שינויי הקוד')
    expect(humanizeTool('unknown_internal_tool')).toBe('מפעיל כלי: unknown internal tool')
  })

  it('frames approvals around user intent', () => {
    expect(approvalCopy({ command: 'gmail send --to dani@example.com' }).title).toContain('מייל')
  })

  it('removes common credential forms from diagnostics', () => {
    const input = 'url=/api/ws?token=abc123 sk-supersecret123456789 "api_key":"hello"'
    const output = redactDiagnosticText(input)
    expect(output).not.toContain('abc123')
    expect(output).not.toContain('sk-supersecret')
    expect(output).not.toContain('"hello"')
  })
})

// Cross-runtime contract: shared/tool-copy.js's CASES table is pinned here (React
// side, direct describeTool() calls — humanizeTool()'s own "action defaults to the
// tool name" quirk above is presentation.ts-specific and deliberately NOT part of
// this contract) and independently in
// hermes-plugin/business-shell/src/schedule-tool-copy.test.js (plugin side, run
// against the real plugin source). A drift on either side of the classifier fails a
// focused test instead of silently falling back to a generic "running a tool" line.
describe('describeTool — shared/tool-copy.js CASES contract', () => {
  it.each(TOOL_COPY_CASES)('$label', ({ name, action, command, text }) => {
    expect(describeTool(name, action, command)).toBe(text)
  })
})
