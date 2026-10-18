import { MakomForm } from '../../../../shared/makom-form.js'
import { hermesClient } from '../../../lib/hermes-client'
import { Modal } from '../../ui/Modal'
export function MakomConnect({ onClose, onConnected }: { onClose: () => void; onConnected: (id: string, connected?: boolean) => void }) {
  return <Modal title="חיבור מקום" subtitle="מידע חי מהקהילה, לקריאה בלבד" onClose={onClose}>
    <MakomForm api={hermesClient.makomRequest} onChanged={connected => onConnected('makom', connected)} />
  </Modal>
}
