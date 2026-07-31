import { ChevronLeft, Download, FileArchive, RefreshCw, TerminalSquare } from 'lucide-react'

export function SupportActions({
  onRestart,
  onLogs,
  onDiagnostics
}: {
  onRestart: () => void
  onLogs: () => void
  onDiagnostics: () => void
}) {
  return (
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
  )
}
