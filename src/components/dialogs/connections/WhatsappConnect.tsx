import { ShieldCheck } from 'lucide-react'
import type { Connection } from '../../../types'
import { Modal } from '../../ui/Modal'
import { ServiceIcon } from '../../ui/ServiceIcon'
import { WhatsappCloudConnect } from './WhatsappCloudConnect'
import { WhatsappPolicyForm } from './WhatsappPolicyForm'
import { WhatsappQrConnect } from './WhatsappQrConnect'

// WhatsApp connection dialog. Exposes both Hermes-supported modes transparently
// (official Meta Cloud vs unofficial WhatsApp Web/QR) and always surfaces the
// fail-closed reply policy — the safety control the business owner must set.
export function WhatsappConnect({
  connection,
  onClose,
  onConnected
}: {
  connection: Connection
  onClose: () => void
  onConnected: (id: string) => void
}) {
  const official = Boolean(connection.official)

  return (
    <Modal title={`חיבור ${connection.name}`} subtitle={connection.description} onClose={onClose}>
      <div className="whatsapp-connect">
        <div className="whatsapp-connect__head">
          <ServiceIcon type="whatsapp" />
          <div>
            <h3>{official ? 'WhatsApp Business (Meta Cloud)' : 'WhatsApp אישי (חיבור QR)'}</h3>
            <p>
              {official
                ? 'חיבור יציב ומאושר של Meta. דורש חשבון עסקי, מספר ייעודי ו־webhook ציבורי.'
                : 'הרישום מתבצע באמצעות API צד שלישי. החיבור עלול להשתנות, להפסיק לעבוד או להביא להגבלת החשבון בהתאם למדיניות WhatsApp.'}
            </p>
          </div>
        </div>

        {!official ? (
          <div className="warning-box">
            <ShieldCheck size={18} />
            מומלץ בחום להשתמש במספר WhatsApp ייעודי לעסק, ולא במספר הפרטי — ולהימנע מהודעות המוניות.
          </div>
        ) : null}

        <WhatsappPolicyForm
          groupsEnabled={!official}
          platform={official ? 'whatsapp_cloud' : 'whatsapp'}
        />

        <hr className="whatsapp-connect__divider" />

        {official ? (
          <WhatsappCloudConnect onConnected={() => onConnected(connection.id)} />
        ) : (
          <WhatsappQrConnect
            onConnected={() => {
              onConnected(connection.id)
              onClose()
            }}
          />
        )}
      </div>
    </Modal>
  )
}
