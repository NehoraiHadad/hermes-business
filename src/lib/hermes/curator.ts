// Curator + learning-graph insights, surfaced as friendly notifications.
//
// The raw payloads come straight from Hermes' official endpoints (GET
// /api/curator and GET /api/learning/graph) via the desktop bridge; this module
// only *reshapes* them into human sentences. It never invents counts, skills or
// timestamps — if a field is absent, its notification is simply omitted, so the
// UI can only ever show things the agent actually reported.

import { timeAgo } from '../presentation'

export type CuratorStatus = {
  enabled?: boolean
  paused?: boolean
  interval_hours?: number | null
  last_run_at?: string | null
  min_idle_hours?: number | null
  stale_after_days?: number | null
  archive_after_days?: number | null
}

export type LearningStats = {
  learned_skills?: number
  nodes?: number
  memories?: number
}

export type LearningGraph = {
  nodes?: unknown[]
  categories?: Array<{ category: string; count: number }>
  stats?: LearningStats
}

// Exactly the shape the electron curator-insights bridge returns.
export type CuratorInsights = {
  available: boolean
  curator: CuratorStatus | null
  learning: LearningGraph | null
}

export type CuratorNotification = {
  id: string
  title: string
  detail?: string
  tone: 'success' | 'info' | 'muted'
}

// Turn the official payloads into friendly notifications. Order: learned-skills
// milestone first (most encouraging), then curator review status. Returns [] when
// nothing trustworthy is available — never a fabricated placeholder.
export function deriveCuratorNotifications(insights: CuratorInsights | null): CuratorNotification[] {
  if (!insights || !insights.available) return []
  const notifications: CuratorNotification[] = []

  const learnedRaw = insights.learning?.stats?.learned_skills
  const learned = typeof learnedRaw === 'number' && Number.isFinite(learnedRaw) ? learnedRaw : 0
  if (learned > 0) {
    notifications.push({
      id: 'learning-skills',
      title:
        learned === 1
          ? 'העוזר למד תהליך חדש אחד מהעבודה איתך'
          : `העוזר למד ${learned} תהליכים חדשים מהעבודה איתך`,
      detail: 'Hermes שומר וממשיך לחדד אותם ברקע.',
      tone: 'success'
    })
  }

  const curator = insights.curator
  if (curator) {
    if (curator.paused) {
      notifications.push({
        id: 'curator-paused',
        title: 'סקירת הידע מושהית',
        detail: 'ניתן להפעיל אותה מחדש בממשק המלא של Hermes.',
        tone: 'muted'
      })
    } else if (curator.last_run_at) {
      const ago = timeAgo(curator.last_run_at)
      notifications.push({
        id: 'curator-last-run',
        title: 'העוזר סקר וסידר את הידע שלו',
        detail: ago ? `הסקירה האחרונה ${ago}.` : 'הסקירה רצה אוטומטית ברקע.',
        tone: 'info'
      })
    }
  }

  return notifications
}
