import { LoaderCircle, Save } from 'lucide-react'
import { FormEvent, useState } from 'react'
import { compileSchedule, parseSchedule, type FriendlySchedule } from '../../lib/schedule'
import type { ScheduledTask, TaskEditValues } from '../../types'
import { Modal } from '../ui/Modal'
import { ScheduleFields } from './ScheduleFields'

// Edit an existing scheduled task. The stored Hermes schedule string is parsed back
// into the friendly model so editing never exposes raw cron for the common cases;
// unrecognised schedules land in the "advanced" escape hatch (round-trip safe). Only
// the fields the form exposes are sent; the caller diffs them against the original so
// the atomic PUT never rewrites untouched fields. Enabling/disabling stays on the
// row's pause/resume toggle, matching Hermes' dedicated endpoints.
export function TaskEditDialog({
  task,
  onClose,
  onSave
}: {
  task: ScheduledTask
  onClose: () => void
  onSave: (updates: TaskEditValues) => Promise<void>
}) {
  const [form, setForm] = useState({ name: task.name, prompt: task.prompt })
  const [schedule, setSchedule] = useState<FriendlySchedule>(parseSchedule(task.schedule))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (schedule.mode === 'weekly' && schedule.days.length === 0) {
      setError('בחר לפחות יום אחד')
      return
    }
    const compiled = compileSchedule(schedule)
    if (!compiled) {
      setError('נדרש תזמון תקין (שעה/תאריך חסרים או שגויים)')
      return
    }
    setSaving(true)
    setError('')
    try {
      // Await the real Hermes save and close ONLY on success. A rejected edit keeps the
      // dialog open with the error, so the user never sees a closed dialog on a failed save.
      await onSave({ name: form.name.trim(), prompt: form.prompt, schedule: compiled })
      onClose()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'עדכון המשימה נכשל')
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
        <ScheduleFields value={schedule} onChange={setSchedule} />
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
