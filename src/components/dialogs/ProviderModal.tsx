import { LoaderCircle, PlugZap, ShieldCheck } from 'lucide-react'
import { useEffect, useState } from 'react'
import { hermesClient } from '../../lib/hermes-client'
import type { OAuthProvider } from '../../lib/hermes/providers'
import { Modal } from '../ui/Modal'
import { CodexOAuth } from './providers/CodexOAuth'

export function ProviderModal({
  onClose,
  onConnect,
  onOAuthConnected
}: {
  onClose: () => void
  onConnect: (provider: string, key: string) => Promise<void>
  onOAuthConnected: () => void
}) {
  const [provider, setProvider] = useState('openai-codex')
  const [oauthProviders, setOauthProviders] = useState<OAuthProvider[]>([])
  const [oauthLoaded, setOauthLoaded] = useState(false)
  const [key, setKey] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const codex = oauthProviders.find(item => item.id === 'openai-codex')

  useEffect(() => {
    void hermesClient
      .listOAuthProviders()
      .then(setOauthProviders)
      .catch(caught => setError(caught instanceof Error ? caught.message : 'לא ניתן לבדוק חיבור OAuth'))
      .finally(() => setOauthLoaded(true))
  }, [])

  return (
    <Modal title="חיבור לספק AI" subtitle="פרטי החיבור נשמרים ב־Hermes בלבד, לא במעטפת." onClose={onClose}>
      <label className="modal-provider-select">
        <span>ספק</span>
        <select value={provider} onChange={event => setProvider(event.target.value)}>
          <option value="openai-codex">OpenAI Codex — חיבור ChatGPT</option>
          <option value="openrouter">OpenRouter — API key</option>
          <option value="anthropic">Anthropic — API key</option>
          <option value="openai">OpenAI API — API key</option>
          <option value="gemini">Google Gemini — API key</option>
        </select>
      </label>
      {provider === 'openai-codex' ? (
        oauthLoaded ? (
          <CodexOAuth connected={Boolean(codex?.status?.logged_in)} onConnected={onOAuthConnected} />
        ) : (
          <div className="info-inline"><LoaderCircle className="spin" size={17} /> בודק אם ChatGPT כבר מחובר…</div>
        )
      ) : (
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
            <span>API key של הספק</span>
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
            <span>המפתח מאומת מול הספק לפני ש־Hermes שומר אותו.</span>
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
      )}
    </Modal>
  )
}
