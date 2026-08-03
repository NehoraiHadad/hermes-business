import { describe, expect, it } from 'vitest'
import { TOOL_COPY_CASES, describeTool } from '../../shared/tool-copy.js'
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
