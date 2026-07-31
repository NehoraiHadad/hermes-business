import { LoaderCircle, PlugZap, ShieldCheck } from 'lucide-react'
import { useState } from 'react'
import { Modal } from '../ui/Modal'

export function ProviderModal({
  onClose,
  onConnect
}: {
  onClose: () => void
  onConnect: (provider: string, key: string) => Promise<void>
}) {
  const [provider, setProvider] = useState('openrouter')
  const [key, setKey] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  return (
    <Modal title="חיבור לספק AI" subtitle="המפתח נשמר ב־Hermes בלבד, לא במעטפת." onClose={onClose}>
      <form
        className="modal-form"
        onSubmit={async event => {
          event.preventDefault()
          setSaving(true)
          setError('')
          try {
            await onConnect(provider, key)
            onClose()
          } catch (caught) {
            setError(caught instanceof Error ? caught.message : 'החיבור נכשל')
          } finally {
            setSaving(false)
          }
        }}
      >
        <label>
          <span>ספק</span>
          <select value={provider} onChange={event => setProvider(event.target.value)}>
            <option value="openrouter">OpenRouter</option>
            <option value="anthropic">Anthropic</option>
            <option value="openai">OpenAI</option>
            <option value="gemini">Google Gemini</option>
          </select>
        </label>
        <label>
          <span>API key</span>
          <input
            required
            type="password"
            autoComplete="off"
            value={key}
            onChange={event => setKey(event.target.value)}
            placeholder="הדבק כאן את המפתח"
            dir="ltr"
          />
        </label>
        {error ? <p className="form-error">{error}</p> : null}
        <div className="info-inline">
          <ShieldCheck size={17} />
          <span>המפתח נבדק מול הספק ונשמר ב־.env של ה־Profile דרך ה־API הרשמי של Hermes.</span>
        </div>
        <div className="modal__actions">
          <button type="button" className="ghost-button" onClick={onClose}>
            ביטול
          </button>
          <button className="primary-button" disabled={saving}>
            {saving ? <LoaderCircle className="spin" size={16} /> : <PlugZap size={16} />} חבר
          </button>
        </div>
      </form>
    </Modal>
  )
}
