import { FolderPlus, LoaderCircle, Trash2 } from 'lucide-react'
import { usePartnerMode } from '../../../hooks/usePartnerMode'
import { tierLabel } from '../../../lib/partner'
import { PartnerModeSelector } from '../../PartnerModeSelector'
import { PartnerStatusRows } from './PartnerStatusRows'

const TIERS: SandboxTier[] = ['off', 'guard', 'docker']

// Interactive settings + truthful status for optional Business Partner mode, over
// the ONE Hermes profile. Every control drives the desktop bridge and re-reads
// the real applied state through the hook.
export function SupportPartnerPanel() {
  const { state, busy, error, apply, addRoot, setRootAccess, removeRoot } = usePartnerMode()

  if (!state) {
    return (
      <section className="panel partner-panel">
        <div className="panel__title"><h3>שותף עסקי וארגז חול</h3></div>
        <p className="partner-panel__hint"><LoaderCircle className="spin" size={16} /> טוען מצב…</p>
      </section>
    )
  }

  return (
    <section className="panel partner-panel">
      <div className="panel__title">
        <h3>שותף עסקי וארגז חול</h3>
        <span className={`state-label ${state.mode === 'partner' ? 'state-label--active' : ''}`}>
          {busy ? 'מחיל…' : state.mode === 'partner' ? 'שותף פעיל' : 'עוזר רגיל'}
        </span>
      </div>

      <PartnerModeSelector mode={state.mode} onChange={mode => void apply({ mode })} disabled={busy} />

      <fieldset className="partner-sandbox" disabled={busy}>
        <legend>ארגז חול (Sandbox)</legend>
        <div className="partner-sandbox__tiers" role="radiogroup" aria-label="רמת בידוד">
          {TIERS.map(tier => (
            <button
              key={tier}
              type="button"
              role="radio"
              aria-checked={state.sandbox === tier}
              className={`partner-tier ${state.sandbox === tier ? 'partner-tier--active' : ''}`}
              onClick={() => void apply({ sandbox: tier })}
            >
              {tierLabel(tier)}
            </button>
          ))}
        </div>

        <div className="partner-roots">
          <div className="partner-roots__head">
            <span>תיקיות מורשות</span>
            <button type="button" className="ghost-button" onClick={() => void addRoot()}>
              <FolderPlus size={15} /> הוסף תיקיה
            </button>
          </div>
          {state.roots.length === 0 ? (
            <p className="partner-panel__hint">לא נבחרו תיקיות. ב־Docker ללא תיקיות — שום דבר במחשב אינו נגיש.</p>
          ) : (
            state.roots.map(root => (
              <div key={root.path} className="partner-root">
                <span className="partner-root__path" title={root.path}>{root.path}</span>
                <div className="partner-root__access">
                  <button
                    type="button"
                    className={root.access === 'ro' ? 'partner-tier--active' : ''}
                    onClick={() => void setRootAccess(root.path, 'ro')}
                  >
                    קריאה
                  </button>
                  <button
                    type="button"
                    className={root.access === 'rw' ? 'partner-tier--active' : ''}
                    onClick={() => void setRootAccess(root.path, 'rw')}
                  >
                    כתיבה
                  </button>
                  <button type="button" className="ghost-button" onClick={() => void removeRoot(root.path)}>
                    <Trash2 size={15} />
                  </button>
                </div>
              </div>
            ))
          )}
        </div>

        <label className="partner-toggle">
          <input
            type="checkbox"
            checked={state.network}
            onChange={event => void apply({ network: event.target.checked })}
          />
          <span>רשת בתוך Docker (ברירת מחדל: סגורה)</span>
        </label>
        <label className="partner-toggle">
          <input
            type="checkbox"
            checked={state.checkins}
            onChange={event => void apply({ checkins: event.target.checked })}
          />
          <span>צ׳ק־אין יזום כמשימת cron רשמית — מחקר וטיוטה בלבד, ללא פעולה אוטומטית</span>
        </label>
        {state.checkins ? (
          <div className="partner-checkin">
            <label className="partner-checkin__cadence">
              <span>תדירות</span>
              <select
                value={state.checkinCadence}
                onChange={event => void apply({ checkinCadence: event.target.value as CheckinCadence })}
              >
                <option value="daily">כל יום (08:00)</option>
                <option value="weekdays">ימי חול (א׳–ה׳, 08:00)</option>
                <option value="weekly">שבועי (ראשון, 08:00)</option>
              </select>
            </label>
            <p className="partner-panel__hint">
              {state.checkin?.scheduled
                ? `משימה מתוזמנת פעילה: ${state.checkin.scheduleDisplay ?? ''}. נראית גם ב־Hermes המלא.`
                : state.checkin?.paused
                  ? 'המשימה קיימת ומושהית — תתחדש עם ההפעלה.'
                  : 'המשימה תיווצר בהרצה הבאה של הסנכרון.'}
            </p>
          </div>
        ) : null}
      </fieldset>

      {error ? <p className="partner-panel__error">{error}</p> : null}
      <PartnerStatusRows state={state} />
    </section>
  )
}
