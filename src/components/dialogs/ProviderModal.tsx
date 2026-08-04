import { LoaderCircle, PlugZap, ShieldCheck } from 'lucide-react'
import { useEffect, useState } from 'react'
import { hermesClient } from '../../lib/hermes-client'
import type { OAuthProvider } from '../../lib/hermes/providers'
import { buildProviderOptions } from '../../lib/provider-catalog'
import { Modal } from '../ui/Modal'
import { CodexOAuth } from './providers/CodexOAuth'
import { DeviceFlowOAuth } from './providers/DeviceFlowOAuth'
import { ExternalProviderCard } from './providers/ExternalProviderCard'

// The provider list is rendered from the LIVE Hermes catalog (user decision
// 2026-08-04): every `/api/providers/oauth` entry appears, mapped by its `flow`
// onto one of three UI shapes (device-flow / api-key / external card) in
// provider-catalog.ts. A failed catalog read falls back to the static
// pre-catalog list — the user is never left without a way to connect.
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
  const [oauthProviders, setOauthProviders] = useState<OAuthProvider[] | null>(null)
  const [oauthLoaded, setOauthLoaded] = useState(false)
  const [key, setKey] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    void hermesClient
      .listOAuthProviders()
      .then(setOauthProviders)
      .catch(() => setOauthProviders(null))
      .finally(() => setOauthLoaded(true))
  }, [])

  const options = buildProviderOptions(oauthProviders)
  const selected = options.find(option => option.id === provider) || options[0]
  const codex = oauthProviders?.find(item => item.id === 'openai-codex')

  return (
    <Modal title="חיבור לספק AI" subtitle="פרטי החיבור נשמרים ב־Hermes בלבד, לא במעטפת." onClose={onClose}>
      <label className="modal-provider-select">
        <span>ספק</span>
        <select value={selected.id} onChange={event => setProvider(event.target.value)}>
          {options.map(option => (
            <option key={option.id} value={option.id}>
              {option.label}
            </option>
          ))}
        </select>
      </label>
      {selected.ui === 'codex-oauth' ? (
        oauthLoaded ? (
          <CodexOAuth connected={Boolean(codex?.status?.logged_in)} onConnected={onOAuthConnected} />
        ) : (
          <div className="info-inline"><LoaderCircle className="spin" size={17} /> בודק אם ChatGPT כבר מחובר…</div>
        )
      ) : selected.ui === 'device-flow' ? (
        <DeviceFlowOAuth
          key={selected.id}
          providerId={selected.id}
          connectLabel={`התחבר עם ${selected.id === 'nous' ? 'Nous Portal' : selected.label.split(' — ')[0]}`}
          description="Hermes יבקש אישור בדפדפן באמצעות Device Code. הסיסמה והאסימון אינם עוברים דרך המעטפת."
          note={
            selected.id === 'nous'
              ? 'חשבון Nous חינמי כולל גישה למודלים חינמיים; שדרוג בתשלום דרך Nous Portal פותח מודלים וכלים נוספים.'
              : undefined
          }
          onConnected={onOAuthConnected}
        />
      ) : selected.ui === 'external' ? (
        <ExternalProviderCard option={selected} />
      ) : (
        <form
          className="modal-form"
          onSubmit={async event => {
            event.preventDefault()
            setSaving(true)
            setError('')
            try {
              await onConnect(selected.id, key)
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
          {error ? <p className="form-error" role="alert">{error}</p> : null}
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
