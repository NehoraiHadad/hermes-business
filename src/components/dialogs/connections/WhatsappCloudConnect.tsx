import { CheckCircle2, ExternalLink, LoaderCircle } from 'lucide-react'
import { useState } from 'react'
import { hermesClient } from '../../../lib/hermes-client'
import {
  createVerifyToken,
  validateCloudCredentials,
  webhookCallback
} from '../../../lib/whatsapp-cloud-config'
import { CloudField, CopyValue } from './WhatsappCloudFields'

type SavedSetup = {
  verifyToken: string
  localReady: boolean
  message: string
}

export function WhatsappCloudConnect({ onConnected }: { onConnected: () => void }) {
  const [phoneNumberId, setPhoneNumberId] = useState('')
  const [accessToken, setAccessToken] = useState('')
  const [appSecret, setAppSecret] = useState('')
  const [publicUrl, setPublicUrl] = useState('')
  const [saved, setSaved] = useState<SavedSetup | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const configure = async () => {
    const checked = validateCloudCredentials({ phoneNumberId, accessToken, appSecret })
    if ('error' in checked) {
      setError(checked.error)
      return
    }
    setBusy(true)
    setError('')
    try {
      // Safety precondition for EVERY mode: no WhatsApp channel may be configured
      // unless the messaging-policy guard is live. The demo backend satisfies this
      // through its fixture, so the check is never skipped in shipped code.
      const safety = await hermesClient.ensureWhatsappPolicy()
      if (!safety?.ok || !safety.enabled) throw new Error('רכיב ההגנה של WhatsApp אינו פעיל.')
      const verifyToken = createVerifyToken()
      const result = await hermesClient.configureWhatsappCloud({
        ...checked.credentials,
        verifyToken
      })
      setSaved({
        verifyToken,
        localReady: Boolean(result.ok),
        message: result.message || 'הפרטים נשמרו ב־Hermes.'
      })
      setAccessToken('')
      setAppSecret('')
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'שמירת חיבור Meta נכשלה.')
    } finally {
      setBusy(false)
    }
  }

  const test = async () => {
    setBusy(true)
    setError('')
    try {
      const result = await hermesClient.testMessagingPlatform('whatsapp_cloud')
      if (!result.ok) throw new Error(result.message || 'Hermes עדיין לא דיווח שהמתאם פעיל.')
      setSaved(current => current && { ...current, localReady: true, message: result.message || 'Hermes פעיל.' })
      onConnected()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'בדיקת החיבור נכשלה.')
    } finally {
      setBusy(false)
    }
  }

  if (saved) {
    const callback = webhookCallback(publicUrl)
    return (
      <div className="whatsapp-cloud">
        <div className={`oauth-summary ${saved.localReady ? 'oauth-summary--success' : ''}`}>
          <CheckCircle2 size={22} />
          <div>
            <strong>Hermes הוגדר דרך המנגנון הרשמי</strong>
            <p>{saved.message} כעת יש להשלים את רישום ה־webhook ב־Meta.</p>
          </div>
        </div>
        <CloudField
          label="כתובת HTTPS ציבורית שמפנה לפורט 8090 במחשב"
          value={publicUrl}
          onChange={setPublicUrl}
          placeholder="https://assistant.example.com"
        />
        <CopyValue label="Callback URL" value={callback} />
        <CopyValue label="Verify Token" value={saved.verifyToken} secret />
        <div className="info-box">
          ב־Meta בחר Webhooks ← WhatsApp, הדבק את שני הערכים והירשם לשדה messages.
          כתובת זמנית שמשתנה בכל הפעלה אינה מתאימה לחיבור קבוע.
        </div>
        <button
          className="link-button link-button--external"
          onClick={() => void hermesClient.openExternal('https://developers.facebook.com/apps/').catch(() => undefined)}
        >
          פתח את Meta Developers <ExternalLink size={14} />
        </button>
        {error ? <p className="form-error" role="alert">{error}</p> : null}
        <button className="primary-button" disabled={busy || !publicUrl.trim()} onClick={test}>
          {busy ? <LoaderCircle className="spin" size={16} /> : <CheckCircle2 size={16} />}
          בדוק שוב לאחר הגדרת Meta
        </button>
      </div>
    )
  }

  return (
    <div className="whatsapp-cloud modal-form">
      <div className="info-box">
        החיבור משתמש ישירות ב־Meta Cloud API של Hermes. ניתן למצוא את הערכים ב־Meta
        Developers ← WhatsApp ← API Setup וב־Settings ← Basic.
      </div>
      <CloudField label="Phone Number ID" value={phoneNumberId} onChange={setPhoneNumberId} />
      <CloudField label="Access Token" value={accessToken} onChange={setAccessToken} secret />
      <CloudField label="App Secret" value={appSecret} onChange={setAppSecret} secret />
      <button
        className="link-button link-button--external"
        onClick={() => void hermesClient.openExternal('https://developers.facebook.com/apps/').catch(() => undefined)}
      >
        פתח את Meta Developers <ExternalLink size={14} />
      </button>
      {error ? <p className="form-error" role="alert">{error}</p> : null}
      <button
        className="primary-button"
        disabled={busy || !phoneNumberId || !accessToken || !appSecret}
        onClick={configure}
      >
        {busy ? <LoaderCircle className="spin" size={16} /> : <CheckCircle2 size={16} />}
        שמור ב־Hermes והפעל
      </button>
    </div>
  )
}
