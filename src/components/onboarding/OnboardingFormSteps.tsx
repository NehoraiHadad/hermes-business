import type { OnboardingData } from '../../types'

type StepProps = {
  data: OnboardingData
  patch: (values: Partial<OnboardingData>) => void
}

// The two text-heavy data-entry screens of the wizard (about you / your business),
// split from the lighter choice screens so each onboarding file stays focused.

export function ProfileStep({ data, patch }: StepProps) {
  return (
    <div className="onboarding__content">
      <span className="eyebrow">קצת עליך</span>
      <h1>איך תרצה לעבוד יחד?</h1>
      <div className="onboarding-form">
        <div className="form-row">
          <label>
            <span>השם שלך</span>
            <input value={data.userName} onChange={event => patch({ userName: event.target.value })} />
          </label>
          <label>
            <span>התפקיד שלך</span>
            <input value={data.role} onChange={event => patch({ role: event.target.value })} />
          </label>
        </div>
        <div className="form-row">
          <label>
            <span>שפה מועדפת</span>
            <select value={data.language} onChange={event => patch({ language: event.target.value })}>
              <option>עברית</option>
              <option>English</option>
              <option>עברית ואנגלית</option>
            </select>
          </label>
          <label>
            <span>סגנון תשובות</span>
            <select value={data.responseStyle} onChange={event => patch({ responseStyle: event.target.value })}>
              <option>קצר, ברור ומעשי</option>
              <option>מפורט עם הסברים</option>
              <option>ישיר ותמציתי מאוד</option>
            </select>
          </label>
        </div>
        <label>
          <span>מה הכי היית רוצה לחסוך?</span>
          <textarea
            rows={3}
            value={data.timeSavers}
            onChange={event => patch({ timeSavers: event.target.value })}
            placeholder="למשל: מעקב אחרי לידים, סיכומי בוקר ומענה ראשוני ללקוחות"
          />
        </label>
      </div>
    </div>
  )
}

export function BusinessStep({ data, patch }: StepProps) {
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
        <label>
          <span>מה אסור לעוזר להבטיח או להתחייב?</span>
          <textarea
            rows={2}
            value={data.restrictions}
            onChange={event => patch({ restrictions: event.target.value })}
            placeholder="למשל: מחיר סופי, מועד אספקה או החזר ללא אישור שלי"
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
      </div>
    </div>
  )
}
