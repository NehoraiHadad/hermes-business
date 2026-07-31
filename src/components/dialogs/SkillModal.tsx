import { LoaderCircle, Sparkles } from 'lucide-react'
import { useState } from 'react'
import { Modal } from '../ui/Modal'

export function SkillModal({
  onClose,
  onCreate
}: {
  onClose: () => void
  onCreate: (name: string, description: string) => Promise<void>
}) {
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  return (
    <Modal title="למד את העוזר תהליך חדש" subtitle="Hermes ישמור את התהליך כ־Skill באותו Profile." onClose={onClose}>
      <form
        className="modal-form"
        onSubmit={async event => {
          event.preventDefault()
          setSaving(true)
          setError('')
          try {
            await onCreate(name.trim().toLowerCase().replace(/\s+/g, '-'), description)
            onClose()
          } catch (caught) {
            setError(caught instanceof Error ? caught.message : 'Hermes לא הצליח לשמור את ה־Skill')
          } finally {
            setSaving(false)
          }
        }}
      >
        <label>
          <span>שם קצר לתהליך</span>
          <input required value={name} onChange={event => setName(event.target.value)} placeholder="סיכום לידים שבועי" />
        </label>
        <label>
          <span>איך התהליך עובד?</span>
          <textarea
            required
            rows={6}
            value={description}
            onChange={event => setDescription(event.target.value)}
            placeholder="אסוף את הלידים החדשים, חלק לפי דחיפות, וציין למי כדאי לחזור קודם…"
          />
        </label>
        <div className="info-inline">
          <Sparkles size={17} />
          <span>העוזר יוכל לשפר את ה־Skill בהמשך לפי המשוב שלך.</span>
        </div>
        {error ? <p className="form-error">{error}</p> : null}
        <div className="modal__actions">
          <button type="button" className="ghost-button" onClick={onClose}>
            ביטול
          </button>
          <button className="primary-button" disabled={saving}>
            {saving ? <LoaderCircle className="spin" size={16} /> : <Sparkles size={16} />} שמור Skill
          </button>
        </div>
      </form>
    </Modal>
  )
}
