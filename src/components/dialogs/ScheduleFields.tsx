import { useScheduleTimezone } from '../../hooks/useScheduleTimezone'
import { DAY_LABELS, describeSchedule, scheduleDefault, type FriendlySchedule } from '../../lib/schedule'
import { describeScheduleTimezone, oneShotDstWarning } from '../../lib/timezone'

// Nontechnical schedule picker shared by the create and edit task dialogs. It edits
// a FriendlySchedule model only — the caller compiles it to a Hermes schedule string
// at the single tested boundary (lib/schedule.compileSchedule). Raw cron lives ONLY
// behind the "advanced" escape hatch, preserving full Hermes power for experts.

const MODE_LABELS: Record<FriendlySchedule['mode'], string> = {
  daily: 'כל יום',
  weekly: 'ימים נבחרים בשבוע',
  once: 'פעם אחת',
  advanced: 'מתקדם (תזמון Hermes)'
}

export function ScheduleFields({
  value,
  onChange
}: {
  value: FriendlySchedule
  onChange: (next: FriendlySchedule) => void
}) {
  const zone = useScheduleTimezone()
  const time = 'time' in value ? value.time : '08:00'
  const toggleDay = (day: number) => {
    if (value.mode !== 'weekly') return
    const days = value.days.includes(day) ? value.days.filter(d => d !== day) : [...value.days, day]
    onChange({ ...value, days })
  }
  const valid = value.mode !== 'once' || Boolean(value.date)
  // Honest DST guard: warn when a one-shot lands in a spring-forward gap (never occurs)
  // or a fall-back overlap (occurs twice) for the resolved zone, instead of silently picking.
  const dstWarning = value.mode === 'once' && value.date ? oneShotDstWarning(value.date, value.time, zone.tz) : null

  return (
    <div className="schedule-fields">
      <label>
        <span>מתי לרוץ?</span>
        <select value={value.mode} onChange={event => onChange(scheduleDefault(event.target.value as FriendlySchedule['mode'], time))}>
          {(Object.keys(MODE_LABELS) as FriendlySchedule['mode'][]).map(mode => (
            <option key={mode} value={mode}>
              {MODE_LABELS[mode]}
            </option>
          ))}
        </select>
      </label>

      {value.mode === 'weekly' ? (
        <div className="schedule-days" role="group" aria-label="ימים">
          {DAY_LABELS.map((label, day) => (
            <button
              type="button"
              key={day}
              className={`day-chip ${value.days.includes(day) ? 'day-chip--on' : ''}`}
              aria-pressed={value.days.includes(day)}
              onClick={() => toggleDay(day)}
            >
              {label}
            </button>
          ))}
        </div>
      ) : null}

      {value.mode === 'once' ? (
        <label>
          <span>תאריך</span>
          <input type="date" required value={value.date} onChange={event => onChange({ ...value, date: event.target.value })} />
        </label>
      ) : null}

      {value.mode === 'advanced' ? (
        <label>
          <span>תזמון Hermes</span>
          <input
            required
            value={value.expr}
            onChange={event => onChange({ ...value, expr: event.target.value })}
            placeholder="0 9 * * 0-4 · every 30m · 2026-08-05T09:00"
          />
          <small className="field-hint">ביטוי cron, ‎every 30m‎ או תאריך ISO — נשלח כפי שהוא ל־Hermes.</small>
        </label>
      ) : null}

      {value.mode !== 'advanced' ? (
        <label>
          <span>שעה</span>
          <input type="time" value={time} onChange={event => onChange({ ...value, time: event.target.value } as FriendlySchedule)} />
        </label>
      ) : null}

      <small className="field-hint">{valid ? describeSchedule(value) : 'בחר תאריך לתזמון החד־פעמי'}</small>
      {value.mode !== 'advanced' ? (
        <small className="field-hint field-hint--tz">{describeScheduleTimezone(zone)}</small>
      ) : null}
      {dstWarning ? <small className="form-error" role="alert">{dstWarning}</small> : null}
    </div>
  )
}
