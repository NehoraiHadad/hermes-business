import { describe, expect, it } from 'vitest'
import { SCHEDULE_DISPLAY_CASES } from '../../../shared/schedule-display.js'
import { TOOL_COPY_CASES, describeTool } from '../../../shared/tool-copy.js'
import { friendlyToolName, humanSchedule } from './helpers.js'

// Cross-runtime contract guard, plugin side. src/lib/schedule.ts and
// src/lib/presentation.ts pin the SAME shared/*.js CASES tables (see
// src/lib/schedule.test.ts and src/lib/presentation.test.ts) — this file exercises
// the real plugin source (not the bundled artifact; helpers.js has no JSX and no
// module-load side effects, so vitest can import it directly, same as
// cron-normalize.test.js does for cron-normalize.js). A drift on either side fails
// a focused test here instead of silently rendering raw cron / a generic fallback.

describe('helpers.humanSchedule stays in sync with shared/schedule-display.js', () => {
  for (const { label, schedule, text } of SCHEDULE_DISPLAY_CASES) {
    if (!schedule) continue // empty input is the plugin's own "no schedule" copy, covered below
    it(`renders the shared display text: ${label}`, () => {
      expect(humanSchedule(schedule)).toBe(text)
    })
  }

  it('falls back to the plugin-specific "no schedule" copy on an empty/opaque value', () => {
    expect(humanSchedule('')).toBe('לפי לוח הזמנים של Hermes')
    expect(humanSchedule({ kind: 'cron', minute: 0, hour: 9 })).toBe('לפי לוח הזמנים של Hermes')
  })

  it('still accepts the official schedule_display/display/expr/cron/value wrapper shapes', () => {
    expect(humanSchedule({ schedule_display: '0 9 * * *' })).toBe('כל יום בשעה 09:00')
    expect(humanSchedule({ expr: '0 8 * * 0-4' })).toBe('ימים א׳–ה׳ בשעה 08:00')
  })
})

describe('helpers.friendlyToolName gains shared/tool-copy.js fidelity beyond its own 8 keys', () => {
  it('keeps its own short in-progress copy for the tool names it already recognises', () => {
    // Pinned verbatim — these must never change here without also updating the
    // shipped-bundle expectations in src/lib/plugin-source.test.ts.
    expect(friendlyToolName('google_calendar.list_events')).toBe('בודק את היומן…')
    expect(friendlyToolName('google_workspace.gmail_search')).toBe('עובד עם המייל…')
  })

  it('delegates every other tool name to the shared classifier (new coverage)', () => {
    expect(friendlyToolName('web_search')).toBe(describeTool('web_search'))
    expect(friendlyToolName('memory_get')).toBe(describeTool('memory_get'))
    expect(friendlyToolName('todo_list')).toBe(describeTool('todo_list'))
    expect(friendlyToolName('read_file')).toBe(describeTool('read_file'))
    expect(friendlyToolName('write_file')).toBe(describeTool('write_file'))
  })

  it('falls back to the plugin default only when the shared classifier finds no category', () => {
    expect(describeTool('unknown_internal_tool')).toBeNull()
    expect(friendlyToolName('unknown_internal_tool')).toBe('מבצע פעולה…')
  })
})

describe('describeTool CASES contract (shared/tool-copy.js), exercised on the plugin side', () => {
  for (const { label, name, action, command, text } of TOOL_COPY_CASES) {
    it(`classifies: ${label}`, () => {
      expect(describeTool(name, action, command)).toBe(text)
    })
  }
})
