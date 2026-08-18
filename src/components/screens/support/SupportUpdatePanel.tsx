import { Download, LoaderCircle, RefreshCw, RotateCcw, ShieldCheck, X } from 'lucide-react'
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

const BYTES_PER_MB = 1024 * 1024

function formatPublishedDate(iso: string | undefined): string | null {
  if (!iso) return null
  const date = new Date(iso)
  return Number.isNaN(date.getTime()) ? null : date.toLocaleDateString('he-IL')
}

/** Hebrew-locale MB, one decimal — the same toLocaleString('he-IL') the rest of the app uses. */
function formatMegabytes(bytes: number): string {
  return (bytes / BYTES_PER_MB).toLocaleString('he-IL', { maximumFractionDigits: 1 })
}

/**
 * Download progress. TWO genuinely different shapes, never merged:
 *  • totalBytes is a number  → determinate: a real percentage the owner can trust.
 *  • totalBytes is null      → INDETERMINATE: the response carried no usable
 *    length, so there is no denominator. We show motion + the bytes we actually
 *    received, and never invent a total (a fabricated "50%" is the same class of
 *    lie as a fabricated 'מעודכן', §1.4).
 * Both shapes carry a text alternative and full ARIA — the bar's width is never
 * the only way to know what is happening.
 */
