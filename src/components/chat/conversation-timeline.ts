import type { Activity, ChatMessage } from '../../types'

export type ConversationTimelineEntry =
  | { kind: 'message'; id: string; order: number; message: ChatMessage }
  | { kind: 'activity'; id: string; order: number; activity: Activity }

export function buildConversationTimeline(messages: ChatMessage[], activities: Activity[]): ConversationTimelineEntry[] {
  const legacyStart = Number.MIN_SAFE_INTEGER
  const entries: ConversationTimelineEntry[] = messages.map((message, index) => ({
    kind: 'message',
    id: message.id,
    order:
      message.timelineOrder ??
      (message.streaming && !message.text.trim() ? Number.MAX_SAFE_INTEGER : legacyStart + index),
    message
  }))

  for (const activity of activities) {
    entries.push({ kind: 'activity', id: activity.id, order: activity.timelineOrder, activity })
  }

  return entries.sort((left, right) => left.order - right.order)
}
