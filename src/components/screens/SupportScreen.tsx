import { AlertTriangle, CheckCircle2, ChevronDown, HeartPulse, LoaderCircle, ShieldCheck } from 'lucide-react'
import type { LoadErrors } from '../../lib/health'
import type { HermesUpdateStatus } from '../../lib/hermes-client'
import type { ProviderStatus } from '../../lib/provider-readiness'
import type { Connection, ScheduledTask } from '../../types'
import { SupportActions } from './support/SupportActions'
import { SupportPartnerPanel } from './support/SupportPartnerPanel'
import { SupportStatusPanel } from './support/SupportStatusPanel'
import { SupportUpdatePanel } from './support/SupportUpdatePanel'

type SupportScreenProps = {
  runtime: HermesRuntime | null
  versions: Record<string, string>
  tasks: ScheduledTask[]
  connections: Connection[]
  provider: ProviderStatus
  loadErrors?: LoadErrors
  onHealth: () => void
  onRestart: () => void
  onLogs: () => void
  onDiagnostics: () => void
  onUpdateCheck: () => void
  onUpdateApply: () => void
  updateStatus: HermesUpdateStatus | null
  updating: boolean
  checking: boolean
  toast: string
}

export function SupportScreen(props: SupportScreenProps) {
  const ready = Boolean(props.runtime?.running && props.provider.provider_ready)
  const connectedCount = props.connections.filter(connection => connection.state === 'connected').length

  return (
    <main className="content-screen support-screen--simple">
      <section className="page-heading page-heading--compact">
        <div><h2>עזרה ותמיכה</h2><p>בדיקה פשוטה קודם; מידע טכני מוצג רק כשבאמת צריך אותו.</p></div>
      </section>

      <section className={ready ? 'support-summary support-summary--ready' : 'support-summary support-summary--attention'}>
        {ready ? <CheckCircle2 size={28} /> : <AlertTriangle size={28} />}
        <div>
          <h3>{ready ? 'העוזר מוכן לעבודה' : 'נדרשת בדיקה קצרה'}</h3>
          <p>
            {ready
              ? `${connectedCount} חיבורים פעילים. אם משהו לא מרגיש תקין, אפשר להריץ בדיקה בטוחה.`
              : 'נבדוק את המנוע ואת חיבור ה־AI ונציג פעולה ברורה לתיקון.'}
          </p>
        </div>
        <button className="primary-button" onClick={props.onHealth} disabled={props.checking}>
          {props.checking ? <LoaderCircle className="spin" size={17} /> : <HeartPulse size={17} />}
          בדוק עכשיו
        </button>
      </section>

      {props.toast ? <div className="success-toast"><CheckCircle2 size={18} /> {props.toast}</div> : null}

      <section className="panel support-help-panel">
        <div><h3>צריך עזרה?</h3><p>אפשר ליצור חבילת אבחון נקייה מסודות ולשלוח אותה לאיש תמיכה.</p></div>
        <button className="outline-button" onClick={props.onDiagnostics}>צור חבילת אבחון</button>
      </section>

      <details className="advanced-support">
        <summary><span>פרטים וכלים מתקדמים</span><ChevronDown size={17} /></summary>
        <div className="advanced-support__content">
          <div className="support-grid">
            <SupportStatusPanel
              runtime={props.runtime}
              provider={props.provider}
              connections={props.connections}
              tasks={props.tasks}
              errors={props.loadErrors}
            />
            <SupportUpdatePanel
              runtime={props.runtime}
              versions={props.versions}
              updateStatus={props.updateStatus}
              updating={props.updating}
              onCheck={props.onUpdateCheck}
              onApply={props.onUpdateApply}
            />
            <SupportPartnerPanel />
          </div>
          <SupportActions onRestart={props.onRestart} onLogs={props.onLogs} onDiagnostics={props.onDiagnostics} />
          <div className="diagnostic-safety">
            <ShieldCheck size={20} />
            <p>חבילת האבחון <strong>אינה כוללת</strong> מפתחות, תוכן שיחות, מיילים, קובצי עסק או פרטי לקוחות.</p>
          </div>
        </div>
      </details>
    </main>
  )
}
