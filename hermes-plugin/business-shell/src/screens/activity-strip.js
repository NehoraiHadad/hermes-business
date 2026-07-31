import { useEffect, useState } from 'react'
import { Loader, host } from '@hermes/plugin-sdk'
import { h } from '../dom.js'
import { friendlyToolName } from '../helpers.js'

// A slim live banner that translates raw Hermes tool events into friendly Hebrew
// activity copy, and surfaces a notification when the agent learns a new Skill.
export function ActivityStrip() {
  const [activity, setActivity] = useState('')

  useEffect(() => {
    const stopStart = host.onEvent('tool.start', event => {
      const payload = event?.payload || event || {}
      setActivity(friendlyToolName(payload.name || payload.tool_name || payload.tool))
    })
    const stopDone = host.onEvent('tool.complete', event => {
      const payload = event?.payload || event || {}
      const tool = String(payload.name || payload.tool_name || payload.tool || '').toLowerCase()
      const action = String(payload.arguments?.action || payload.args?.action || '').toLowerCase()
      if (tool === 'skill_manage' && ['create', 'edit', 'patch', 'write_file'].includes(action)) {
        host.notify({
          kind: 'success',
          title: 'Hermes למד תהליך חדש',
          message: 'ה־Skill זמין גם בממשק המלא.'
        })
      }
      setActivity('')
    })
    const stopError = host.onEvent('error', () => setActivity(''))

    return () => {
      stopStart()
      stopDone()
      stopError()
    }
  }, [])

  if (!activity) return null

  return h(
    'div',
    {
      className:
        'mb-4 flex items-center gap-2 rounded-[5px] border border-primary/20 bg-primary/5 px-3 py-2 text-xs text-(--ui-text-secondary)'
    },
    h(Loader, { type: 'lemniscate-bloom', className: 'size-4' }),
    h('span', null, activity)
  )
}