function DownloadProgress({
  receivedBytes,
  totalBytes,
  verifying
}: {
  receivedBytes: number
  totalBytes: number | null
  verifying: boolean
}) {
  const determinate = typeof totalBytes === 'number' && totalBytes > 0
  const percent = determinate ? Math.min(100, Math.round((receivedBytes / (totalBytes as number)) * 100)) : null
  const received = formatMegabytes(receivedBytes)
  const label = verifying
    ? 'בודקים שקובץ ההתקנה תקין…'
    : determinate
      ? `הורדו ${received} MB מתוך ${formatMegabytes(totalBytes as number)} MB (${percent}%)`
      : `הורדו ${received} MB — גודל הקובץ אינו ידוע מראש`

  return (
    <div className="update-progress">
      <div
        className={`update-progress__track${determinate ? '' : ' update-progress__track--indeterminate'}`}
        role="progressbar"
        aria-label="התקדמות הורדת העדכון"
        // An indeterminate bar deliberately reports NO valuenow (there is nothing
        // to report) and says so with aria-busy, per the ARIA progressbar pattern.
        aria-valuemin={determinate ? 0 : undefined}
        aria-valuemax={determinate ? 100 : undefined}
        aria-valuenow={determinate ? (percent as number) : undefined}
        aria-valuetext={label}
        aria-busy={determinate ? undefined : true}
      >
        {/* Block child inside a block track: in an RTL layout it starts at the
            inline-start (right) edge on its own — no LTR assumption here. */}
        <div className="update-progress__fill" style={{ width: determinate ? `${percent}%` : '100%' }} />
      </div>
      <p className="version-note update-progress__label">{label}</p>
    </div>
  )
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
  // `managedUpdate` exists ONLY on an update-available verdict, and only main can
  // set it (it proved both release assets exist and both URLs are ours). Anything
  // else — absent, false, no verdict — means there is no one-click path.
  const managed = available?.managedUpdate === true
  const phase = companion.phase
  const inFlight = phase === 'downloading' || phase === 'verifying' || phase === 'applying'
  const checkingEither = updating || companion.checking || inFlight
  // The manual release page stays reachable whenever a managed update is not
  // possible OR did not work — a failed one-click update must never leave the
  // owner without a way forward.
  const manualFallback = Boolean(available) && (!managed || companion.error !== null)
  const target = companion.targetVersion

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

      {/* An install that was started and never confirmed (a previous launch). It is
          NOT cleared automatically — the state is genuinely unresolved and nothing
          is thrown away — so without this acknowledgement it would greet the owner
          on every single launch. Acknowledging hides the notice here only; the
          record itself stays where it is. */}
      {companion.stuckApply ? (
        <div className="version-note version-note--warn" role="status">
          {companion.stuckApply.reachedTarget ? (
            <span>
              הגרסה <bdi dir="ltr">{companion.stuckApply.targetVersion}</bdi> הותקנה, אך לא הצלחנו לוודא שהכול חזר
              לפעול כרגיל. כדאי לבדוק את מצב המערכת במסך הזה.
            </span>
          ) : (
            <span>
              התחילה התקנה של גרסה <bdi dir="ltr">{companion.stuckApply.targetVersion ?? '—'}</bdi> ולא ידוע אם
              הושלמה. הגרסה שפועלת עכשיו היא <bdi dir="ltr">{companion.stuckApply.currentVersion}</bdi>. לא בוצעה שום
              פעולה נוספת.
            </span>
          )}
          <div className="modal__actions">
            {companion.rollbackOffer && !companion.rollbackOffer.available && companion.rollbackOffer.message ? (
              <p className="version-note">{companion.rollbackOffer.message}</p>
            ) : null}
            <button className="ghost-button" onClick={companion.acknowledgeStuckApply}>
              <X size={15} /> הבנתי, אפשר להסתיר
            </button>
          </div>
        </div>
      ) : null}

      {available ? (
        <div>
          <p className="version-note">
            גרסה <bdi dir="ltr">{available.latest}</bdi> של תכל'ס זמינה
            {publishedDate ? ` · ${publishedDate}` : ''}
          </p>
          {/* release notes are UNTRUSTED, sanitized-to-plain-text data (companion-update-core.cjs
              sanitizeReleaseNotes) — rendered as plain text only, never markdown/HTML. */}
          {available.notes ? <p className="version-note">{available.notes}</p> : null}
          {managed && phase === 'idle' ? (
            <>
              <p className="version-note">
                אפשר לעדכן ישירות מכאן: תכל'ס יוריד את הגרסה החדשה, יבדוק שהקובץ תקין, ורק אחר כך יבקש את אישורכם
                להתקנה.
              </p>
              <div className="modal__actions">
                {/* The Hermes-agent row at the bottom of this same panel has a
                    button with the SAME visible label, so this one carries an
                    accessible name that says which of the two it updates —
                    otherwise a screen-reader user hears "עדכן עכשיו" twice with
                    nothing to tell them apart. */}
                <button
                  className="primary-button"
                  onClick={() => void companion.download()}
                  disabled={inFlight}
                  aria-label="עדכן עכשיו את תכל'ס"
                >
                  <Download size={15} /> עדכן עכשיו
                </button>
              </div>
            </>
          ) : null}
          {/* managedUpdate:false is an HONEST state, not an error: this release
              simply cannot be replaced from inside the app, and the manual path
              below is the whole answer. Deliberately worded as information. */}
          {available.managedUpdate === false ? (
            <p className="version-note">
              את הגרסה הזו לא ניתן לעדכן מתוך תכל'ס. אפשר להוריד ולהתקין אותה ידנית — הכול נשמר.
            </p>
          ) : null}
        </div>
      ) : null}

      {/* Return to the previous version. Shown only while nothing of ours is
          running, and only when MAIN proved a previous version actually ran on
          this machine — the offer is never rendered off a guess. Deliberately a
          quiet secondary action: going backwards is the exception, and putting it
          at the same weight as "update" would invite it as a routine choice. */}
      {phase === 'idle' && companion.rollbackOffer?.available ? (
        <div>
          <p className="version-note">
            אם משהו הפסיק לעבוד כמו קודם, אפשר לחזור לגרסה{' '}
            <bdi dir="ltr">{companion.rollbackOffer.target}</bdi> — זו הגרסה שהייתה כאן לפני העדכון האחרון.
          </p>
          <p className="version-note">
            ההגדרות והנתונים שלכם נשארים במקומם. שימו לב שדברים שנוספו בגרסה החדשה עשויים לא להופיע בגרסה הקודמת.
          </p>
          <div className="modal__actions">
            <button
              className="outline-button"
              onClick={() => void companion.rollback()}
              disabled={inFlight}
              aria-label={`חזרו לגרסה ${companion.rollbackOffer.target ?? ''} של תכל'ס`}
            >
              <RotateCcw size={15} /> חזרו לגרסה הקודמת
            </button>
          </div>
        </div>
      ) : null}

      {/* Download in progress — including the short "checking the file" step, which
          keeps the same bar so the owner sees one continuous operation. */}
      {phase === 'downloading' || phase === 'verifying' ? (
        <div>
          <DownloadProgress
            receivedBytes={companion.receivedBytes}
            totalBytes={companion.totalBytes}
            verifying={phase === 'verifying'}
          />
          <div className="modal__actions">
            <button className="outline-button" onClick={() => void companion.cancel()}>
              <X size={15} /> בטלו את ההורדה
            </button>
          </div>
        </div>
      ) : null}

      {/* Verified and waiting. Rendered off `phase` alone — not off a verdict — so a
          download verified in a PREVIOUS session comes back as an offer at launch
          instead of asking the owner to download the same file again. The install is
          a SECOND, separate consent: nothing is applied automatically. */}
      {phase === 'ready' ? (
        <div>
          <p className="version-note">
            <ShieldCheck size={14} /> הגרסה {target ? <bdi dir="ltr">{target}</bdi> : null} ירדה ואומתה, ומחכה לאישור
            שלכם.
          </p>
          <p className="version-note">
            כשתאשרו: תכל'ס ייסגר, ההתקנה תרוץ ברקע, והאפליקציה תעלה מחדש — כדקה. בזמן הזה העוזר לא יענה להודעות ולא
            יבצע משימות, וזה חוזר לעצמו מיד עם העלייה מחדש.
          </p>
          <div className="modal__actions">
            {/* Same action, different promise. `rollingBack` comes from MAIN's
                direction verdict, so the label can never say "update" while the
                journal is about to install something older. */}
            <button className="primary-button" onClick={() => void companion.apply()}>
              <Download size={15} /> {companion.rollingBack ? 'התקן את הגרסה הקודמת' : 'התקן והפעל מחדש'}
            </button>
          </div>
        </div>
      ) : null}

      {phase === 'applying' ? (
        <div>
          <p className="version-note" role="status">
            <LoaderCircle className="spin" size={14} /> מתחילים בהתקנה. תכל'ס ייסגר עוד רגע ויחזור מעצמו.
          </p>
          <div className="modal__actions">
            <button className="primary-button" disabled aria-disabled="true" aria-busy="true">
              <LoaderCircle className="spin" size={15} /> מתקינים…
            </button>
          </div>
        </div>
      ) : null}

      {/* Main's own words, verbatim. Its messages are already Hebrew, already
          user-safe, and already state that the machine was not changed — writing
          our own version of a failure main just described would be a second,
          competing account of the same event. 'cancelled' is the owner's own
          action, so it gets the neutral tone rather than the warning one. */}
      {companion.error ? (
        <p
          className={`version-note${companion.errorCode === 'cancelled' ? '' : ' version-note--warn'}`}
          role="status"
        >
          {companion.error}
        </p>
      ) : null}

      {manualFallback ? (
        downloadUrl ? (
          <div>
            <div className="modal__actions">
              <button
                className="outline-button"
                onClick={() => void hermesClient.openExternal(downloadUrl).catch(() => undefined)}
              >
                <Download size={15} /> פתח דף הורדה
              </button>
            </div>
            <p className="version-note">
              ההורדה נפתחת בדפדפן. הקובץ אינו חתום — Windows עשוי להציג אזהרה. מומלץ לאמת SHA-256 מול SHA256SUMS.txt
              שבדף ההורדה. סגרו את תכל'ס לפני הרצת ההתקנה.
            </p>
          </div>
        ) : (
          <p className="version-note">
            לא ניתן לפתוח קישור הורדה ישיר כרגע; ניתן למצוא את הגרסה בדף ה־Releases של הפרויקט ב־GitHub.
          </p>
        )
      ) : null}

      {companionVerdict?.status === 'unknown' ? (
        <p className="version-note">לא ניתן לבדוק עדכונים כרגע. לא בוצע שינוי.</p>
      ) : null}

      <div className="modal__actions">
        <button
          className="outline-button outline-button--small"
          onClick={handleCheck}
          disabled={checkingEither}
          aria-busy={checkingEither || undefined}
        >
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
