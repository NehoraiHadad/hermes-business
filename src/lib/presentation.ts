import { describeTool } from '../../shared/tool-copy.js'
import { humanizeSchedule } from './schedule'

// Tool-name/action → Hebrew activity-label RULES now live in
// ../../shared/tool-copy.js so the Rollup-bundled Hermes Desktop plugin
// (hermes-plugin/business-shell/src/helpers.js) can render the same ~50-rule
// fidelity from a bare tool name, instead of its own 8-substring lookup. This file
// keeps the React-specific payload-shape extraction (toolArguments below — agent
// tool-call payloads carry action/command in several different shapes) and the
// final generic-tool fallback copy; only the classification table is shared.

type ToolPayload = Record<string, unknown>

function toolArguments(payload: ToolPayload): ToolPayload {
  const value = payload.arguments || payload.args || payload.input || payload.parameters
  if (typeof value === 'string') {
    try {
      const parsed: unknown = JSON.parse(value)
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as ToolPayload) : {}
    } catch {
      return {}
    }
  }
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as ToolPayload) : {}
}

function readableToolName(name: string) {
  const leaf = name.split(/[.:/]/).filter(Boolean).at(-1) || ''
  const readable = leaf.replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim()
  return /^[\p{L}\p{N} ]{1,48}$/u.test(readable) ? readable : ''
}

export function humanizeTool(name: string, payload: ToolPayload = {}): string {
  const normalized = name.toLowerCase()
  const args = toolArguments(payload)
  const action = String(payload.action || args.action || normalized).toLowerCase()
  const command = String(payload.command || args.command || args.cmd || args.script || '')

  const described = describeTool(normalized, action, command)
  if (described) return described

  const readable = readableToolName(name)
  return readable ? `מפעיל כלי: ${readable}` : 'מפעיל כלי עזר למשימה'
}

export function approvalCopy(payload: Record<string, unknown>) {
  const command = String(payload.command || '')
  const reason = String(payload.reason || payload.description || '')
  const isMail = /gmail|email|mail|send/i.test(`${command} ${reason}`)
  const isCalendar = /calendar|event|meeting/i.test(`${command} ${reason}`)
  if (isMail) {
    return {
      title: 'העוזר רוצה לשלוח מייל',
      description: reason || 'נדרש אישור לפני שליחת ההודעה.'
    }
  }
  if (isCalendar) {
    return {
      title: 'העוזר רוצה לעדכן את היומן',
      description: reason || 'נדרש אישור לפני יצירת או שינוי אירוע.'
    }
  }
  return {
    title: 'העוזר מבקש אישור לפעולה',
    description: reason || 'כדאי לבדוק את פרטי הפעולה לפני שממשיכים.'
  }
}

export function humanSchedule(schedule: string): string {
  if (/^every\s+/i.test(schedule)) return schedule.replace(/^every\s+/i, 'כל ')
  return humanizeSchedule(schedule)
}

// Present a UTC/ISO timestamp as a short Hebrew "time ago", or '' if unusable. Shared
// by src/lib/hermes/curator.ts and the partner-feed UI (docs/specs/partner-feed.md
// §6.1) so both surfaces render identical relative-time copy from one place.
export function timeAgo(iso: string | null | undefined): string {
  if (!iso) return ''
  const then = Date.parse(iso)
  if (Number.isNaN(then)) return ''
  const minutes = Math.max(0, Math.round((Date.now() - then) / 60000))
  if (minutes < 60) return minutes <= 1 ? 'לפני רגע' : `לפני ${minutes} דקות`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `לפני ${hours} שעות`
  const days = Math.round(hours / 24)
  return `לפני ${days} ימים`
}

export function redactDiagnosticText(text: string): string {
  return text
    .replace(/([?&](?:token|ticket)=)[^&\s]+/gi, '$1<redacted>')
    .replace(/\b(sk-[A-Za-z0-9_-]{12,}|AIza[A-Za-z0-9_-]{20,}|\d{7,}:[A-Za-z0-9_-]{20,})\b/g, '<redacted>')
    .replace(/("(?:api_key|token|secret|password)"\s*:\s*")[^"]+(")/gi, '$1<redacted>$2')
}
