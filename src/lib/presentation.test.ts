import { describe, expect, it } from 'vitest'
import { approvalCopy, humanizeTool, redactDiagnosticText } from './presentation'

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
