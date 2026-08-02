import type { ProviderStatus } from './provider-readiness'
import { describeWhatsappProtection, type WhatsappGuardStatus } from './whatsapp-policy'
import type { Connection, ScheduledTask } from '../types'
import type { HealthComponent, HealthReport, LoadErrors } from './health'

// The support status panel: turn the already-authoritative runtime/provider/
// connection state into the rows the UI renders + one overall verdict. This layer
// never talks to Hermes itself — interpretHealthResponse (health.ts) does that;
// here we only PRESENT what callers have already resolved. Every path still fails
// CLOSED: a required layer that is not positively ok flips the header off "healthy",
// and a failed LIST read is an error row, never a silent healthy "0".

// Re-exported for panel consumers so they can import the builder and the row types
// they render from one place.
export type { HealthComponent, HealthReport, LoadErrors }

// The provider row. A configured key is NOT proof of usability, so we distinguish
// verified/usable (ok) from merely-configured-but-unverified (error — product needs a
// working provider) from absent (error). Provider is REQUIRED, so a not-usable provider
// is an ERROR that flips overall health, never an ignorable warning.
function providerRow(provider: ProviderStatus): HealthComponent {
  if (provider.provider_usable) {
    return { id: 'provider', label: 'ספק AI', value: `${provider.provider_label} · מאומת`, state: 'ok' }
  }
  if (provider.provider_configured) {
    return { id: 'provider', label: 'ספק AI', value: `${provider.provider_label} · מוגדר, טרם אומת`, state: 'error' }
  }
  const value = provider.provider_state === 'unknown' ? 'לא ניתן לאמת' : provider.provider_label
  return { id: 'provider', label: 'ספק AI', value, state: 'error' }
}

// Build the component rows + overall verdict for the support status panel from the
// already-authoritative runtime/provider/connection state. Overall health is the AND
// of every REQUIRED component (runtime + provider): either failing flips the header off
// "all healthy". Optional connectors stay warnings; a failed LIST read is an error row,
// never a silent healthy "0".
export function buildSystemHealth(input: {
  runtime: HermesRuntime | null
  provider: ProviderStatus
  connections: Connection[]
  tasks: ScheduledTask[]
  errors?: LoadErrors
  // undefined = no desktop bridge / not probed yet (skip the enforcement row — web/demo
  // has no enforcement concept); null = probed but no LIVE proof (a connected channel
  // then reads UNKNOWN/unprotected); a value = the live running-gateway guard proof.
  whatsappGuard?: WhatsappGuardStatus | null
}): HealthReport {
  const connected = (id: string) => input.connections.find(item => item.id === id)?.state === 'connected'
  const connErr = Boolean(input.errors?.connections)
  // A connector row: unknown (error) when the platform read failed — we must not claim
  // "לא מחובר" (known-disconnected) from a read we never got.
  const connectorRow = (id: string, label: string, ok: boolean): HealthComponent =>
    connErr
      ? { id, label, value: 'לא ידוע (קריאה נכשלה)', state: 'error' }
      : { id, label, value: ok ? 'מחובר' : 'לא מחובר', state: ok ? 'ok' : 'warning' }

  const cloudConnected = connected('whatsapp-cloud')
  const qrConnected = connected('whatsapp')
  const components: HealthComponent[] = [
    { id: 'runtime', label: 'Hermes Runtime', value: input.runtime?.running ? 'פועל' : 'לא פועל', state: input.runtime?.running ? 'ok' : 'error' },
    providerRow(input.provider),
    connectorRow('google', 'Google Workspace', connected('google')),
    connectorRow('telegram', 'Telegram', connected('telegram')),
    // Official (Meta Cloud) and unofficial (QR/Web) WhatsApp are surfaced SEPARATELY —
    // they are different trust levels, not one "WhatsApp".
    connectorRow('whatsapp-cloud', 'WhatsApp Business (הרשמי)', cloudConnected),
    connectorRow('whatsapp', 'WhatsApp אישי (QR)', qrConnected)
  ]
  // Enforcement health: a connected channel is "protected" only with a LIVE guard proof
  // from the running gateway — a policy file alone is not proof. Only shown once the
  // guard has been probed (not undefined) and something is connected.
  if (input.whatsappGuard !== undefined && !connErr) {
    const protection = describeWhatsappProtection({ cloudConnected, qrConnected, guard: input.whatsappGuard })
    if (protection) components.push({ id: 'whatsapp-policy', label: 'הגנת WhatsApp', value: protection.value, state: protection.state })
  }
  components.push(
    input.errors?.tasks
      ? { id: 'tasks', label: 'משימות מתוזמנות', value: 'קריאה נכשלה', state: 'error' }
      : { id: 'tasks', label: 'משימות מתוזמנות', value: `${input.tasks.filter(task => task.enabled).length} פעילות`, state: 'ok' }
  )
  const errored = components.some(component => component.state === 'error')
  const healthy = !errored
  return { healthy, summary: healthy ? 'הכול תקין' : 'דורש בדיקה', components }
}
