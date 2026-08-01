import { AlertTriangle, ShieldCheck } from 'lucide-react'
import { tierLabel } from '../../../lib/partner'

function Row({ label, value, warn }: { label: string; value: string; warn?: boolean }) {
  return (
    <div className="check-row">
      <span className={`check-row__icon ${warn ? '' : 'check-row__icon--ok'}`}>
        {warn ? <AlertTriangle size={14} /> : <ShieldCheck size={14} />}
      </span>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  )
}

// Read-only, truthful reflection of what the runtime actually applied. No value
// here is optimistic — it all comes from the live native config and Docker probe.
export function PartnerStatusRows({ state }: { state: PartnerState }) {
  const { plan, docker } = state
  const dockerValue = state.sandbox === 'docker' ? (docker.ready ? 'מוכן' : docker.status) : 'לא בשימוש'
  return (
    <div className="partner-status">
      <Row label="מצב שותף" value={state.mode === 'partner' ? 'פעיל' : 'כבוי'} warn={false} />
      <Row
        label="בידוד בפועל"
        value={tierLabel(plan.effective)}
        warn={plan.degraded || plan.effective === 'off'}
      />
      <Row label="Backend של טרמינל" value={state.backend || plan.backend} />
      <Row
        label="בריאות Docker"
        value={dockerValue}
        warn={state.sandbox === 'docker' && !docker.ready}
      />
      <Row label="רשת" value={plan.network ? 'פתוחה' : 'סגורה'} warn={plan.network} />
      <Row label="תיקיות מחוברות" value={`${state.roots.length}`} />
      {plan.mounts.map(mount => (
        <Row
          key={mount.spec}
          label={mount.host}
          value={mount.ro ? 'קריאה בלבד' : 'קריאה/כתיבה'}
          warn={!mount.ro}
        />
      ))}
      {state.writeRoot ? <Row label="נתיב כתיבה בטוח" value={state.writeRoot} /> : null}
      {plan.invalidRoots.map(root => (
        <Row key={`bad-${root.path}`} label="תיקיה לא תקינה" value={`${root.path || '(ריק)'} — ${root.reason}`} warn />
      ))}
      {state.checkins ? (
        <Row
          label="צ׳ק־אין מתוזמן"
          value={state.checkin?.scheduled ? state.checkin.scheduleDisplay || 'פעיל' : state.checkin?.paused ? 'מושהה' : 'ממתין לסנכרון'}
          warn={!state.checkin?.scheduled}
        />
      ) : null}
      {state.checkins && state.checkin?.edited ? (
        <Row
          label="לוח זמנים שונה ב־Hermes"
          value={`${state.checkin.liveSchedule ?? ''} — יסונכרן חזרה לתדירות שנבחרה`}
          warn
        />
      ) : null}
      {state.checkinMismatch ? (
        <Row
          label="סתירת צ׳ק־אין"
          value={
            state.checkin?.scheduled
              ? 'משימה מתוזמנת עדיין פעילה למרות שהצ׳ק־אין כבוי — נדרש סנכרון מחדש'
              : 'הכוונה היא צ׳ק־אין פעיל אך אין משימה מתוזמנת — נדרש סנכרון מחדש'
          }
          warn
        />
      ) : null}
      {plan.degraded && plan.reason ? <Row label="מצב מוגבל" value={plan.reason} warn /> : null}
      {state.liveError ? <Row label="קריאת מצב חי" value={state.liveError} warn /> : null}
      <p className="partner-status__semantics">{plan.approvalSemantics}</p>
    </div>
  )
}
