import React, { useEffect, useState } from 'react'
import { makomStyle } from './makom-style.js'
const h = React.createElement

// One accessible connection flow for Companion and the native Desktop plugin.
// api is namespace-bound by the host; this component never fetches external URLs.
export function MakomForm({ api, onChanged = () => {} }) {
  const [data, setData] = useState(null)
  const [selected, setSelected] = useState(['default'])
  const [link, setLink] = useState('')
  const [resolved, setResolved] = useState(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  useEffect(() => {
    let alive = true
    api('/makom').then(value => { if (alive) setData(value) }).catch(() => {
      if (alive) setError('לא הצלחנו לקרוא את החיבורים. ודאו ש־Hermes פועל ונסו שוב.')
    })
    return () => { alive = false }
  }, [api])
  async function act(work) {
    setBusy(true); setError(''); setMessage('')
    try { await work() } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'הפעולה לא הושלמה. רעננו ובדקו את מצב החיבור.')
    } finally { setBusy(false) }
  }
  async function reload() {
    const value = await api('/makom'); setData(value)
    onChanged(value.profiles.some(row => row.connected))
  }
  const configured = data?.profiles.filter(row => selected.includes(row.id) && row.binding) || []
  return h('div', { className: 'modal-form makom-form', dir: 'rtl' },
    h('style', null, makomStyle),
    h('p', null, 'קריאת מידע ציבורי עדכני מהקהילה: תפילות, שעות פעילות ואירועים. אין צורך בטוקן.'),
    h('label', null, h('span', null, 'קישור לקהילה במקום'), h('input', {
      type: 'url', dir: 'ltr', value: link, disabled: busy,
      placeholder: 'https://…/public/…',
      onChange: event => { setLink(event.target.value); setResolved(null); setMessage('') }
    })),
    h('button', { type: 'button', className: 'outline-button', disabled: busy || !link.trim(),
      onClick: () => act(async () => { setResolved(await api('/makom/resolve', { method: 'POST', body: { link } })) })
    }, busy ? 'בודק…' : 'בדיקת הקהילה'),
    resolved ? h('p', { role: 'status' }, 'נמצאה הקהילה: ', h('strong', null, resolved.name), ' · קריאה בלבד') : null,
    data ? h('fieldset', { disabled: busy },
      h('legend', null, 'באילו מרחבים להשתמש במידע?'),
      ...data.profiles.map(row => h('label', { key: row.id, className: 'makom-profile' },
        h('input', { type: 'checkbox', checked: selected.includes(row.id),
          onChange: event => setSelected(previous => event.target.checked ? [...previous, row.id] : previous.filter(id => id !== row.id)) }),
        h('span', null, row.label, row.binding ? ` — ${row.binding.name} (${row.connected ? 'נבדק וזמין' : 'הוגדר; לא ניתן לאמת כרגע'})` : '')
      ))
    ) : error ? null : h('p', { role: 'status' }, 'טוען מרחבים…'),
    resolved && configured.length ? h('p', null, 'החיבור הקודם במרחבים שנבחרו יוחלף בחיבור לקהילה הזאת.') : null,
    h('p', null, 'החיבור אינו מפעיל מענה בווטסאפ ואינו משנה את הרשאות הקבוצות. לאחר חיבור, התחילו שיחה חדשה כדי לטעון את הכלים.'),
    error ? h('p', { className: 'form-error', role: 'alert' }, error) : null,
    message ? h('p', { role: 'status' }, message) : null,
    h('div', { className: 'modal__actions' },
      h('button', { type: 'button', className: 'primary-button', disabled: busy || !resolved || !data || !selected.length,
        onClick: () => act(async () => {
          await api('/makom/connect', { method: 'POST', body: { link, profiles: selected } })
          await reload(); setMessage(`חובר ל${resolved.name}. המידע נבדק והסקיל הותקן במרחבים שנבחרו.`)
        })
      }, busy ? 'מבצע…' : 'חיבור מקום'),
      h('button', { type: 'button', className: 'ghost-button', disabled: busy || !configured.length,
        onClick: () => act(async () => {
          await api('/makom/disconnect', { method: 'POST', body: { profiles: configured.map(row => row.id) } })
          await reload(); setMessage('החיבור והסקיל הוסרו מהמרחבים שנבחרו. חיבורים אחרים לא השתנו.')
        })
      }, 'ניתוק מהמרחבים שנבחרו')
    ),
    h('button', { type: 'button', className: 'ghost-button', disabled: busy,
      onClick: () => act(reload) }, 'רענון מצב החיבור')
  )
}
