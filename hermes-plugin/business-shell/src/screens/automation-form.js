import { useState } from 'react'
import { Button, host } from '@hermes/plugin-sdk'
import { h } from '../dom.js'
import { Card, Field } from '../ui.js'

// The "new scheduled task" composer. It offers human-friendly presets but persists
// everything through the official Hermes cron.manage door, then asks the parent to
// refresh its list via onCreated.
export function NewTaskForm({ onCreated }) {
  const [name, setName] = useState('')
  const [schedule, setSchedule] = useState('0 8 * * 0-4')
  const [prompt, setPrompt] = useState('')
  const [saving, setSaving] = useState(false)

  async function create() {
    if (!name.trim() || !prompt.trim()) return
    setSaving(true)
    try {
      await host.request('cron.manage', { action: 'add', name: name.trim(), schedule, prompt: prompt.trim() })
      host.notify({ kind: 'success', title: 'המשימה נוצרה', message: 'היא מופיעה גם במסך Cron המלא.' })
      setName('')
      setPrompt('')
      onCreated()
    } catch (error) {
      host.notifyError(error, 'לא הצלחנו ליצור משימה')
    } finally {
      setSaving(false)
    }
  }

  return h(
    Card,
    null,
    h('h3', { className: 'mb-3 text-sm font-semibold text-(--ui-text-primary)' }, 'משימה חדשה'),
    h(
      'div',
      { className: 'grid gap-3' },
      h(Field, { label: 'שם', name: 'name', value: name, onChange: (_, value) => setName(value), placeholder: 'סיכום בוקר' }),
      h(
        'label',
        { className: 'grid gap-1.5' },
        h('span', { className: 'text-xs font-medium text-(--ui-text-secondary)' }, 'מתי'),
        h(
          'select',
          {
            value: schedule,
            onChange: event => setSchedule(event.target.value),
            className:
              'h-8 rounded-[4px] border border-(--ui-stroke-secondary) bg-(--ui-bg-primary) px-2 text-xs text-(--ui-text-primary)'
          },
          h('option', { value: '0 8 * * 0-4' }, 'ימים א׳–ה׳ בשעה 08:00'),
          h('option', { value: '0 9 * * *' }, 'כל יום בשעה 09:00'),
          h('option', { value: '0 9 * * 0' }, 'כל יום ראשון בשעה 09:00')
        )
      ),
      h(Field, {
        label: 'מה Hermes יעשה?',
        name: 'prompt',
        value: prompt,
        multiline: true,
        onChange: (_, value) => setPrompt(value),
        placeholder: 'סכם את הפגישות והמשימות החשובות להיום'
      }),
      h(Button, { disabled: saving || !name.trim() || !prompt.trim(), onClick: create }, saving ? 'יוצר…' : 'צור משימה')
    )
  )
}
