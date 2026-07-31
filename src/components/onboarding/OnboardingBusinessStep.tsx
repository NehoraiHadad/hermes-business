import type { OnboardingData } from '../../types'

type Props = {
  data: OnboardingData
  patch: (values: Partial<OnboardingData>) => void
}

export function BusinessStep({ data, patch }: Props) {
  return (
    <div className="onboarding__content">
      <span className="eyebrow">העסק שלך</span>
      <h1>מה חשוב ש־Hermes יכיר?</h1>
      <div className="onboarding-form">
        <div className="form-row">
          <label>
            <span>שם העסק</span>
            <input value={data.businessName} onChange={event => patch({ businessName: event.target.value })} />
          </label>
          <label>
            <span>תחום הפעילות</span>
            <input value={data.industry} onChange={event => patch({ industry: event.target.value })} />
          </label>
        </div>
        <label>
          <span>שירותים ומוצרים</span>
          <textarea rows={2} value={data.offerings} onChange={event => patch({ offerings: event.target.value })} />
        </label>
        <div className="form-row">
          <label>
            <span>סוגי לקוחות</span>
            <input value={data.customers} onChange={event => patch({ customers: event.target.value })} />
          </label>
          <label>
            <span>שעות פעילות העסק</span>
            <input value={data.businessHours} onChange={event => patch({ businessHours: event.target.value })} />
          </label>
        </div>
        <label>
          <span>סגנון התקשורת של העסק</span>
          <input
            value={data.communicationStyle}
            onChange={event => patch({ communicationStyle: event.target.value })}
          />
        </label>
        <label>
          <span>מה אסור לעוזר להבטיח או להתחייב?</span>
          <textarea
            rows={2}
            value={data.restrictions}
            onChange={event => patch({ restrictions: event.target.value })}
            placeholder="מחיר סופי, מועד אספקה או החזר ללא אישור"
          />
        </label>
        <label>
          <span>תהליכים שחוזרים על עצמם</span>
          <textarea
            rows={2}
            value={data.recurringProcesses}
            onChange={event => patch({ recurringProcesses: event.target.value })}
          />
        </label>
        <label>
          <span>מערכות וקבצים שבהם העסק משתמש</span>
          <textarea
            rows={2}
            value={data.systems}
            onChange={event => patch({ systems: event.target.value })}
            placeholder="Google Drive, מערכת CRM, תיקיות או קובצי Excel"
          />
        </label>
      </div>
    </div>
  )
}
