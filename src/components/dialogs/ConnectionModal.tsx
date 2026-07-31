import type { Connection } from '../../types'
import { GoogleConnect } from './connections/GoogleConnect'
import { TelegramConnect } from './connections/TelegramConnect'
import { WhatsappConnect } from './connections/WhatsappConnect'

// Dispatches to the right guided connection flow. Each flow owns its own state and
// Hermes calls; this stays a thin router keyed on the connection id.
export function ConnectionModal({
  connection,
  onClose,
  onConnected
}: {
  connection: Connection
  onClose: () => void
  onConnected: (id: string) => void
}) {
  if (connection.id === 'telegram') {
    return <TelegramConnect connection={connection} onClose={onClose} onConnected={onConnected} />
  }
  if (connection.id === 'google') {
    return <GoogleConnect connection={connection} onClose={onClose} onConnected={onConnected} />
  }
  return <WhatsappConnect connection={connection} onClose={onClose} onConnected={onConnected} />
}
