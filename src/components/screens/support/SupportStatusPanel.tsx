import { Activity as ActivityIcon, AlertTriangle, Check } from 'lucide-react'
import { useWhatsappGuard } from '../../../hooks/useWhatsappGuard'
import { buildSystemHealth, type HealthComponent, type LoadErrors } from '../../../lib/health-panel'
import type { ProviderStatus } from '../../../lib/provider-readiness'
import type { Connection, ScheduledTask } from '../../../types'

// Icon + accent per component state. `error` is visually distinct from `warning`
// so a stopped runtime never reads like an optional, disconnected connector.
function CheckRow({ component }: { component: HealthComponent }) {
  const icon =
    component.state === 'ok' ? <Check size={14} /> : component.state === 'error' ? <AlertTriangle size={14} /> : <ActivityIcon size={14} />
  return (
    <div className="check-row">
      <span className={`check-row__icon check-row__icon--${component.state}`}>{icon}</span>
      <span>{component.label}</span>
      <strong>{component.value}</strong>
    </div>
  )
}

export function SupportStatusPanel({
  runtime,
  provider,
  connections,
  tasks,
  errors
}: {
  runtime: HermesRuntime | null
  provider: ProviderStatus
  connections: Connection[]
  tasks: ScheduledTask[]
  errors?: LoadErrors
}) {
  // Re-probe the live guard whenever the runtime/connection snapshot changes (health
  // refresh) so a gateway reload or a policy write is reflected, not a stale proof.
  const whatsappGuard = useWhatsappGuard(runtime?.running ? connections : null)
  const report = buildSystemHealth({ runtime, provider, connections, tasks, errors, whatsappGuard })

  return (
    <section className="panel health-panel">
      <div className="panel__title">
        <h3>מצב המערכת</h3>
        <span className={`state-label ${report.healthy ? 'state-label--active' : ''}`}>{report.summary}</span>
      </div>
      {report.components.map(component => (
        <CheckRow key={component.id} component={component} />
      ))}
    </section>
  )
}
