import { useState } from 'react'
import { Button, host } from '@hermes/plugin-sdk'
import { h } from '../dom.js'
import { Card, Field } from '../ui.js'
import { EMPTY_ONBOARDING, ONBOARDING_STEPS, STORAGE_KEYS, normalizeOnboarding } from '../../../../shared/onboarding-contract.js'
import { buildBootstrapPrompt } from '../../../../shared/onboarding-bootstrap.js'
import { submitBusinessBootstrap } from '../bootstrap-session.js'

// A quick fallback questionnaire used only when the guided setup session cannot
// start. Field keys and defaults come from the shared canonical contract, so any
// previously persisted (legacy-key) answers are migrated on load, and on save it
// opens one real Hermes session that persists facts through Memory/Profile and a
// business-context Skill — never a giant system prompt.

export function Onboarding({ storage, onDone, onCancel }) {
  const [step, setStep] = useState(0)
  const [saving, setSaving] = useState(false)
  const [form, setForm] = useState(() => normalizeOnboarding(storage.get(STORAGE_KEYS.form, EMPTY_ONBOARDING)))
  const update = (name, value) => setForm(current => ({ ...current, [name]: value }))
  const page = ONBOARDING_STEPS[step]

  async function save() {
    setSaving(true)
    try {
      storage.set(STORAGE_KEYS.form, form)
      const prompt = buildBootstrapPrompt({ data: form })
      const created = await host.request('session.create', {
        title: `היכרות עם ${form.businessName || 'העסק'}`,
        source: 'desktop'
      })
      await submitBusinessBootstrap(created.session_id, prompt)
      storage.set(STORAGE_KEYS.pluginComplete, true)
      host.notify({
        kind: 'success',
        title: 'Hermes התחיל ללמוד את העסק',
        message: 'השיחה נשמרת ותופיע גם ברשימת השיחות הרגילה.'
      })
      onDone()
      if (created.stored_session_id) host.navigate(`/${encodeURIComponent(created.stored_session_id)}`)
    } catch (error) {
      host.notifyError(error, 'לא הצלחנו לשמור את ההיכרות')
    } finally {
      setSaving(false)
    }
  }

  return h(
    'div',
    { className: 'mx-auto max-w-2xl' },
    h(
      'div',
      { className: 'mb-6 flex items-center justify-between gap-4' },
      h(
        'div',
        null,
        h(
          'div',
          { className: 'text-[0.6875rem] font-semibold text-primary' },
          `שלב ${step + 1} מתוך ${ONBOARDING_STEPS.length}`
        ),
        h('h1', { className: 'mt-1 text-xl font-semibold text-(--ui-text-primary)' }, page.title),
        h('p', { className: 'mt-1 text-xs text-(--ui-text-tertiary)' }, page.copy)
      ),
      h(Button, { variant: 'text', onClick: onCancel }, 'סגירה')
    ),
    h(
      Card,
      null,
      h(
        'div',
        { className: 'grid gap-4 sm:grid-cols-2' },
        ...page.fields.map(({ key, label, multiline }) =>
          h(Field, {
            key,
            label,
            name: key,
            multiline,
            value: Array.isArray(form[key]) ? form[key].join(', ') : form[key] || '',
            onChange: update
          })
        )
      ),
      h(
        'div',
        { className: 'mt-6 flex items-center justify-between border-t border-(--ui-stroke-secondary) pt-4' },
        h(
          Button,
          { variant: 'outline', disabled: step === 0 || saving, onClick: () => setStep(current => current - 1) },
          'הקודם'
        ),
        step < ONBOARDING_STEPS.length - 1
          ? h(Button, { onClick: () => setStep(current => current + 1) }, 'המשך')
          : h(Button, { disabled: saving, onClick: save }, saving ? 'Hermes לומד…' : 'שמור והמשך לשיחה')
      )
    )
  )
}
