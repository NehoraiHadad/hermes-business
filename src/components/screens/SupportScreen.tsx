import { CheckCircle2, HeartPulse, LoaderCircle, ShieldCheck } from 'lucide-react'
import type { HermesUpdateStatus } from '../../lib/hermes-client'
import type { ProviderReadiness } from '../../lib/provider-readiness'
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
  provider: ProviderReadiness
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
  return (
    <main className="content-screen">
      <section className="page-heading">
        <div>
          <h2>תמיכה ותקינות</h2>
          <p>תמונה ברורה של מצב המערכת, בלי מידע רגיש.</p>
        </div>
        <button className="primary-button" onClick={props.onHealth} disabled={props.checking}>
          {props.checking ? <LoaderCircle className="spin" size={17} /> : <HeartPulse size={17} />}
          בדיקת תקינות
        </button>
      </section>
      {props.toast ? (
        <div className="success-toast">
          <CheckCircle2 size={18} /> {props.toast}
        </div>
      ) : null}
      <div className="support-grid">
        <SupportStatusPanel
          runtime={props.runtime}
          provider={props.provider}
          connections={props.connections}
          tasks={props.tasks}
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
      <SupportActions
        onRestart={props.onRestart}
        onLogs={props.onLogs}
        onDiagnostics={props.onDiagnostics}
      />
      <div className="diagnostic-safety">
        <ShieldCheck size={20} />
        <p>
          חבילת האבחון <strong>אינה כוללת</strong> API keys, תוכן שיחות, תוכן מיילים, קבצי עסק או פרטי לקוחות.
        </p>
      </div>
    </main>
  )
}
