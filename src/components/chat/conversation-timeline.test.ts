import { describe, expect, it } from 'vitest'
import type { Activity, ChatMessage } from '../../types'
import { buildConversationTimeline } from './conversation-timeline'

describe('buildConversationTimeline', () => {
  it('places a tool before an assistant answer whose text arrived later', () => {
    const messages: ChatMessage[] = [
      { id: 'user', role: 'user', text: 'בדוק מייל', timelineOrder: 1 },
      { id: 'assistant', role: 'assistant', text: 'מצאתי', timelineOrder: 3 }
    ]
    const activities: Activity[] = [
      { id: 'tool', tool: 'gmail_search', label: 'מחפש הודעות ב־Gmail', status: 'done', timelineOrder: 2 }
    ]

    expect(buildConversationTimeline(messages, activities).map(entry => entry.id)).toEqual(['user', 'tool', 'assistant'])
  })

  it('keeps an empty streaming bubble after current tool activity', () => {
    const messages: ChatMessage[] = [{ id: 'assistant', role: 'assistant', text: '', streaming: true }]
    const activities: Activity[] = [
      { id: 'tool', tool: 'terminal', label: 'מריץ בדיקות', status: 'running', timelineOrder: 1 }
    ]

    expect(buildConversationTimeline(messages, activities).map(entry => entry.id)).toEqual(['tool', 'assistant'])
  })

  it('keeps resumed transcript messages before new live activity', () => {
    const messages: ChatMessage[] = [
      { id: 'old-user', role: 'user', text: 'שלום' },
      { id: 'old-assistant', role: 'assistant', text: 'היי' }
    ]
    const activities: Activity[] = [
      { id: 'tool', tool: 'memory', label: 'בודק פרטים מהזיכרון', status: 'running', timelineOrder: 4 }
    ]

    expect(buildConversationTimeline(messages, activities).map(entry => entry.id)).toEqual([
      'old-user',
      'old-assistant',
      'tool'
    ])
  })
})
