import { Activity as ActivityIcon, Check } from 'lucide-react'
import type { ProviderReadiness } from '../../../lib/provider-readiness'
import type { Connection, ScheduledTask } from '../../../types'

function CheckRow({
  label,
  value,
  state = 'ok'
}: {
  label: string
  value: string
  state?: 'ok' | 'warning'
}) {
  return (
    <div className="check-row">
      <span className={`check-row__icon ${state === 'ok' ? 'check-row__icon--ok' : ''}`}>
        {state === 'ok' ? <Check size={14} /> : <ActivityIcon size={14} />}
      </span>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  )
}

export function SupportStatusPanel({
  runtime,
  provider,
  connections,
  tasks
}: {
  runtime: HermesRuntime | null
  provider: ProviderReadiness
  connections: Connection[]
  tasks: ScheduledTask[]
}) {
  const connectionState = (id: string) => connections.find(item => item.id === id)?.state === 'connected'
  const googleConnected = connectionState('google')
  const telegramConnected = connectionState('telegram')

  return (
    <section className="panel health-panel">
      <div className="panel__title">
        <h3>מצב המערכת</h3>
        <span className={`state-label ${runtime?.running ? 'state-label--active' : ''}`}>
          {runtime?.running ? 'הכול תקין' : 'דורש בדיקה'}
        </span>
      </div>
      <CheckRow
        label="Hermes Runtime"
        value={runtime?.running ? 'פועל' : 'לא פועל'}
        state={runtime?.running ? 'ok' : 'warning'}
      />
      <CheckRow label="ספק AI" value={provider.label} state={provider.connected ? 'ok' : 'warning'} />
      <CheckRow
        label="Google Workspace"
        value={googleConnected ? 'מחובר' : 'לא מחובר'}
        state={googleConnected ? 'ok' : 'warning'}
      />
      <CheckRow
        label="Telegram"
        value={telegramConnected ? 'מחובר' : 'לא מחובר'}
        state={telegramConnected ? 'ok' : 'warning'}
      />
      <CheckRow label="משימות מתוזמנות" value={`${tasks.filter(task => task.enabled).length} פעילות`} />
    </section>
  )
}
