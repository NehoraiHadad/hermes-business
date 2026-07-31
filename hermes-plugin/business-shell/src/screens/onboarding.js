import { useState } from 'react'
import { Button, host } from '@hermes/plugin-sdk'
import { h } from '../dom.js'
import { Card, Field } from '../ui.js'

// A quick fallback questionnaire used only when the guided setup session cannot
// start. On save it opens one real Hermes session that persists the facts through
// Memory/Profile and a business-context Skill — never a giant system prompt.

const EMPTY_ONBOARDING = {
  name: '',
  role: '',
  language: 'עברית',
  answerStyle: 'קצר ומעשי',
  workHours: '',
  approvals: 'שליחת הודעות, התחייבויות כספיות ומחיקת מידע',
  repetitiveTasks: '',
  businessName: '',
  industry: '',
  offerings: '',
  customers: '',
  openingHours: '',
  voice: '',
  forbiddenPromises: '',
  processes: '',
  systems: ''
}

const PAGES = [
  {
    title: 'נעים להכיר',
    copy: 'כמה פרטים שיעזרו ל־Hermes לעבוד כמו שמתאים לך.',
    fields: [
      ['שם', 'name'],
      ['תפקיד', 'role'],
      ['שפה מועדפת', 'language'],
      ['סגנון תשובות', 'answerStyle'],
      ['שעות עבודה', 'workHours']
    ]
  },
  {
    title: 'העסק',
    copy: 'המידע יישמר ב־Memory וב־Skill של Hermes, לא ב־prompt ענקי.',
    fields: [
      ['שם העסק', 'businessName'],
      ['תחום פעילות', 'industry'],
      ['שירותים ומוצרים', 'offerings', true],
      ['סוגי לקוחות', 'customers'],
      ['שעות פעילות', 'openingHours']
    ]
  },
  {
    title: 'איך נכון לעבוד',
    copy: 'גבולות ברורים ותהליכים שהעוזר יכול לחסוך.',
    fields: [
      ['פעולות שדורשות אישור', 'approvals', true],
      ['סגנון התקשורת של העסק', 'voice', true],
      ['מגבלות והתחייבויות שאסור לתת', 'forbiddenPromises', true],
      ['תהליכים חוזרים', 'processes', true],
      ['מערכות וקבצים בשימוש', 'systems', true],
      ['משימות שתרצה לחסוך', 'repetitiveTasks', true]
    ]
  }
]

export function Onboarding({ storage, onDone, onCancel }) {
  const [step, setStep] = useState(0)
  const [saving, setSaving] = useState(false)
  const [form, setForm] = useState(() => storage.get('onboarding', EMPTY_ONBOARDING))
  const update = (name, value) => setForm(current => ({ ...current, [name]: value }))
  const page = PAGES[step]

  async function save() {
    setSaving(true)
    try {
      storage.set('onboarding', form)
      const prompt = [
        'זו משימת onboarding מפורשת שאושרה על ידי המשתמש.',
        'שמור את עובדות המשתמש הקצרות והיציבות באמצעות מנגנון ה-memory/profile הרשמי של Hermes.',
        'צור או עדכן Skill בשם business-context עבור ההקשר העסקי המפורט והתהליכים החוזרים.',
        'אל תשמור secrets. אל תיצור system prompt. אל תבצע פעולות חיצוניות.',
        '',
        JSON.stringify(form, null, 2),
        '',
        'בסיום, סכם בקצרה מה נשמר ואיפה.'
      ].join('\n')
      const created = await host.request('session.create', {
        title: `היכרות עם ${form.businessName || 'העסק'}`,
        source: 'desktop'
      })
      await host.request('prompt.submit', { session_id: created.session_id, text: prompt })
      storage.set('onboardingComplete', true)
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
        h('div', { className: 'text-[0.6875rem] font-semibold text-primary' }, `שלב ${step + 1} מתוך ${PAGES.length}`),
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
        ...page.fields.map(([label, name, multiline]) =>
          h(Field, {
            key: name,
            label,
            name,
            multiline,
            value: form[name] || '',
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
        step < PAGES.length - 1
          ? h(Button, { onClick: () => setStep(current => current + 1) }, 'המשך')
          : h(Button, { disabled: saving, onClick: save }, saving ? 'Hermes לומד…' : 'שמור והמשך לשיחה')
      )
    )
  )
}
