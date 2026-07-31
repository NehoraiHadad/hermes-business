import { LoaderCircle, Save } from 'lucide-react'
import { FormEvent, useState } from 'react'
import { humanSchedule } from '../../lib/presentation'
import type { ScheduledTask, TaskEditValues } from '../../types'
import { Modal } from '../ui/Modal'

// Edit an existing scheduled task. Only the fields the form exposes are sent
// (name/prompt/schedule); the caller diffs them against the original so the
// atomic PUT never rewrites untouched fields. Enabling/disabling stays on the
// row's pause/resume toggle, matching Hermes' dedicated endpoints.
export function TaskEditDialog({
  task,
  onClose,
  onSave
}: {
  task: ScheduledTask
  onClose: () => void
  onSave: (updates: TaskEditValues) => void
}) {
  const [form, setForm] = useState<TaskEditValues>({
    name: task.name,
    prompt: task.prompt,
    schedule: task.schedule
  })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const submit = (event: FormEvent) => {
    event.preventDefault()
    if (!form.schedule.trim()) {
      setError('נדרש תזמון (ביטוי cron)')
      return
    }
    setSaving(true)
    setError('')
    try {
      onSave({ name: form.name.trim(), prompt: form.prompt, schedule: form.schedule.trim() })
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal title="עריכת משימה" subtitle="שינויים נשמרים ב־Hermes ומשפיעים על הריצה הבאה." onClose={onClose}>
      <form className="modal-form" onSubmit={submit}>
        <label>
          <span>שם המשימה</span>
          <input required value={form.name} onChange={event => setForm({ ...form, name: event.target.value })} />
        </label>
        <label>
          <span>מה העוזר יעשה?</span>
          <textarea
            required
            rows={4}
            value={form.prompt}
            onChange={event => setForm({ ...form, prompt: event.target.value })}
          />
        </label>
        <label>
          <span>תזמון (cron)</span>
          <input
            required
            value={form.schedule}
            onChange={event => setForm({ ...form, schedule: event.target.value })}
            placeholder="0 8 * * 1-5"
          />
          <small className="field-hint">{humanSchedule(form.schedule) || 'הזן ביטוי cron תקין'}</small>
        </label>
        {error ? <p className="form-error">{error}</p> : null}
        <div className="modal__actions">
          <button type="button" className="ghost-button" onClick={onClose}>
            ביטול
          </button>
          <button className="primary-button" disabled={saving}>
            {saving ? <LoaderCircle className="spin" size={16} /> : <Save size={16} />}
            שמור שינויים
          </button>
        </div>
      </form>
    </Modal>
  )
}
