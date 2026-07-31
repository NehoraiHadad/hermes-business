import { QRCodeSVG } from 'qrcode.react'
import { Check, LoaderCircle, QrCode, RefreshCw } from 'lucide-react'
import { useWhatsappOnboarding } from '../../../hooks/useWhatsappOnboarding'
import { describeOnboarding } from '../../../lib/hermes/whatsapp-onboarding'

// Unofficial WhatsApp Web (Baileys) QR pairing, driven entirely from the shell
// through the official Hermes onboarding REST endpoints.
export function WhatsappQrConnect({ onConnected }: { onConnected: () => void }) {
  const { onboarding, error, busy, start, apply, cancel } = useWhatsappOnboarding('bot', '')
  const status = onboarding?.status
  const qr = onboarding?.qr_payload || ''

  const finish = async () => {
    if (await apply()) onConnected()
  }

  return (
    <div className="whatsapp-qr">
      {!onboarding ? (
        <button className="primary-button" disabled={busy} onClick={start}>
          {busy ? <LoaderCircle className="spin" size={16} /> : <QrCode size={16} />} התחל חיבור עם קוד QR
        </button>
      ) : null}

      {onboarding && status === 'waiting' && qr ? (
        <div className="whatsapp-qr__code">
          <QRCodeSVG value={qr} size={220} marginSize={4} level="M" />
          <p>{describeOnboarding(onboarding)}</p>
          <button className="ghost-button" onClick={start} disabled={busy}>
            <RefreshCw size={14} /> קוד חדש
          </button>
        </div>
      ) : null}

      {onboarding && status !== 'waiting' ? <p className="whatsapp-qr__status">{describeOnboarding(onboarding)}</p> : null}

      {status === 'connected' ? (
        <button className="primary-button" disabled={busy} onClick={finish}>
          {busy ? <LoaderCircle className="spin" size={16} /> : <Check size={16} />} סיים והפעל
        </button>
      ) : null}

      {onboarding && status !== 'connected' ? (
        <button className="link-button" onClick={cancel} disabled={busy}>
          בטל
        </button>
      ) : null}

      {error ? <p className="form-error">{error}</p> : null}
    </div>
  )
}
