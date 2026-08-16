import { LoaderCircle, PlugZap, ShieldCheck } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { hermesClient } from '../../lib/hermes-client'
import { createCommunityProviderApi } from '../../lib/hermes/community-provider'
import type { HermesProviderApi, OAuthProvider } from '../../lib/hermes/providers'
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
  const [loadError, setLoadError] = useState('')
  const [targetError, setTargetError] = useState('')
  const [runtimeTarget, setRuntimeTarget] = useState<'resolving' | 'business' | 'community' | 'blocked'>('resolving')
  const communityTarget = runtimeTarget === 'community'
  const providerApi = useMemo<HermesProviderApi>(() => {
    const bridge = window.hermesDesktop
    return communityTarget && bridge ? createCommunityProviderApi(bridge) : hermesClient
  }, [communityTarget])

  useEffect(() => {
    let active = true
    void (async () => {
      let target: 'business' | 'community' = 'business'
      try {
        let status: CommunityRuntimeState | null = null
        try {
          status = await window.hermesDesktop?.getCommunityRuntime?.() ?? null
        } catch {
          // A probe failure must never let a stale community directory capture
          // a key. Business is the explicit safe fallback, surfaced below.
          if (active) setLoadError('לא ניתן לאמת מצב קהילה; החיבור יישמר ב־Hermes העסקי הראשי.')
        }
        if (status?.active === true && status.target === 'community') {
          target = 'community'
          const ready = await window.hermesDesktop!.startCommunityRuntime()
          if (!ready.running || !ready.gatewayStarted) {
            throw new Error(ready.error || 'Hermes הקהילתי אינו פועל במלואו.')
          }
        }
      } catch (caught) {
        if (!active) return
        setRuntimeTarget('blocked')
        setTargetError(caught instanceof Error ? caught.message : 'לא ניתן לקבוע בבטחה לאיזה Hermes לחבר את הספק.')
        setOauthLoaded(true)
        return
      }
      if (!active) return
      setRuntimeTarget(target)

      const api = target === 'community'
        ? createCommunityProviderApi(window.hermesDesktop!)
        : hermesClient
      try {
        const providers = await api.listOAuthProviders()
        if (!active) return
        setOauthProviders(providers)
      } catch (caught) {
        if (!active) return
        setOauthProviders(null)
        setLoadError(
          `לא ניתן לקרוא כרגע את קטלוג הספקים מ־Hermes. מוצגות אפשרויות החיבור הבסיסיות. ${
            caught instanceof Error ? caught.message : ''
          }`.trim()
        )
      } finally {
        if (active) setOauthLoaded(true)
      }
    })()
    return () => { active = false }
  }, [])

  const allOptions = buildProviderOptions(oauthProviders)
  // The isolated community bridge deliberately exposes OAuth + model selection,
  // never the generic /api/env writer used by API-key providers.
  const options = communityTarget
    ? allOptions.filter(option => option.ui === 'codex-oauth' || option.ui === 'device-flow')
    : allOptions
  const selected = options.find(option => option.id === provider) || options[0]
  const codex = oauthProviders?.find(item => item.id === 'openai-codex')

  if (runtimeTarget === 'resolving') {
    return (
      <Modal title="חיבור לספק AI" subtitle="פרטי החיבור נשמרים ב־Hermes בלבד, לא במעטפת." onClose={onClose}>
        <div className="info-inline"><LoaderCircle className="spin" size={17} /> בודק לאיזה Hermes החיבור שייך…</div>
      </Modal>
    )
  }

  if (runtimeTarget === 'blocked') {
    return (
      <Modal title="חיבור לספק AI" subtitle="פרטי החיבור נשמרים ב־Hermes בלבד, לא במעטפת." onClose={onClose}>
        <p className="form-error" role="alert">{targetError}</p>
      </Modal>
    )
  }

  // The community filter keeps only the two flows the isolated bridge can
  // actually complete, so a catalog without either leaves nothing renderable.
  // Say so instead of rendering `selected` as undefined and blanking the only
  // screen from which a provider can be connected.
  if (!selected) {
    return (
      <Modal title="חיבור לספק AI" subtitle="פרטי החיבור נשמרים ב־Hermes בלבד, לא במעטפת." onClose={onClose}>
        <p className="form-error" role="alert">
          Hermes לא הציע כרגע שום דרך חיבור נתמכת. נסה שוב מאוחר יותר או פנה לתמיכה.
        </p>
      </Modal>
    )
  }

  return (
    <Modal title="חיבור לספק AI" subtitle="פרטי החיבור נשמרים ב־Hermes בלבד, לא במעטפת." onClose={onClose}>
      <div className="info-inline" data-testid="provider-runtime-target">
        <ShieldCheck size={17} />
        {communityTarget
          ? 'החיבור יישמר ב־Hermes הקהילתי המבודד.'
          : 'החיבור יישמר ב־Hermes העסקי הראשי.'}
      </div>
      {loadError ? <p className="warning-box" role="status">{loadError}</p> : null}
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
          <CodexOAuth
            connected={Boolean(codex?.status?.logged_in)}
            providerApi={providerApi}
            probeExisting={!communityTarget}
            recordEvidence={!communityTarget}
            onConnected={onOAuthConnected}
          />
        ) : (
          <div className="info-inline"><LoaderCircle className="spin" size={17} /> בודק אם ChatGPT כבר מחובר…</div>
        )
      ) : selected.ui === 'device-flow' ? (
        <DeviceFlowOAuth
          key={selected.id}
          providerId={selected.id}
          providerApi={providerApi}
          recordEvidence={!communityTarget}
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
