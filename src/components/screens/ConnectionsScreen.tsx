import { CheckCircle2, ChevronLeft, MessageCircle, ShieldCheck } from 'lucide-react'
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
        <h3>{connection.name}</h3>
        <p>{connection.description}</p>
      </div>
      {connection.state === 'connected' ? (
        <button className="connected-button" onClick={() => onConnect(connection)}>
          <CheckCircle2 size={16} /> מחובר
        </button>
      ) : (
        <button className="outline-button outline-button--small" onClick={() => onConnect(connection)}>
          חבר <ChevronLeft size={15} />
        </button>
      )}
    </article>
  )
}

export function ConnectionsScreen({
  connections,
  onConnect
}: {
  connections: Connection[]
  onConnect: (connection: Connection) => void
}) {
  const recommended = connections.filter(connection => connection.official !== false)
  const experimental = connections.filter(connection => connection.official === false)

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
          <h3>חיבורים מומלצים</h3>
          <span>שירותים רשמיים שאפשר לנתק בכל רגע</span>
        </div>
        <div className="connections-list">
          {recommended.map(connection => (
            <ConnectionRow key={connection.id} connection={connection} onConnect={onConnect} />
          ))}
        </div>
      </section>

      {experimental.length ? (
        <details className="advanced-connections">
          <summary>אפשרויות ניסיוניות</summary>
          <p>האפשרויות האלה אינן המסלול המומלץ ועלולות להיות פחות יציבות.</p>
          <div className="connections-list connections-list--experimental">
            {experimental.map(connection => (
              <ConnectionRow key={connection.id} connection={connection} onConnect={onConnect} />
            ))}
          </div>
        </details>
      ) : null}

      <div className="privacy-note">
        <ShieldCheck size={19} />
        <div><strong>השליטה נשארת אצלך</strong><p>הרשאות וחיבורים נשמרים במנגנונים של Hermes, ולא בתוך השיחה.</p></div>
      </div>
    </main>
  )
}
