import { useId, useState } from 'react'
import { useScheduleTimezone } from '../../hooks/useScheduleTimezone'
import { DAY_LABELS, describeSchedule, parseTimeInput, scheduleDefault, type FriendlySchedule } from '../../lib/schedule'
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
  const timeErrorId = useId()
  const toggleDay = (day: number) => {
    if (value.mode !== 'weekly') return
    const days = value.days.includes(day) ? value.days.filter(d => d !== day) : [...value.days, day]
    onChange({ ...value, days })
  }

  // The time field keeps the RAW text the owner is typing while the MODEL only ever
  // holds a canonical 24h "HH:MM" (parseTimeInput) — a plain text box, because
  // <input type="time"> renders its format from the OS locale and would show an English
  // AM/PM widget above this component's 24h Hebrew summary.
  const [draft, setDraft] = useState(time)
  const [syncedTime, setSyncedTime] = useState(time)
  if (time !== syncedTime) {
    // The model's time changed from OUTSIDE the field (mode switch, an edited task):
    // adopt it. An EMPTY model time is what we ourselves emit for an unreadable draft,
    // so it must never wipe the text the owner is still typing.
    setSyncedTime(time)
    if (time && time !== parseTimeInput(draft)) setDraft(time)
  }
  const canonicalTime = parseTimeInput(draft)
  const timeError = draft.trim() !== '' && canonicalTime === null
  const changeTime = (raw: string) => {
    setDraft(raw)
    // Strict output: only a canonical time reaches the model; an unreadable entry clears
    // it, so no summary and no save can ever describe a time the model does not hold.
    // This runs on every input event — including the single programmatic value+input a
    // test driver's fill() produces, which never blurs.
    const next = parseTimeInput(raw) ?? ''
    if ('time' in value && value.time !== next) onChange({ ...value, time: next } as FriendlySchedule)
  }
  // Normalising on blur (not while typing) is what lets "8" survive long enough to
  // become "8:30"; unreadable text is left visible next to its error, never rewritten.
  const normalizeTime = () => {
    if (canonicalTime && canonicalTime !== draft) setDraft(canonicalTime)
  }

  // The summary describes the MODEL, so it stays silent while the model is missing the
  // date or the time it would need — it never fills the gap with a guess.
  const summary =
    value.mode === 'once' && !value.date
      ? 'בחר תאריך לתזמון החד־פעמי'
      : value.mode !== 'advanced' && !time
        ? 'הזן שעה כדי לראות מתי המשימה תרוץ'
        : describeSchedule(value)
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
          {/* dir="ltr" only flips the digits' own direction inside this RTL dialog; the
              error text stays OUTSIDE the label so the field's accessible name is
              exactly "שעה" (the installed-app probe fills it by that label). */}
          <input
            type="text"
            inputMode="numeric"
            dir="ltr"
            autoComplete="off"
            placeholder="08:30"
            value={draft}
            aria-invalid={timeError ? 'true' : undefined}
            aria-describedby={timeError ? timeErrorId : undefined}
            onChange={event => changeTime(event.target.value)}
            onBlur={normalizeTime}
          />
        </label>
      ) : null}
      {timeError ? (
        <small className="form-error" role="alert" id={timeErrorId}>
          שעה לא תקינה. אפשר למשל 08:30
        </small>
      ) : null}

      <small className="field-hint">{summary}</small>
      {value.mode !== 'advanced' ? (
        <small className="field-hint field-hint--tz">{describeScheduleTimezone(zone)}</small>
      ) : null}
      {dstWarning ? <small className="form-error" role="alert">{dstWarning}</small> : null}
    </div>
  )
}
