import { CheckCircle2, ChevronLeft, ShieldCheck } from 'lucide-react'
import type { Connection } from '../../types'
import { ServiceIcon } from '../ui/ServiceIcon'

export function ConnectionsScreen({
  connections,
  onConnect
}: {
  connections: Connection[]
  onConnect: (connection: Connection) => void
}) {
  return (
    <main className="content-screen">
      <section className="page-heading">
        <div>
          <h2>חיבורים</h2>
          <p>חבר את הכלים שכבר משמשים את העסק. Hermes מנהל את החיבור מתחת למכסה.</p>
        </div>
      </section>
      <section className="panel connections-panel">
        <div className="panel__title">
          <h3>שירותים לעסק</h3>
          <span>החיבורים נשמרים רק במחשב שלך</span>
        </div>
        <div className="connections-grid">
          {connections.map(connection => (
            <article className="connection-card" key={connection.id}>
              <ServiceIcon type={connection.icon} />
              <div className="connection-card__content">
                <div>
                  <h3>{connection.name}</h3>
                  {connection.official === false ? <span className="unofficial-tag">לא רשמי</span> : null}
                </div>
                <p>{connection.description}</p>
                {connection.id === 'whatsapp' ? (
                  <small className="risk-note">מבוסס Baileys ועלול להיחסם. מומלץ מספר ייעודי.</small>
                ) : null}
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
          ))}
        </div>
      </section>
      <div className="privacy-note">
        <ShieldCheck size={19} />
        <div>
          <strong>השליטה נשארת אצלך</strong>
          <p>כל חיבור משתמש במנגנון הרשמי של Hermes. ניתן לנתק אותו בכל רגע מהממשק המלא.</p>
        </div>
      </div>
    </main>
  )
}
