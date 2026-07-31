import { CalendarClock, LoaderCircle } from 'lucide-react'
import { FormEvent, useState } from 'react'
import { buildCron } from '../../lib/schedule'
import type { ScheduledTask } from '../../types'
import { Modal } from '../ui/Modal'

export function TaskModal({
  onClose,
  onCreate
}: {
  onClose: () => void
  onCreate: (task: Pick<ScheduledTask, 'name' | 'prompt' | 'schedule'>) => Promise<void>
}) {
  const [form, setForm] = useState({ name: '', prompt: '', days: 'weekdays', time: '08:00' })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const submit = async (event: FormEvent) => {
    event.preventDefault()
    setSaving(true)
    setError('')
    try {
      const schedule = buildCron(form.days, form.time)
      await onCreate({ name: form.name, prompt: form.prompt, schedule })
      onClose()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Hermes לא הצליח ליצור את המשימה')
    } finally {
      setSaving(false)
    }
  }
  return (
    <Modal title="משימה מתוזמנת חדשה" subtitle="פשוט אומרים מה לעשות ומתי — Hermes מנהל את התזמון." onClose={onClose}>
      <form className="modal-form" onSubmit={submit}>
        <label>
          <span>שם המשימה</span>
          <input
            required
            value={form.name}
            onChange={event => setForm({ ...form, name: event.target.value })}
            placeholder="למשל: סיכום בוקר"
          />
        </label>
        <label>
          <span>מה העוזר יעשה?</span>
          <textarea
            required
            rows={4}
            value={form.prompt}
            onChange={event => setForm({ ...form, prompt: event.target.value })}
            placeholder="סכם את הפגישות, המיילים החשובים והמשימות להיום"
          />
        </label>
        <div className="form-row">
          <label>
            <span>ימים</span>
            <select value={form.days} onChange={event => setForm({ ...form, days: event.target.value })}>
              <option value="weekdays">ימים א׳–ה׳</option>
              <option value="daily">כל יום</option>
            </select>
          </label>
          <label>
            <span>שעה</span>
            <input type="time" value={form.time} onChange={event => setForm({ ...form, time: event.target.value })} />
          </label>
        </div>
        {error ? <p className="form-error">{error}</p> : null}
        <div className="modal__actions">
          <button type="button" className="ghost-button" onClick={onClose}>
            ביטול
          </button>
          <button className="primary-button" disabled={saving}>
            {saving ? <LoaderCircle className="spin" size={16} /> : <CalendarClock size={16} />}
            צור משימה
          </button>
        </div>
      </form>
    </Modal>
  )
}
