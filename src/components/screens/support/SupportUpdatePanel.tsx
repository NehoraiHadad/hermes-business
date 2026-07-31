import { Download, LoaderCircle, RefreshCw } from 'lucide-react'
import type { HermesUpdateStatus } from '../../../lib/hermes-client'

export function SupportUpdatePanel({
  runtime,
  versions,
  updateStatus,
  updating,
  onCheck,
  onApply
}: {
  runtime: HermesRuntime | null
  versions: Record<string, string>
  updateStatus: HermesUpdateStatus | null
  updating: boolean
  onCheck: () => void
  onApply: () => void
}) {
  return (
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
        לפני העדכון נשמר גיבוי מלא (ZIP) באמצעות <code>hermes backup</code>, ואז מורץ <code>hermes update --yes</code>
        {' '}(כולל snapshot מהיר של Hermes ובדיקת תקינות). Profile, שיחות, זיכרון ו־Skills נשמרים.
      </p>
      {runtime && runtime.compatible === false ? (
        <p className="version-note version-note--warn">
          גרסת Hermes המותקנת אינה בטווח הנתמך ({runtime.compatRange || '>=0.19.0 <0.20.0'}). עדכון אוטומטי חסום עד
          להתאמה.
        </p>
      ) : null}
      {updateStatus?.message ? <p className="version-note">{updateStatus.message}</p> : null}
      <div className="modal__actions">
        <button className="outline-button outline-button--small" onClick={onCheck} disabled={updating}>
          {updating ? <LoaderCircle className="spin" size={15} /> : <RefreshCw size={15} />}
          בדוק עדכון
        </button>
        {updateStatus?.update_available && updateStatus.can_apply ? (
          <button className="primary-button" onClick={onApply} disabled={updating}>
            <Download size={15} /> עדכן עכשיו
          </button>
        ) : null}
      </div>
    </section>
  )
}
