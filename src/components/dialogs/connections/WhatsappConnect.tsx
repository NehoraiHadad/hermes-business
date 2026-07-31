import { ExternalLink, ShieldCheck } from 'lucide-react'
import type { Connection } from '../../../types'
import { Modal } from '../../ui/Modal'
import { ServiceIcon } from '../../ui/ServiceIcon'

// WhatsApp and any other connection: explain the official vs unofficial route and
// hand off to the guided setup inside Hermes. No credentials are captured here.
export function WhatsappConnect({
  connection,
  onClose,
  onConnected
}: {
  connection: Connection
  onClose: () => void
  onConnected: (id: string) => void
}) {
  return (
    <Modal title={`חיבור ${connection.name}`} subtitle={connection.description} onClose={onClose}>
      <div className="whatsapp-choice">
        <ServiceIcon type="whatsapp" />
        <h3>{connection.official ? 'המסלול הרשמי לעסק' : 'חיבור WhatsApp Web לא רשמי'}</h3>
        <p>
          {connection.official
            ? 'דורש Meta Business, מספר עסקי וכתובת webhook ציבורית. יציב וללא סיכון חסימת חשבון.'
            : 'מבוסס Baileys ומדמה WhatsApp Web. מהיר להגדרה, אך עלול להישבר או להוביל להגבלת החשבון.'}
        </p>
        {!connection.official ? (
          <div className="warning-box">
            <ShieldCheck size={18} />
            מומלץ להשתמש במספר ייעודי ולא לשלוח הודעות המוניות.
          </div>
        ) : null}
        <button
          className="primary-button"
          onClick={() => {
            onConnected(connection.id)
            onClose()
          }}
        >
          פתח הגדרה מודרכת ב־Hermes <ExternalLink size={16} />
        </button>
      </div>
    </Modal>
  )
}
