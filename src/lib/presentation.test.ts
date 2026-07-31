import { describe, expect, it } from 'vitest'
import { approvalCopy, humanizeTool, redactDiagnosticText } from './presentation'

describe('business presentation mapping', () => {
  it('turns internal tool names into plain-language activity', () => {
    expect(humanizeTool('google_calendar.list_events')).toBe('בודק את היומן…')
    expect(humanizeTool('gmail.send_message')).toBe('עובר על המייל…')
    expect(humanizeTool('unknown_internal_tool')).toBe('מתקדם במשימה…')
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
