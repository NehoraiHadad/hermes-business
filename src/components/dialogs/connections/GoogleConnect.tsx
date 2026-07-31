import { ArrowLeft, Check, Cloud, ExternalLink, FileText, LoaderCircle } from 'lucide-react'
import { useState } from 'react'
import { hermesClient } from '../../../lib/hermes-client'
import type { Connection } from '../../../types'
import { Modal } from '../../ui/Modal'
import { ServiceIcon } from '../../ui/ServiceIcon'

// Google Workspace OAuth handled by the official google-workspace Skill: pick the
// Desktop-app JSON, then paste the redirect URL Hermes opens in the browser.
export function GoogleConnect({
  connection,
  onClose,
  onConnected
}: {
  connection: Connection
  onClose: () => void
  onConnected: (id: string) => void
}) {
  const [step, setStep] = useState(1)
  const [googleFile, setGoogleFile] = useState('')
  const [redirectUrl, setRedirectUrl] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const start = async () => {
    if (hermesClient.demo) {
      setStep(2)
      return
    }
    if (!googleFile) return
    setSaving(true)
    setError('')
    try {
      await window.hermesDesktop!.startGoogleSetup(googleFile, 'all')
      setStep(2)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'לא ניתן להתחיל את החיבור')
    } finally {
      setSaving(false)
    }
  }

  const finish = async () => {
    setSaving(true)
    setError('')
    try {
      if (!hermesClient.demo) await window.hermesDesktop!.finishGoogleSetup(redirectUrl)
      onConnected(connection.id)
      onClose()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'האישור לא הושלם')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal
      title="חיבור Google Workspace"
      subtitle="OAuth מנוהל על ידי ה־google-workspace Skill הרשמי של Hermes."
      onClose={onClose}
    >
      {step === 1 ? (
        <div className="modal-form">
          <div className="oauth-summary">
            <ServiceIcon type="google" />
            <div>
              <strong>הרשאות מבוקשות</strong>
              <p>Gmail, Calendar, Drive, Contacts, Sheets ו־Docs — כל ההרשאות ניתנות יחד. בגרסה זו לא ניתן לבחור שירותים בנפרד.</p>
            </div>
          </div>
          <label>
            <span>קובץ OAuth Desktop app מ־Google Cloud</span>
            <button
              type="button"
              className="file-picker"
              onClick={async () => {
                if (hermesClient.demo) setGoogleFile('client_secret_demo.json')
                else {
                  const file = await window.hermesDesktop!.chooseFile([
                    { name: 'Google OAuth JSON', extensions: ['json'] }
                  ])
                  if (file) setGoogleFile(file)
                }
              }}
            >
              <FileText size={18} />
              {googleFile ? googleFile.split(/[\\/]/).pop() : 'בחר קובץ JSON'}
            </button>
          </label>
          <button
            type="button"
            className="link-button link-button--external"
            onClick={() => window.hermesDesktop?.openExternal('https://console.cloud.google.com/apis/credentials')}
          >
            איך יוצרים קובץ כזה? <ExternalLink size={14} />
          </button>
          {error ? <p className="form-error">{error}</p> : null}
          <div className="modal__actions">
            <button className="ghost-button" onClick={onClose}>
              ביטול
            </button>
            <button className="primary-button" disabled={!googleFile || saving} onClick={start}>
              {saving ? <LoaderCircle className="spin" size={16} /> : <ArrowLeft size={16} />} המשך לאישור Google
            </button>
          </div>
        </div>
      ) : (
        <div className="modal-form">
          <div className="oauth-summary oauth-summary--success">
            <Cloud size={24} />
            <div>
              <strong>חלון Google נפתח בדפדפן</strong>
              <p>לאחר האישור הדפדפן עשוי להציג שגיאה ב־localhost:1 — זה צפוי.</p>
            </div>
          </div>
          <label>
            <span>הדבק את כתובת ההפניה המלאה מסרגל הכתובות</span>
            <textarea
              dir="ltr"
              rows={4}
              value={redirectUrl}
              onChange={event => setRedirectUrl(event.target.value)}
              placeholder="http://localhost:1/?code=..."
            />
          </label>
          {error ? <p className="form-error">{error}</p> : null}
          <div className="modal__actions">
            <button className="ghost-button" onClick={() => setStep(1)}>
              חזרה
            </button>
            <button className="primary-button" disabled={!redirectUrl || saving} onClick={finish}>
              {saving ? <LoaderCircle className="spin" size={16} /> : <Check size={16} />} סיים חיבור
            </button>
          </div>
        </div>
      )}
    </Modal>
  )
}
