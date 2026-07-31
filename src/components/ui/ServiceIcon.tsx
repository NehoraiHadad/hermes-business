import { MessageCircle, Send } from 'lucide-react'
import type { Connection } from '../../types'

export function ServiceIcon({ type }: { type: Connection['icon'] }) {
  if (type === 'google') {
    return (
      <span className="service-icon service-icon--google" aria-hidden="true">
        G
      </span>
    )
  }
  if (type === 'telegram') {
    return (
      <span className="service-icon service-icon--telegram" aria-hidden="true">
        <Send size={22} />
      </span>
    )
  }
  return (
    <span className="service-icon service-icon--whatsapp" aria-hidden="true">
      <MessageCircle size={23} />
    </span>
  )
}
