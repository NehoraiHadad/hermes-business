import { useEffect, useState } from 'react'
import { Button, Loader, host } from '@hermes/plugin-sdk'
import { h } from './dom.js'
import { Card } from './ui.js'
import { GUIDED_SETUP_VERSION, startGuidedSetup } from './guided-setup.js'
import { Overview } from './screens/overview.js'
import { Onboarding } from './screens/onboarding.js'
import { Connections } from './screens/connections.js'
import { Automations } from './screens/automations.js'
import { Support } from './screens/support.js'

// The top-level shell: RTL layout, tab navigation, guided-setup orchestration and
// the fallback quick onboarding. Screens themselves live in ./screens.
export function BusinessShell({ storage }) {
  const [view, setView] = useState('home')
  const [onboarding, setOnboarding] = useState(false)
  const [guidedSetupBusy, setGuidedSetupBusy] = useState(false)
  const [guidedSetupError, setGuidedSetupError] = useState('')
  const nav = [
    ['home', 'בית'],
    ['automations', 'משימות'],
    ['connections', 'חיבורים'],
    ['support', 'תמיכה']
  ]

  async function openGuidedSetup(force = false) {
    setGuidedSetupBusy(true)
    setGuidedSetupError('')
    try {
      await startGuidedSetup(storage, { force })
    } catch (error) {
      setGuidedSetupError(String(error?.message || error))
    } finally {
      setGuidedSetupBusy(false)
    }
  }

  useEffect(() => {
    const setup = storage.get('guidedSetup', {})
    if (setup?.version === GUIDED_SETUP_VERSION && ['starting', 'active', 'complete'].includes(setup?.status)) {
      return
    }
    void openGuidedSetup(false)
  }, [storage])

  return h(
    'main',
    {
      dir: 'rtl',
      lang: 'he',
      className: 'h-full min-h-0 overflow-auto bg-(--ui-bg-primary) text-(--ui-text-primary)'
    },
    h(
      'div',
      { className: 'mx-auto min-h-full w-full max-w-6xl px-5 py-5 sm:px-7' },
      h(
        'nav',
        {
          'aria-label': 'ניווט עסקי',
          className: 'mb-6 flex flex-wrap items-center gap-1 border-b border-(--ui-stroke-secondary) pb-2'
        },
        ...nav.map(([id, label]) =>
          h(
            Button,
            {
              key: id,
              variant: view === id ? 'secondary' : 'ghost',
              size: 'sm',
              onClick: () => {
                setOnboarding(false)
                setView(id)
              }
            },
            label
          )
        ),
        h('span', { className: 'flex-1' }),
        h(Button, { variant: 'textStrong', size: 'inline', onClick: () => host.navigate('/') }, 'פתח את Hermes המלא')
      ),
      guidedSetupBusy
        ? h(
            Card,
            { className: 'mb-4' },
            h(
              'div',
              { className: 'flex items-center gap-3 text-sm text-(--ui-text-secondary)' },
              h(Loader, { type: 'lemniscate-bloom', className: 'size-4' }),
              h('span', null, 'מכין שיחת היכרות אישית עם העוזר…')
            )
          )
        : guidedSetupError
          ? h(
              Card,
              { className: 'mb-4' },
              h('h2', { className: 'text-sm font-semibold text-(--ui-text-primary)' }, 'לא הצלחנו להתחיל את ההיכרות'),
              h(
                'p',
                { className: 'mt-1 text-xs leading-5 text-(--ui-text-tertiary)' },
                'אפשר לנסות שוב, או להשתמש זמנית בטופס המהיר.'
              ),
              h(
                'div',
                { className: 'mt-3 flex gap-2' },
                h(Button, { onClick: () => openGuidedSetup(true) }, 'נסה שוב'),
                h(Button, { variant: 'outline', onClick: () => setOnboarding(true) }, 'טופס מהיר')
              )
            )
          : null,
      onboarding
        ? h(Onboarding, { storage, onDone: () => setOnboarding(false), onCancel: () => setOnboarding(false) })
        : view === 'automations'
          ? h(Automations, { storage })
          : view === 'connections'
            ? h(Connections)
            : view === 'support'
              ? h(Support, { storage })
          : h(Overview, { storage, onOnboarding: () => openGuidedSetup(false) })
    )
  )
}
