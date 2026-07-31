import {
  Activity as ActivityIcon,
  Check,
  CheckCircle2,
  ChevronLeft,
  Download,
  FileArchive,
  HeartPulse,
  LoaderCircle,
  RefreshCw,
  ShieldCheck,
  TerminalSquare
} from 'lucide-react'
import type { HermesUpdateStatus } from '../../lib/hermes-client'
import type { Connection, ScheduledTask } from '../../types'

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

export function SupportScreen({
  runtime,
  versions,
  tasks,
  connections,
  onHealth,
  onRestart,
  onLogs,
  onDiagnostics,
  onUpdateCheck,
  onUpdateApply,
  updateStatus,
  updating,
  checking,
  toast
}: {
  runtime: HermesRuntime | null
  versions: Record<string, string>
  tasks: ScheduledTask[]
  connections: Connection[]
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
}) {
  const googleConnected = connections.find(item => item.id === 'google')?.state === 'connected'
  const telegramConnected = connections.find(item => item.id === 'telegram')?.state === 'connected'
  return (
    <main className="content-screen">
      <section className="page-heading">
        <div>
          <h2>תמיכה ותקינות</h2>
          <p>תמונה ברורה של מצב המערכת, בלי מידע רגיש.</p>
        </div>
        <button className="primary-button" onClick={onHealth} disabled={checking}>
          {checking ? <LoaderCircle className="spin" size={17} /> : <HeartPulse size={17} />}
          בדיקת תקינות
        </button>
      </section>
      {toast ? (
        <div className="success-toast">
          <CheckCircle2 size={18} /> {toast}
        </div>
      ) : null}
      <div className="support-grid">
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
          <CheckRow label="ספק AI" value="מנוהל ב־Hermes" />
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
        <section className="panel version-panel">
          <div className="panel__title">
            <h3>גרסאות ועדכונים</h3>
          </div>
          <div className="version-row">
            <span>Hermes Agent</span>
            <strong>{versions.hermes || runtime?.version || '0.19.0'}</strong>
            <span className="up-to-date">
              {updateStatus?.update_available ? 'יש עדכון' : updateStatus ? 'מעודכן' : 'לא נבדק'}
            </span>
          </div>
          <div className="version-row">
            <span>Hermes לעסק</span>
            <strong>{versions.shell || '0.1.0'}</strong>
            <span className="up-to-date">מעודכן</span>
          </div>
          <p className="version-note">
            עדכון Hermes משתמש ב־<code>hermes update</code>, כולל snapshot ובדיקת תקינות, ואינו מוחק Profile,
            שיחות, זיכרון או Skills.
          </p>
          {updateStatus?.message ? <p className="version-note">{updateStatus.message}</p> : null}
          <div className="modal__actions">
            <button className="outline-button outline-button--small" onClick={onUpdateCheck} disabled={updating}>
              {updating ? <LoaderCircle className="spin" size={15} /> : <RefreshCw size={15} />}
              בדוק עדכון
            </button>
            {updateStatus?.update_available && updateStatus.can_apply ? (
              <button className="primary-button" onClick={onUpdateApply} disabled={updating}>
                <Download size={15} /> עדכן עכשיו
              </button>
            ) : null}
          </div>
        </section>
      </div>
      <section className="panel support-actions">
        <div className="panel__title">
          <h3>פעולות תמיכה</h3>
        </div>
        <div className="support-action-grid">
          <button onClick={onRestart}>
            <span>
              <RefreshCw size={20} />
            </span>
            <strong>הפעל מחדש את Hermes</strong>
            <small>אתחול בטוח של שירות הרקע</small>
            <ChevronLeft size={16} />
          </button>
          <button onClick={onLogs}>
            <span>
              <TerminalSquare size={20} />
            </span>
            <strong>פתח Logs</strong>
            <small>מידע טכני לפתרון תקלות</small>
            <ChevronLeft size={16} />
          </button>
          <button onClick={onDiagnostics}>
            <span>
              <FileArchive size={20} />
            </span>
            <strong>צור חבילת אבחון</strong>
            <small>קובץ בטוח לשליחה לתמיכה</small>
            <Download size={16} />
          </button>
        </div>
      </section>
      <div className="diagnostic-safety">
        <ShieldCheck size={20} />
        <p>
          חבילת האבחון <strong>אינה כוללת</strong> API keys, תוכן שיחות, תוכן מיילים, קבצי עסק או פרטי לקוחות.
        </p>
      </div>
    </main>
  )
}
