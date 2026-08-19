import { AlertTriangle, CheckCircle2, ChevronLeft, MessageCircle, ShieldAlert, ShieldCheck } from 'lucide-react'
import type { Connection } from '../../types'
import { ServiceIcon } from '../ui/ServiceIcon'

function ConnectionRow({
  connection,
  onConnect
}: {
  connection: Connection
  onConnect: (connection: Connection) => void
}) {
  return (
    <article className="connection-card" key={connection.id}>
      <ServiceIcon type={connection.icon} />
      <div className="connection-card__content">
        <h4>{connection.name}</h4>
        {connection.official === false ? (
          <div className="connection-risk-note">
            <ShieldAlert size={16} />
            <span>
              הרישום מתבצע באמצעות API צד שלישי. החיבור עלול להשתנות, להפסיק לעבוד
              או להביא להגבלת החשבון בהתאם למדיניות WhatsApp; מומלץ להשתמש במספר ייעודי.
            </span>
          </div>
        ) : null}
        <p>{connection.description}</p>
      </div>
      {connection.state === 'connected' ? (
        <button
          className="connected-button"
          onClick={() => onConnect(connection)}
          aria-label={`${connection.name}, מחובר. לחצו כדי לפתוח ולנהל את החיבור.`}
        >
          <CheckCircle2 size={16} /> מחובר · ניהול
        </button>
      ) : (
        <button
          className="outline-button outline-button--small"
          onClick={() => onConnect(connection)}
          aria-label={`חבר את ${connection.name}`}
        >
          חבר <ChevronLeft size={15} />
        </button>
      )}
    </article>
  )
}

export function ConnectionsScreen({
  connections,
  onConnect,
  loadError
}: {
  connections: Connection[]
  onConnect: (connection: Connection) => void
  // The last authoritative readiness read failed — `connections` still reflects the
  // prior/default state, not a proven-current one. Must never render as "נדרשת הגדרה"
  // (a confident negative) when we simply couldn't check; see useHermesData.
  loadError?: boolean
}) {
  return (
    <main className="content-screen">
      <section className="page-heading page-heading--compact">
        <div>
          <h2>חיבורים</h2>
          <p>אין צורך להגדיר הכול מראש. העוזר יציע חיבור רק כשהוא יעזור במשימה שביקשת.</p>
        </div>
      </section>

      <div className="intent-connection-note">
        <MessageCircle size={19} />
        <div>
          <strong>אפשר פשוט לבקש בשיחה</strong>
          <p>למשל: “בדוק מתי אני פנוי לפגישה”. אם דרוש יומן, העוזר יציע לחבר אותו ויוודא שהחיבור עובד.</p>
        </div>
      </div>

      <section className="panel connections-panel">
        <div className="panel__title">
          <h3>חיבורים זמינים</h3>
          {/* Deliberately no disconnect control, and no agent tool either. The
              authoritative off-switch is WhatsApp's own linked-devices logout on the
              phone: it removes the device on WhatsApp's side (deleting local creds
              does not — the phone keeps listing us), and it works when this app is
              broken, which is exactly when someone wants to cut the connection. We
              point at it instead of shadowing it. */}
          <span>בחר את השירות שמתאים לעסק; אפשר לפתוח ולנהל כל חיבור פעיל בכל רגע</span>
        </div>
        {loadError ? (
          <div className="list-state list-state--error">
            <span className="list-state__icon list-state__icon--error">
              <AlertTriangle size={20} />
            </span>
            <strong>לא הצלחנו לבדוק את מצב החיבורים</strong>
            <p>ייתכן שהחיבור ל־Hermes נקטע. רעננו את החלון, או בדקו את מצב המערכת במסך התמיכה.</p>
          </div>
        ) : (
          <div className="connections-list">
            {connections.map(connection => (
              <ConnectionRow key={connection.id} connection={connection} onConnect={onConnect} />
            ))}
          </div>
        )}
      </section>

      <div className="privacy-note">
        <ShieldCheck size={19} />
        <div><strong>השליטה נשארת אצלך</strong><p>רוצים לנתק? עושים את זה מהטלפון: וואטסאפ ← מכשירים מקושרים ← התנתקות.</p></div>
      </div>
    </main>
  )
}
