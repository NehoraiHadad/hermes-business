import { Download, LoaderCircle, RefreshCw } from 'lucide-react'
import { useCompanionUpdate } from '../../../hooks/useCompanionUpdate'
import { hermesClient, type HermesUpdateStatus } from '../../../lib/hermes-client'
// Derived, not duplicated: the supported range/floor come straight from the
// canonical compat module so this panel can never advertise a bound that has
// drifted from hermes-compat.json (asserted by hermes-compat-policy.test.ts).
import { HERMES_COMPAT_RANGE, HERMES_MIN_VERSION } from '../../../lib/hermes/compat'

// Status tag for the תכל'ס (companion) row (docs/specs/versioning.md §7.1). 'לא
// נבדק' is the ONLY label before any check completes (active or passive) —
// mirrors the Hermes row above it. 'מעודכן' is reachable ONLY through a real
// 'up-to-date' verdict from main (fail-closed: never rendered as a default —
// see §1.4, the doctrine violation this panel used to commit).
const COMPANION_STATUS_LABEL: Record<'never-checked' | CompanionUpdateStatus['status'], string> = {
  'never-checked': 'לא נבדק',
  'update-available': 'יש עדכון',
  'up-to-date': 'מעודכן',
  'dev-ahead': 'גרסה מקומית חדשה מהפורסם',
  unknown: 'לא ידוע'
}

function formatPublishedDate(iso: string | undefined): string | null {
  if (!iso) return null
  const date = new Date(iso)
  return Number.isNaN(date.getTime()) ? null : date.toLocaleDateString('he-IL')
}

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
  const companion = useCompanionUpdate()
  const companionVerdict = companion.verdict
  const available = companionVerdict?.status === 'update-available' ? companionVerdict : null
  const downloadUrl = available?.downloadUrl
  const publishedDate = formatPublishedDate(available?.publishedAt)
  const checkingEither = updating || companion.checking

  // ONE "בדוק עדכון" button checks BOTH surfaces (§7.1): Hermes via the existing
  // onCheck prop (useSupportActions) and the companion via its own hook — two
  // independent result rows from one action, kept here rather than threaded
  // through App.tsx/MainScreen.tsx (out of scope for this change) so the two
  // checks stay decoupled: either can fail without affecting the other's report.
  const handleCheck = () => {
    onCheck()
    void companion.check(true)
  }

  return (
    <section className="panel version-panel">
      <div className="panel__title">
        <h3>גרסאות ועדכונים</h3>
      </div>
      <div className="version-row">
        <span>Hermes Agent</span>
        <strong>{versions.hermes || runtime?.version || HERMES_MIN_VERSION}</strong>
        <span className="up-to-date">
          {updateStatus?.update_available ? 'יש עדכון' : updateStatus ? 'מעודכן' : 'לא נבדק'}
        </span>
      </div>
      <div className="version-row">
        <span>{"תכל'ס (האפליקציה)"}</span>
        {/* No fallback version number (§1.4): an unanswered bridge shows '—', never a
            fabricated '0.1.0'. bdi keeps the LTR version number from flipping inside
            the RTL sentence. */}
        <strong>{versions.shell ? <bdi dir="ltr">{versions.shell}</bdi> : '—'}</strong>
        <span className="up-to-date">
          {COMPANION_STATUS_LABEL[companionVerdict?.status ?? 'never-checked']}
        </span>
      </div>
      <p className="version-note">
        לפני העדכון נשמר גיבוי מלא (ZIP) באמצעות <code>hermes backup</code>, ואז מורץ <code>hermes update --yes</code>
        {' '}(כולל snapshot מהיר של Hermes ובדיקת תקינות). Profile, שיחות, זיכרון ו־Skills נשמרים.
      </p>
      {runtime && runtime.compatible === false ? (
        <p className="version-note version-note--warn">
          גרסת Hermes המותקנת אינה בטווח הנתמך ({runtime.compatRange || HERMES_COMPAT_RANGE}). עדכון אוטומטי חסום עד
          להתאמה.
        </p>
      ) : null}
      {updateStatus?.message ? <p className="version-note">{updateStatus.message}</p> : null}

      {available ? (
        <div>
          <p className="version-note">
            גרסה <bdi dir="ltr">{available.latest}</bdi> של תכל'ס זמינה
            {publishedDate ? ` · ${publishedDate}` : ''}
          </p>
          {/* release notes are UNTRUSTED, sanitized-to-plain-text data (companion-update-core.cjs
              sanitizeReleaseNotes) — rendered as plain text only, never markdown/HTML. */}
          {available.notes ? <p className="version-note">{available.notes}</p> : null}
          {downloadUrl ? (
            <div className="modal__actions">
              <button
                className="primary-button"
                onClick={() => void hermesClient.openExternal(downloadUrl).catch(() => undefined)}
              >
                <Download size={15} /> פתח דף הורדה
              </button>
            </div>
          ) : (
            <p className="version-note">
              לא ניתן לפתוח קישור הורדה ישיר כרגע; ניתן למצוא את הגרסה בדף ה־Releases של הפרויקט ב־GitHub.
            </p>
          )}
          <p className="version-note">
            ההורדה נפתחת בדפדפן. הקובץ אינו חתום — Windows עשוי להציג אזהרה. מומלץ לאמת SHA-256 מול
            SHA256SUMS.txt שבדף ההורדה. סגרו את תכל'ס לפני הרצת ההתקנה.
          </p>
        </div>
      ) : null}
      {companionVerdict?.status === 'unknown' ? (
        <p className="version-note">לא ניתן לבדוק עדכונים כרגע. לא בוצע שינוי.</p>
      ) : null}

      <div className="modal__actions">
        <button className="outline-button outline-button--small" onClick={handleCheck} disabled={checkingEither}>
          {checkingEither ? <LoaderCircle className="spin" size={15} /> : <RefreshCw size={15} />}
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
