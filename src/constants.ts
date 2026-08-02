import { CalendarClock, CircleHelp, MessageCircle, PlugZap, WandSparkles } from 'lucide-react'
import type { ChatMessage, Connection, Screen } from './types'

// Canonical onboarding defaults live in the shared contract so React, Electron and
// the Hermes plugin cannot drift. Re-exported here to keep existing import sites.
export { EMPTY_ONBOARDING } from '../shared/onboarding-contract.js'

const ALL_NAV_ITEMS: Array<{ id: Screen; label: string; icon: typeof MessageCircle }> = [
  { id: 'chat', label: 'שיחות', icon: MessageCircle },
  { id: 'tasks', label: 'משימות מתוזמנות', icon: CalendarClock },
  { id: 'skills', label: 'מה העוזר יודע', icon: WandSparkles },
  { id: 'connections', label: 'חיבורים', icon: PlugZap },
  { id: 'support', label: 'תמיכה ותקינות', icon: CircleHelp }
]
// The simple shell exposes only the owner's everyday surfaces. Connections,
// support and the raw Skill registry remain reachable from the settings menu.
export const NAV_ITEMS = ALL_NAV_ITEMS
  .filter(item => item.id === 'chat' || item.id === 'tasks')
  .map(item => item.id === 'chat'
    ? { ...item, label: 'שיחה' }
    : { ...item, label: 'פעילות ומשימות' })

export const INITIAL_MESSAGES: ChatMessage[] = []

export const CONNECTIONS: Connection[] = [
  {
    id: 'google',
    name: 'Google Workspace',
    description: 'מייל, יומן, Drive, מסמכים ו־Sheets',
    state: 'available',
    official: true,
    icon: 'google'
  },
  {
    id: 'telegram',
    name: 'Telegram',
    description: 'דבר עם העוזר גם מהטלפון',
    state: 'available',
    official: true,
    icon: 'telegram'
  },
  {
    id: 'whatsapp-cloud',
    name: 'WhatsApp Business',
    description: 'החיבור הרשמי של Meta לעסקים',
    state: 'available',
    official: true,
    icon: 'whatsapp'
  },
  {
    id: 'whatsapp',
    name: 'WhatsApp אישי',
    description: 'חיבור אישי באמצעות סריקת QR ו־API צד שלישי',
    state: 'attention',
    official: false,
    icon: 'whatsapp'
  }
]
